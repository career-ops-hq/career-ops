package data

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// Two tracker rows may legitimately share one tracker # (#1704), so both answer
// to `--row 32`. These cover the consequences of keying pending repairs by that
// selector instead of by the application that filed them.

// recordingStatusWriter installs a set-status.mjs stub that appends each argv to
// a log and reports a follow-up seeding failure while the control file exists.
// It returns the root to pass as the data root, plus readers for both.
func recordingStatusWriter(t *testing.T) (root string, argvOf func(int) []string, failFollowup func(bool)) {
	t.Helper()
	root = t.TempDir()
	argvLog := filepath.Join(root, "argv.log")
	control := filepath.Join(root, "fail-followup")
	writeStatusTarget(t, filepath.Join(root, "path-resolver.mjs"), "")
	writeStatusTarget(t, filepath.Join(root, "set-status.mjs"),
		"import { appendFileSync, existsSync } from 'node:fs';\n"+
			"appendFileSync(process.env.ARGV_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n"+
			"const result = { changed: true, newStatus: process.argv[4] };\n"+
			"if (existsSync(process.env.FAIL_FOLLOWUP)) result.followupSeeded = { reason: 'error', error: 'stub refused' };\n"+
			"console.log(JSON.stringify(result));\n")
	t.Setenv("ARGV_LOG", argvLog)
	t.Setenv("FAIL_FOLLOWUP", control)
	t.Setenv("CAREER_OPS_TRACKER", "")
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
	// Pending repairs are process-wide, but every entry carries its tracker
	// file, so another test's temp root can never match these rows.
	argvOf = func(call int) []string {
		t.Helper()
		body, err := os.ReadFile(argvLog)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(body)), "\n")
		if call >= len(lines) {
			t.Fatalf("want at least %d writer calls, got %d: %s", call+1, len(lines), body)
		}
		var argv []string
		if err := json.Unmarshal([]byte(lines[call]), &argv); err != nil {
			t.Fatal(err)
		}
		return argv
	}
	failFollowup = func(fail bool) {
		t.Helper()
		if fail {
			writeStatusTarget(t, control, "")
			return
		}
		if err := os.Remove(control); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
	}
	return root, argvOf, failFollowup
}

func hasFlag(argv []string, flag string) bool {
	for _, arg := range argv {
		if arg == flag {
			return true
		}
	}
	return false
}

// Case 1: a repair read by the wrong application. Alpha files under `--row 32`;
// Beta, a different application sharing tracker #32, must not inherit it.
func TestDashboardStatusRepairBelongsToTheRowThatFiledIt(t *testing.T) {
	root, argvOf, failFollowup := recordingStatusWriter(t)
	alpha := model.CareerApplication{Number: 32, Company: "Alpha Co", Role: "Engineer"}
	beta := model.CareerApplication{Number: 32, ReportNumber: "7", Company: "Beta Co", Role: "Analyst"}
	failFollowup(true)
	if err := UpdateApplicationStatus(root, alpha, "Applied"); err == nil {
		t.Fatal("partial save must report the failed follow-up seeding")
	}
	failFollowup(false)
	if err := UpdateApplicationStatus(root, beta, "Applied"); err != nil {
		t.Fatal(err)
	}
	if argv := argvOf(1); hasFlag(argv, "--repair-followup") {
		t.Fatalf("another application's pending repair leaked into this save: %v", argv)
	}
}

// Case 2, the silent one: a repair deleted by the wrong application. Beta saving
// any status must not clear the repair Alpha is still owed.
func TestDashboardStatusSuccessClearsOnlyItsOwnRepair(t *testing.T) {
	root, argvOf, failFollowup := recordingStatusWriter(t)
	alpha := model.CareerApplication{Number: 32, Company: "Alpha Co", Role: "Engineer"}
	beta := model.CareerApplication{Number: 32, ReportNumber: "7", Company: "Beta Co", Role: "Analyst"}
	failFollowup(true)
	if err := UpdateApplicationStatus(root, alpha, "Applied"); err == nil {
		t.Fatal("partial save must report the failed follow-up seeding")
	}
	failFollowup(false)
	if err := UpdateApplicationStatus(root, beta, "Responded"); err != nil {
		t.Fatal(err)
	}
	if err := UpdateApplicationStatus(root, alpha, "Applied"); err != nil {
		t.Fatal(err)
	}
	if argv := argvOf(2); !hasFlag(argv, "--repair-followup") {
		t.Fatalf("another application's save dropped the pending repair: %v", argv)
	}
}

// Two requisitions can share a company, a title and tracker #32 while carrying
// reports 7 and 9. Their shared `--row 32` must not hand one the other's repair
// flags, nor let the second save clear the first's pending repair.
func TestDashboardStatusRepairStaysWithItsReportNumber(t *testing.T) {
	root, argvOf, failFollowup := recordingStatusWriter(t)
	seven := model.CareerApplication{Number: 32, ReportNumber: "7", Company: "Delta Co", Role: "Engineer"}
	nine := model.CareerApplication{Number: 32, ReportNumber: "9", Company: "Delta Co", Role: "Engineer"}
	failFollowup(true)
	if err := UpdateApplicationStatus(root, seven, "Applied"); err == nil {
		t.Fatal("partial save must report the failed follow-up seeding")
	}
	failFollowup(false)
	if err := UpdateApplicationStatus(root, nine, "Applied"); err != nil {
		t.Fatal(err)
	}
	if argv := argvOf(1); hasFlag(argv, "--repair-followup") {
		t.Errorf("report 9 inherited report 7's pending repair: %v", argv)
	}
	if err := UpdateApplicationStatus(root, seven, "Applied"); err != nil {
		t.Fatal(err)
	}
	if argv := argvOf(2); !hasFlag(argv, "--repair-followup") {
		t.Fatalf("report 9's save dropped report 7's pending repair: %v", argv)
	}
}

// The case the multi-identity lookup exists for: a merge gives Alpha a report
// link between the failed write and the retry, and the retry still repairs its
// own follow-up — then leaves nothing behind for the next save.
func TestDashboardStatusRepairSurvivesAMergeAddingAReportLink(t *testing.T) {
	root, argvOf, failFollowup := recordingStatusWriter(t)
	alpha := model.CareerApplication{Number: 32, Company: "Alpha Co", Role: "Engineer"}
	merged := alpha
	merged.ReportNumber = "9"
	failFollowup(true)
	if err := UpdateApplicationStatus(root, alpha, "Applied"); err == nil {
		t.Fatal("partial save must report the failed follow-up seeding")
	}
	failFollowup(false)
	if err := UpdateApplicationStatus(root, merged, "Applied"); err != nil {
		t.Fatal(err)
	}
	if argv := argvOf(1); !hasFlag(argv, "--repair-followup") {
		t.Fatalf("retry after the merge lost its own repair: %v", argv)
	}
	if err := UpdateApplicationStatus(root, merged, "Applied"); err != nil {
		t.Fatal(err)
	}
	if argv := argvOf(2); hasFlag(argv, "--repair-followup") {
		t.Fatalf("a repaired follow-up must not be repaired again: %v", argv)
	}
}
