// Tests for parseInboxMarkdown() — the web Pipeline inbox reader.
// Imports inbox-parse.mjs directly so the test and production path cannot drift.
//
// Run:  node --test tests/lib/inbox-parse.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInboxMarkdown } from "../../src/lib/inbox-parse.mjs";

const URL = "https://example.com/job/1";

test("full URL | Company | Role row still parses", () => {
  const jobs = parseInboxMarkdown(`- [ ] ${URL} | Acme | Engineer`);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], {
    done: false,
    url: URL,
    company: "Acme",
    role: "Engineer",
    location: undefined,
    compensation: undefined,
    postedAt: undefined,
  });
});

test("bare checkbox URL row is kept, not skipped", () => {
  const jobs = parseInboxMarkdown(`- [ ] ${URL}`);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, URL);
  assert.equal(jobs[0].company, "");
  assert.equal(jobs[0].role, "");
  assert.equal(jobs[0].done, false);
});

test("URL | company without a role is kept", () => {
  const jobs = parseInboxMarkdown(`- [ ] ${URL} | Acme`);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, URL);
  assert.equal(jobs[0].company, "Acme");
  assert.equal(jobs[0].role, "");
});

test("labeled posted: segment still maps to postedAt on a full row", () => {
  const jobs = parseInboxMarkdown(
    `- [ ] ${URL} | Acme | Engineer | Remote (US) | posted: 2026-07-14`,
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, "Acme");
  assert.equal(jobs[0].role, "Engineer");
  assert.equal(jobs[0].location, "Remote (US)");
  assert.equal(jobs[0].postedAt, "2026-07-14");
  assert.equal(jobs[0].compensation, undefined);
});

test("labeled posted: still works on a bare URL row", () => {
  const jobs = parseInboxMarkdown(`- [ ] ${URL} | posted: 2026-07-14`);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, URL);
  assert.equal(jobs[0].company, "");
  assert.equal(jobs[0].role, "");
  assert.equal(jobs[0].postedAt, "2026-07-14");
});

test("location and compensation stay positional on a 5-column row", () => {
  const jobs = parseInboxMarkdown(
    `- [ ] ${URL} | Acme | Engineer | Remote (US) | 180000-220000 USD`,
  );
  assert.equal(jobs[0].location, "Remote (US)");
  assert.equal(jobs[0].compensation, "180000-220000 USD");
});

test("non-http junk is skipped", () => {
  const md = [
    "- [ ] not-a-url | Acme | Engineer",
    "- [ ] ftp://example.com/job/1 | Acme | Engineer",
    "- [ ] local:jds/acme.md | Acme | Engineer",
    "- a prose line with https://example.com/job/1 in it",
    "",
  ].join("\n");
  assert.deepEqual(parseInboxMarkdown(md), []);
});

test("processed #NNN | URL row keeps the http URL, not the report number", () => {
  const jobs = parseInboxMarkdown(
    `- [x] #143 | ${URL} | Acme | Engineer | 4.2/5 | PDF ✅`,
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].done, true);
  assert.equal(jobs[0].url, URL);
  assert.equal(jobs[0].company, "Acme");
  assert.equal(jobs[0].role, "Engineer");
});

test("processed #NNN | URL without company/role still keeps the URL", () => {
  const jobs = parseInboxMarkdown(`- [x] #-- | ${URL}`);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].done, true);
  assert.equal(jobs[0].url, URL);
  assert.equal(jobs[0].company, "");
  assert.equal(jobs[0].role, "");
});
