#!/usr/bin/env node

/**
 * ats-payload.mjs — ATS payload transform: one safe fold, three lints (#3251).
 *
 * Follows from #3202, whose conclusion was that an ATS variant is not a template
 * swap. A template owns the DOM; it does not own what is IN the payload, and some
 * of what an ATS parser mishandles is in the payload. By the time a template sees
 * `competencies: [...]` the decision that breaks parsing has already been made.
 *
 * THE FOLD (applied — pure data movement, no text invented, fully reversible)
 *
 *   `build-cv-html.mjs` renders competencies as bare tag spans into a container
 *   whose separation is entirely visual (`.competencies-grid { gap: 8px }`).
 *   There is no delimiter CHARACTER between one competency and the next — the gap
 *   is CSS. Extract the text layer and adjacent competencies run together into a
 *   single token. On top of that the block ships under `Core Competencies`, which
 *   is not a section name parsers recognise, so it is frequently dropped whole
 *   rather than merely mangled.
 *
 *   `Skills` IS recognised, and already renders through `buildSkills()` as
 *   `<span class="skill-category">Cat:</span> a, b, c` — comma-delimited, under a
 *   header parsers look for. So the same facts, expressed two ways, survive or
 *   don't depending on which array they sit in. This script moves them into the
 *   array that survives. Nothing is rewritten, nothing is invented.
 *
 * THE THREE LINTS (reported, never applied — each needs a decision only the
 * author can make, which is where AGENTS.md's no-fabrication rule draws the line)
 *
 *   employer-in-role       An employer name inside `role` yields a phantom
 *                          employer in the parsed record — the trap for
 *                          consulting and agency work. Detecting "this substring
 *                          is an employer" is not something a script should be
 *                          confident about, and silently rewriting a job title is
 *                          worse than the mangling it prevents.
 *   parenthetical-in-company
 *                          `(Cloud Platform Division)` is kept verbatim as part of
 *                          the employer name, giving a record no search matches.
 *                          Stripping it is easy; deciding where that detail GOES
 *                          instead is authoring.
 *   multiple-date-ranges   Two stints at one employer parse as one. Splitting them
 *                          needs someone to decide which bullets belong to which
 *                          stint. A script can see the second range; it cannot
 *                          allocate the bullets.
 *
 * A tool that reported four findings and applied one is trustworthy; a tool that
 * applied four would be guessing three times per run.
 *
 * CONTRACT: payload JSON in, payload JSON out on stdout, findings on stderr.
 * Zero-LLM, deterministic, offline, and read-only with respect to user-layer
 * files — it consumes a payload and emits a new one, and never writes back to
 * `cv.md` or `config/profile.yml`. Same family as `jd-skill-gap.mjs` and
 * `verify-cv-facts.mjs`. The input object is never mutated.
 *
 * Usage:
 *   node ats-payload.mjs cv.json > cv-ats.json
 *   node ats-payload.mjs cv.json --summary > cv-ats.json
 *   cat cv.json | node ats-payload.mjs - > cv-ats.json
 *   node build-cv-html.mjs cv-ats.json out.html templates/ats/cv-template.ats.html
 *   node ats-payload.mjs --self-test
 *
 * Exit 0 whenever the transform succeeded, findings or not: the lints are
 * advisory by design and the payload on stdout is always usable. Exit 1 only for
 * an unreadable or malformed input.
 */

import { readFileSync } from 'fs';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

// Mirrors DEFAULT_SECTION_TITLES.competencies in build-cv-html.mjs. Used only
// when the payload carries no `sections.competencies` of its own — a localized
// payload keeps its own label, because relabelling the user's section title
// would be inventing text rather than moving it.
const DEFAULT_COMPETENCIES_TITLE = 'Core Competencies';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Trimmed non-empty strings from a payload array (numbers coerced, as the
 *  builder's own `escapeHtml(String(tag))` does). Objects/null are structural
 *  noise and are dropped rather than stringified into "[object Object]". */
function toItemList(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(',') : [];
  return raw
    .filter((v) => v !== null && v !== undefined && typeof v !== 'object')
    .map((v) => String(v).trim())
    .filter(Boolean);
}

/** Category-name identity for the idempotency check: case- and
 *  whitespace-insensitive, trailing colon ignored (the template renders the
 *  colon, but a hand-written payload sometimes carries it). */
function categoryKey(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .replace(/:\s*$/, '')
    .trim()
    .toLowerCase();
}

// ── The transform: fold competencies[] into skills[] ─────────────────────────

/**
 * Move `competencies[]` into `skills[]` as one comma-delimited category and
 * empty the source array.
 *
 * IDEMPOTENT (the edge santifer asked to have pinned by a test): running this on
 * an already-folded payload is a no-op, not a duplicate category. Two mechanisms
 * carry that, because either alone is incomplete:
 *
 *   1. An empty/absent `competencies` returns the payload untouched — the second
 *      run of a plain `transform | transform` pipeline.
 *   2. When a skills category with the same name already exists, its items are
 *      UNIONed in place (order preserved, exact duplicates dropped) instead of a
 *      second category being prepended — the case where a payload was re-edited
 *      with some competencies re-added after a first fold.
 *
 * @param {object} payload - Parsed CV payload. Never mutated.
 * @returns {{payload: object, transform: object}} New payload + what was done.
 */
export function foldCompetencies(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const competencies = toItemList(source.competencies);
  const category = (typeof source.sections?.competencies === 'string'
    && source.sections.competencies.trim())
    || DEFAULT_COMPETENCIES_TITLE;

  if (competencies.length === 0) {
    return {
      payload: source,
      transform: {
        name: 'fold-competencies-into-skills',
        applied: false,
        reason: 'no competencies to fold',
        category,
        moved: 0,
      },
    };
  }

  const skills = Array.isArray(source.skills) ? source.skills : [];
  const existingIndex = skills.findIndex(
    (s) => s && typeof s === 'object' && categoryKey(s.category) === categoryKey(category),
  );

  let nextSkills;
  let merged;
  if (existingIndex === -1) {
    // Prepend: competencies are the keyword block a parser should hit first,
    // and prepending keeps them ahead of the language/framework categories.
    nextSkills = [{ category, items: competencies.join(', ') }, ...skills];
    merged = false;
  } else {
    const existing = skills[existingIndex];
    const existingItems = toItemList(existing.items);
    const seen = new Set(existingItems.map((i) => i.toLowerCase()));
    const added = competencies.filter((i) => {
      const key = i.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    nextSkills = skills.slice();
    nextSkills[existingIndex] = {
      ...existing,
      items: [...existingItems, ...added].join(', '),
    };
    merged = true;
  }

  return {
    // `competencies: []` rather than a deleted key: build-cv-html.mjs and
    // stripEmptySections() both already treat an empty array as "drop the whole
    // block, header included", and keeping the key makes the fold obvious to a
    // human diffing the two payloads.
    payload: { ...source, competencies: [], skills: nextSkills },
    transform: {
      name: 'fold-competencies-into-skills',
      applied: true,
      merged,
      category,
      moved: competencies.length,
      items: competencies,
    },
  };
}

// ── The three lints ─────────────────────────────────────────────────────────

// Legal-form tokens that mark a substring as an organisation name rather than a
// job title. Deliberately narrow: a suffix is near-conclusive evidence, whereas
// a bare capitalized noun in a title is not.
const CORPORATE_SUFFIX_RE = /\b(?:inc|llc|l\.l\.c|ltd|limited|gmbh|mbh|ag|s\.?a\.?s|sarl|s\.?a|s\.?l|b\.?v|n\.?v|plc|corp|corporation|co|company|pty|oy|ab|a\/s|aps|kk|k\.k|holdings|group)\b\.?/i;

// Prepositions that attach an employer to a title. `at` and `@` only: " for "
// reads just as naturally as a team or product ("Engineer for Payments"), and a
// lint that cries wolf on ordinary titles gets ignored, which costs more than
// the case it would have caught.
const EMPLOYER_PREPOSITION_RE = /(?:\s(?:at|@)\s|\s@|^@)/i;

// Explicit client framing — the consulting/agency shape this lint exists for.
const CLIENT_MARKER_RE = /\b(?:client|customer|on behalf of|seconded to|via|through)\s*[:—–-]?\s*\S/i;

// A parenthetical inside `company`. Both ASCII and CJK full-width brackets: a
// ja/zh payload writes （云平台事业部）and the parser keeps it verbatim just the same.
const PARENTHETICAL_RE = /[(（]\s*([^)）]*?)\s*[)）]/;

// One date range: an endpoint, a separator, an endpoint. Endpoint forms cover
// "June 2022", "Jun. 2022", "06/2022", "2022" and the open end ("Present").
const DATE_POINT = '(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s*,?\\s*\\d{4}'
  + '|\\d{1,2}\\s*[/.]\\s*\\d{4}'
  + '|\\d{4}'
  + '|present|current|now|ongoing|date)';
const DATE_SEPARATOR = '\\s*(?:[-–—]{1,2}|\\bto\\b|\\buntil\\b|\\bthrough\\b)\\s*';
const DATE_RANGE_RE = new RegExp(`${DATE_POINT}${DATE_SEPARATOR}${DATE_POINT}`, 'gi');

/** Non-overlapping date ranges in a `dates` string. */
export function countDateRanges(dates) {
  if (typeof dates !== 'string') return 0;
  // Fresh lastIndex per call: the regex is module-level and /g is stateful.
  DATE_RANGE_RE.lastIndex = 0;
  return (dates.match(DATE_RANGE_RE) || []).length;
}

/** True when `needle` appears in `haystack` on non-alphanumeric boundaries, so
 *  "Acme" matches "Acme Cloud Engineer" but not "Acmerica". */
function containsAsToken(haystack, needle) {
  const hay = String(haystack).toLowerCase();
  const need = String(needle).trim().toLowerCase();
  if (need.length < 3) return false;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(need, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : hay[at - 1];
    const after = hay[at + need.length] ?? '';
    if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) return true;
    from = at + 1;
  }
}

/**
 * Report the three judgement calls. Never edits anything.
 *
 * @param {object} payload - Parsed CV payload (pre- or post-fold; the lints read
 *   only `experience[]`, which the fold does not touch).
 * @returns {Array<object>} Findings, in payload order.
 */
export function lintPayload(payload) {
  const entries = Array.isArray(payload?.experience) ? payload.experience : [];
  const findings = [];

  // Every company named anywhere in the payload. A client name that leaked into
  // a title is very often another entry's employer, and that cross-entry match
  // is the one high-confidence signal available without a company database.
  const knownCompanies = entries
    .filter((e) => e && typeof e === 'object' && typeof e.company === 'string')
    .map((e) => e.company.trim())
    .filter((c) => c.length >= 3);

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;

    // ── 1. employer-in-role ──────────────────────────────────────────────
    const role = typeof entry.role === 'string' ? entry.role : '';
    if (role) {
      const signals = [];
      if (CORPORATE_SUFFIX_RE.test(role)) signals.push('corporate-suffix');
      if (EMPLOYER_PREPOSITION_RE.test(role)) signals.push('employer-preposition');
      if (CLIENT_MARKER_RE.test(role)) signals.push('client-marker');
      const matchedCompany = knownCompanies.find((c) => containsAsToken(role, c));
      if (matchedCompany) signals.push('known-company-name');
      if (signals.length > 0) {
        findings.push({
          code: 'employer-in-role',
          severity: 'review',
          path: `experience[${index}].role`,
          value: role,
          signals,
          ...(matchedCompany ? { matchedCompany } : {}),
          message: `Role reads as if it carries an employer name (${signals.join(', ')}). `
            + 'A parser lifts that into the employer field and the record gains a phantom '
            + 'employer. Rewriting a job title is authoring, not cleanup — decide yourself '
            + 'whether the employer belongs in `company` instead.',
        });
      }
    }

    // ── 2. parenthetical-in-company ──────────────────────────────────────
    const company = typeof entry.company === 'string' ? entry.company : '';
    const paren = company.match(PARENTHETICAL_RE);
    if (paren) {
      findings.push({
        code: 'parenthetical-in-company',
        severity: 'review',
        path: `experience[${index}].company`,
        value: company,
        parenthetical: paren[1],
        message: `The parenthetical "${paren[1]}" is kept verbatim as part of the employer `
          + 'name, so the record matches no search for the employer. Stripping it is easy; '
          + 'deciding where that detail goes instead (role, location, a bullet) is yours.',
      });
    }

    // ── 3. multiple-date-ranges ──────────────────────────────────────────
    const dates = typeof entry.dates === 'string' ? entry.dates : '';
    const ranges = countDateRanges(dates);
    if (ranges > 1) {
      findings.push({
        code: 'multiple-date-ranges',
        severity: 'review',
        path: `experience[${index}].dates`,
        value: dates,
        ranges,
        message: `${ranges} date ranges in one entry parse as one continuous stint. Splitting `
          + 'them into separate entries needs someone to decide which bullets belong to which '
          + 'stint — this script can see the second range, it cannot allocate the bullets.',
      });
    }
  });

  return findings;
}

// ── Orchestration ───────────────────────────────────────────────────────────

/**
 * The whole contract: one transform applied, three lints reported.
 *
 * @param {object} payload - Parsed CV payload. Never mutated.
 * @returns {{payload: object, transform: object, findings: Array<object>}}
 */
export function transformPayload(payload) {
  const { payload: folded, transform } = foldCompetencies(payload);
  return { payload: folded, transform, findings: lintPayload(folded) };
}

// ── Human summary ───────────────────────────────────────────────────────────

function formatSummary({ transform, findings }) {
  const lines = [];
  lines.push('');
  lines.push('ATS Payload Transform');
  lines.push('─'.repeat(60));
  if (transform.applied) {
    lines.push(`  ✅ Folded ${transform.moved} competenc${transform.moved === 1 ? 'y' : 'ies'} `
      + `into skills[] as "${transform.category}" (${transform.merged ? 'merged into existing category' : 'new category'}).`);
  } else {
    lines.push(`  ⏭️  No fold applied — ${transform.reason}.`);
  }
  lines.push('');
  if (findings.length === 0) {
    lines.push('  ✅ No lint findings.');
  } else {
    lines.push(`  ⚠️  ${findings.length} finding${findings.length === 1 ? '' : 's'} — reported, NOT applied:`);
    for (const f of findings) {
      lines.push('');
      lines.push(`  [${f.code}] ${f.path}`);
      lines.push(`     value: ${f.value}`);
      lines.push(`     ${f.message}`);
    }
  }
  lines.push('');
  lines.push('  The transformed payload is on stdout; these findings are yours to decide on.');
  lines.push('');
  return lines.join('\n');
}

// ── Self-test ───────────────────────────────────────────────────────────────

function runSelfTest() {
  let passed = 0;
  let failed = 0;
  const eq = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.log(`  ❌ ${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`); }
  };

  // ── The fold ──
  const base = {
    competencies: ['RAG Pipelines', 'LLMOps', 'Kubernetes & Docker'],
    skills: [{ category: 'Languages', items: 'Python, Go' }],
  };
  const once = transformPayload(base);
  eq('competencies are emptied', once.payload.competencies, []);
  eq('competencies become a comma-delimited skills category',
    once.payload.skills[0], { category: 'Core Competencies', items: 'RAG Pipelines, LLMOps, Kubernetes & Docker' });
  eq('the existing skills categories survive after it', once.payload.skills[1], base.skills[0]);
  eq('the input payload is not mutated', base.competencies.length, 3);

  // Idempotency — the edge #3251 asked to have pinned.
  const twice = transformPayload(once.payload);
  eq('a second run is a no-op on skills', twice.payload.skills, once.payload.skills);
  eq('a second run applies no fold', twice.transform.applied, false);
  eq('a second run leaves competencies empty', twice.payload.competencies, []);

  // Idempotency, harder case: competencies re-added after a fold must merge
  // into the existing category, not create a duplicate one.
  const reAdded = { ...once.payload, competencies: ['LLMOps', 'Evaluation Harnesses'] };
  const remerged = transformPayload(reAdded);
  eq('a re-added competency merges instead of duplicating the category',
    remerged.payload.skills.filter((s) => s.category === 'Core Competencies').length, 1);
  eq('the merge unions items and drops the duplicate',
    remerged.payload.skills[0].items, 'RAG Pipelines, LLMOps, Kubernetes & Docker, Evaluation Harnesses');
  eq('the merge is reported as a merge', remerged.transform.merged, true);

  // A localized payload keeps its own section title as the category label.
  const localized = transformPayload({
    sections: { competencies: 'Competencias Clave' },
    competencies: ['Arquitectura Cloud'],
  });
  eq('a localized section title becomes the category label',
    localized.payload.skills[0].category, 'Competencias Clave');

  // Absent/empty inputs.
  eq('an absent competencies key applies no fold', foldCompetencies({}).transform.applied, false);
  eq('an empty competencies array applies no fold', foldCompetencies({ competencies: [] }).transform.applied, false);
  eq('a payload with no skills key still gets the folded category',
    foldCompetencies({ competencies: ['A'] }).payload.skills.length, 1);

  // ── The lints ──
  const codes = (p) => lintPayload(p).map((f) => f.code);

  eq('a clean entry produces no findings', codes({
    experience: [{ company: 'Acme', role: 'Senior Engineer', dates: 'June 2022 - Present' }],
  }), []);

  eq('an employer preposition in the role is reported', codes({
    experience: [{ company: 'Consultancy', role: 'Lead Engineer at Globex', dates: '2020 - 2022' }],
  }), ['employer-in-role']);

  eq('a corporate suffix in the role is reported', codes({
    experience: [{ company: 'Consultancy', role: 'Platform Lead, Initech Inc.', dates: '2020 - 2022' }],
  }), ['employer-in-role']);

  eq("another entry's employer appearing in a role is reported", codes({
    experience: [
      { company: 'Globex', role: 'Staff Engineer', dates: '2018 - 2020' },
      { company: 'Consultancy', role: 'Globex Platform Lead', dates: '2020 - 2022' },
    ],
  }), ['employer-in-role']);

  eq('a company substring inside a longer word is not reported', codes({
    experience: [
      { company: 'Acme', role: 'Staff Engineer', dates: '2018 - 2020' },
      { company: 'Consultancy', role: 'Acmerican Studies Lead', dates: '2020 - 2022' },
    ],
  }), []);

  eq('a team named with "for" is not mistaken for an employer', codes({
    experience: [{ company: 'Acme', role: 'Engineer for Payments Platform', dates: '2020 - 2022' }],
  }), []);

  eq('a parenthetical in the company is reported', codes({
    experience: [{ company: 'Globex (Cloud Platform Division)', role: 'Engineer', dates: '2020 - 2022' }],
  }), ['parenthetical-in-company']);

  eq('a full-width parenthetical is reported too', codes({
    experience: [{ company: '日立製作所（クラウド事業部）', role: 'エンジニア', dates: '2020 - 2022' }],
  }), ['parenthetical-in-company']);

  eq('one date range is not reported', countDateRanges('June 2022 - Present'), 1);
  eq('a numeric single range is not reported', countDateRanges('06/2018 - 09/2020'), 1);
  eq('two comma-separated ranges are counted', countDateRanges('2016 - 2019, 2021 - Present'), 2);
  eq('two ranges joined by "and" are counted', countDateRanges('Jan 2016 to Dec 2018 and Mar 2021 until Present'), 2);
  eq('two date ranges in one entry are reported', codes({
    experience: [{ company: 'Acme', role: 'Engineer', dates: '2016 - 2019, 2021 - Present' }],
  }), ['multiple-date-ranges']);

  // The whole contract in one run: exactly one transform, three findings.
  const full = transformPayload({
    competencies: ['RAG Pipelines'],
    experience: [{
      company: 'Globex (Cloud Platform Division)',
      role: 'Lead Engineer at Initech',
      dates: '2016 - 2019, 2021 - Present',
    }],
  });
  eq('one transform applied', full.transform.applied, true);
  eq('three lints reported, none applied', full.findings.map((f) => f.code),
    ['employer-in-role', 'parenthetical-in-company', 'multiple-date-ranges']);
  eq('every finding is advisory', full.findings.every((f) => f.severity === 'review'), true);
  eq('the lints changed nothing in the payload',
    full.payload.experience[0], {
      company: 'Globex (Cloud Platform Division)',
      role: 'Lead Engineer at Initech',
      dates: '2016 - 2019, 2021 - Present',
    });

  console.log(`\nats-payload self-test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `Usage: node ats-payload.mjs <payload.json|-> [--summary] > payload-ats.json
       node ats-payload.mjs --self-test

Applies ONE safe transform and reports THREE lints on a build-cv-html.mjs payload.

  transform  fold competencies[] into skills[] as one comma-delimited category
             under a header ATS parsers recognise (idempotent, reversible)
  lints      employer-in-role · parenthetical-in-company · multiple-date-ranges
             — reported only, because each needs a decision only you can make

The transformed payload goes to STDOUT; findings go to STDERR (JSON by default,
a human summary with --summary). Read-only: nothing is written back to cv.md or
config/profile.yml. Exits 0 whenever the transform succeeded, findings or not.`;

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  // `-` is the stdin OPERAND, not a flag. validateFlags() rejects any token
  // starting with `-` that it does not know, so it has to be withheld here —
  // listing it as a known flag instead would print it in the "Valid flags:"
  // line of every typo message, which is where a reader looks for flags.
  validateFlags(args.filter((a) => a !== '-'), ['--summary', '--self-test', '--help', '-h'], USAGE);

  if (args.includes('--self-test')) {
    runSelfTest();
  } else {
    const summaryMode = args.includes('--summary');
    const positional = args.filter((a) => !a.startsWith('-') || a === '-');
    if (positional.length > 1) {
      console.error(`Error: unexpected extra positional argument: ${positional[1]}`);
      console.error(USAGE);
      process.exit(1);
    }

    const source = positional[0] ?? '-';
    let raw;
    try {
      raw = readFileSync(source === '-' ? 0 : source, 'utf-8');
    } catch (err) {
      console.error(`Error: cannot read payload: ${source} (${err.code || err.message})`);
      process.exit(1);
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      console.error(`Error: ${source === '-' ? 'stdin' : source} is not valid JSON (${err.message})`);
      process.exit(1);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      console.error(`Error: ${source === '-' ? 'stdin' : source} is not a CV payload object`);
      process.exit(1);
    }

    const result = transformPayload(payload);
    // stdout is the payload and ONLY the payload, so `> cv-ats.json` is safe and
    // the script composes into a pipe. Everything human goes to stderr.
    console.log(JSON.stringify(result.payload, null, 2));
    if (summaryMode) {
      console.error(formatSummary(result));
    } else {
      console.error(JSON.stringify({ transform: result.transform, findings: result.findings }, null, 2));
    }
  }
}
