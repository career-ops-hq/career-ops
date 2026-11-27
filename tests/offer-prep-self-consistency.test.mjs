// tests/offer-prep-self-consistency.test.mjs — content contract for #7489:
// offer-prep reads a contract against itself (a figure with two different
// values in the same unit inside one document, a quantity stated in two
// different units, figures deferred to another instrument, documents in the
// offer package the contract never references).
//
// Reads the mode text and synthetic fixtures; runs no model. The pins, the
// surface anchors, the twin pins of each ban, the surfaces a local ban
// applies to and the exact expected text of every surface are NOT typed here:
// they are test data next to the fixtures, pins.json (twins) and
// surfaces.json (bans, expected_norm, expected_blocks). They were generated
// once by a script that is not part of this repository; after a wording
// change to a surface, update them by hand (the K18 failure shows expected
// and got at the first differing offset). DEFS below holds no pin or surface id.
//
// K18 (K-exact) is the root check: every surface slice must equal the derived
// slice, as normalised text and as a Markdown block skeleton. Any added,
// removed, changed or hidden text inside a slice is red there, whatever markup
// is used. The bans (K3-K8, K17) and K2 stay as diagnostics that name the cause.
//
// Inputs (both optional, for mutation runs against copies):
//   OFFER_PREP_MODE_PATH            mode file     (default modes/offer-prep.md)
//   OFFER_PREP_SELF_FIXTURES        fixtures dir  (default tests/fixtures/offer-prep-self-consistency)
//
// Every check prints exactly one line that starts with its id; a failure
// names the broken half first in each problem.
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MODE_PATH = process.env.OFFER_PREP_MODE_PATH
  ? resolve(process.env.OFFER_PREP_MODE_PATH)
  : join(ROOT, 'modes', 'offer-prep.md');
const FIXTURES = process.env.OFFER_PREP_SELF_FIXTURES
  ? resolve(process.env.OFFER_PREP_SELF_FIXTURES)
  : join(ROOT, 'tests', 'fixtures', 'offer-prep-self-consistency');

const readText = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const fx = (name) => readText(join(FIXTURES, name));

// ── check definitions ──────────────────────────────────────────────────────
// The mutation script reads the block between BEGIN DEFS and END DEFS and
// derives its mutant list from it, so keep it free of side effects.
// BEGIN DEFS
const DEFS = {
  // Bans over surface slices (after norm). Each member is [regex source,
  // matching sample]. scope 'all' = every surface in surfaces.json; scope
  // 'local' = the surfaces whose `bans` list names the ban. The twin pins are
  // the pins whose `twins` list names the ban; every ban that is not
  // structural must have one.
  bans: {
    K3: {
      label: 'no verdict or fault wording in the surfaces',
      scope: 'all',
      members: [
        // retyped from tests/offer-prep-contract-stage.test.mjs (posture
        // check), which exports nothing; keep the two in step
        ['safe to sign', 'safe to sign'], ['\\brisky\\b', 'risky'],
        ['🔴', '🔴'], ['🟡', '🟡'], ['🟢', '🟢'], ['⚠️', '⚠️'],
        // fault wording (#7489: no "error" wording)
        ['\\berrors?\\b', 'error'], ['\\bmistakes?\\b', 'mistake'], ['\\btypos?\\b', 'typo'],
        ['\\bwrong\\b', 'wrong'], ['\\bincorrect\\b', 'incorrect'], ['\\binvalid\\b', 'invalid'],
      ],
    },
    K4: {
      label: 'no law stated in the surfaces',
      scope: 'all',
      members: [
        ['\\bunenforceable\\b', 'unenforceable'], ['\\bvoid\\b', 'void'], ['\\billegal\\b', 'illegal'],
        ['\\bunlawful\\b', 'unlawful'], ['\\bstatutory (?:minimum|floor)\\b', 'statutory minimum'],
        ['\\bthe law (?:requires|allows|permits|prohibits)\\b', 'the law requires'],
        ['\\bunder [\\w{}.-]+ law\\b', 'under {jurisdiction} law'],
      ],
    },
    K5: {
      label: 'nothing is looked up from the surfaces',
      scope: 'all',
      members: [
        ['https?:\\/\\/', 'https://'], ['\\bweb ?fetch\\b', 'webfetch'], ['\\bweb ?search\\b', 'websearch'],
        ['\\bonline\\b', 'online'], ['\\bdownload', 'download'], ['\\bsearch for\\b', 'search for'],
      ],
    },
    K6: {
      label: 'no new tag in the surfaces',
      scope: 'all',
      members: [
        // any [tag] that is not an existing offer-prep tag ([differs from the
        // posting] is #7801's tag and stays allowed so both edits can merge)
        ['\\[(?!(?:commonly negotiated|ask your lawyer|standard|matches what you were told|differs from what you were told|differs from the posting)\\])[^\\]\\n]{1,60}\\]', '[check this]'],
      ],
    },
    K8: {
      label: 'no HTML or tilde markup in the surfaces',
      scope: 'all',
      // structural ban and a diagnostic: K18 is the root check for hidden
      // text (it also catches link-reference definitions, fences, indented
      // code and added sentences, which K8 does not see). No surface holds
      // "<" or "~", so any HTML tag or comment (<!--, <del>, <s>, <strike>,
      // <details>) and any tilde strike-through (~~x~~ or GFM ~x~) is named
      // here; "-->" names a comment opened before START.
      structural: true,
      members: [['<', '<'], ['~', '~'], ['-->', '-->']],
    },
    K17: {
      label: 'item 1 stays narrow: an ordinary cross-reference is not a finding, and different units are neither converted nor called a difference',
      scope: 'local',
      members: [
        ['\\bany clause (?:whose|that)\\b', 'any clause whose'], ['\\bdefined by another clause\\b', 'defined by another clause'],
        ['\\b(?:any|every) (?:cross-)?reference\\b', 'every cross-reference'], ['\\bevery clause (?:whose|that)\\b', 'every clause that'],
        // values are compared only in the same unit: the rev. 2 wording
        // "reads differently" is banned, and so is any conversion and any
        // difference claimed for two different units
        ['\\breads? differently\\b', 'reads differently'],
        ['\\b(?:units?|periods?|amounts?|figures?|values?)(?: and (?:units?|periods?))? (?:are|is|get) converted\\b', 'once units and periods are converted'],
        ['\\bmultiply out\\b', 'multiply out'],
        ['\\bconver(?:t|ts|ting|sion)\\b', 'convert'],
        ['\\bdifferent units\\b[^.]*\\bdiffers?\\b', 'in different units the two readings differ'],
      ],
    },
  },
  // Allowed tags, for the K6 controls (must stay green when inserted).
  allowedTags: ['[commonly negotiated]', '[ask your lawyer]', '[standard]', '[matches what you were told]', '[differs from what you were told]', '[differs from the posting]'],
  // The fixture files must stay English; the twin is the English title line.
  germanBan: [['Arbeitnehmer', 'Arbeitnehmer'], ['Arbeitgeber', 'Arbeitgeber'], ['Vertrag', 'Vertrag'], ['Urlaub', 'Urlaub'], ['Tarifvertrag', 'Tarifvertrag'], ['Kündigung', 'Kündigung']],
  englishFiles: ['contract-inconsistent.md', 'contract-consistent.md', 'package-inconsistent.md', 'package-consistent.md'],
  englishTwin: { files: ['contract-inconsistent.md', 'contract-consistent.md'], line: '# Employment Agreement' },
  // The AND-halves of each compound check; failure details name the half.
  halves: {
    K1: ['start-once', 'end-once', 'start-before-end', 'in-parent', 'surface-order'],
    K2: ['pin-in-surface', 'pin-in-sentence', 'pin-order'],
    K18: ['slice-equals', 'blocks-equal'],
    K3: ['no-ban-member', 'twin-present'],
    K4: ['no-ban-member', 'twin-present'],
    K5: ['no-ban-member', 'twin-present'],
    K6: ['no-ban-member', 'twin-present'],
    K8: ['no-ban-member'],
    K17: ['no-ban-member', 'twin-present'],
    K9: ['kind-present', 'quote-in-section', 'same-unit', 'figures-differ'],
    K10: ['kind-present', 'quote-in-section', 'units-differ', 'asks-only'],
    K11: ['kind-present', 'quote-in-section', 'cites-base', 'base-is-a-finding'],
    K12: ['kind-present', 'quote-in-section', 'no-figure', 'refers-in-quote', 'route-matches'],
    K13: ['kind-present', 'listed-in-package', 'absent-from-contract'],
    K15: ['expects-none', 'same-sections', 'pairs-agree', 'dependent-base-agrees', 'deferred-has-figure', 'package-all-referenced'],
    K16: ['no-german', 'twin-present'],
  },
};
DEFS.checks = Object.keys(DEFS.halves);
// END DEFS

// One normalisation for mode text, anchors and pins: strip backticks and **,
// collapse whitespace, lowercase.
const norm = (t) => t.replace(/\r\n/g, '\n').replace(/`/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').toLowerCase();
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
// BEGIN SHARED (derive.mjs --test asserts that this block is byte-identical
// to its own copy, so the expected values and the check use one definition)
// normMap: norm(raw) as text t plus map, where t[k] comes from raw[map[k]].
const normMap = (raw) => {
  const kept = [];
  for (let i = 0; i < raw.length; i++) if (raw[i] !== '`') kept.push(i);
  let t = '';
  const map = [];
  for (let k = 0; k < kept.length; k++) {
    const c = raw[kept[k]];
    if (c === '*' && raw[kept[k + 1]] === '*') { k++; continue; }
    if (/\s/.test(c)) { if (!t.endsWith(' ')) { t += ' '; map.push(kept[k]); } continue; }
    for (const l of c.toLowerCase()) { t += l; map.push(kept[k]); }
  }
  return { t, map };
};
// The whole raw lines that hold norm offsets [i, j).
const rawLinesOf = (raw, map, i, j) => {
  const a = raw.lastIndexOf('\n', map[i] - 1) + 1;
  const e = raw.indexOf('\n', map[j - 1]);
  return raw.slice(a, e === -1 ? raw.length : e).split('\n');
};
// Markdown block skeleton of some lines, one letter per block start:
// P paragraph text (consecutive lines merge), B blank, F fence, I indented
// code, R link-reference definition, H HTML, G heading, Q quote, L list item,
// T rule or setext underline. Rewrapping a paragraph does not change it.
const blocksOf = (lines) => {
  const out = [];
  lines.forEach((l, k) => {
    const afterBlank = k === 0 || /^\s*$/.test(lines[k - 1]);
    let c = 'P';
    if (/^\s*$/.test(l)) c = 'B';
    else if (/^ {0,3}(?:`{3,}|~{3,})/.test(l)) c = 'F';
    else if (afterBlank && /^(?: {4}|\t)/.test(l)) c = 'I';
    else if (/^ {0,3}\[[^\]]+\]:/.test(l)) c = 'R';
    else if (/^ {0,3}</.test(l)) c = 'H';
    else if (/^ {0,3}#{1,6}(?:\s|$)/.test(l)) c = 'G';
    else if (/^ {0,3}>/.test(l)) c = 'Q';
    else if (/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/.test(l)) c = 'L';
    else if (/^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|=+[ \t]*)$/.test(l)) c = 'T';
    if (!(c === 'P' && out[out.length - 1] === 'P')) out.push(c);
  });
  return out.join('');
};
// END SHARED
const check = (id, label, problems) => {
  if (problems.length === 0) pass(`${id} ${label}`);
  else fail(`${id} ${label}: ${problems.join('; ')}`);
};

console.log('\n📄 offer-prep self-consistency (content contract, #7489)');

const rawMode = readText(MODE_PATH);
const mode = norm(rawMode);
const pins = JSON.parse(fx('pins.json'));
const surfaces = JSON.parse(fx('surfaces.json'));
const pinById = Object.fromEntries(pins.map((p) => [p.id, p]));

// A parent's block: from its heading line to the next heading of any level.
const modeLines = rawMode.split('\n');
const isHeading = (l) => /^#{1,6} /.test(l);
const parentBlock = (heading) => {
  const at = modeLines.flatMap((l, k) => (l === heading ? [k] : []));
  if (at.length !== 1) return { n: at.length };
  let e = at[0] + 1;
  while (e < modeLines.length && !isHeading(modeLines[e])) e++;
  return { n: 1, text: norm(modeLines.slice(at[0], e).join('\n')) };
};

// ── K1 anchors: once each, START before END, inside the parent, in order ──
const slices = {};
const sliceAt = {};
{
  const problems = [];
  let prev = null;
  for (const s of surfaces) {
    const a = norm(s.start);
    const b = norm(s.end);
    const ca = count(mode, a);
    const cb = count(mode, b);
    if (ca !== 1) problems.push(`start-once ${s.id} x${ca}`);
    if (cb !== 1) problems.push(`end-once ${s.id} x${cb}`);
    if (ca !== 1 || cb !== 1) continue;
    const i = mode.indexOf(a);
    const j = mode.indexOf(b);
    if (!(i + a.length <= j)) { problems.push(`start-before-end ${s.id}`); continue; }
    slices[s.id] = mode.slice(i, j + b.length);
    sliceAt[s.id] = i;
    const blk = parentBlock(s.parent);
    if (blk.n !== 1) problems.push(`in-parent ${s.id} heading "${s.parent}" x${blk.n}`);
    else if (count(blk.text, a) !== 1 || count(blk.text, b) !== 1) problems.push(`in-parent ${s.id} outside "${s.parent}"`);
    if (prev && !(prev.end <= i)) problems.push(`surface-order ${prev.id} before ${s.id}`);
    prev = { id: s.id, end: j + b.length };
  }
  check('K1', 'surface anchors occur once each, START before END, inside the parent section, in order', problems);
}
const slice = (id) => slices[id];

// ── K2 pins: inside its own surface, whole sentence intact, in id order ────
{
  const problems = [];
  const last = {};
  for (const p of pins) {
    const s = slice(p.surface);
    if (s === undefined) { problems.push(`pin-in-surface no slice ${p.surface} for ${p.id}`); continue; }
    const at = s.indexOf(norm(p.phrase));
    if (at === -1) problems.push(`pin-in-surface ${p.id} (${p.surface})`);
    if (!s.includes(norm(p.sentence))) problems.push(`pin-in-sentence ${p.id} (${p.surface})`);
    if (at === -1) continue;
    const prev = last[p.surface];
    if (prev && !(prev.at < at)) problems.push(`pin-order ${prev.id} before ${p.id} (${p.surface})`);
    last[p.surface] = { id: p.id, at };
  }
  check('K2', 'every pin sits inside its own surface and sentence, in order', problems);
}

// ── K18 K-exact: every slice equals the derived slice, text and blocks ─────
{
  const problems = [];
  const { t, map } = normMap(rawMode);
  const clip = (x, k) => x.slice(Math.max(0, k - 20), k + 40);
  for (const s of surfaces) {
    const got = slices[s.id];
    if (got === undefined) { problems.push(`slice-equals no slice ${s.id}`); continue; }
    const want = s.expected_norm;
    if (typeof want !== 'string' || typeof s.expected_blocks !== 'string') { problems.push(`slice-equals no expected slice for ${s.id}`); continue; }
    if (got !== want) {
      let k = 0;
      while (k < got.length && got[k] === want[k]) k++;
      problems.push(`slice-equals ${s.id} differs at ${k}: expected "${clip(want, k)}", got "${clip(got, k)}"`);
    }
    if (t !== mode) { problems.push(`blocks-equal ${s.id}: offset map disagrees with norm`); continue; }
    const blocks = blocksOf(rawLinesOf(rawMode, map, sliceAt[s.id], sliceAt[s.id] + got.length));
    if (blocks !== s.expected_blocks) problems.push(`blocks-equal ${s.id} expected ${s.expected_blocks}, got ${blocks}`);
  }
  check('K18', 'K-exact, every surface slice equals the derived target slice, as text and as Markdown blocks', problems);
}

// ── bans (K3–K8, K17), each with its positive twin ─────────────────────────
for (const [id, ban] of Object.entries(DEFS.bans)) {
  const problems = [];
  const re = new RegExp(ban.members.map(([src]) => src).join('|'));
  const scope = surfaces.filter((s) => ban.scope === 'all' || (s.bans ?? []).includes(id)).map((s) => s.id);
  if (scope.length === 0) problems.push('no-ban-member no surface in scope');
  for (const sid of scope) {
    const s = slice(sid);
    if (s === undefined) { problems.push(`no-ban-member no slice ${sid}`); continue; }
    const m = s.match(re);
    if (m) problems.push(`no-ban-member found "${m[0]}" in ${sid}`);
  }
  const twins = pins.filter((p) => (p.twins ?? []).includes(id)).map((p) => p.id);
  if (!ban.structural && twins.length === 0) problems.push('twin-present no twin pin');
  for (const pid of twins) {
    const p = pinById[pid];
    const s = p && slice(p.surface);
    if (!p || s === undefined || !s.includes(norm(p.phrase))) problems.push(`twin-present missing ${pid}${p ? ` (${p.surface})` : ''}`);
  }
  check(id, ban.label, problems);
}

// ── fixtures ───────────────────────────────────────────────────────────────
const fields = (line) => Object.fromEntries(line.replace(/^- /, '').split(' | ').map((f) => {
  const k = f.indexOf(': ');
  return [f.slice(0, k).trim(), f.slice(k + 2).trim()];
}));
const quoted = (v) => /^"(.*)"$/.exec(v ?? '')?.[1];
const items = (text) => text.split('\n').filter((l) => l.startsWith('- '));
// Sections: "N. Title. …" (one line each) and "## Annex X" blocks.
const sectionsOf = (text) => {
  const out = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^(\d+)\. ([^.]+)\. /.exec(line);
    if (m) { cur = m[1]; out[cur] = { title: m[2], text: line }; continue; }
    const a = /^## (Annex [A-Z])\s*$/.exec(line);
    if (a) { cur = a[1]; out[cur] = { title: a[1], text: '' }; continue; }
    if (/^#/.test(line)) { cur = null; continue; }
    if (cur && line.trim()) out[cur].text += `\n${line}`;
  }
  return out;
};
const num = (t) => {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(t ?? '');
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
};
const inSection = (secs, at, q) => Boolean(q) && secs[at] !== undefined && secs[at].text.includes(q);
const packageDocs = (text) => items(text).map((l) => l.slice(2).trim());

const contractI = fx('contract-inconsistent.md');
const contractC = fx('contract-consistent.md');
const packageI = fx('package-inconsistent.md');
const packageC = fx('package-consistent.md');
const secI = sectionsOf(contractI);
const secC = sectionsOf(contractC);
const findings = items(fx('expected-findings.md')).map(fields);
const ofKind = (k) => findings.filter((f) => f.kind === k);

// Values are compared only in the same unit: a unit word must appear in its
// quote (case-insensitive).
const hasUnit = (q, u) => Boolean(q) && Boolean(u) && q.toLowerCase().includes(u.toLowerCase());

// ── K9 differs: same unit, both places quoted, the values differ ──────────
{
  const problems = [];
  const fs = ofKind('differs');
  if (fs.length === 0) problems.push('kind-present no differs finding');
  for (const f of fs) {
    if (!inSection(secI, f['a-at'], quoted(f.a)) || !inSection(secI, f['b-at'], quoted(f.b))) problems.push(`quote-in-section ${f.id}`);
    if (!hasUnit(quoted(f.a), f.unit) || !hasUnit(quoted(f.b), f.unit)) problems.push(`same-unit ${f.id}`);
    if (!(num(quoted(f.a)) !== num(quoted(f.b)))) problems.push(`figures-differ ${f.id}`);
  }
  check('K9', 'fixture: a figure with two values in the same unit is quoted in both places, and the values differ', problems);
}

// ── K10 units: different units are quoted, never converted or compared ────
{
  const problems = [];
  const fs = ofKind('units');
  if (fs.length === 0) problems.push('kind-present no units finding');
  for (const f of fs) {
    if (!inSection(secI, f['a-at'], quoted(f.a)) || !inSection(secI, f['b-at'], quoted(f.b))) problems.push(`quote-in-section ${f.id}`);
    const [ua, ub] = [f['a-unit'], f['b-unit']];
    if (!hasUnit(quoted(f.a), ua) || !hasUnit(quoted(f.b), ub) || ua.toLowerCase() === ub.toLowerCase()) problems.push(`units-differ ${f.id}`);
    // the only output is the neutral question: no factor, no claimed difference
    const ask = quoted(f.ask);
    if (!ask || !ask.endsWith('?') || /\d|\bdiffer/i.test(ask) || 'factor' in f || 'unit' in f) problems.push(`asks-only ${f.id}`);
  }
  check('K10', 'fixture: a quantity stated in two different units is quoted in both places with only a neutral question, no conversion and no claimed difference', problems);
}

// ── K11 depends: a clause takes its figure from another clause ─────────────
{
  const problems = [];
  const fs = ofKind('depends');
  if (fs.length === 0) problems.push('kind-present no depends finding');
  // only a same-unit difference is a base: a different-unit pair is not a difference
  const baseSections = new Set(ofKind('differs').flatMap((f) => [f['a-at'], f['b-at']]));
  for (const f of fs) {
    if (!inSection(secI, f.at, quoted(f.quote))) problems.push(`quote-in-section ${f.id}`);
    if (!(quoted(f.quote) ?? '').includes(`section ${f['base-at']}`) || secI[f['base-at']] === undefined) problems.push(`cites-base ${f.id}`);
    if (!baseSections.has(f['base-at'])) problems.push(`base-is-a-finding ${f.id}`);
  }
  check('K11', 'fixture: a dependent clause cites a base clause that is itself a finding', problems);
}

// ── K12 deferred: no figure, the reference is quoted, routed by kind ──────
{
  const problems = [];
  const fs = ofKind('deferred');
  if (fs.length === 0) problems.push('kind-present no deferred finding');
  for (const f of fs) {
    const q = quoted(f.quote);
    if (!inSection(secI, f.at, q)) problems.push(`quote-in-section ${f.id}`);
    if (secI[f.at] === undefined || /\d/.test(secI[f.at].text.replace(/^\d+\. /, ''))) problems.push(`no-figure ${f.id}`);
    if (!quoted(f.refers) || !(q ?? '').includes(quoted(f.refers))) problems.push(`refers-in-quote ${f.id}`);
    const statute = /statut/i.test(quoted(f.refers) ?? '');
    if (f.route !== (statute ? 'lawyer' : 'items')) problems.push(`route-matches ${f.id}`);
  }
  check('K12', 'fixture: a deferred figure states no number, quotes its reference, and is routed by kind', problems);
}

// ── K13 unreferenced: received with the offer, never named by the contract ─
{
  const problems = [];
  const fs = ofKind('unreferenced');
  if (fs.length === 0) problems.push('kind-present no unreferenced finding');
  const docs = packageDocs(packageI);
  for (const f of fs) {
    const d = quoted(f.document);
    if (!d || !docs.includes(d)) problems.push(`listed-in-package ${f.id}`);
    if (!d || contractI.toLowerCase().includes(d.toLowerCase())) problems.push(`absent-from-contract ${f.id}`);
  }
  check('K13', 'fixture: an unreferenced document is in the package and absent from the contract', problems);
}


// ── K15 negative fixture: the consistent twin surfaces nothing ────────────
{
  const problems = [];
  const exp = items(fx('expected-consistent.md'));
  if (!(exp.length === 1 && exp[0] === '- none')) problems.push('expects-none');
  const sig = (secs) => Object.entries(secs).map(([k, v]) => `${k}:${v.title}`).join('|');
  if (sig(secI) !== sig(secC)) problems.push('same-sections');
  const annexLine = (at, q) => {
    const label = (q ?? '').split(':')[0];
    return (secC[at]?.text ?? '').split('\n').find((l) => l.startsWith(`- ${label}:`));
  };
  // the twin states both places in the same unit (the unit of place a) with
  // the same value, so neither a difference nor the neutral question arises
  const agreeing = new Set();
  for (const f of [...ofKind('differs'), ...ofKind('units')]) {
    const aText = secC[f['a-at']]?.text.replace(/^\d+\. /, '');
    const line = annexLine(f['b-at'], quoted(f.b));
    const unit = f.kind === 'units' ? f['a-unit'] : f.unit;
    const a = num(aText);
    if (!(Number.isFinite(a) && a === num(line) && hasUnit(aText, unit) && hasUnit(line, unit))) problems.push(`pairs-agree ${f.id}`);
    else agreeing.add(f['a-at']);
  }
  // The twin keeps each dependent clause's cross-reference, and its base agrees
  // there: an ordinary cross-reference is not a finding.
  for (const f of ofKind('depends')) {
    const cites = (secC[f.at]?.text ?? '').includes(`section ${f['base-at']}`);
    if (!cites || !agreeing.has(f['base-at'])) problems.push(`dependent-base-agrees ${f.id}`);
  }
  for (const f of ofKind('deferred')) {
    if (!/\d/.test((secC[f.at]?.text ?? '').replace(/^\d+\. /, ''))) problems.push(`deferred-has-figure ${f.id}`);
  }
  for (const d of packageDocs(packageC)) {
    if (!contractC.toLowerCase().includes(d.toLowerCase())) problems.push(`package-all-referenced "${d}"`);
  }
  check('K15', 'fixture: the consistent twin agrees everywhere and expects no finding', problems);
}

// ── K16 English fixtures ───────────────────────────────────────────────────
{
  const problems = [];
  const re = new RegExp(DEFS.germanBan.map(([src]) => src).join('|'));
  for (const f of DEFS.englishFiles) {
    const m = fx(f).match(re);
    if (m) problems.push(`no-german found "${m[0]}" in ${f}`);
  }
  for (const f of DEFS.englishTwin.files) {
    if (fx(f).split('\n')[0] !== DEFS.englishTwin.line) problems.push(`twin-present ${f}`);
  }
  check('K16', 'fixture files are English', problems);
}
