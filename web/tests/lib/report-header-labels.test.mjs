// Tests for the report header labels the viewer resolves by name.
//
// parseReport maps `**Label:** value` lines through FIELD_KEYS and DROPS any
// label it does not recognise, silently. So an unlisted form is not a render
// glitch: the field disappears from the report page and nobody reports it.
// That is how a Russian report lost Archetype, Score and Date, and a
// Portuguese one Archetype and Date, for as long as those modes have existed.
//
// The fixture below is the set of labels the localized `oferta.md` modes
// actually dictate, extracted from this repo on 2026-09-02. It is a fixture
// rather than a live read of `modes/` on purpose: the point is to pin the
// forms already in circulation in USERS' existing reports, which no future
// change to the modes can alter.
//
// Run:  node --test tests/lib/report-header-labels.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReport } from "../../src/lib/report-header.mjs";

/** label -> canonical field, as dictated by each mode's report template. */
const DICTATED = {
  "modes/oferta.md (canonical)": { Date: "Date", URL: "URL", Archetype: "Archetype", Score: "Score", Legitimacy: "Legitimacy", PDF: "PDF" },
  "modes/zh, zh-TW": { Date: "Date", URL: "URL", Archetype: "Archetype", Score: "Score", Legitimacy: "Legitimacy", PDF: "PDF" },
  "modes/es": { Fecha: "Date", URL: "URL", Arquetipo: "Archetype", Score: "Score", PDF: "PDF" },
  "modes/pt": { Data: "Date", URL: "URL", "Arquétipo": "Archetype", Score: "Score", PDF: "PDF" },
  "modes/pl": { Data: "Date", URL: "URL", Archetyp: "Archetype", Score: "Score", PDF: "PDF" },
  "modes/da": { Dato: "Date", URL: "URL", Arketype: "Archetype", Score: "Score", PDF: "PDF" },
  "modes/ru": { "Дата": "Date", URL: "URL", "Архетип": "Archetype", "Балл": "Score", PDF: "PDF" },
  "modes/ua": { "Дата": "Date", URL: "URL", "Архетип": "Archetype", "Бал": "Score", "Легітимність": "Legitimacy", PDF: "PDF" },
};

const report = (labels) =>
  ["# Acme — Engineer", ...Object.entries(labels).map(([k, v]) => `**${k}:** ${v}`), "", "---", "", "## A) Role Summary", "text"].join("\n");

test("every label the localized modes dictate resolves to its canonical field", () => {
  for (const [mode, labels] of Object.entries(DICTATED)) {
    const values = Object.fromEntries(Object.keys(labels).map((l, i) => [l, `v${i}`]));
    const meta = parseReport(report(values));
    const got = new Set(meta.fields.map((f) => f.label));
    for (const [label, canonical] of Object.entries(labels)) {
      assert.ok(got.has(canonical), `${mode}: "${label}" did not resolve to ${canonical} (dropped silently)`);
    }
  }
});

test("the accent is part of the key: arquetipo and arquétipo are different labels", () => {
  // `arquetipo` was listed and `arquétipo` was not, so Portuguese reports lost
  // the field while Spanish ones kept it. Both must resolve.
  for (const label of ["Arquetipo", "Arquétipo"]) {
    const meta = parseReport(report({ [label]: "Platform" }));
    assert.deepEqual(meta.fields, [{ label: "Archetype", value: "Platform" }], `"${label}" was dropped`);
  }
});

test("Legitimacy still reaches the badge, in English and in Ukrainian", () => {
  // meta.legitimacy is what drives the posting-legitimacy badge. Losing the
  // label loses the scam indicator, not just a row of text.
  for (const label of ["Legitimacy", "Легітимність"]) {
    assert.equal(parseReport(report({ [label]: "Verified" })).legitimacy, "Verified", `"${label}" lost the badge`);
  }
});

test("an unknown label is dropped rather than rendered raw", () => {
  // The drop itself is deliberate: a stray bold line in a hand-edited report
  // must not become a header field. This pins the behaviour the map exists to
  // work around, so a future 'render anything' change is a conscious one.
  const meta = parseReport(report({ Sonstiges: "x" }));
  assert.deepEqual(meta.fields, []);
});

test("a label with no value is dropped, not rendered empty", () => {
  const meta = parseReport(["# T", "**Date:**", "", "---", "", "## A) x", "y"].join("\n"));
  assert.deepEqual(meta.fields, []);
});
