// tests/providers/_profile-keywords.test.mjs
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from '../helpers.mjs';
import { pathToFileURL } from 'url';

console.log('\nProvider helper — _profile-keywords');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/_profile-keywords.mjs')).href);
  const { profileTargetKeywords, resolveProfileKeywords } = mod;

  const profile = {
    target_roles: {
      primary: ['Data Engineer', '  Frontend Developer  '],
      archetypes: [
        { name: 'Site Reliability Engineer' },
        { name: '' },
        { name: 'Data Engineer' }, // dup of primary[0]
      ],
    },
  };
  const keywords = profileTargetKeywords(profile);
  if (
    keywords.length === 3
    && keywords[0] === 'Data Engineer'
    && keywords[1] === 'Frontend Developer'
    && keywords[2] === 'Site Reliability Engineer'
  ) {
    pass('profileTargetKeywords extracts primary roles and archetype names, trims, and dedups');
  } else {
    fail(`profileTargetKeywords = ${JSON.stringify(keywords)}`);
  }

  if (profileTargetKeywords({}).length === 0 && profileTargetKeywords(null).length === 0) {
    pass('profileTargetKeywords returns [] when target_roles is absent/missing');
  } else {
    fail('profileTargetKeywords should return [] for a profile with no target_roles');
  }

  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-profile-keywords-'));
  const profilePath = join(tmp, 'profile.yml');
  writeFileSync(profilePath, [
    'target_roles:',
    '  primary:',
    '    - Data Engineer',
    '  archetypes:',
    '    - name: Site Reliability Engineer',
    '',
  ].join('\n'));

  const fromFile = resolveProfileKeywords(profilePath);
  if (fromFile.length === 2 && fromFile[0] === 'Data Engineer' && fromFile[1] === 'Site Reliability Engineer') {
    pass('resolveProfileKeywords reads target_roles from a real profile.yml on disk');
  } else {
    fail(`resolveProfileKeywords(file) = ${JSON.stringify(fromFile)}`);
  }

  if (resolveProfileKeywords(join(tmp, 'missing-profile.yml')).length === 0) {
    pass('resolveProfileKeywords returns [] (fails open) when the file is missing');
  } else {
    fail('resolveProfileKeywords should return [] for a missing file');
  }

  const badPath = join(tmp, 'bad-profile.yml');
  writeFileSync(badPath, '::: not valid yaml :::\n  - [unterminated');
  if (resolveProfileKeywords(badPath).length === 0) {
    pass('resolveProfileKeywords returns [] (fails open) on unparseable YAML');
  } else {
    fail('resolveProfileKeywords should return [] for unparseable YAML');
  }
} catch (e) {
  fail(`_profile-keywords tests crashed: ${e.message}`);
}
