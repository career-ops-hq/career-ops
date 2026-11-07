// tests/cv-ingest-mode.test.mjs: modes/cv-ingest.md exists and matches the contract
// web/src/app/api/cv/ingest/route.ts and web/src/lib/cv/quality.ts depend on.
//
// The route reads modes/cv-ingest.md and, when the file is missing, silently falls
// back to an inline copy of the prompt. A missing file therefore changes nothing a
// user can see, which is why the CLI and the web could drift apart unnoticed.
// Run: node test-all.mjs --only cv-ingest-mode
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nmodes/cv-ingest.md matches the CV ingest contract');

const check = (label, ok) => (ok ? pass(label) : fail(label));
const read = (p) => readFileSync(join(ROOT, p), 'utf-8').replace(/\r\n/g, '\n');

check('modes/cv-ingest.md exists', existsSync(join(ROOT, 'modes', 'cv-ingest.md')));
const mode = read('modes/cv-ingest.md');
const route = read('web/src/app/api/cv/ingest/route.ts');

check('the web route reads modes/cv-ingest.md', /"modes",\s*"cv-ingest\.md"/.test(route));

// Every marker the web's stream parser looks for is documented in the mode.
for (const marker of ['<<cv:start>>', '<<cv:end>>', '<<cv:seed>>', '<<cv:error>>']) {
  check(`documents ${marker}`, mode.includes(marker));
}
check('documents the unreadable error reason', mode.includes('<<cv:error>>{"reason":"unreadable"}'));
check('seed example carries title, roles and location', /<<cv:seed>>\{"title":.*"roles":\[.*\],"location":/.test(mode));

// The proposer contract: the mode must say it never writes the file.
check('states that it never writes cv.md', /never writes `cv\.md`/i.test(mode));

// The markdown skeleton mirrors examples/cv-example.md, the format source of truth.
const example = read('examples/cv-example.md');
const skeleton = mode.match(/```markdown\n([\s\S]*?)\n```/)?.[1] ?? '';
const headings = (md) => md.split('\n').filter((l) => /^#{1,2} /.test(l)).map((l) => l.replace(/\s*\{.*$/, '').trim());
const exampleTitle = example.split('\n')[0].replace(/\s*--.*$/, '').trim();
const skeletonHeads = headings(skeleton);
check('skeleton has the five reference sections',
  ['## Professional Summary', '## Work Experience', '## Projects', '## Education', '## Skills']
    .every((h) => skeletonHeads.includes(h)));
check('every skeleton section heading exists in examples/cv-example.md',
  skeletonHeads.filter((h) => h.startsWith('## ')).every((h) => example.includes(`\n${h}\n`)));
check('skeleton title style matches the example', skeleton.startsWith(`${exampleTitle} -- `));
check('the machine-channel example uses the same title', mode.includes('<<cv:start>>\n# CV -- {Full Name}'));

// The mode itself follows the ATS rule it teaches.
check('contains no em dash', !mode.includes('—'));

// Shipping: catalogued and part of the system layer the updater manages.
check('modes/README.md catalog lists cv-ingest.md', /^\| `cv-ingest\.md` \|/m.test(read('modes/README.md')));
check('update manifest ships modes/cv-ingest.md', read('lib/update-manifest.mjs').includes("'modes/cv-ingest.md'"));
