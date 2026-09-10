// Inbox Skip must persist by checking data/pipeline.md, not only localStorage.
//
// applyInboxSkip / setInboxSkip flip `- [ ]` ↔ `- [x]` for one posting URL and
// leave every other line byte-identical. The URL is a matcher, never a path.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/inbox-skip.test.mjs
// From the repo root:                   node --test web/tests/lib/inbox-skip.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "..", "src", "lib", "inbox-skip.mjs");
const CORE = process.env.CAREER_OPS_ROOT || path.join(HERE, "..", "..", "..");
const LOCK = path.join(CORE, "pipeline-lock.mjs");
const HAS_LOCK = fs.existsSync(LOCK);

const { postingUrl, applyInboxSkip, setInboxSkip } = await import(pathToFileURL(SRC).href);

const ACME = "https://boards.greenhouse.io/acme/jobs/1";
const BETA = "https://jobs.lever.co/beta/2";
const DONE = "https://done.example.com/x";

const ACME_PENDING = `- [ ] ${ACME} | Acme | Staff Engineer | Remote | posted: 2026-08-01`;
const ACME_SKIPPED = `- [x] ${ACME} | Acme | Staff Engineer | Remote | posted: 2026-08-01`;
const BETA_PENDING = `- [ ] ${BETA} | Beta | Platform Engineer | NYC`;
const BETA_SKIPPED = `- [x] ${BETA} | Beta | Platform Engineer | NYC`;
const OLD_DONE = "- [x] https://ats.example.com/old | OldCo | Already done";
const DONE_PROCESSED = `- [x] ${DONE} | DoneCo | PM`;
const BETA_PROCESSED = `- [ ] ${BETA} | Beta | should not flip (processed duplicate)`;

const FIXTURE = [
  "# Pipeline — Pending URLs",
  "",
  "Paste job URLs below.",
  "",
  "## Pending",
  "",
  ACME_PENDING,
  BETA_PENDING,
  OLD_DONE,
  "",
  "## Processed",
  "",
  DONE_PROCESSED,
  BETA_PROCESSED,
  "",
].join("\n");

const SKIPPED_FIXTURE = [
  "# Pipeline — Pending URLs",
  "",
  "Paste job URLs below.",
  "",
  "## Pending",
  "",
  ACME_PENDING,
  BETA_SKIPPED,
  OLD_DONE,
  "",
  "## Processed",
  "",
  DONE_PROCESSED,
  BETA_PROCESSED,
  "",
].join("\n");

function linesOf(text) {
  return text.split("\n");
}

test("postingUrl accepts http(s) and refuses path traversal / non-http", () => {
  assert.equal(postingUrl("https://boards.greenhouse.io/acme/jobs/1"), ACME);
  assert.equal(postingUrl("  http://example.com/a  "), "http://example.com/a");
  assert.equal(postingUrl("../data/applications.md"), null);
  assert.equal(postingUrl("/etc/passwd"), null);
  assert.equal(postingUrl("file:///etc/passwd"), null);
  assert.equal(postingUrl("javascript:alert(1)"), null);
  assert.equal(postingUrl("data:text/plain,hi"), null);
  assert.equal(postingUrl("https://example.com/job\n- [x] https://evil.example"), null);
  assert.equal(postingUrl("https://user:pass@example.com/job"), null);
  assert.equal(postingUrl(""), null);
  assert.equal(postingUrl(null), null);
});

test("skip one URL checks that line and leaves every other line unchanged", () => {
  const result = applyInboxSkip(FIXTURE, BETA, true);
  assert.equal(result.ok, true);
  assert.equal(result.matched, 1);
  assert.equal(result.changed, 1);
  assert.equal(result.text, SKIPPED_FIXTURE);

  const before = linesOf(FIXTURE);
  const after = linesOf(result.text);
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    if (before[i] === BETA_PENDING) {
      assert.equal(after[i], BETA_SKIPPED);
    } else {
      assert.equal(after[i], before[i], `line ${i} must stay unchanged`);
    }
  }
});

test("undo restores the checkbox to [ ]", () => {
  const skipped = applyInboxSkip(FIXTURE, BETA, true);
  assert.equal(skipped.ok, true);
  const undone = applyInboxSkip(skipped.text, BETA, false);
  assert.equal(undone.ok, true);
  assert.equal(undone.text, FIXTURE);
});

test("already-skipped row is idempotent and does not rewrite neighbors", () => {
  const once = applyInboxSkip(FIXTURE, BETA, true);
  const twice = applyInboxSkip(once.text, BETA, true);
  assert.equal(twice.ok, true);
  assert.equal(twice.changed, 0);
  assert.equal(twice.text, once.text);
});

test("Processed-section rows are not flipped, even with the same URL", () => {
  const skipped = applyInboxSkip(FIXTURE, BETA, true);
  assert.equal(
    linesOf(skipped.text).find((l) => l === BETA_PROCESSED),
    BETA_PROCESSED,
  );
});

test("unmatched URL is refused without rewriting the file", () => {
  const result = applyInboxSkip(FIXTURE, "https://nobody.example/jobs/9", true);
  assert.equal(result.ok, false);
  assert.equal(result.error, "unmatched");
});

test("invalid URL never matches", () => {
  assert.equal(applyInboxSkip(FIXTURE, "../data/pipeline.md", true).error, "invalid-url");
  assert.equal(applyInboxSkip(FIXTURE, "file:///tmp/pipeline.md", true).error, "invalid-url");
});

test("does not invent company/role — only the checkbox character changes", () => {
  const result = applyInboxSkip(FIXTURE, ACME, true);
  assert.equal(
    linesOf(result.text).find((l) => l === ACME_SKIPPED),
    ACME_SKIPPED,
  );
});

test("a URL that is only a substring of another row's URL cell does not match", () => {
  const trap = `- [ ] ${new URL("https://evil.example/https://jobs.lever.co/beta/2").href} | Evil | Trap`;
  const real = BETA_PENDING;
  const text = ["## Pending", "", trap, real, ""].join("\n");
  const result = applyInboxSkip(text, BETA, true);
  assert.equal(result.ok, true);
  assert.equal(result.matched, 1);
  assert.equal(result.text, ["## Pending", "", trap, BETA_SKIPPED, ""].join("\n"));
});

test("a URL that only appears under Processed does not match as inbox Skip", () => {
  const result = applyInboxSkip(FIXTURE, DONE, true);
  assert.equal(result.ok, false);
  assert.equal(result.error, "unmatched");
});

test("setInboxSkip writes the fixture file, then undo restores it", { skip: HAS_LOCK ? false : "pipeline-lock.mjs not resolvable" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-skip-"));
  const file = path.join(dir, "pipeline.md");
  fs.writeFileSync(file, FIXTURE);
  try {
    const skipped = await setInboxSkip(file, BETA, true, { lockModule: LOCK, timeoutMs: 5_000 });
    assert.equal(skipped.ok, true);
    const afterSkip = fs.readFileSync(file, "utf8");
    assert.equal(afterSkip, SKIPPED_FIXTURE);

    const undone = await setInboxSkip(file, BETA, false, { lockModule: LOCK, timeoutMs: 5_000 });
    assert.equal(undone.ok, true);
    assert.equal(fs.readFileSync(file, "utf8"), FIXTURE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("setInboxSkip refuses an unmatched URL and leaves the file untouched", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-skip-miss-"));
  const file = path.join(dir, "pipeline.md");
  fs.writeFileSync(file, FIXTURE);
  try {
    const result = await setInboxSkip(file, "https://nobody.example/jobs/9", true);
    assert.equal(result.ok, false);
    assert.equal(result.error, "unmatched");
    assert.equal(fs.readFileSync(file, "utf8"), FIXTURE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
