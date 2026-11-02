// tests/web-prompt-profile-path.test.mjs — the prompts the web sends to an agent
// name the profile it must read (#5144). With CAREER_OPS_PROFILE set they carry
// the resolved path, never `config/profile.yml`; with it unset they are unchanged.
//
// Sites: run-prompts.mjs (pdf, evaluate, cover), apply/answer-prompt.mjs and
// assistant-preamble.mjs (the assistant route's system prompt).

import { pass, fail, ROOT } from './helpers.mjs';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

console.log('\nweb prompts — profile path under CAREER_OPS_PROFILE');

const lib = join(ROOT, 'web', 'src', 'lib');
if (!existsSync(join(ROOT, 'web'))) {
  pass('web prompt profile path skipped: no web/ in this checkout');
} else {
  const load = (rel) => import(pathToFileURL(join(lib, rel)).href);
  const { profileRef, profileNote, DEFAULT_PROFILE_REF } = await load('core/profile-path.mjs');
  const { buildPrompt } = await load('run-prompts.mjs');
  const { buildAnswerPrompt } = await load('apply/answer-prompt.mjs');
  const { buildSystemPreamble } = await load('assistant-preamble.mjs');

  const root = resolve('/fixture/data-root');
  const override = resolve('/fixture/elsewhere/me.yml');
  const DEFAULT = 'config/profile.yml';
  const note = profileNote(override);

  const eq = (label, got, want) => (got === want ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
  const check = (label, cond, detail = '') => (cond ? pass(label) : fail(`${label}${detail ? `: ${detail}` : ''}`));

  eq('profileRef without an override is config/profile.yml', profileRef(root, { env: {} }), DEFAULT);
  eq('profileRef treats a blank override as unset', profileRef(root, { env: { CAREER_OPS_PROFILE: ' \t' } }), DEFAULT);
  eq('profileRef with an override is the resolved path', profileRef(root, { env: { CAREER_OPS_PROFILE: override } }), override);
  eq('profileRef anchors a relative override to the root', profileRef(root, { env: { CAREER_OPS_PROFILE: 'p/me.yml' } }), join(root, 'p', 'me.yml'));
  eq('profileNote is empty for the default', profileNote(DEFAULT_PROFILE_REF), '');
  check('profileNote names the resolved path', note.includes(override));

  // The note is the only place the default name may remain, and only to say it is not the file.
  const withoutNote = (text) => text.split(note).join('');

  const ARGS = { input: '018', memory: '', today: '2026-10-20', reportFile: 'reports/018-acme-2026-10-01.md' };
  const COVER = { why: 'a', problem: 'b', approach: 'c', tone: 'warm' };
  const sites = [
    ['pdf prompt', (profile) => buildPrompt({ ...ARGS, kind: 'pdf', profile })],
    ['evaluate prompt', (profile) => buildPrompt({ ...ARGS, kind: 'evaluate', profile })],
    ['cover prompt', (profile) => buildPrompt({ ...ARGS, kind: 'cover', coverBrief: COVER, profile })],
    ['answer prompt (tailored CV)', (profile) => buildAnswerPrompt({ title: 'Acme', fields: [], cvSource: 'output/cv.html', profile })],
    ['answer prompt (no tailored CV)', (profile) => buildAnswerPrompt({ title: 'Acme', fields: [], profile })],
    ['assistant system prompt', (profile) => buildSystemPreamble(profile)],
  ];

  for (const [label, build] of sites) {
    const withOverride = build(override);
    check(`${label}: the override path appears`, withOverride.includes(override));
    check(`${label}: the agent is not told to read config/profile.yml`, !withoutNote(withOverride).includes(DEFAULT),
      withoutNote(withOverride).split('\n').find((l) => l.includes(DEFAULT))?.slice(0, 120));
    const plain = build(DEFAULT_PROFILE_REF);
    eq(`${label}: no override is the same as the default argument`, plain, build(undefined));
    check(`${label}: no override still names config/profile.yml`, label.startsWith('cover') ? true : plain.includes(DEFAULT));
    check(`${label}: no override adds no profile note`, !plain.includes('Profile location:'));
  }
  for (const [label, build] of sites.filter(([l]) => /^(pdf|evaluate|cover)/.test(l))) {
    check(`${label}: carries the profile note when overridden`, build(override).includes(note));
  }
}
