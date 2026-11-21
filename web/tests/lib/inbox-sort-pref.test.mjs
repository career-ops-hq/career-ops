import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_INBOX_SORT,
  INBOX_SORT_STORAGE_KEY,
  parseInboxSort,
  readInboxSort,
  writeInboxSort,
} from "../../src/lib/inbox-sort-pref.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    data,
  };
}
const throwing = {
  getItem() { throw new DOMException("denied", "SecurityError"); },
  setItem() { throw new DOMException("quota", "QuotaExceededError"); },
};

test("the default stays Best fit", () => {
  assert.equal(DEFAULT_INBOX_SORT, "fit");
  assert.equal(INBOX_SORT_STORAGE_KEY, "career-ops:inbox-sort");
});

test("a saved Newest choice reads back after a reload", () => {
  const storage = memoryStorage();
  assert.equal(readInboxSort(storage), "fit");
  assert.equal(writeInboxSort(storage, "newest"), true);
  assert.equal(storage.data.get("career-ops:inbox-sort"), "newest");
  assert.equal(readInboxSort(storage), "newest");
  assert.equal(writeInboxSort(storage, "fit"), true);
  assert.equal(readInboxSort(storage), "fit");
});

test("a missing, stale or invalid stored value falls back to Best fit", () => {
  for (const value of [undefined, null, "", "NEWEST", "oldest", "constructor", '"newest"', "{}", 3, [], {}]) {
    assert.equal(parseInboxSort(value), "fit", String(value));
  }
  assert.equal(readInboxSort(memoryStorage({ [INBOX_SORT_STORAGE_KEY]: "oldest" })), "fit");
  assert.equal(readInboxSort(memoryStorage()), "fit");
});

test("unavailable storage never throws and keeps the default", () => {
  assert.equal(readInboxSort(throwing), "fit");
  assert.equal(readInboxSort(null), "fit");
  assert.equal(readInboxSort(undefined), "fit");
  assert.equal(writeInboxSort(throwing, "newest"), false);
  assert.equal(writeInboxSort(null, "newest"), false);
});

test("only a known mode is ever written", () => {
  const storage = memoryStorage();
  for (const mode of ["oldest", "", null, undefined, 1]) assert.equal(writeInboxSort(storage, mode), false);
  assert.equal(storage.data.size, 0);
});

test("picking a sort only changes the view; Make default is what saves it", () => {
  const triage = readFileSync(join(root, "src/components/inbox/inbox-triage.tsx"), "utf8");
  // Server and first client render use the default, so hydration matches.
  assert.match(triage, /useState<"fit" \| "newest">\(DEFAULT_INBOX_SORT\)/);
  // The saved default is loaded inside an effect, never during render, and sets both the view and the default.
  assert.match(triage, /const saved = readInboxSort\(browserStorage\(\)\);\s*setSortMode\(saved\);\s*setDefaultSort\(saved\);/);
  // The two sort buttons change the view and never touch storage.
  assert.match(triage, /onClick=\{\(\) => \{ setSortMode\("fit"\);/);
  assert.match(triage, /onClick=\{\(\) => \{ setSortMode\("newest"\);/);
  assert.equal((triage.match(/writeInboxSort\(/g) ?? []).length, 1, "one writer: the Make default handler");
  assert.match(triage, /const makeSortDefault = \(\) => \{[\s\S]*?writeInboxSort\(browserStorage\(\), sortMode\)/);
  // The pill is disabled when the view already is the default, and reads as a check mark then.
  assert.match(triage, /disabled=\{sortMode === defaultSort\}/);
  assert.match(triage, /onClick=\{makeSortDefault\}/);
  assert.match(triage, /"✓ Default" : "Make default"/);
  // A failed save is shown, not swallowed.
  assert.match(triage, /Can’t save in this browser/);
  // Another tab's save updates the saved default only, never this tab's view.
  assert.match(triage, /window\.addEventListener\("storage", onStorage\)/);
  assert.match(triage, /window\.removeEventListener\("storage", onStorage\)/);
  assert.match(triage, /event\.key !== INBOX_SORT_STORAGE_KEY\) return;\s*setDefaultSort\(readInboxSort\(browserStorage\(\)\)\);/);
});
