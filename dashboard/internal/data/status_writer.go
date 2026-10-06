package data

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Scripts belong to the checkout, even when --path points at a data-only root.
// The executable fallback also supports launching the built TUI from elsewhere.
func statusWriterScript() (string, error) {
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
		script := filepath.Join(root, "set-status.mjs")
		if info, err := os.Stat(script); err == nil && !info.IsDir() {
			return filepath.Abs(script)
		}
	}
	return "", fmt.Errorf("status updates need set-status.mjs in the career-ops checkout")
}

func runStatusWriter(dataRoot, report, status, note string) error {
	script, err := statusWriterScript()
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
	args := []string{script, "--report-link", report, status, "--json"}
	if strings.EqualFold(status, "applied") {
		// A retry after a partial Applied save may need to repair missing
		// lifecycle observations even though the tracker is already Applied.
		args = append(args, "--repair-status-log")
		args = append(args, "--repair-followup")
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
	// The CLI treats these as non-fatal after the tracker commit. Surface that
	// partial success so a missing lifecycle record cannot disappear silently.
	if result.StatusLogged != nil && !*result.StatusLogged {
		return fmt.Errorf("status saved, but status-log append failed: %s", strings.TrimSpace(stderr.String()))
	}
	if repair := result.StatusLogRepair; repair != nil && repair.Error != "" {
		return fmt.Errorf("status saved, but status-log repair failed: %s", repair.Error)
	}
	if seed := result.FollowupSeeded; seed != nil && seed.Reason == "error" {
		return fmt.Errorf("status saved, but follow-up seeding failed: %s", seed.Error)
	}
	return nil
}
