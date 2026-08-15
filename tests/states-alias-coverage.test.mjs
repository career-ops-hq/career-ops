// tests/states-alias-coverage.test.mjs — templates/states.yml must know every
// alias the rest of the engine already accepts.
//
// states.yml calls itself "Source of truth for career-ops (writer) and dashboard
// (reader). Both systems MUST use these exact states." But normalize-statuses.mjs
// carried alias mappings states.yml had never heard of (condicional, hold,
// evaluar, verificar -> Evaluated; geo blocker -> SKIP), and the two lists drifted
// silently because nothing compared them.
//
// The drift is not cosmetic. set-status.mjs writes the row's PREVIOUS status text
// into data/status-log.tsv as the transition's `from` cell, and funnel-velocity.mjs
// validates that cell against states.yml. A row sitting on an accepted-but-unlisted
// status produced a log line funnel-velocity discarded as unparseable, so the row's
// first tracked transition vanished from velocity and coverage math.
//
// The vocabulary is read out of normalize-statuses.mjs rather than hardcoded, so
// adding an alias there without adding it to states.yml fails here.
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nstates.yml alias coverage — the engine and the source of truth agree');

try {
  const { loadCanonicalStates, resolveCanonicalState } = await import(
    pathToFileURL(join(ROOT, 'tracker-utils.mjs')).href
  );
  const states = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));

  const src = readFileSync(join(ROOT, 'normalize-statuses.mjs'), 'utf-8');

  // Rules of the shape:  if (/^<pattern>$/i.test(s)) return { status: 'Canonical' };
  // <pattern> may be a bare literal or a (a|b|c) alternation. Alternatives that
  // carry regex metacharacters (\d, ?, ., +) are not plain aliases — they match
  // shapes like "rechazado 2026" — so they are skipped rather than guessed at.
  // Loose, unanchored patterns (e.g. /geo.?blocker/) are covered by the explicit
  // spot-checks below instead.
  const RULE_RE = /\/\^\(?([A-Za-zÀ-ÿ|_ ]+)\)?\$\/i\.test\([^)]*\)\)\s*return\s*\{\s*status:\s*'([^']+)'/g;
  const extracted = [];
  for (const m of src.matchAll(RULE_RE)) {
    for (const alias of m[1].split('|')) {
      const a = alias.trim();
      if (a) extracted.push({ alias: a, expected: m[2] });
    }
  }

  // normalize-statuses.mjs used to carry a SECOND rule shape — plain
  // `['evaluada'].includes(lower)` alias lists — and this file extracted those
  // too. Those lists are gone (#2704): the function now resolves the remaining
  // aliases through states.yml itself, so there is no second vocabulary left to
  // scrape. The assertion below inverted with it — instead of proving the lists
  // are extractable, it proves they have not come back.

  // Each extractor is asserted separately on purpose. A combined
  // `extracted.length > 0` passes on the regex arm alone, so if
  // normalize-statuses.mjs reshapes its list rules and LIST_RULE_RE stops
  // matching, that arm silently checks nothing while the test stays green —
  // exactly the kind of quiet drift this file exists to catch.
  extracted.length > 0
    ? pass(`extracted ${extracted.length} anchored alias rule(s) from normalize-statuses.mjs`)
    : fail("extracted no anchored alias rules — RULE_RE no longer matches normalize-statuses.mjs and is checking nothing");

  // Derivation guard, replacing the extractor that has nothing left to extract.
  // Two halves, because either alone can go quietly wrong: the derivation must
  // still be wired, and a hardcoded alias list must not reappear beside it.
  const derives = /resolveCanonicalState\(/.test(src);
  const hasListRule = /\]\.includes\(lower\)\)\s*return\s*\{\s*status:/.test(src);
  derives && !hasListRule
    ? pass('normalize-statuses derives its remaining aliases from states.yml rather than listing them (#2704)')
    : fail(derives
      ? 'a hardcoded alias list reappeared in normalize-statuses.mjs — resolve through states.yml instead (#2704)'
      : 'normalize-statuses no longer calls resolveCanonicalState — the states.yml derivation was removed (#2704)');

  const orphans = extracted.filter(({ alias, expected }) => {
    const resolved = resolveCanonicalState(alias, states);
    return !resolved || resolved.toLowerCase() !== expected.toLowerCase();
  });

  orphans.length === 0
    ? pass('every alias normalize-statuses accepts resolves to the same state in states.yml')
    : fail(`states.yml is missing or disagrees on ${orphans.length} alias(es): ${orphans.map(o => `"${o.alias}"->${o.expected}`).join(', ')}`);

  // The specific drift this was written for, including the loose geo-blocker
  // pattern the extractor deliberately does not try to parse.
  for (const [alias, expected] of [
    ['hold', 'Evaluated'],
    ['verificar', 'Evaluated'],
    ['condicional', 'Evaluated'],
    ['evaluar', 'Evaluated'],
    ['geo blocker', 'SKIP'],
    ['geo_blocker', 'SKIP'],
  ]) {
    const resolved = resolveCanonicalState(alias, states);
    resolved === expected
      ? pass(`"${alias}" resolves to ${expected}`)
      : fail(`"${alias}" resolved to ${resolved ?? 'nothing'}, expected ${expected}`);
  }

  // The other direction: widening the alias lists must not shadow a real state.
  const shadowed = states.filter(s => resolveCanonicalState(s.label, states) !== s.label);
  shadowed.length === 0
    ? pass('every canonical label still resolves to itself')
    : fail(`alias widening shadowed canonical label(s): ${shadowed.map(s => s.label).join(', ')}`);

  // ---------------------------------------------------------------------------
  // The reverse direction: every alias states.yml PROMISES must actually be
  // accepted by normalize-statuses.mjs.
  //
  // Everything above reads states.yml through tracker-utils, so it only ever
  // proves "the normalizer's vocabulary is listed in states.yml". It cannot see
  // the opposite drift — states.yml advertising an alias the normalizer rejects.
  // That gap was real: states.yml listed `rechazado`, but the rule was
  // /^rechazada?$/i ("rechazad" + an optional "a"), which matches "rechazada" and
  // never "rechazado", so a bare Rechazado row normalized to unknown.
  //
  // This calls normalizeStatus directly rather than pattern-matching source, so
  // it cannot be fooled by a rule shape the extractors above do not parse — which
  // is exactly how the rechazado rule escaped: its `?` is not in RULE_RE's class.
  const { normalizeStatus } = await import(
    pathToFileURL(join(ROOT, 'normalize-statuses.mjs')).href
  );

  const unaccepted = [];
  for (const state of states) {
    for (const alias of [state.label, ...(state.aliases ?? [])]) {
      const got = normalizeStatus(alias).status;
      if (got !== state.label) unaccepted.push(`"${alias}"->${got ?? 'unknown'} (want ${state.label})`);
    }
  }
  unaccepted.length === 0
    ? pass(`normalize-statuses accepts all ${states.reduce((n, s) => n + 1 + (s.aliases?.length ?? 0), 0)} labels and aliases states.yml declares`)
    : fail(`states.yml declares ${unaccepted.length} value(s) normalize-statuses rejects: ${unaccepted.join(', ')}`);

  // Boundary samples for the loose regex rules, which neither extractor parses.
  // `geoblocker` (no separator) is accepted by /geo.?blocker/i but was covered by
  // no test; the spaced and underscored forms above are the only ones asserted.
  for (const [raw, expected] of [
    ['geoblocker', 'SKIP'],
    ['GEO BLOCKER', 'SKIP'],
    ['rechazado 2026', 'Rejected'],
    ['aplicado 2026', 'Applied'],
    ['**Rechazado**', 'Rejected'],
  ]) {
    const got = normalizeStatus(raw).status;
    got === expected
      ? pass(`normalizeStatus("${raw}") -> ${expected}`)
      : fail(`normalizeStatus("${raw}") -> ${got ?? 'unknown'}, expected ${expected}`);
  }
} catch (err) {
  fail(`states alias coverage test threw: ${err?.message ?? err}`);
}
