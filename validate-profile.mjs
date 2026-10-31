#!/usr/bin/env node
/**
 * validate-profile.mjs — structural check for config/profile.yml.
 *
 * profile.yml steers scoring targets, output language, spend tier, CV format
 * and location policy, and nothing checked its shape. `doctor.mjs` checks that
 * the file EXISTS; every reader then does `profile?.language?.output` and takes
 * the fallback when the key is missing — which is indistinguishable from the
 * key being misspelled. A profile reading
 *
 *     langauge:
 *       output: ja
 *     spend_teir: premium
 *
 * parses cleanly, validates nowhere, and silently produces English output at
 * the default tier. The user's only signal is noticing the wrong language in
 * finished work.
 *
 * Unknown keys WARN, never FAIL. career-ops is meant to work out of the box
 * and an unknown key is not a broken install. It is almost always a typo,
 * and the right response is to name it, not to refuse to run. A known key
 * set to a value its reader ignores is an error: spend_tier, language.output,
 * and cv.output_format otherwise fall back with no signal.
 * `portals.yml` gets validate-portals.mjs and the plugin registry gets
 * validate-plugin-registry.mjs; this is the same family for the one file
 * that had none.
 *
 * The known-key set is DERIVED from config/profile.example.yml rather than
 * hardcoded, so a key added to the example is understood here on the same
 * commit. Keys the code reads but the example does not document are listed
 * explicitly below, each naming its reader — a hardcoded list can only ever
 * chase reality, and that list is short and auditable.
 *
 * Usage:
 *   node validate-profile.mjs [--profile <path>] [--json] [--self-test]
 *
 * Exit codes:
 *   0  clean, or warnings only (unknown keys)
 *   1  usage error
 *   2  the profile does not parse, or a known key is set to a value readers ignore
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import { hasYamlContent, loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));

export const EXAMPLE_PATH = join(CODE_ROOT, 'config', 'profile.example.yml');
export const DEFAULT_PROFILE_PATH = getProfilePath();

/**
 * Top-level keys the code reads that config/profile.example.yml does not show.
 *
 * Each is a real reader, so treating them as unknown would warn on a correct
 * profile. They are listed here rather than added to the example silently
 * because the example is the file a user learns the schema from — see the
 * `undocumented` finding below, which reports the gap instead of hiding it.
 */
export const UNDOCUMENTED_KEYS = {
  rejection_latency: 'rejection-latency.mjs (courtesy_days)',
  table_freshness: 'check-table-freshness.mjs (max_age_months)',
};

/**
 * Top-level keys from the shipped example — the documented schema.
 *
 * Optional sections ship commented out (`# style:`, `# page_format: letter`),
 * so parsing alone misses them, and a profile that set one was told the setting
 * had no effect while theme-style.mjs / lib/page-format.mjs were reading it.
 * Each one is written `# key:` at column 0 with a single space. A key nested in
 * such a block is indented past the `#`, and no prose line in the example opens
 * with a bare lowercase word and a colon, so neither is taken for a top-level
 * key: that would accept `margin:` at the top level, where nothing reads it.
 */
export function knownKeysFromExample(exampleText) {
  const text = String(exampleText ?? '');
  const doc = loadYaml(text) || {};
  if (typeof doc !== 'object' || Array.isArray(doc)) return [];
  const commented = [...text.matchAll(/^# ([a-z][a-z0-9_]*):(?=\s|$)/gm)].map((m) => m[1]);
  return [...new Set([...Object.keys(doc), ...commented])];
}

/**
 * Edit distance, capped — only used to turn "unknown key" into "did you mean".
 * A typo is the case this check exists for, so naming the intended key is most
 * of its value; without it the user is told `langauge` is unknown and still has
 * to spot the transposition themselves.
 */
export function nearestKey(key, candidates, maxDistance = 3) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = editDistance(key.toLowerCase(), c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= maxDistance ? best : null;
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * @param {string} profileText - Raw profile.yml.
 * @param {string} exampleText - Raw config/profile.example.yml.
 * @returns {{findings: object[], parsed: object|null}}
 */
const SPEND_TIERS = new Set(['economy', 'standard', 'premium']);
const CV_FORMATS = new Set(['html', 'latex', 'text']);

function shownValue(value) {
  return typeof value === 'string' ? JSON.stringify(value.trim()) : typeof value;
}

/**
 * Known keys whose readers silently substitute a default. Missing keys stay
 * valid. A present value that those readers will not use is an error.
 *
 * @param {object} parsed
 * @param {object[]} findings
 * @param {string} file
 */
function checkKnownValues(parsed, findings, file) {
  if ('spend_tier' in parsed) {
    const raw = parsed.spend_tier;
    const ok = typeof raw === 'string' && SPEND_TIERS.has(raw.trim().toLowerCase());
    if (!ok) {
      findings.push({
        level: 'error',
        code: 'bad-value',
        key: 'spend_tier',
        message: `${file}: spend_tier is ${shownValue(raw)}. Use economy, standard, or premium. Example: spend_tier: standard`,
      });
    }
  }

  if ('language' in parsed) {
    const language = parsed.language;
    const mapping = language != null && typeof language === 'object' && !Array.isArray(language);
    if (!mapping) {
      findings.push({
        level: 'error',
        code: 'bad-value',
        key: 'language',
        message: `${file}: language must be a mapping. Example: output: en`,
      });
    } else if ('output' in language) {
      const output = language.output;
      const ok = typeof output === 'string'
        && output.trim().length > 0
        && output.trim().length <= 64
        && !/[\r\n\0]/.test(output);
      if (!ok) {
        findings.push({
          level: 'error',
          code: 'bad-value',
          key: 'language.output',
          message: `${file}: language.output must be one line of at most 64 characters. Example: output: en`,
        });
      }
    }
  }

  if ('cv' in parsed) {
    const cv = parsed.cv;
    const mapping = cv != null && typeof cv === 'object' && !Array.isArray(cv);
    if (!mapping) {
      findings.push({
        level: 'error',
        code: 'bad-value',
        key: 'cv',
        message: `${file}: cv must be a mapping. Example: output_format: html`,
      });
    } else if ('output_format' in cv) {
      const format = cv.output_format;
      const ok = typeof format === 'string' && CV_FORMATS.has(format.trim().toLowerCase());
      if (!ok) {
        findings.push({
          level: 'error',
          code: 'bad-value',
          key: 'cv.output_format',
          message: `${file}: cv.output_format is ${shownValue(format)}. Use html, latex, or text. Example: output_format: html`,
        });
      }
    }
  }
}

// The CLI passes the real path. Library callers (doctor) get the resolved
// profile relative to the data root, so an overridden profile path is named
// as it is, not as the default. Forward slashes on every platform.
const DEFAULT_PROFILE_LABEL = relative(getCareerOpsRoot(), DEFAULT_PROFILE_PATH).split(sep).join('/') || DEFAULT_PROFILE_PATH;

export function validateProfile(profileText, exampleText, profileLabel = DEFAULT_PROFILE_LABEL) {
  const findings = [];
  if (!hasYamlContent(profileText)) return { parsed: null, findings };

  let parsed;
  try {
    parsed = loadYaml(String(profileText ?? ''));
  } catch (err) {
    return {
      parsed: null,
      findings: [{
        level: 'error',
        code: 'unparseable',
        message: `config/profile.yml is not valid YAML: ${String(err.message).split('\n')[0]}`,
      }],
    };
  }
  // An empty or comment-only profile is a legitimate starting state, not an
  // error — doctor's existence check is what covers "you have not set this up".
  if (parsed == null) return { parsed: null, findings };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      parsed: null,
      findings: [{ level: 'error', code: 'not-a-mapping', message: 'config/profile.yml does not contain a YAML mapping.' }],
    };
  }

  const documented = knownKeysFromExample(exampleText);
  const known = new Set([...documented, ...Object.keys(UNDOCUMENTED_KEYS)]);

  for (const key of Object.keys(parsed)) {
    if (known.has(key)) continue;
    const suggestion = nearestKey(key, [...known]);
    findings.push({
      level: 'warn',
      code: 'unknown-key',
      key,
      suggestion,
      message: suggestion
        ? `Unknown top-level key "${key}" — did you mean "${suggestion}"? It is being ignored, so whatever you set under it has no effect.`
        : `Unknown top-level key "${key}". It is being ignored, so whatever you set under it has no effect.`,
    });
  }

  // Reported, not silently tolerated: a key the code reads and the example does
  // not show is a schema a user cannot learn from the file they are pointed at.
  for (const [key, reader] of Object.entries(UNDOCUMENTED_KEYS)) {
    if (key in parsed && !documented.includes(key)) {
      findings.push({
        level: 'info',
        code: 'undocumented-key',
        key,
        message: `"${key}" is read by ${reader} but is not in config/profile.example.yml, so it is undiscoverable.`,
      });
    }
  }

  checkKnownValues(parsed, findings, profileLabel);

  return { parsed, findings };
}

// --- self-test ---------------------------------------------------------
function runSelfTest() {
  let pass = 0; let fail = 0;
  const check = (cond, label) => { if (cond) { pass++; } else { fail++; console.error(`  ✗ ${label}`); } };
  const EXAMPLE = 'candidate:\n  full_name: x\nlanguage:\n  output: en\nspend_tier: standard\ncv:\n  output_format: html\n';

  const typo = validateProfile('langauge:\n  output: ja\nspend_teir: premium\n', EXAMPLE);
  check(typo.findings.filter(f => f.code === 'unknown-key').length === 2, 'two typo keys are reported');
  check(typo.findings.some(f => f.key === 'langauge' && f.suggestion === 'language'), 'langauge suggests language');
  check(typo.findings.some(f => f.key === 'spend_teir' && f.suggestion === 'spend_tier'), 'spend_teir suggests spend_tier');

  const clean = validateProfile('candidate:\n  full_name: x\nlanguage:\n  output: ja\n', EXAMPLE);
  check(clean.findings.length === 0, 'a correct profile produces no findings');

  const extra = validateProfile('rejection_latency:\n  courtesy_days: 45\n', EXAMPLE);
  check(extra.findings.every(f => f.code !== 'unknown-key'), 'a code-read key is not reported as unknown');
  check(extra.findings.some(f => f.code === 'undocumented-key'), 'and its absence from the example is reported');

  check(validateProfile('', EXAMPLE).findings.length === 0, 'an empty profile is not an error');
  check(validateProfile('# just a comment\n', EXAMPLE).findings.length === 0, 'a comment-only profile is not an error');
  check(validateProfile('\tbroken: tab\n', EXAMPLE).findings[0]?.code === 'unparseable', 'malformed YAML is reported as unparseable');
  check(validateProfile('just a string\n', EXAMPLE).findings[0]?.code === 'not-a-mapping', 'a scalar profile is reported');

  // Derivation, not a hardcoded list: a key added to the example is accepted
  // here with no edit to this file.
  const widened = validateProfile('brand_new_section:\n  x: 1\n', `${EXAMPLE}brand_new_section:\n  x: 0\n`);
  check(widened.findings.length === 0, 'a key added to the example is understood without editing this file');

  // Optional sections ship commented out, and are still documented. A key
  // nested in one, or a prose comment, is not a top-level key.
  const COMMENTED = `${EXAMPLE}# Paper size: "letter" or "a4".\n# page_format: letter\n# style:\n#   accent_color: "#2563eb"\n`;
  check(validateProfile('page_format: a4\nstyle:\n  accent_color: "#000"\n', COMMENTED).findings.length === 0, 'a key the example ships commented out is known');
  check(knownKeysFromExample(COMMENTED).join() === 'candidate,language,spend_tier,cv,page_format,style', 'prose and nested commented keys are not top-level keys');
  check(validateProfile('styel:\n  x: 1\n', COMMENTED).findings[0]?.suggestion === 'style', 'a typo of a commented key gets its suggestion');

  console.log(`\n  validate-profile self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) runSelfTest();
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node validate-profile.mjs [--profile <path>] [--json] [--self-test]

Unknown keys are warnings and the command exits 0.
A known key set to a value readers ignore exits 2.

Examples:
  node validate-profile.mjs --json
  node validate-profile.mjs --profile config/profile.yml
  node validate-profile.mjs --self-test`);
    process.exit(0);
  }
  const pi = args.indexOf('--profile');
  const profilePath = pi !== -1 && args[pi + 1] ? args[pi + 1] : DEFAULT_PROFILE_PATH;
  if (!existsSync(profilePath)) {
    console.log(`No profile at ${profilePath} — nothing to validate.`);
    process.exit(0);
  }
  const example = existsSync(EXAMPLE_PATH) ? readFileSync(EXAMPLE_PATH, 'utf-8') : '';
  const { findings } = validateProfile(readFileSync(profilePath, 'utf-8'), example, profilePath);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ profile: profilePath, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log(`✓ ${profilePath}: no structural problems.`);
  } else {
    for (const f of findings) console.log(`  ${f.level === 'error' ? '✗' : '⚠'} ${f.message}`);
  }
  process.exit(findings.some((f) => f.level === 'error') ? 2 : 0);
}
