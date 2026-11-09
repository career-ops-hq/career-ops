import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_SCHEDULES_HINT,
  SCHEDULED_SCANS_INTRO,
  scanEngineDetail,
  scanEngineLabel,
  scheduleCadenceLabel,
} from "../../src/lib/schedule-label.mjs";

test("one day is Daily, two days stay counted, and seven days are Weekly", () => {
  assert.equal(scheduleCadenceLabel(1, "days"), "Daily");
  assert.equal(scheduleCadenceLabel(2, "days"), "Every 2 days");
  assert.equal(scheduleCadenceLabel(7, "days"), "Weekly");
  assert.equal(scheduleCadenceLabel(14, "days"), "Every 2 weeks");
});

test("hours and minutes get the same plain treatment", () => {
  assert.equal(scheduleCadenceLabel(1, "hours"), "Hourly");
  assert.equal(scheduleCadenceLabel(24, "hours"), "Daily");
  assert.equal(scheduleCadenceLabel(6, "hours"), "Every 6 hours");
  assert.equal(scheduleCadenceLabel(1, "minutes"), "Every minute");
  assert.equal(scheduleCadenceLabel(15, "minutes"), "Every 15 minutes");
});

test("a broken cadence does not print Every NaN", () => {
  assert.equal(scheduleCadenceLabel("nope", "days"), "On a schedule");
  assert.equal(scheduleCadenceLabel(0, "days"), "On a schedule");
});

test("scheduled-scan copy talks about checking job boards", () => {
  const copy = [
    SCHEDULED_SCANS_INTRO,
    EMPTY_SCHEDULES_HINT,
    scanEngineLabel("full"),
    scanEngineLabel("portals"),
    scanEngineDetail("full"),
    scanEngineDetail("portals"),
    scheduleCadenceLabel(1, "days"),
  ].join("\n");
  assert.match(copy, /check job boards/i);
  assert.equal(/crawler/i.test(copy), false);
  assert.equal(/zero-token/i.test(copy), false);
  assert.equal(/\bATS\b/.test(copy), false);
  assert.equal(copy.includes("Every 1 days"), false);
});
