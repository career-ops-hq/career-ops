// tests/gemini-node-floor.test.mjs
//
// The Gemini integration needs Node 20+ while the rest of the project needs 18+.
// That difference lived only in prose until now: docs/SETUP.md carried it, the
// docs site did not, and the Spanish and French pages had drifted into asserting
// Node 20 as a *general* requirement, which is false. A user on Node 18 who
// followed the site and chose Gemini hit the wall at runtime with no warning.
//
// These pin the verdict itself, so the number has one home and every surface
// derives from it. The failing branch matters most — it is the one that protects
// that user — and it cannot be exercised through doctor.mjs on a machine that
// already runs a recent Node, which is why the logic is a pure module.

import { pass, fail } from './helpers.mjs';
import { geminiNodeFloor, GEMINI_MIN_MAJOR } from '../lib/gemini-node-floor.mjs';

console.log('\n🔎 Gemini Node floor (the requirement that only applies to one CLI)');

const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));

// ── Scope: it applies to Gemini and to nothing else ──────────────────
{
  for (const cli of ['claude', 'codex', 'opencode', 'antigravity', 'grok', 'qwen', 'kimi', 'copilot']) {
    ok(geminiNodeFloor(cli, '18.20.4') === null, `${cli} on Node 18 gets no verdict (the floor is not theirs)`);
  }
  ok(geminiNodeFloor('gemini', '18.20.4') !== null, 'gemini does get a verdict');
}

// ── The failing branch: the user this check exists for ───────────────
{
  const v = geminiNodeFloor('gemini', '18.20.4');
  ok(v.pass === false, 'Node 18 + Gemini fails');
  ok(v.label.includes(String(GEMINI_MIN_MAJOR)), 'the failure names the required major');
  ok(v.label.includes('18.20.4'), 'and names the version actually found');
  ok(Array.isArray(v.fix) && v.fix.length >= 2, 'it offers a fix');
  ok(v.fix.some((f) => /another CLI/i.test(f)), 'including the way out that does not require upgrading Node');

  const boundary = geminiNodeFloor('gemini', '19.9.0');
  ok(boundary.pass === false, 'Node 19 still fails (the floor is 20, not "recent enough")');
}

// ── The passing branch ───────────────────────────────────────────────
{
  for (const version of ['20.0.0', '22.5.1', '25.9.0']) {
    ok(geminiNodeFloor('gemini', version).pass === true, `Node ${version} + Gemini passes`);
  }
}

// ── "Could not read it" is never "all clear" ─────────────────────────
// The project keeps finding checks that answer OK because they failed to look.
// An unparseable version has to fail closed, not quietly pass.
{
  for (const junk of ['', 'unknown', undefined]) {
    const v = geminiNodeFloor('gemini', junk);
    ok(v !== null && v.pass === false, `an unreadable version (${JSON.stringify(junk)}) fails closed instead of passing`);
  }
}

// ── The floor is stated once ─────────────────────────────────────────
{
  ok(GEMINI_MIN_MAJOR === 20, 'the floor is 20, matching docs/SETUP.md');
}
