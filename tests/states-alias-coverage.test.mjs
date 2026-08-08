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

  // Rules of the second shape normalize-statuses.mjs also uses:
  //   if (['evaluada'].includes(lower)) return { status: 'Evaluated' };
  // A plain list-membership check against the already-lowercased `lower`,
  // rather than an anchored regex. RULE_RE above never matches these, so
  // without this pass a missing alias here (e.g. dropping 'evaluada' from
  // states.yml) would sail through the test undetected.
  const LIST_RULE_RE = /\[((?:'[^']*'|"[^"]*")(?:\s*,\s*(?:'[^']*'|"[^"]*"))*)\]\.includes\(lower\)\)\s*return\s*\{\s*status:\s*'([^']+)'/g;
  for (const m of src.matchAll(LIST_RULE_RE)) {
    for (const lit of m[1].matchAll(/'([^']*)'|"([^"]*)"/g)) {
      const a = (lit[1] ?? lit[2] ?? '').trim();
      if (a) extracted.push({ alias: a, expected: m[2] });
    }
  }

  extracted.length > 0
    ? pass(`extracted ${extracted.length} plain alias rule(s) from normalize-statuses.mjs`)
    : fail("extracted no alias rules — this guard's parser no longer matches normalize-statuses.mjs and is checking nothing");

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
} catch (err) {
  fail(`states alias coverage test threw: ${err?.message ?? err}`);
}
