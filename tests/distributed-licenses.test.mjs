// tests/distributed-licenses.test.mjs — artifacts we redistribute must carry
// the license text their licenses require (#4886).
//
// Two shapes of the same omission:
//   - fonts/ ships OFL 1.1 font binaries (embedded in every rendered CV via
//     templates/resume-template.html). OFL 1.1 requires the license to
//     accompany redistribution, so every family in fonts/ needs an OFL file.
//   - scaffolder/ is published to npm as @santifer/career-ops with
//     "license": "MIT". MIT requires the notice to ship with the copy; npm
//     packs a LICENSE file automatically regardless of `files`, so the file
//     only has to exist — and must not drift from the root LICENSE.

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ROOT, pass, fail } from './helpers.mjs';

console.log('\nDistributed license files (#4886)');

const FONTS = join(ROOT, 'fonts');
const families = new Set(
  readdirSync(FONTS)
    .filter(f => f.endsWith('.woff2'))
    .map(f => f.replace(/-latin(-ext)?\.woff2$/, '')),
);
for (const family of families) {
  const license = join(FONTS, `${family}-OFL.txt`);
  if (existsSync(license) && /SIL Open Font License, Version 1\.1/.test(readFileSync(license, 'utf8'))) {
    pass(`fonts/${family}-OFL.txt accompanies the ${family} font files`);
  } else {
    fail(`fonts/ ships ${family} without fonts/${family}-OFL.txt (OFL 1.1 requires the license with redistribution)`);
  }
}
if (existsSync(join(FONTS, 'README.md'))) pass('fonts/README.md names the upstream font sources');
else fail('fonts/README.md is missing — it should name the upstream source of each font family');

const rootLicense = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
const scaffolderLicense = join(ROOT, 'scaffolder', 'LICENSE');
if (!existsSync(scaffolderLicense)) {
  fail('scaffolder/LICENSE is missing — the npm package declares MIT but ships no license text');
} else if (readFileSync(scaffolderLicense, 'utf8') !== rootLicense) {
  fail('scaffolder/LICENSE has drifted from the root LICENSE — copy it again');
} else {
  pass('scaffolder/LICENSE matches the root LICENSE');
}
