// tests/add-entry-dedup.test.mjs — articleDigestHasEntry must not false-positive on prefix of existing entry
import { pass, fail } from './helpers.mjs';
import { articleDigestHasEntry, applyAdd } from '../add-entry.mjs';

console.log('\nadd-entry.mjs — dedup key prefix false positive prevention');

// 1. articleDigestHasEntry: exact match vs prefix
const md = [
  '# Article Digest',
  '',
  '---',
  '',
  '## Airflow Pipeline — Data Engineering',
  '',
  '**Hero metrics:** 99.9% uptime',
  '',
  '## Reactive Architecture — Distributed Systems',
  '',
  '**Hero metrics:** 10x throughput',
  '',
].join('\n');

if (articleDigestHasEntry(md, 'Airflow Pipeline')) {
  pass('articleDigestHasEntry matches exact project name');
} else {
  fail('articleDigestHasEntry should match exact project name');
}

if (!articleDigestHasEntry(md, 'AI')) {
  pass('articleDigestHasEntry does not false-match "AI" against "Airflow Pipeline" prefix');
} else {
  fail('articleDigestHasEntry should not match "AI" when only "Airflow Pipeline" exists');
}

if (!articleDigestHasEntry(md, 'Airflow')) {
  pass('articleDigestHasEntry does not false-match "Airflow" against "Airflow Pipeline" prefix');
} else {
  fail('articleDigestHasEntry should not match "Airflow" when only "Airflow Pipeline" exists');
}

if (!articleDigestHasEntry(md, 'React')) {
  pass('articleDigestHasEntry does not false-match "React" against "Reactive Architecture" prefix');
} else {
  fail('articleDigestHasEntry should not match "React" when only "Reactive Architecture" exists');
}

// 2. applyAdd end-to-end: adding a project whose name is a prefix of an existing one succeeds
const sampleCv = [
  '# CV -- Test',
  '',
  '## Projects',
  '',
  '- **Airflow Pipeline** (OSS) -- data engineering',
  '',
].join('\n');

const res = applyAdd(
  {
    cv: { section: 'Projects', dedupKey: 'AI', entry: '- **AI** (OSS) -- AI agent framework' },
    articleDigest: { dedupKey: 'AI', entry: '## AI — Intelligent Agent\n\n**Hero metrics:** 5x speedup' },
  },
  { cvText: sampleCv, articleText: md },
);

if (res.result.articleDigest.status === 'added' && res.result.cv.status === 'added') {
  pass('applyAdd successfully adds distinct entry whose key is a prefix of an existing entry');
} else {
  fail(`applyAdd failed to add prefix-keyed entry: ${JSON.stringify(res.result)}`);
}
