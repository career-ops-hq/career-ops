import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingInbox, reconcileInbox } from "../../src/lib/inbox-pending.mjs";
import { parseInbox } from "../../src/lib/pipeline-table.mjs";
import { parseApplications } from "../../src/lib/tracker-table.mjs";
import { fileURLToPath } from "node:url";

test("a persisted evaluation leaves the pending inbox after a fresh file read", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const inbox = parseInbox(`## Pending
- [ ] https://jobs.example.test/1234 | Acme | Working Student Tools | Example City
- [ ] https://jobs.example.test/5678 | Acme | Working Student Tools | Example City
`);
  const applications = parseApplications(`| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|---|---|---|---|---|---|---|---|---|
| 3 | 2026-10-25 | Acme Energy GmbH | Working Student Tools | 4.4/5 | Evaluated | ❌ | [003](../reports/003-acme.md) | | [jobs.example.test](https://jobs.example.test/1234) |
`, root);
  const reconciled = reconcileInbox(inbox, applications);
  assert.deepEqual(pendingInbox(reconciled).map((j) => j.url), [inbox[1].url]);
  assert.equal(reconciled[0].done, true);
  assert.equal(inbox[0].done, false, "the read view does not mutate the pipeline parser's rows");
  assert.equal(applications[0].score, "4.4/5");
});

test("tracked URLs reconcile tracking variants without hiding distinct requisitions", () => {
  const inbox = [
    { url: "http://jobs.example.com/role/?gh_jid=1&utm_source=email", done: false },
    { url: "https://jobs.example.com/role?gh_jid=2", done: false },
    { url: "https://jobs.example.com/other", done: true },
    { url: "local:jds/job.md", done: false },
  ];
  const applications = [
    { url: "[posting](https://jobs.example.com/role?gh_jid=1)", score: "—", status: "Applied" },
    { url: "N/A" }, { url: "" }, {},
  ];
  assert.deepEqual(pendingInbox(reconcileInbox(inbox, applications)).map((j) => j.url), [inbox[1].url, inbox[3].url]);
  assert.deepEqual(reconcileInbox(inbox, []), inbox, "a failed or unsaved evaluation remains pending");
});

test("pendingInbox drops done postings and repeated URLs", () => {
  const inbox = [
    { url: "https://jobs.example.test/a", done: false, role: "First" },
    { url: "https://jobs.example.test/b", done: true, role: "Done" },
    { url: "https://jobs.example.test/a", done: false, role: "Repeat" },
    { url: "https://jobs.example.test/c", done: false, role: "Third" },
  ];
  assert.deepEqual(pendingInbox(inbox).map((j) => j.role), ["First", "Third"]);
});
