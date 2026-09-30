package data

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

func TestDashboardStatusLifecycleMatchesCLIAndWeb(t *testing.T) {
	for _, caller := range []string{"dashboard", "cli", "web"} {
		t.Run(caller, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
			t.Setenv("CAREER_OPS_FOLLOWUPS_LOCK", "")
			before := statusTargetHeader + strings.Replace(statusTargetRow, "| Applied |", "| Evaluated |", 1)
			root, tracker := writeTracker(t, before)
			// The explicit dashboard --path must win over inherited data root settings.
			decoy := t.TempDir()
			t.Setenv("CAREER_OPS_ROOT", decoy)
			t.Setenv("CAREER_OPS_DATA_DIR", decoy)
			update := func(status, note string) {
				t.Helper()
				if caller == "dashboard" {
					if err := UpdateApplicationStatusAndNotes(root, model.CareerApplication{Number: 42, ReportNumber: "7"}, status, note); err != nil {
						t.Fatal(err)
					}
					return
				}
				args := []string{filepath.Join(getRepoRoot(), "set-status.mjs"), "--row", "42", status, "--json"}
				if note != "" {
					args = append(args, "--note", note)
				}
				if caller == "web" {
					args = append(args, "--source", "web")
				}
				cmd := exec.Command("node", args...)
				cmd.Env = append(os.Environ(), "CAREER_OPS_TRACKER="+tracker, "CAREER_OPS_ROOT="+root)
				if out, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("%v: %s", err, out)
				}
			}
			update("Applied", "sent application")
			update("Applied", "sent application")
			followups, err := os.ReadFile(filepath.Join(filepath.Dir(tracker), "follow-ups.md"))
			if err != nil {
				t.Fatal(err)
			}
			if count := strings.Count(string(followups), "next #42 "); count != 1 {
				t.Fatalf("want one pin, got %d: %s", count, followups)
			}
			update("Rejected", "")
			ledger, err := os.ReadFile(filepath.Join(filepath.Dir(tracker), "status-log.tsv"))
			if err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(strings.TrimSpace(string(ledger)), "\n")
			if len(lines) != 2 {
				t.Fatalf("want exactly two transitions: %s", ledger)
			}
			source := "set-status"
			if caller == "web" {
				source = "web"
			}
			for i, pair := range []string{"Evaluated\tApplied", "Applied\tRejected"} {
				want := "42\t" + time.Now().Format("2006-01-02") + "\t" + pair + "\t" + source
				if strings.TrimSpace(lines[i]) != want {
					t.Fatalf("ledger row = %q, want %q", lines[i], want)
				}
			}
			apps := ParseApplications(root)
			if len(apps) != 1 || apps[0].Status != "Rejected" || apps[0].Notes != "original; sent application" {
				t.Fatalf("unexpected application: %+v", apps)
			}
			if entries, err := os.ReadDir(decoy); err != nil || len(entries) != 0 {
				t.Fatalf("wrote into inherited root: %v, %v", entries, err)
			}
		})
	}
}

func TestDashboardStatusReportsLifecycleFailure(t *testing.T) {
	for _, sidecar := range []string{"status-log.tsv", "follow-ups.md"} {
		t.Run(sidecar, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			before := statusTargetHeader + strings.Replace(statusTargetRow, "| Applied |", "| Evaluated |", 1)
			root, tracker := writeTracker(t, before)
			if err := os.Mkdir(filepath.Join(filepath.Dir(tracker), sidecar), 0o755); err != nil {
				t.Fatal(err)
			}
			err := UpdateApplicationStatus(root, model.CareerApplication{ReportNumber: "7"}, "Applied")
			if err == nil || !strings.Contains(err.Error(), "status saved, but") {
				t.Fatalf("missing partial success warning: %v", err)
			}
			apps := ParseApplications(root)
			if len(apps) != 1 || apps[0].Status != "Applied" {
				t.Fatalf("saved status must stay visible: %+v", apps)
			}
		})
	}
}

func TestDashboardStatusReportsBusyTracker(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	t.Setenv("CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS", "30")
	t.Setenv("CAREER_OPS_TRACKER_LOCK_RETRY_MS", "5")
	before := statusTargetHeader + statusTargetRow
	root, tracker := writeTracker(t, before)
	lock, err := acquireTrackerLock(tracker, defaultTrackerLockOptions())
	if err != nil {
		t.Fatal(err)
	}
	defer lock.release()
	err = UpdateApplicationStatus(root, model.CareerApplication{ReportNumber: "7"}, "Interview")
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "lock") {
		t.Fatalf("missing lock failure: %v", err)
	}
	assertStatusTargetBytes(t, tracker, before)
}

func TestDashboardStatusRequiresNode(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	before := statusTargetHeader + statusTargetRow
	root, tracker := writeTracker(t, before)
	t.Setenv("PATH", t.TempDir())
	if err := UpdateApplicationStatus(root, model.CareerApplication{ReportNumber: "7"}, "Interview"); err == nil {
		t.Fatal("missing node must fail")
	}
	assertStatusTargetBytes(t, tracker, before)
}

func TestDashboardStatusRejectsInvalidWriterResults(t *testing.T) {
	for _, body := range []string{"console.log('not json')", "console.log('{}')", "console.log(JSON.stringify({changed:true,newStatus:'Interview'})); process.exit(1)", "console.log(JSON.stringify({error:'writer refused'}))"} {
		t.Run(body, func(t *testing.T) {
			root := t.TempDir()
			writeStatusTarget(t, filepath.Join(root, "path-resolver.mjs"), "")
			writeStatusTarget(t, filepath.Join(root, "set-status.mjs"), body)
			cwd, err := os.Getwd()
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Chdir(root); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := os.Chdir(cwd); err != nil {
					t.Error(err)
				}
			})
			if err := UpdateApplicationStatus(root, model.CareerApplication{ReportNumber: "7"}, "Interview"); err == nil {
				t.Fatal("invalid writer result must not report success")
			}
		})
	}
}

func TestDashboardStatusPreservesFlagLikeNotes(t *testing.T) {
	for _, note := range []string{"--dry-run", "--help", "-- recruiter called"} {
		t.Run(note, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			root, _ := writeTracker(t, statusTargetHeader+statusTargetRow)
			if err := UpdateApplicationStatusAndNotes(root, model.CareerApplication{ReportNumber: "7"}, "Interview", note); err != nil {
				t.Fatal(err)
			}
			apps := ParseApplications(root)
			if len(apps) != 1 || apps[0].Status != "Interview" || apps[0].Notes != "original; "+note {
				t.Fatalf("note became a CLI flag: %+v", apps)
			}
		})
	}
}
