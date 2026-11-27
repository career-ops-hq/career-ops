import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  nextQuarterHour,
  osScheduleStatus,
  parseCrontab,
  parseLaunchctlPrint,
} from "../../src/lib/scheduled-os-schedule.mjs";

const MODULE_URL = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/lib/scheduled-os-schedule.mjs"),
).href;
const MARKER = "# career-ops recurring scan";
const LINE = `*/15 * * * * cd '/r' && touch 'data/x.tick' && node run.mjs ${MARKER}`;
const EMPTY_TASK = { exists: false, enabled: false, status: null, nextRun: null, lastRun: null };

test("parseCrontab detects the marker line and its disabled form", () => {
  assert.deepEqual(parseCrontab(`0 8 * * * echo hi\n${LINE}\n`), { exists: true, enabled: true });
  assert.deepEqual(parseCrontab(`#${LINE}\n`), { exists: true, enabled: false });
  assert.deepEqual(parseCrontab("0 8 * * * echo hi\n"), { exists: false, enabled: false });
  assert.deepEqual(parseCrontab(""), { exists: false, enabled: false });
});

test("parseLaunchctlPrint maps the exit code", () => {
  assert.deepEqual(parseLaunchctlPrint(0), { exists: true, enabled: true });
  assert.deepEqual(parseLaunchctlPrint(113), { exists: false, enabled: false });
  assert.deepEqual(parseLaunchctlPrint(1), { exists: false, enabled: false });
});

test("nextQuarterHour is strictly after now and rolls over hours and days", () => {
  const iso = (value) => new Date(value).toISOString();
  const at = (h, m, s = 0, ms = 0) => new Date(2026, 0, 5, h, m, s, ms);
  assert.equal(nextQuarterHour(at(10, 0)), iso(at(10, 15)));
  assert.equal(nextQuarterHour(at(10, 14, 59, 999)), iso(at(10, 15)));
  assert.equal(nextQuarterHour(at(10, 15)), iso(at(10, 30)));
  assert.equal(nextQuarterHour(at(10, 59, 30)), iso(at(11, 0)));
  assert.equal(nextQuarterHour(at(23, 50)), iso(new Date(2026, 0, 6, 0, 0)));
});

test("nextQuarterHour is timezone-independent", () => {
  assert.equal(nextQuarterHour(new Date(Date.UTC(2026, 10, 1, 5, 50))), "2026-11-01T06:00:00.000Z");
});

test("nextQuarterHour is correct in the DST fall-back hour", () => {
  const code = `import { nextQuarterHour } from ${JSON.stringify(MODULE_URL)};
console.log(nextQuarterHour(new Date("2026-11-01T05:50:00Z")));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, TZ: "America/New_York" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "2026-11-01T06:00:00.000Z");
});

test("osScheduleStatus reports cron and launchd state", () => {
  const now = new Date(2026, 0, 5, 10, 7, 0);
  const tickMtimeMs = Date.UTC(2026, 0, 5, 9, 0, 0);
  const ready = {
    exists: true,
    enabled: true,
    status: "Ready",
    nextRun: nextQuarterHour(now),
    lastRun: new Date(tickMtimeMs).toISOString(),
  };

  assert.deepEqual(osScheduleStatus({ platform: "linux", crontabText: LINE, launchctlExitCode: null, tickMtimeMs, now }), ready);
  assert.deepEqual(
    osScheduleStatus({ platform: "linux", crontabText: LINE, launchctlExitCode: null, tickMtimeMs: null, now }),
    { ...ready, lastRun: null },
  );
  assert.deepEqual(osScheduleStatus({ platform: "darwin", crontabText: "", launchctlExitCode: 0, tickMtimeMs, now }), ready);
  assert.deepEqual(osScheduleStatus({ platform: "darwin", crontabText: "", launchctlExitCode: 113, tickMtimeMs, now }), EMPTY_TASK);
  assert.deepEqual(
    osScheduleStatus({ platform: "linux", crontabText: `#${LINE}`, launchctlExitCode: null, tickMtimeMs, now }),
    { exists: true, enabled: false, status: "Disabled", nextRun: null, lastRun: ready.lastRun },
  );
  assert.deepEqual(
    osScheduleStatus({ platform: "linux", crontabText: `#${LINE}`, launchctlExitCode: null, tickMtimeMs: null, now }),
    { exists: true, enabled: false, status: "Disabled", nextRun: null, lastRun: null },
  );
});

test("osScheduleStatus returns the empty task on unsupported platforms", () => {
  const now = new Date(2026, 0, 5, 10, 7, 0);
  for (const platform of ["win32", "freebsd"]) {
    assert.deepEqual(
      osScheduleStatus({ platform, crontabText: LINE, launchctlExitCode: 0, tickMtimeMs: 1, now }),
      EMPTY_TASK,
    );
  }
});
