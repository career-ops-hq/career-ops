// Drift guard: web's STATUS_ALIAS literal vs templates/states.yml.
//
// format.ts is node-free (client components import it), so it cannot read
// states.yml at runtime — the alias map has to ship in the bundle as a
// literal. This test is what makes that copy safe: it loads the real
// states.yml and asserts every alias in it still resolves here.
//
// Without it, an alias added to states.yml silently resolves to nothing in the
// dashboard. `canonStatus` ends in `STATUS_ALIAS[k] ?? s.toUpperCase()`, so an
// unknown alias is not rejected — it is passed through as raw uppercased text,
// and every consumer substring-tests it against the canonical names, which it
// matches none of. The row then shows under ALL and no other tracker tab, is
// absent from every tab badge and stage bar, and reads as zero in the
// analytics achievement tiles — re-firing the #2410 "keep follow-ups warm"
// nudge at someone who is mid-interview. That is #2249 (fixed by hand for one
// state) recurring as #2917 with 27 aliases.
//
// Imports from status-alias.mjs rather than format.ts because `node --test`
// has no TS runner. Reading up out of web/ follows clean-chips.test.mjs, which
// loads ../../../templates/portals.example.yml the same way.
//
// Run:  node --test tests/lib/status-alias.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Namespace import, not default: js-yaml has no default export (test-all.mjs
// enforces this — a default import breaks on js-yaml 5).
import * as yaml from "js-yaml";
import { STATUS_ALIAS, canonStatus } from "../../src/lib/status-alias.mjs";

const states = yaml.load(
  readFileSync(new URL("../../../templates/states.yml", import.meta.url), "utf8"),
).states;
const STAGES = states.map((s) => s.label.toUpperCase());

test("every states.yml alias resolves to its own canonical stage", () => {
  const broken = [];
  for (const st of states) {
    const canon = st.label.toUpperCase();
    for (const alias of st.aliases ?? []) {
      const got = canonStatus(String(alias));
      // Consumers test with `.includes`, so that is the contract to assert.
      if (!got.includes(canon)) broken.push(`${JSON.stringify(alias)} -> ${JSON.stringify(got)}, want ${canon}`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    `${broken.length} states.yml alias(es) resolve to no canonical stage in the dashboard (#2917).\n` +
      `Add them to web/src/lib/status-alias.mjs:\n  ${broken.join("\n  ")}`,
  );
});

test("no alias maps to a stage the dashboard does not know", () => {
  for (const [alias, canon] of Object.entries(STATUS_ALIAS)) {
    assert.ok(STAGES.includes(canon), `alias ${JSON.stringify(alias)} maps to unknown stage ${JSON.stringify(canon)}`);
  }
});

test("a bare canonical label resolves to itself with no alias entry", () => {
  for (const st of states) {
    const label = st.label;
    assert.ok(canonStatus(label).includes(label.toUpperCase()), `${label} does not resolve to itself`);
  }
});

test("aliases states.yml does not list are still honoured", () => {
  // These predate states.yml. Dropping them would regress an existing tracker,
  // so the sync above is one-directional: states.yml is a floor, not a cap.
  for (const [alias, canon] of [
    ["evaluado", "EVALUATED"],
    ["respondida", "RESPONDED"],
    ["contestada", "RESPONDED"],
    ["duplicado", "DISCARDED"],
    ["repost", "DISCARDED"],
  ]) {
    assert.equal(canonStatus(alias), canon, `web-only alias ${alias} was dropped`);
  }
});

test("empty and placeholder statuses are Discarded, not a crash", () => {
  for (const blank of ["", "   ", "—", "-"]) assert.equal(canonStatus(blank), "DISCARDED");
});

// The drift test above feeds aliases exactly as states.yml spells them, which
// is lowercase — so it cannot see a folding bug. A real tracker row is
// capitalised, and that is where the Turkish dotted capital breaks: JS
// lowercases "İ" to "i" + U+0307, so "İşe alındı" keys as "i̇şe alındı" and
// misses the "işe alındı" entry however complete the map is.
test("a capitalised status resolves, including Turkish dotted İ", () => {
  for (const [input, canon] of [
    ["İşe alındı", "HIRED"],
    ["Mülakat", "INTERVIEW"],
    ["Teklif", "OFFER"],
    ["Değerlendirildi", "EVALUATED"],
    ["Başvuruldu", "APPLIED"],
    ["Uygun değil", "SKIP"],
    ["Reddedildi", "REJECTED"],
    ["Entrevista", "INTERVIEW"],
  ]) {
    assert.equal(canonStatus(input), canon, `${input} did not resolve to ${canon}`);
  }
});

test("the İ fold does not reach other languages' dots", () => {
  // Why the fold is NFKC and not NFD: NFD decomposes precomposed letters too,
  // so stripping U+0307 afterwards would eat the dot of ż / ė / ġ and collapse
  // these onto Zubr / Eme / Generali. None is a status, so each must simply
  // pass through unrecognised rather than silently become a different word.
  for (const name of ["Żubr", "Ėmė", "Ġenerali"]) {
    assert.equal(canonStatus(name), name.toUpperCase(), `${name} was over-folded`);
  }
});

test("a bolded alias resolves — AGENTS.md forbids bold, so it turns up", () => {
  assert.equal(canonStatus("**Oferta**"), "OFFER");
  assert.equal(canonStatus("**Mülakat**"), "INTERVIEW");
});
