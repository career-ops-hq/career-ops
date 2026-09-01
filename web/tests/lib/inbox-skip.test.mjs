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

const FIXTURE = [
  "# Pipeline — Pending URLs",
  "",
  "Paste job URLs below.",
  "",
  "## Pending",
  "",
  "- [ ] https://boards.greenhouse.io/acme/jobs/1 | Acme | Staff Engineer | Remote | posted: 2026-08-01",
  "- [ ] https://jobs.lever.co/beta/2 | Beta | Platform Engineer | NYC",
  "- [x] https://ats.example.com/old | OldCo | Already done",
  "",
  "## Processed",
  "",
  "- [x] https://done.example.com/x | DoneCo | PM",
  "- [ ] https://jobs.lever.co/beta/2 | Beta | should not flip (processed duplicate)",
  "",
].join("\n");

const ACME = "https://boards.greenhouse.io/acme/jobs/1";
const BETA = "https://jobs.lever.co/beta/2";
const DONE = "https://done.example.com/x";

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

  const before = linesOf(FIXTURE);
  const after = linesOf(result.text);
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    if (before[i].includes(BETA) && before[i].startsWith("- [ ] https://jobs.lever.co/beta/2 | Beta | Platform")) {
      assert.equal(
        after[i],
        "- [x] https://jobs.lever.co/beta/2 | Beta | Platform Engineer | NYC",
      );
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
  const processed = linesOf(skipped.text).find((l) => l.includes("should not flip"));
  assert.equal(processed, "- [ ] https://jobs.lever.co/beta/2 | Beta | should not flip (processed duplicate)");
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
  const line = linesOf(result.text).find((l) => l.includes("boards.greenhouse.io/acme"));
  assert.equal(
    line,
    "- [x] https://boards.greenhouse.io/acme/jobs/1 | Acme | Staff Engineer | Remote | posted: 2026-08-01",
  );
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
    assert.match(afterSkip, /^- \[x\] https:\/\/jobs\.lever\.co\/beta\/2 \| Beta \| Platform Engineer \| NYC$/m);
    assert.match(afterSkip, /^- \[ \] https:\/\/boards\.greenhouse\.io\/acme\/jobs\/1 /m);
    assert.match(afterSkip, /^- \[x\] https:\/\/ats\.example\.com\/old /m);
    assert.match(afterSkip, /^- \[x\] https:\/\/done\.example\.com\/x /m);
    assert.match(afterSkip, /should not flip \(processed duplicate\)/);
    assert.equal(afterSkip.split("\n").length, FIXTURE.split("\n").length);

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
