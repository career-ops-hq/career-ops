package data

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// pendingRepairs remembers Applied saves that returned a partial-success error,
// so only an explicit retry of the same row asks set-status.mjs to repair the
// missing lifecycle records. A routine Applied save never requests repair.
//
// Entries are owned by the application that filed them, not keyed by selector:
// two rows may legitimately share one tracker # (#1704), so `--row 32` names a
// selector, not an application.
var (
	pendingRepairsMu sync.Mutex
	pendingRepairs   []*pendingRepair
)

// pendingRepair is one partial Applied save, filed against the row that made
// it: the tracker file, the row's company and role, and every selector the row
// answered to when it filed.
type pendingRepair struct {
	tracker          string
	company, role    string
	ids              []trackerIdentity
	ledger, followup bool
}

// ownedBy reports whether p was filed by the row now saving. Company and role
// say which application it is, because a shared tracker # makes `--row 32` name
// two of them. An identity must still match, so two requisitions sharing one
// company and title stay apart; a merge that adds a report link leaves the
// tracker # it filed under, and that is what the retry matches on.
func (p *pendingRepair) ownedBy(tracker string, app model.CareerApplication, ids []trackerIdentity) bool {
	if p.tracker != tracker || !sameRowLabel(p.company, app.Company) || !sameRowLabel(p.role, app.Role) {
		return false
	}
	// Reports 7 and 9 under one company, title and tracker #32 are two
	// applications, and their shared `--row 32` must not join them. Only a
	// filed report identity rules: without one, the tracker # still owns the
	// retry, which is how a merge may add the report link later.
	if mine, ok := reportIdentity(p.ids); ok {
		if theirs, ok := reportIdentity(ids); ok && mine != theirs {
			return false
		}
	}
	for _, mine := range p.ids {
		for _, theirs := range ids {
			if mine == theirs {
				return true
			}
		}
	}
	return false
}

// reportIdentity returns the report selector among ids, if it carries one.
func reportIdentity(ids []trackerIdentity) (trackerIdentity, bool) {
	for _, id := range ids {
		if strings.HasPrefix(id.flag, "--report") {
			return id, true
		}
	}
	return trackerIdentity{}, false
}

func sameRowLabel(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

// mergeIdentities unions add into have, so a row that files again under a new
// selector stays findable under the old one too.
func mergeIdentities(have, add []trackerIdentity) []trackerIdentity {
	for _, id := range add {
		if !slices.Contains(have, id) {
			have = append(have, id)
		}
	}
	return have
}

// CheckoutScriptPath resolves system scripts, even when --path points at a data-only root.
// The executable fallback also supports launching the built TUI from elsewhere.
func CheckoutScriptPath(name string) (string, error) {
	roots := []string{getRepoRoot()}
	if executable, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(executable); err == nil {
			executable = resolved
		}
		roots = append(roots, filepath.Dir(executable), filepath.Dir(filepath.Dir(executable)))
	}
	for _, root := range roots {
		if info, err := os.Stat(filepath.Join(root, "path-resolver.mjs")); err != nil || info.IsDir() {
			continue
		}
		script := filepath.Join(root, name)
		if info, err := os.Stat(script); err == nil && !info.IsDir() {
			return filepath.Abs(script)
		}
	}
	return "", fmt.Errorf("dashboard actions need %s in the career-ops checkout", name)
}

// runStatusWriter runs set-status.mjs against the row named by the first of
// app's trackerIdentities. The remaining ones name the same row through the
// other selector and are used for the pending-repair bookkeeping only.
func runStatusWriter(dataRoot string, app model.CareerApplication, status, note string) error {
	ids := trackerIdentities(app)
	if len(ids) == 0 {
		return fmt.Errorf("status write needs a row selector")
	}
	script, err := CheckoutScriptPath("set-status.mjs")
	if err != nil {
		return err
	}
	tracker, err := canonicalPath(resolveTrackerPath(dataRoot))
	if err != nil {
		return fmt.Errorf("resolve tracker path: %w", err)
	}
	root, err := filepath.Abs(dataRoot)
	if err != nil {
		return err
	}
	// --detach-jd-archive: a move into Interview may start a JD archive that can
	// outlast the 30s budget below, and this runs inside Bubble Tea's Update, so
	// waiting froze the TUI and then reported a saved status as timed out.
	args := []string{script, ids[0].flag, ids[0].value, status, "--detach-jd-archive", "--json"}
	// The flag keeps the two number spaces apart, so report #32 and row #32 are
	// never one row — but two rows may share tracker #32 (#1704), and both then
	// answer to `--row 32`, so ownedBy decides whose repair this is. A repair is
	// filed under the selector the failed write used and found again under every
	// identity its own row carries now: a merge can add report #7 to the row
	// saved as row #32, and the retry must still find it. Two reports on the
	// two sides disagreeing is proof they are not one row.
	if strings.EqualFold(status, "applied") {
		// Only a retry after a partial Applied save may repair missing
		// lifecycle observations even though the tracker is already Applied.
		pendingRepairsMu.Lock()
		var pending struct{ ledger, followup bool }
		for _, p := range pendingRepairs {
			if !p.ownedBy(tracker, app, ids) {
				continue
			}
			pending.ledger = pending.ledger || p.ledger
			pending.followup = pending.followup || p.followup
		}
		pendingRepairsMu.Unlock()
		if pending.ledger {
			args = append(args, "--repair-status-log")
		}
		if pending.followup {
			args = append(args, "--repair-followup")
		}
	}
	markPending := func(ledger, followup bool) {
		pendingRepairsMu.Lock()
		defer pendingRepairsMu.Unlock()
		for _, p := range pendingRepairs {
			if p.ownedBy(tracker, app, ids) {
				p.ledger = p.ledger || ledger
				p.followup = p.followup || followup
				p.ids = mergeIdentities(p.ids, ids)
				return
			}
		}
		pendingRepairs = append(pendingRepairs, &pendingRepair{
			tracker: tracker, company: app.Company, role: app.Role,
			ids: ids, ledger: ledger, followup: followup,
		})
	}
	if note != "" {
		args = append(args, "--note="+note)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", args...)
	cmd.Dir = filepath.Dir(script)
	// Pass the exact reader target, including legacy/relative overrides, rather
	// than letting the child's cwd or inherited root choose a different tracker.
	boundedWait := func(name string) string {
		wait := envMilliseconds(name, 10*time.Second)
		if wait > 10*time.Second {
			wait = 10 * time.Second
		}
		return strconv.FormatInt(wait.Milliseconds(), 10)
	}
	cmd.Env = append(cmd.Environ(), "CAREER_OPS_ROOT="+root, "CAREER_OPS_TRACKER="+tracker,
		"CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS="+boundedWait("CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS"),
		"CAREER_OPS_FOLLOWUPS_LOCK_TIMEOUT_MS="+boundedWait("CAREER_OPS_FOLLOWUPS_LOCK_TIMEOUT_MS"))
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, runErr := cmd.Output()
	if ctx.Err() != nil {
		return fmt.Errorf("status update timed out; the change may or may not have been applied")
	}
	var result struct {
		Changed         *bool  `json:"changed"`
		NewStatus       string `json:"newStatus"`
		Error           string `json:"error"`
		StatusLogged    *bool  `json:"statusLogged"`
		StatusLogRepair *struct {
			Repaired bool   `json:"repaired"`
			Error    string `json:"error"`
		} `json:"statusLogRepair"`
		FollowupSeeded *struct {
			Reason string `json:"reason"`
			Error  string `json:"error"`
		} `json:"followupSeeded"`
	}
	parseErr := json.Unmarshal(stdout, &result)
	if result.Error != "" {
		return fmt.Errorf("status update: %s", result.Error)
	}
	if runErr != nil {
		return fmt.Errorf("run set-status.mjs: %w: %s", runErr, strings.TrimSpace(stderr.String()))
	}
	if parseErr != nil || result.Changed == nil || result.NewStatus == "" {
		return fmt.Errorf("set-status.mjs returned no valid result; reload to check whether the change was applied")
	}
	// A current set-status.mjs fails the command when the ledger cannot be
	// written, and puts the tracker row back. This branch remains for a writer
	// that still commits the row and reports statusLogged false.
	if result.StatusLogged != nil && !*result.StatusLogged {
		markPending(true, false)
		return fmt.Errorf("status saved, but status-log append failed: %s", strings.TrimSpace(stderr.String()))
	}
	if repair := result.StatusLogRepair; repair != nil && repair.Error != "" {
		markPending(true, false)
		return fmt.Errorf("status saved, but status-log repair failed: %s", repair.Error)
	}
	if seed := result.FollowupSeeded; seed != nil && seed.Reason == "error" {
		markPending(false, true)
		return fmt.Errorf("status saved, but follow-up seeding failed: %s", seed.Error)
	}
	// Clear only what this row owns: another application sharing its tracker #
	// may be holding a repair the system still owes (#1704).
	pendingRepairsMu.Lock()
	kept := pendingRepairs[:0]
	for _, p := range pendingRepairs {
		if !p.ownedBy(tracker, app, ids) {
			kept = append(kept, p)
		}
	}
	pendingRepairs = kept
	pendingRepairsMu.Unlock()
	return nil
}
