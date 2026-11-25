import { test } from "node:test";
import assert from "node:assert/strict";
import { todaySnapshot } from "../../src/lib/home/today-snapshot.mjs";

const scoreOf = (score) => Number.parseFloat(score);

test("Today keeps all undecided aliases and saved URLs, without shipping tracker history", () => {
  const applications = [
    { n: "1", status: "Applied", notes: "historical notes" },
    ...Array.from({ length: 8 }, (_, i) => ({
      n: String(i + 2), status: i % 2 ? "Evaluated 2026-09-10" : "verificar",
      date: "2026-09-10", score: "4.5/5",
    })),
    { n: "10", status: "Discarded" },
  ];
  const inbox = [
    { url: "https://example.com/jobs/1", done: true, role: "Old role", company: "Example" },
    { url: "https://example.com/jobs/2", done: false, role: "New role", company: "Example" },
  ];
  const before = structuredClone({ applications, inbox });
  const result = todaySnapshot({ applications, inbox }, scoreOf);
  assert.equal(result.applications.length, 8, "headline must count beyond the six visible cards");
  assert.deepEqual(result.applications.map((a) => a.n), ["2", "3", "4", "5", "6", "7", "8", "9"]);
  assert.deepEqual(result.inbox, [
    { url: "https://example.com/jobs/1", done: true },
    { url: "https://example.com/jobs/2", done: false },
  ]);
  assert.deepEqual({ applications, inbox }, before, "the shared snapshot stays intact for setup detection");
});

test("a large completed history does not become a large Today payload", () => {
  const snapshot = {
    applications: Array.from({ length: 1000 }, (_, i) => ({
      n: String(i), status: "Discarded", notes: "Archived evaluation detail. ".repeat(40),
    })),
    inbox: Array.from({ length: 1000 }, (_, i) => ({
      url: `https://example.com/jobs/${i}`, done: true, company: "Example", role: "Past role", location: "Remote",
    })),
  };
  const result = todaySnapshot(snapshot, scoreOf);
  assert.equal(result.applications.length, 0);
  assert.equal(result.inbox.length, 1000, "saved-offer identity is retained");
  assert.ok(JSON.stringify(result).length < JSON.stringify(snapshot).length / 10);
});
