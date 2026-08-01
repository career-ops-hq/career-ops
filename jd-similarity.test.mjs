import { hardMismatch, jaccardSimilarity, recommendCvReuse, tokenize } from './jd-similarity.mjs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

ok('tokenization is case-insensitive', tokenize('React react TypeScript').size === 2);
ok('tokenization keeps technical punctuation', tokenize('Node.js C++ C# F#').has('node.js'));
ok('tokenization preserves plus/hash language suffixes', ['c++', 'c#', 'f#'].every(token => tokenize(`Build with ${token}`).has(token)));
ok('identical text scores 1', jaccardSimilarity('Vue React Node', 'Vue React Node') === 1);
ok('unrelated text scores 0', jaccardSimilarity('Flutter mobile', '法律 财务') === 0);
ok('high similarity recommends reuse', recommendCvReuse('Vue React TypeScript Node.js', 'React TypeScript Node.js Vue').decision === 'reuse');
ok('medium similarity recommends edits', recommendCvReuse('Vue React TypeScript Node.js', 'React TypeScript Python Node.js').decision === 'reuse-with-edits');
ok('low similarity recommends regeneration', recommendCvReuse('Flutter Android iOS', '法律 财务 审计').decision === 'regenerate');
ok('level mismatch blocks reuse', hardMismatch('高级 React 工程师', '实习生 React 开发') === true);
const mismatchedRecommendation = recommendCvReuse('Senior React TypeScript Node.js platform engineer', 'Junior React TypeScript Node.js platform engineer');
ok('level mismatch overrides a high-similarity reuse recommendation', mismatchedRecommendation.decision === 'regenerate');
ok('level mismatch reports its exact reason', mismatchedRecommendation.reason === 'level-mismatch');
ok('level match does not block reuse', hardMismatch('远程 React 实习生', 'Flutter 实习生') === false);
ok('seniority matching uses whole words', hardMismatch('International React Engineer', 'Intermediate React Engineer') === false);
ok('leadership does not imply lead seniority', hardMismatch('Leadership platform role', 'Senior platform role') === false);

try {
  execFileSync(process.execPath, [fileURLToPath(new URL('./jd-similarity.mjs', import.meta.url)), '/tmp/does-not-exist-jd.txt', '/tmp/does-not-exist-cv.txt'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  ok('CLI reports missing files cleanly', false);
} catch (error) {
  ok('CLI reports missing files cleanly', /Unable to read input files/.test(error.stderr));
}

console.log(`jd-similarity: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
