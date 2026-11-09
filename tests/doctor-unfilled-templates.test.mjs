// tests/doctor-unfilled-templates.test.mjs — doctor must notice when a
// personalization file EXISTS but still carries template content.
//
// Why this matters: doctor auto-copies `modes/_profile.md` and `modes/_brief.md`
// during explicit onboarding, so existence alone cannot detect unedited content.
// Left unedited, `_profile.md` feeds the template author's archetypes into
// every A-F evaluation — the system looks healthy and scores against a stranger.
//
// Each scenario uses a fresh --target dir so nothing leaks across cases.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { sectionState, SECTIONS } from '../lib/personalization.mjs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\ndoctor.mjs — unfilled personalization templates');

const DOCTOR = join(ROOT, 'doctor.mjs');
const dirs = [];

function runDoctor(cwd, args = []) {
  try {
    const out = execFileSync(NODE, [DOCTOR, '--json', '--target', cwd, ...args], {
      cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(out);
  } catch (e) {
    return { _error: e.message };
  }
}

// Builds a target dir carrying the REAL templates, so the test tracks whatever
// placeholder vocabulary the shipped templates actually use.
function fixture(label, { seedPrereqs = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `co-unfilled-${label}-`));
  dirs.push(dir);
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  for (const f of ['_profile.template.md', '_brief.template.md', '_custom.template.md']) {
    writeFileSync(join(dir, 'modes', f), readFileSync(join(ROOT, 'modes', f), 'utf-8'));
  }
  // The prerequisites doctor gates onboarding on. Only the non-blocking case
  // needs them, and it needs them for a specific reason: without cv.md,
  // config/profile.yml and portals.yml, `onboardingNeeded` is true because
  // those are MISSING, and a test that then finds warnings has proved nothing
  // about whether an unpersonalized file gates anything. Caught by CodeRabbit
  // on this PR — reproduced before fixing: the fixture reported
  // `onboardingNeeded: true, missing: ["cv.md","config/profile.yml","portals.yml"]`.
  if (seedPrereqs) {
    writeFileSync(join(dir, 'cv.md'), '# Jane Smith\n\n## Experience\n\n### Engineer — Acme\n');
    writeFileSync(join(dir, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jane Smith"\n');
    writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - "Engineer"\n');
  }
  return dir;
}

const flagged = (state, path) => (state.unpersonalized || []).some((u) => u.path === path);

try {
  // 1. The real cold-start shape: doctor auto-copies the templates, so both
  //    files exist and are byte-identical. Existence says healthy; content
  //    must not.
  {
    const dir = fixture('identical');
    const s = runDoctor(dir, ['--init-templates']);
    if (s._error) fail(`auto-copied templates: doctor crashed: ${s._error}`);
    else if (flagged(s, 'modes/_profile.md') && flagged(s, 'modes/_brief.md')) {
      pass('auto-copied templates are reported as unpersonalized');
    } else {
      fail(`auto-copied templates not flagged: ${JSON.stringify(s.unpersonalized)}`);
    }
  }

  // 2. Non-blocking: an unedited personalization file is a warning, never a
  //    gate. career-ops is documented as working out of the box.
  //
  //    Every prerequisite is present here, so `onboardingNeeded` has exactly
  //    one thing left it could be reacting to. That is the whole assertion:
  //    without the seed it is true because cv.md and friends are absent, and
  //    "warnings exist AND onboarding is needed" is equally consistent with the
  //    gate this PR must not introduce.
  {
    const dir = fixture('nonblocking', { seedPrereqs: true });
    const s = runDoctor(dir, ['--init-templates']);
    if (s._error) fail(`non-blocking: doctor crashed: ${s._error}`);
    else if ((s.missing || []).length > 0) {
      fail(`non-blocking: fixture is not complete, so the gate is untestable: missing ${JSON.stringify(s.missing)}`);
    } else if (
      s.onboardingNeeded === false &&
      (s.unpersonalized || []).length > 0 &&
      s.warnings.some((w) => w.includes('_profile.md'))
    ) {
      pass('an unpersonalized file warns and reports onboardingNeeded false — a signal, not a gate');
    } else {
      fail(`unpersonalized gated onboarding or never warned: onboardingNeeded=${s.onboardingNeeded}, ` +
        `unpersonalized=${JSON.stringify((s.unpersonalized || []).map((u) => u.path))}`);
    }
  }

  // 3. Edited but still carrying the template's own placeholders — the halfway
  //    state where someone filled the top and stopped.
  {
    const dir = fixture('placeholders');
    writeFileSync(join(dir, 'modes', '_brief.md'),
      '# Jane Smith — Triage Brief\n\n## Identity\nSenior Backend Engineer.\n\n' +
      '| 1 | **{Archetype name}** | {the capability/experience that makes you a fit} |\n');
    const s = runDoctor(dir);
    const hit = (s.unpersonalized || []).find((u) => u.path === 'modes/_brief.md');
    if (s._error) fail(`placeholders: doctor crashed: ${s._error}`);
    else if (hit && /placeholder/.test(hit.reason)) pass(`leftover placeholders detected (${hit.reason})`);
    else fail(`leftover placeholders not detected: ${JSON.stringify(s.unpersonalized)}`);
  }

  // 4. No false positives. Real personalized content that happens to contain
  // 4. No false positives. Real personalized content that happens to contain
  //    braces (a JSON snippet in someone's house rules) must stay clean — the
  //    check compares against the TEMPLATE's placeholder set, not any `{...}`.
  {
    const dir = fixture('clean');
    writeFileSync(join(dir, 'modes', '_profile.md'),
      '# Profile\n\n' +
      'Config sample: `{"retries": 3}` and a shell brace `${HOME}`.\n\n' +
      '## Target Roles\nAI Engineer.\n');
    writeFileSync(join(dir, 'modes', '_brief.md'),
      '# Jane Smith — Triage Brief\n\n## Identity\nSenior Backend Engineer, US remote.\n');
    const s = runDoctor(dir);
    if (s._error) fail(`clean: doctor crashed: ${s._error}`);
    else if ((s.unpersonalized || []).length === 0) pass('personalized files with literal braces are not flagged');
    else fail(`false positive on personalized content: ${JSON.stringify(s.unpersonalized)}`);
  }

  // 5. `modes/_custom.md` is deliberately exempt: it holds optional procedural
  //    house rules, so shipping it unedited is a valid end state, not a defect.
  {
    const dir = fixture('custom-exempt');
    writeFileSync(join(dir, 'modes', '_profile.md'), '# Profile\nBackend Engineer.\n');
    writeFileSync(join(dir, 'modes', '_brief.md'), '# Brief\nBackend Engineer.\n');
    const s = runDoctor(dir);
    if (s._error) fail(`custom-exempt: doctor crashed: ${s._error}`);
    else if (!flagged(s, 'modes/_custom.md')) pass('modes/_custom.md left as template is not flagged');
    else fail('modes/_custom.md was flagged, but unedited house rules are a valid end state');
  }

  // 6. Half-filled _profile.md — e.g. compTargets customized, but other sections
  //    still on template. Doctor must flag it as unpersonalized and list unfilled ids.
  {
    const dir = fixture('half-filled');
    const tpl = readFileSync(join(ROOT, 'modes', '_profile.template.md'), 'utf-8');
    const fromComp = tpl.indexOf('## Your Comp Targets');
    const toNext = tpl.indexOf('## Your Negotiation Scripts');
    const halfFilled = tpl.slice(0, fromComp) +
      '## Your Comp Targets\n\nTargeting $160k-$190k base salary for US remote Staff/Lead roles.\n\n' +
      tpl.slice(toNext);
    writeFileSync(join(dir, 'modes', '_profile.md'), halfFilled);
    writeFileSync(join(dir, 'modes', '_brief.md'),
      '# Jane Smith — Triage Brief\n\n## Identity\nSenior Backend Engineer, US remote.\n');
    const s = runDoctor(dir);
    const hit = (s.unpersonalized || []).find((u) => u.path === 'modes/_profile.md');
    if (s._error) fail(`half-filled: doctor crashed: ${s._error}`);
    else if (hit && /still has 7 unfilled sections: 7 on template, 0 missing/.test(hit.reason) && hit.reason.includes('targetRoles') && !hit.reason.includes('compTargets')) {
      const coreUnfilled = sectionState(halfFilled, tpl).filter((x) => x.state !== 'filled').map((x) => x.id);
      const doctorReportedIds = hit.reason.match(/\(([^)]+)\)/)?.[1].split(', ') ?? [];
      if (JSON.stringify(coreUnfilled) === JSON.stringify(doctorReportedIds)) {
        pass(`half-filled _profile.md flagged with unfilled sections matching core sectionState (${hit.reason})`);
      } else {
        fail(`doctor reported ids do not match core sectionState: ${JSON.stringify({ coreUnfilled, doctorReportedIds })}`);
      }
    } else {
      fail(`half-filled _profile.md not correctly flagged: ${JSON.stringify(hit)}`);
    }
  }

  // 7. A custom-structured profile without template headings stays quiet (#5126).
  {
    const dir = fixture('custom-structure');
    writeFileSync(join(dir, 'modes', '_profile.md'),
      '# Custom Profile\n\n## About Me\nExperienced engineer.\n\n## Focus\nDistributed systems.\n');
    writeFileSync(join(dir, 'modes', '_brief.md'),
      '# Jane Smith — Triage Brief\n\n## Identity\nSenior Backend Engineer, US remote.\n');
    const s = runDoctor(dir);
    if (s._error) fail(`custom-structure: doctor crashed: ${s._error}`);
    else if ((s.unpersonalized || []).length === 0) {
      pass('custom-structured profile without template headings is not flagged');
    } else {
      fail(`custom-structured profile flagged: ${JSON.stringify(s.unpersonalized)}`);
    }
  }

  // 8. Section with empty body under heading is flagged as unfilled/missing (#5126).
  {
    const dir = fixture('empty-section');
    const tpl = readFileSync(join(ROOT, 'modes', '_profile.template.md'), 'utf-8');
    const fromComp = tpl.indexOf('## Your Comp Targets');
    const toNext = tpl.indexOf('## Your Negotiation Scripts');
    const userProfile = tpl.slice(0, fromComp) +
      '## Your Comp Targets\n\n' +
      tpl.slice(toNext);
    writeFileSync(join(dir, 'modes', '_profile.md'), userProfile);
    writeFileSync(join(dir, 'modes', '_brief.md'),
      '# Jane Smith — Triage Brief\n\n## Identity\nSenior Backend Engineer, US remote.\n');
    const s = runDoctor(dir);
    const hit = (s.unpersonalized || []).find((u) => u.path === 'modes/_profile.md');
    if (s._error) fail(`empty-section: doctor crashed: ${s._error}`);
    else if (hit && hit.reason.includes('compTargets') && /1 missing/.test(hit.reason)) {
      pass(`section with empty body is diagnosed as missing/unfilled (${hit.reason})`);
    } else {
      fail(`empty-section not diagnosed as missing: ${JSON.stringify(hit)}`);
    }
  }

  // 9. All 8 template headings present with empty bodies are diagnosed as unfilled (#5126).
  {
    const dir = fixture('all-empty');
    const allEmpty = SECTIONS.map((s) => `${s.heading}\n\n`).join('');
    writeFileSync(join(dir, 'modes', '_profile.md'), allEmpty);
    writeFileSync(join(dir, 'modes', '_brief.md'),
      '# Jane Smith — Triage Brief\n\n## Identity\nSenior Backend Engineer, US remote.\n');
    const s = runDoctor(dir);
    const hit = (s.unpersonalized || []).find((u) => u.path === 'modes/_profile.md');
    if (s._error) fail(`all-empty: doctor crashed: ${s._error}`);
    else if (hit && /8 unfilled sections: 0 on template, 8 missing/.test(hit.reason)) {
      pass('profile with all 8 headings but empty bodies is flagged as 8 missing');
    } else {
      fail(`profile with all empty bodies not flagged: ${JSON.stringify(hit)}`);
    }
  }

  // 10. An empty or whitespace-only file is unpersonalized, not "customized" (#5340).
  for (const [label, file, body] of [
    ['empty-profile', '_profile.md', ''],
    ['blank-profile', '_profile.md', '\n  \n'],
    ['empty-brief', '_brief.md', ''],
  ]) {
    const dir = fixture(label);
    const other = file === '_profile.md' ? '_brief.md' : '_profile.md';
    writeFileSync(join(dir, 'modes', file), body);
    writeFileSync(join(dir, 'modes', other),
      other === '_brief.md'
        ? '# Jane Smith — Triage Brief\n\n## Identity\nSenior Backend Engineer, US remote.\n'
        : SECTIONS.map((x) => `${x.heading}\nFilled in by Jane.\n\n`).join(''));
    const s = runDoctor(dir);
    const hit = (s.unpersonalized || []).find((u) => u.path === `modes/${file}`);
    if (s._error) fail(`${label}: doctor crashed: ${s._error}`);
    else if (hit && hit.reason === 'is empty' && !flagged(s, `modes/${other}`)) {
      pass(`${label}: empty ${file} is flagged as empty, the filled one is not`);
    } else {
      fail(`${label}: not flagged as empty: ${JSON.stringify(s.unpersonalized)}`);
    }
  }

  // 11. Doctor compares against the checkout's template, not a stale data-root copy (#5340).
  //     The data root holds an OLD template; the profile matches the checkout's real
  //     one section for section, so every section is still template text. Against the
  //     stale copy it would read as customized.
  {
    const dir = fixture('stale-template');
    const real = readFileSync(join(ROOT, 'modes', '_profile.template.md'), 'utf-8');
    writeFileSync(join(dir, 'modes', '_profile.template.md'), '# Old template\n\n## Your Target Roles\nsomething else\n');
    writeFileSync(join(dir, 'modes', '_profile.md'), real);
    writeFileSync(join(dir, 'modes', '_brief.md'),
      '# Jane Smith — Triage Brief\n\n## Identity\nSenior Backend Engineer, US remote.\n');
    const s = runDoctor(dir);
    const hit = (s.unpersonalized || []).find((u) => u.path === 'modes/_profile.md');
    if (s._error) fail(`stale-template: doctor crashed: ${s._error}`);
    else if (hit && /on template/.test(hit.reason) && !/0 on template/.test(hit.reason)) {
      pass('profile equal to the checkout template is flagged even when the data root holds a stale template');
    } else {
      fail(`stale data-root template masked the checkout template: ${JSON.stringify(hit)}`);
    }
  }
} finally {
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* temp dir */ } }
}
