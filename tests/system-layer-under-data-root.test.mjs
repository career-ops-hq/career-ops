// tests/system-layer-under-data-root.test.mjs — System Layer files must resolve
// from the codebase, never from the configurable data root (#3500).
//
// DATA_CONTRACT.md: "System Layer files continue to be resolved relative to the
// codebase/repository root, keeping code and personal data completely separate."
//
// normalize-statuses.mjs broke that for templates/states.yml: one variable served
// both roles, so `join(getCareerOpsRoot(), 'templates', 'states.yml')` looked for a
// System Layer file inside the user's data directory. A data root that legitimately
// has no templates/ is indistinguishable from the broken checkout the surrounding
// `catch` was written for, so every status silently normalized to unknown — the
// documented tracker repair path rewriting 156 localized spellings to nothing.
// followup-cadence.mjs carried the identical join.
//
// The suite never caught it because it runs with the default root, where data root
// and codebase root are the same directory. These checks therefore run the modules
// with a data root configured, and additionally scan for the pattern itself so a
// new consumer of states.yml cannot reintroduce the leak.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nSystem Layer resolution under a configured data root (#3500)');

const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-dataroot-'));
mkdirSync(join(dataRoot, 'data'), { recursive: true });

/** Run a snippet in the repo with a data root configured; return trimmed stdout. */
function runWithDataRoot(snippet, envVar = 'CAREER_OPS_ROOT') {
  return execFileSync(NODE, ['-e', snippet], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '', [envVar]: dataRoot },
  }).trim();
}

try {
  // 1. normalize-statuses still canonicalizes with a data root set — English,
  //    Spanish, and a localized alias, i.e. exactly the table in the bug report.
  for (const envVar of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR']) {
    const out = runWithDataRoot(
      `import('./normalize-statuses.mjs').then(m => console.log(` +
      `['Accepted','Contratado','Evaluada','Rechazado'].map(v => v + '=' + (m.normalizeStatus(v).status ?? 'unknown')).join(' ')))`,
      envVar,
    );
    const expected = 'Accepted=Hired Contratado=Hired Evaluada=Evaluated Rechazado=Rejected';
    out === expected
      ? pass(`normalize-statuses canonicalizes under ${envVar} (${expected})`)
      : fail(`normalize-statuses under ${envVar} produced "${out}", expected "${expected}"`);
  }

  // 2. followup-cadence reads the same System Layer file for its alias map; a
  //    localized status resolving to '' there drops the row out of the funnel.
  const cadence = runWithDataRoot(
    `import('./followup-cadence.mjs').then(m => console.log(` +
    `['Contratado','Aplicado','Entrevista'].map(v => v + '=' + (m.normalizeStatus(v) || 'unknown')).join(' ')))`,
  );
  const cadenceExpected = 'Contratado=hired Aplicado=applied Entrevista=interview';
  cadence === cadenceExpected
    ? pass(`followup-cadence resolves states.yml aliases under a data root (${cadenceExpected})`)
    : fail(`followup-cadence under a data root produced "${cadence}", expected "${cadenceExpected}"`);

  // 3. Source-level guard against the class: a variable bound to getCareerOpsRoot()
  //    must not be joined onto a System Layer directory. modes/_profile.md,
  //    _custom.md and _brief.md are the documented exceptions — those specific
  //    files ARE user data that happens to live under modes/.
  const USER_FILES_IN_MODES = /^_(profile|custom|brief)\.md$/;
  const offenders = [];
  for (const file of readdirSync(ROOT).filter(f => f.endsWith('.mjs'))) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    const dataVars = [...src.matchAll(/const\s+(\w+)\s*=\s*getCareerOpsRoot\(\)/g)].map(m => m[1]);
    if (!dataVars.length) continue;
    for (const v of dataVars) {
      const re = new RegExp(`join\\(\\s*${v}\\s*,\\s*['"\`](templates|modes)\\b([^)]*)\\)`, 'g');
      for (const m of src.matchAll(re)) {
        // Everything after the dir name, whether written as one 'modes/_profile.md'
        // argument or as separate 'modes', '_profile.md' arguments.
        const rest = m[2].replace(/['"\`,\s]+/g, '').replace(/^\/+/, '');
        if (m[1] === 'modes' && USER_FILES_IN_MODES.test(rest)) continue;
        offenders.push(`${file}: join(${v}, '${m[1]}${m[2]})`);
      }
    }
  }
  offenders.length === 0
    ? pass('no root-level script joins a System Layer dir onto the data root')
    : fail(`System Layer path(s) resolved through the data root (#3500): ${offenders.join('; ')}`);

  // 4. A genuinely unreadable states.yml must be loud, not a silent empty list —
  //    the property that made the original path bug invisible.
  const src = readFileSync(join(ROOT, 'normalize-statuses.mjs'), 'utf-8');
  /console\.error\(/.test(src.slice(src.indexOf('function canonicalStates'), src.indexOf('function normalizeStatus')))
    ? pass('normalize-statuses reports an unreadable states.yml on stderr instead of degrading silently')
    : fail('normalize-statuses swallows a states.yml load failure with no diagnostic (#3500)');
} finally {
  rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
