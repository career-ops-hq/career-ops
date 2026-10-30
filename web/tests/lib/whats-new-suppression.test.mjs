// Suppression for the Explore "new matches" supply loop must be per ROLE, not
// per employer (#3131).
//
// Keying on the company alone meant one evaluated role removed that employer's
// entire board from Explore, permanently, including postings first seen later.
// The scanner was working throughout — the rows were in scan-history.tsv, only
// the view hid them — and "no new matches" reads identically to "matches exist
// but are suppressed", which is what made it hard to notice.
//
// The normalizer is injected in production (the route resolves the CORE's
// normalizeTextKey from the user's own checkout so web dedup matches CLI
// dedup), so these tests inject the same Unicode-safe mirror the web ships as
// its fallback. Using a toy normalizer here would test a key helper that does
// not exist in production.
//
// Run:  node --test tests/lib/whats-new-suppression.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatedKeys, isEvaluated, suppressionKey } from "../../src/lib/whats-new-suppression.mjs";
import { normalizeTextKey as norm } from "../../src/lib/core/normalize-text-key.mjs";
import { aggregatorPostingId, isAggregatorUrl } from "../../../url-key.mjs";

const evaluatedAt = (...pairs) => evaluatedKeys(pairs.map(([company, role]) => ({ company, role })), norm);

test("a sibling role at an evaluated employer is NOT suppressed", () => {
  // The bug: evaluating one Google role hid every Google role forever.
  const keys = evaluatedAt(["Google", "Staff Software Engineer"]);
  assert.equal(isEvaluated(keys, norm, "Google", "Staff Software Engineer"), true, "the evaluated role should stay hidden");
  assert.equal(isEvaluated(keys, norm, "Google", "Senior Product Manager"), false, "a different role at the same employer was hidden");
  assert.equal(isEvaluated(keys, norm, "Google", "Engineering Manager, Search"), false);
});

test("the evaluated role itself is still suppressed on a repost", () => {
  // The guard: this is what the suppression is FOR. A fix that stopped
  // suppressing would pass the test above and break the feature.
  const keys = evaluatedAt(["Acme", "Staff Engineer"]);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer"), true);
  // Same role, cosmetic differences the core key folds away: case and
  // surrounding/interior whitespace.
  assert.equal(isEvaluated(keys, norm, "  acme  ", "STAFF   ENGINEER"), true);
  // NOT folded, and deliberately not asserted as such: the core key keeps
  // punctuation as a separator, so "Acme, Inc." keys as "acme inc" and does
  // not match "acme". That is unchanged from the company-only key this
  // replaces — the legal-suffix question is orthogonal to #3131, and pinning
  // it either way here would be inventing a contract this key never had.
  assert.equal(isEvaluated(keys, norm, "Acme, Inc.", "Staff Engineer"), false);
});

test("an unrelated employer is untouched", () => {
  const keys = evaluatedAt(["Acme", "Staff Engineer"]);
  assert.equal(isEvaluated(keys, norm, "Globex", "Staff Engineer"), false);
});

test("a role-less tracker row suppresses only a title-less scan row", () => {
  // Backfilled rows (#1799) carry no role. Under the old key they suppressed
  // the whole employer; they must now suppress just their own shape.
  const keys = evaluatedAt(["Initech", ""]);
  assert.equal(isEvaluated(keys, norm, "Initech", ""), true);
  assert.equal(isEvaluated(keys, norm, "Initech", "Staff Engineer"), false, "a backfilled row hid a real posting");
});

test("non-Latin companies and roles key distinctly (#2666 stays fixed)", () => {
  // The core key preserves script; an ASCII-only key would collapse all of
  // these to the empty string and make every pair collide.
  const keys = evaluatedAt(["日本電産", "ソフトウェアエンジニア"], ["Škoda", "Konstrukteur"]);
  assert.equal(isEvaluated(keys, norm, "日本電産", "ソフトウェアエンジニア"), true);
  assert.equal(isEvaluated(keys, norm, "日本電産", "プロダクトマネージャー"), false, "a sibling role was hidden");
  assert.equal(isEvaluated(keys, norm, "Škoda", "Konstrukteur"), true);
  assert.equal(isEvaluated(keys, norm, "Koda", "Konstrukteur"), false, "Škoda and Koda collided");
});

test("a company that normalizes to nothing suppresses nothing", () => {
  // Otherwise one unkeyable tracker row would hide every scan row whose
  // company is also unkeyable — the empty-key collision from #2666, moved.
  const keys = evaluatedKeys([{ company: "!!!", role: "Staff Engineer" }], norm);
  assert.equal(keys.size, 0);
  assert.equal(isEvaluated(keys, norm, "???", "Staff Engineer"), false);
  assert.equal(isEvaluated(keys, norm, "", "Staff Engineer"), false);
});

test("the key separates the two fields", () => {
  // "ab" + "" and "a" + "b" must not produce one key.
  assert.notEqual(suppressionKey(norm, "ab", ""), suppressionKey(norm, "a", "b"));
});

test("missing rows and fields do not throw", () => {
  assert.equal(evaluatedKeys(undefined, norm).size, 0);
  assert.equal(evaluatedKeys([{}], norm).size, 0);
  const keys = evaluatedAt(["Acme", "Staff Engineer"]);
  assert.equal(isEvaluated(keys, norm, undefined, undefined), false);
});

// ── Posting URL refinement (#5684) ──────────────────────────────────────────
//
// Company + role alone hid every LATER requisition with the same title — one
// opening per city, a second req a recruiter posted with the same title — for
// good. When the evaluated row's posting URL and the scan row's URL are both
// known, the URL decides; when either is unknown, the #3131 key still does.
// The report reader is injected in production (the route passes
// readLinkedReport from career-ops.ts), so these tests inject a fake one.

const REQ_A = "https://boards.greenhouse.io/acme/jobs/1001";
const REQ_B = "https://boards.greenhouse.io/acme/jobs/2002";
const REQ_C = "https://boards.greenhouse.io/acme/jobs/3003";

const reportWithUrl = (url) => `# Evaluation: Acme — Staff Engineer\n\n**Date:** 2026-10-01\n**URL:** ${url}\n**Score:** 4.1/5\n`;

/** A tracker row linked to report `n`, plus a reader that records each read. */
function evaluatedWithReports(rows) {
  const reads = [];
  const apps = rows.map(([company, role, report], i) => ({
    company,
    role,
    report: `[${i + 1}](../reports/${String(i + 1).padStart(3, "0")}-acme-2026-10-01.md)`,
    url: "",
    reportText: report,
  }));
  const readReport = (app) => {
    reads.push(app.report);
    return app.reportText;
  };
  return { keys: evaluatedKeys(apps, norm, readReport), reads };
}

test("a second posting with the same company and title stays visible (#5684)", () => {
  const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", reportWithUrl(REQ_A)]]);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_A), true, "the evaluated posting should stay hidden");
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_B), false, "a second requisition with the same title was hidden");
});

test("the evaluated posting is still hidden under a cosmetically different URL", () => {
  // Same posting, spellings the core URL key folds: http, a tracking param, a
  // trailing slash. A refinement that compared raw strings would resurface it.
  const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", reportWithUrl(REQ_A)]]);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", "http://boards.greenhouse.io/acme/jobs/1001/?utm_source=x"), true);
});

test("the tracker's URL cell is used before the report, and the report is not read", () => {
  const reads = [];
  const keys = evaluatedKeys(
    [{ company: "Acme", role: "Staff Engineer", url: REQ_A, report: "[1](../reports/001-acme-2026-10-01.md)" }],
    norm,
    (app) => {
      reads.push(app.report);
      return reportWithUrl(REQ_B);
    },
  );
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_A), true);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_B), false);
  assert.deepEqual(reads, [], "the report was read although the URL cell named the posting");
});

test("an inline report header still yields the posting URL", () => {
  // The documented header can be one line (`**Score:** … | **URL:** … | …`),
  // which is why the core matches `**URL:**` anywhere on the line.
  const inline = `# Evaluation: Acme — Staff Engineer\n\n**Score:** 4.1/5 | **URL:** ${REQ_A} | **PDF:** ❌\n`;
  const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", inline]]);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_B), false);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_A), true);
});

test("a wrapped report URL still yields the posting URL", () => {
  // The core unwraps the `**URL:**` token before keying it (tracker-parse.mjs
  // unwrapReportUrlToken): an autolink's `<…>` and trailing punctuation. Keyed
  // raw, `<https://…>` has no key, the posting reads as unknown, and a second
  // requisition with the same title is hidden again.
  for (const token of [`<${REQ_A}>`, `<${REQ_A}>,`, `${REQ_A}.`]) {
    const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", reportWithUrl(token)]]);
    assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_B), false, `token: ${token}`);
    assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_A), true, `token: ${token}`);
  }
});

test("an unknown report URL falls back to company + role", () => {
  // No report, no `**URL:**` line, a recruiter-sourced `N/A`, an empty header
  // (which must not capture the next line's text): none of these say which
  // posting was evaluated, so the #3131 key decides and both rows stay hidden.
  for (const report of [null, "# Evaluation: Acme — Staff Engineer\n\n**Score:** 4.1/5\n", reportWithUrl("N/A"), "**URL:**\n**Score:** 4.1/5\n"]) {
    const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", report]]);
    assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_A), true, `report: ${JSON.stringify(report)}`);
    assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_B), true, `report: ${JSON.stringify(report)}`);
  }
  // No reader injected at all (older callers): the same fallback.
  const keys = evaluatedAt(["Acme", "Staff Engineer"]);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_B), true);
});

test("an unknown scan-row URL falls back to company + role", () => {
  const { keys, reads } = evaluatedWithReports([["Acme", "Staff Engineer", reportWithUrl(REQ_A)]]);
  for (const url of [undefined, "", "N/A", "not a url"]) {
    assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", url), true, `scan url: ${JSON.stringify(url)}`);
  }
  assert.deepEqual(reads, [], "a report was read although the scan row had no URL to compare");
});

test("URLs on two different hosts are not evidence of two postings", () => {
  // An aggregator listing is evaluated under the EMPLOYER's URL (AGENTS.md,
  // "Aggregator Listings"), so the scan row and the report name one posting
  // on two hosts. Treating that as two postings would resurface every such
  // evaluated role.
  const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", reportWithUrl(REQ_A)]]);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", "https://remoteok.com/remote-jobs/123456"), true);
});

test("several evaluated postings with one title: each hides only its own", () => {
  const { keys } = evaluatedWithReports([
    ["Acme", "Staff Engineer", reportWithUrl(REQ_A)],
    ["Acme", "Staff Engineer", reportWithUrl(REQ_B)],
  ]);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_A), true);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_B), true);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_C), false, "a third requisition was hidden");

  // One of them without a URL: it could be any posting, so it hides them all.
  const mixed = evaluatedWithReports([
    ["Acme", "Staff Engineer", reportWithUrl(REQ_A)],
    ["Acme", "Staff Engineer", null],
  ]);
  assert.equal(isEvaluated(mixed.keys, norm, "Acme", "Staff Engineer", REQ_C), true);
});

test("reports are read lazily: only for a company + role match, once each", () => {
  const { keys, reads } = evaluatedWithReports([
    ["Acme", "Staff Engineer", reportWithUrl(REQ_A)],
    ["Globex", "Data Engineer", reportWithUrl("https://jobs.lever.co/globex/1")],
  ]);
  assert.deepEqual(reads, [], "building the keys read reports");
  isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_B);
  isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_C);
  isEvaluated(keys, norm, "Initech", "Staff Engineer", REQ_B);
  assert.deepEqual(reads, ["[1](../reports/001-acme-2026-10-01.md)"], "expected one read, for the matching row only");
});

test("a language param is read the way the core reads it", () => {
  // The core compares posting URLs through postingUrlRelation (url-key.mjs):
  // a region is not another posting (`en-GB` vs `en` is 'same'), and a
  // language on one side only proves nothing either way. Neither is proof of
  // two openings, so both stay hidden. Two known, different languages are two
  // postings, as the core keeps them as two tracker rows.
  const PAGE = "https://acme.recruitee.com/o/staff-engineer";
  const cases = [
    [`${PAGE}?lang=en-GB`, `${PAGE}?lang=en`, true],
    [PAGE, `${PAGE}?lang=de`, true],
    [`${PAGE}?lang=de`, PAGE, true],
    [`${PAGE}?lang=de`, `${PAGE}?lang=en`, false],
  ];
  for (const [evaluated, scanned, hidden] of cases) {
    const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", reportWithUrl(evaluated)]]);
    assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", scanned), hidden, `${evaluated} vs ${scanned}`);
  }

  // A distinct posting must not outweigh an ambiguous one: the bare page may be
  // the German version, so the German scan row stays hidden.
  const { keys } = evaluatedWithReports([
    ["Acme", "Staff Engineer", reportWithUrl(PAGE)],
    ["Acme", "Staff Engineer", reportWithUrl("https://acme.recruitee.com/o/staff-engineer-berlin")],
  ]);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", `${PAGE}?lang=de`), true);
});

// On an aggregator the host and the path say little about the posting: one
// LinkedIn requisition has a `/comm/` spelling, a slug spelling and a page per
// language, and one Indeed requisition is listed on `uk.` and `www.`. The
// core's merge (merge-tracker.mjs, urlDiffers) reads two aggregator URLs as
// two postings only when both carry a posting id, on one board, and the ids
// differ. The route injects that rule from the user's own core (lib/core/
// aggregator-id), so these tests inject the core module itself.
const aggregator = { isAggregatorUrl, aggregatorPostingId };

test("one aggregator posting under another spelling stays hidden", () => {
  const cases = [
    ["https://www.linkedin.com/jobs/view/4001/?lang=de", "https://www.linkedin.com/jobs/view/4001/?lang=fr"],
    ["https://www.linkedin.com/comm/jobs/view/4001?trackingId=x", "https://www.linkedin.com/jobs/view/4001"],
    ["https://www.linkedin.com/jobs/view/staff-engineer-at-acme-4001", "https://www.linkedin.com/jobs/view/4001"],
  ];
  for (const [evaluated, scanned] of cases) {
    const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", reportWithUrl(evaluated)]]);
    assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", scanned, aggregator), true, `${evaluated} vs ${scanned}`);
  }
});

test("two aggregator posting ids on one board are two postings", () => {
  const cases = [
    ["https://www.linkedin.com/jobs/view/4001", "https://www.linkedin.com/jobs/view/4002"],
    // A region host is the same board, so the ids decide across it.
    ["https://uk.indeed.com/viewjob?jk=a", "https://www.indeed.com/viewjob?jk=b"],
  ];
  for (const [evaluated, scanned] of cases) {
    const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", reportWithUrl(evaluated)]]);
    assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", scanned, aggregator), false, `${evaluated} vs ${scanned}`);
  }
});

test("an aggregator URL without a posting id proves nothing", () => {
  // No id extractor for the board, two boards, or the employer's URL against
  // a listing: all unknown to the core, so company + role decides.
  const cases = [
    ["https://remoteok.com/remote-jobs/123", "https://remoteok.com/remote-jobs/456"],
    ["https://www.linkedin.com/jobs/view/4001", "https://www.indeed.com/viewjob?jk=b"],
    [REQ_A, "https://www.linkedin.com/jobs/view/4002"],
  ];
  for (const [evaluated, scanned] of cases) {
    const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", reportWithUrl(evaluated)]]);
    assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", scanned, aggregator), true, `${evaluated} vs ${scanned}`);
  }
  // Employer URLs keep the host + language rule above.
  const { keys } = evaluatedWithReports([["Acme", "Staff Engineer", reportWithUrl(REQ_A)]]);
  assert.equal(isEvaluated(keys, norm, "Acme", "Staff Engineer", REQ_B, aggregator), false);
});
