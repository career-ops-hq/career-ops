import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DASHBOARD = join(ROOT, 'dashboard');

const goTest = `package data

import (
    "os"
    "path/filepath"
    "strings"
    "testing"

    "github.com/santifer/career-ops/dashboard/internal/model"
)

func TestDashboardStatusUpdateAppendsStatusLog(t *testing.T) {
    root := t.TempDir()
    tracker := filepath.Join(root, "data", "applications.md")
    if err := os.MkdirAll(filepath.Dir(tracker), 0o755); err != nil { t.Fatal(err) }
    fixture := "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\\n|---|---|---|---|---|---|---|---|---|\\n| 42 | 2026-09-01 | Example Co | Engineer | 4.2/5 | Applied | ❌ | [7](reports/007.md) | original |\\n"
    if err := os.WriteFile(tracker, []byte(fixture), 0o644); err != nil { t.Fatal(err) }
    t.Setenv("CAREER_OPS_TRACKER", tracker)
    t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
    app := model.CareerApplication{Number: 42, ReportNumber: "7", Status: "Applied"}
    if err := UpdateApplicationStatusAndNotes(root, app, "Rejected", ""); err != nil { t.Fatal(err) }
    ledger := filepath.Join(root, "data", "status-log.tsv")
    contents, err := os.ReadFile(ledger)
    if err != nil { t.Fatalf("status log missing after dashboard update: %v", err) }
    if !strings.Contains(string(contents), "\\tApplied\\tRejected\\t") { t.Fatalf("status transition missing from ledger: %q", contents) }
}
`;

test('dashboard status updates append the transition to status-log.tsv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-dashboard-ledger-'));
  const generatedTest = join(dir, 'dashboard_status_log_test.go');
  const overlay = join(dir, 'overlay.json');
  const virtualTest = join(DASHBOARD, 'internal', 'data', 'dashboard_status_log_test.go');
  try {
    writeFileSync(generatedTest, goTest);
    writeFileSync(overlay, JSON.stringify({ Replace: { [virtualTest]: generatedTest } }));
    const result = spawnSync('go', [
      'test', `-overlay=${overlay}`, './internal/data',
      '-run', '^TestDashboardStatusUpdateAppendsStatusLog$', '-count=1',
    ], { cwd: DASHBOARD, encoding: 'utf8', timeout: 120_000 });
    assert.equal(result.error, undefined, `go test could not run: ${result.error?.message}`);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
