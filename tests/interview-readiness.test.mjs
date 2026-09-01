// tests/interview-readiness.test.mjs — coverage for interview-readiness.mjs.
//
// Style mirrors tests/cli-flag-validation.test.mjs (node:test + spawnSync
// CLI smoke tests) plus direct unit tests against the exported functions,
// using mkdtemp fixtures for filesystem isolation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  parseQuestionBank,
  loadTaxonomy,
  scoreTopics,
  W_WEAKNESS,
  W_STALENESS,
  W_DEMAND,
  W_CONFIDENCE,
  STALENESS_HORIZON_DAYS,
  DEMAND_BASELINE,
} from '../interview-readiness.mjs';
import { extractGapsByCompany } from '../weekly-digest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const SCRIPT = join(REPO_ROOT, 'interview-readiness.mjs');
const TAXONOMY_FIXTURE = join(REPO_ROOT, 'templates', 'interview-topics.yml');

function runCli(args, opts = {}) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', ...opts });
}

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'interview-readiness-test-'));
}

// ── Weight constants ────────────────────────────────────────────────

test('weight constants sum to 1', () => {
  assert.ok(Math.abs(W_WEAKNESS + W_STALENESS + W_DEMAND + W_CONFIDENCE - 1) < 1e-9);
});

test('exported constants match the documented formula values', () => {
  assert.equal(W_WEAKNESS, 0.40);
  assert.equal(W_STALENESS, 0.25);
  assert.equal(W_DEMAND, 0.20);
  assert.equal(W_CONFIDENCE, 0.15);
  assert.equal(STALENESS_HORIZON_DAYS, 60);
  assert.equal(DEMAND_BASELINE, 0.4);
});

// ── parseQuestionBank ────────────────────────────────────────────────

test('parseQuestionBank: legacy bare question line parses with company + status', () => {
  const md = [
    '## Acme Corp',
    '',
    '- **Q:** How would you shard a write-heavy Postgres table? Status: 🔴 Gap',
  ].join('\n');
  const entries = parseQuestionBank(md);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].company, 'Acme Corp');
  assert.equal(entries[0].status, 'gap');
  assert.equal(entries[0].topic, null);
});

test('parseQuestionBank: structured entry parses all metadata sub-bullets', () => {
  const md = [
    '## Acme Corp',
    '',
    '- **Q:** How would you shard a write-heavy Postgres table? — Status: 🔴 Gap',
    '  - topic: databases/indexing-partitioning',
    '  - round: technical',
    '  - asked: 2026-08-20',
    '  - practiced: 2026-08-25',
    '  - attempts: 3',
    '  - confidence: 2',
    '  - gap: no precise vocabulary for partition pruning',
    '  - source: debrief',
  ].join('\n');
  const [entry] = parseQuestionBank(md);
  assert.equal(entry.topic, 'databases/indexing-partitioning');
  assert.equal(entry.domain, 'databases');
  assert.equal(entry.round, 'technical');
  assert.equal(entry.asked, '2026-08-20');
  assert.equal(entry.practiced, '2026-08-25');
  assert.equal(entry.attempts, 3);
  assert.equal(entry.confidence, 2);
  assert.equal(entry.gap, 'no precise vocabulary for partition pruning');
  assert.equal(entry.source, 'debrief');
});

test('parseQuestionBank: malformed date sub-bullet is left null, not thrown', () => {
  const md = [
    '## Acme Corp',
    '- **Q:** X? Status: 🟡 Solid',
    '  - asked: not-a-date',
  ].join('\n');
  const [entry] = parseQuestionBank(md);
  assert.equal(entry.asked, null);
});

test('parseQuestionBank: attempts and confidence reject invalid integers and ranges', () => {
  const md = [
    '## Acme Corp',
    '- **Q:** X? Status: 🟡 Solid',
    '  - attempts: many',
    '  - confidence: high',
    '- **Q:** Y? Status: 🟡 Solid',
    '  - attempts: -1',
    '  - confidence: 6',
    '- **Q:** Z? Status: 🟡 Solid',
    '  - attempts: 3abc',
    '  - confidence: 2.5',
  ].join('\n');
  const entries = parseQuestionBank(md);
  assert.deepEqual(entries.map((entry) => entry.attempts), [null, null, null]);
  assert.deepEqual(entries.map((entry) => entry.confidence), [null, null, null]);
});

test('parseQuestionBank: empty attempts and confidence stay null instead of coercing to zero', () => {
  const md = [
    '## Acme Corp',
    '- **Q:** X? Status: 🟡 Solid',
    '  - attempts:',
    '  - confidence:   ',
  ].join('\n');
  const [entry] = parseQuestionBank(md);
  assert.equal(entry.attempts, null);
  assert.equal(entry.confidence, null);
});

test('parseQuestionBank: status emoji variants map correctly (🔴/🟡/✅/none)', () => {
  const md = [
    '## Co',
    '- **Q:** a? Status: 🔴 Gap',
    '- **Q:** b? Status: 🟡 Solid',
    '- **Q:** c? Status: ✅ Strong',
    '- **Q:** d? (no status marker)',
  ].join('\n');
  const entries = parseQuestionBank(md);
  assert.deepEqual(entries.map((e) => e.status), ['gap', 'solid', 'strong', 'unknown']);
});

test('parseQuestionBank: non-string / empty input returns []', () => {
  assert.deepEqual(parseQuestionBank(null), []);
  assert.deepEqual(parseQuestionBank(undefined), []);
  assert.deepEqual(parseQuestionBank(42), []);
  assert.deepEqual(parseQuestionBank(''), []);
});

test('parseQuestionBank: CRLF line endings parse identically to LF', () => {
  const md = '## Beta Inc\r\n\r\n- **Q:** What is a hash table? Status: ✅ Strong\r\n';
  const entries = parseQuestionBank(md);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].company, 'Beta Inc');
  assert.equal(entries[0].status, 'strong');
});

// ── Cross-check against weekly-digest.mjs (mandatory) ────────────────

test('cross-check: structured entries (no ### sub-headings) still attribute to extractGapsByCompany', () => {
  const md = [
    '## Acme Corp',
    '',
    '- **Q:** How would you shard a write-heavy Postgres table? — Status: 🔴 Gap',
    '  - topic: databases/indexing-partitioning',
    '  - round: technical',
    '  - asked: 2026-08-20',
    '',
    '- **Q:** Explain replication lag? — Status: 🔴 Gap',
    '  - topic: databases/replication',
  ].join('\n');

  // Both consumers must agree on which company owns these gaps.
  const parsed = parseQuestionBank(md);
  assert.ok(parsed.every((e) => e.company === 'Acme Corp'));
  assert.equal(parsed.filter((e) => e.status === 'gap').length, 2);

  const gapsByCompany = extractGapsByCompany(md, ['Acme Corp']);
  assert.equal(gapsByCompany.size, 1);
  assert.ok(gapsByCompany.has('Acme Corp'));
  assert.equal(gapsByCompany.get('Acme Corp').length, 2);
});

test('cross-check: a ### sub-heading between company and question clears attribution (documents the binding constraint)', () => {
  const md = [
    '## Acme Corp',
    '### Technical Round',
    '- **Q:** Explain CAP theorem. Status: 🔴 Gap',
  ].join('\n');

  // parseQuestionBank attributes to the nearest heading of ANY level...
  const [entry] = parseQuestionBank(md);
  assert.equal(entry.company, 'Technical Round');

  // ...and extractGapsByCompany drops the gap entirely, because "Technical
  // Round" does not match the known company name "Acme Corp". This is
  // exactly why templates/question-bank.template.md forbids ### sub-headings.
  const gapsByCompany = extractGapsByCompany(md, ['Acme Corp']);
  assert.equal(gapsByCompany.size, 0);
});

// ── loadTaxonomy ─────────────────────────────────────────────────────

test('loadTaxonomy: parses the shipped templates/interview-topics.yml with 14 domains', () => {
  const text = readFileSync(TAXONOMY_FIXTURE, 'utf-8');
  const taxonomy = loadTaxonomy(text);
  assert.equal(taxonomy.domains.length, 14);
  const ids = taxonomy.domains.map((d) => d.id);
  for (const expected of [
    'algorithms', 'system-design', 'programming-language', 'databases',
    'data-engineering', 'ml-fundamentals', 'deep-learning', 'llm', 'rag',
    'agents', 'mlops', 'cloud-infra', 'security-privacy', 'behavioral-leadership',
  ]) {
    assert.ok(ids.includes(expected), `missing domain: ${expected}`);
  }
});

test('loadTaxonomy: throws on malformed YAML (no domains array)', () => {
  assert.throws(() => loadTaxonomy('version: 1\n'));
  assert.throws(() => loadTaxonomy('not: valid: yaml: at: all: -\n'));
});

test('loadTaxonomy: validates version, ids, aliases, topics, and duplicates with paths', () => {
  assert.throws(
    () => loadTaxonomy('version: latest\ndomains: []\n'),
    /taxonomy\.version must be a positive integer/,
  );
  assert.throws(
    () => loadTaxonomy('domains:\n  - id: ""\n    topics: []\n'),
    /taxonomy\.domains\[0\]\.id must be a non-empty string/,
  );
  assert.throws(
    () => loadTaxonomy('domains:\n  - id: rag\n    topics: []\n  - id: rag\n    topics: []\n'),
    /taxonomy\.domains\[1\]\.id duplicates domain id "rag"/,
  );
  assert.throws(
    () => loadTaxonomy('domains:\n  - id: rag\n    aliases: [retrieval, 42]\n    topics: [chunking]\n'),
    /taxonomy\.domains\[0\]\.aliases\[1\] must be a string/,
  );
  assert.throws(
    () => loadTaxonomy('domains:\n  - id: rag\n    topics: [chunking, ""]\n'),
    /taxonomy\.domains\[0\]\.topics\[1\] must be a non-empty string/,
  );
  assert.throws(
    () => loadTaxonomy('domains:\n  - id: rag\n    topics: [chunking, chunking]\n'),
    /taxonomy\.domains\[0\]\.topics\[1\] duplicates topic id "chunking"/,
  );
});

// ── scoreTopics ──────────────────────────────────────────────────────

const fixtureTaxonomy = {
  domains: [
    { id: 'databases', label: 'Databases', aliases: ['sql'], topics: ['indexing-partitioning'] },
  ],
};

test('scoreTopics: weakness formula matches (2*gap + solid) / (2*total)', () => {
  const entries = [
    { topic: 'databases/indexing-partitioning', status: 'gap', asked: '2026-08-01', practiced: null, confidence: 2 },
    { topic: 'databases/indexing-partitioning', status: 'gap', asked: '2026-08-01', practiced: null, confidence: 1 },
    { topic: 'databases/indexing-partitioning', status: 'solid', asked: '2026-08-01', practiced: null, confidence: 3 },
    { topic: 'databases/indexing-partitioning', status: 'strong', asked: '2026-08-01', practiced: null, confidence: 4 },
  ];
  const [scored] = scoreTopics(entries, fixtureTaxonomy, { today: new Date('2026-08-01T00:00:00Z') }).topics;
  assert.ok(Math.abs(scored.weakness - 0.625) < 1e-9);
  assert.equal(scored.totalQuestions, 4);
  assert.equal(scored.gapCount, 2);
  assert.equal(scored.solidCount, 1);
  assert.equal(scored.strongCount, 1);
});

test('scoreTopics: the weakness rationale never claims gaps on a gap-free record', () => {
  // A merely-solid record scores weakness 0.5, which is enough to make the
  // weakness factor dominant — but there is no gap behind it. ready.md relays
  // this sentence to the candidate verbatim, so asserting "gaps outweigh
  // solid/strong answers" here reports a failure that never happened.
  const solidOnly = [
    { topic: 'databases/indexing-partitioning', status: 'solid', asked: null, practiced: '2026-08-01', confidence: 3 },
  ];
  const [scored] = scoreTopics(solidOnly, fixtureTaxonomy, { today: new Date('2026-09-01T00:00:00Z') }).topics;
  assert.equal(scored.gapCount, 0);
  assert.ok(Math.abs(scored.weakness - 0.5) < 1e-9);
  assert.doesNotMatch(scored.rationale, /gaps outweigh/);
  assert.match(scored.rationale, /merely solid answers/);

  // ...and a record that DOES carry a gap keeps the original wording.
  const withGap = [
    { topic: 'databases/indexing-partitioning', status: 'gap', asked: null, practiced: '2026-08-01', confidence: 1 },
  ];
  const [gapScored] = scoreTopics(withGap, fixtureTaxonomy, { today: new Date('2026-09-01T00:00:00Z') }).topics;
  assert.equal(gapScored.gapCount, 1);
  assert.match(gapScored.rationale, /gaps outweigh solid\/strong answers/);
});

test('scoreTopics: staleness caps at 1 at/after the 60-day horizon', () => {
  const today = new Date('2026-08-31T00:00:00Z');
  const at0 = scoreTopics(
    [{ topic: 'databases/indexing-partitioning', status: 'solid', asked: '2026-08-31', practiced: null, confidence: 3 }],
    fixtureTaxonomy, { today },
  ).topics[0];
  const at30 = scoreTopics(
    [{ topic: 'databases/indexing-partitioning', status: 'solid', asked: '2026-08-01', practiced: null, confidence: 3 }],
    fixtureTaxonomy, { today },
  ).topics[0];
  const at90 = scoreTopics(
    [{ topic: 'databases/indexing-partitioning', status: 'solid', asked: '2026-06-02', practiced: null, confidence: 3 }],
    fixtureTaxonomy, { today },
  ).topics[0];
  assert.equal(at0.staleness, 0);
  assert.ok(Math.abs(at30.staleness - 0.5) < 1e-9);
  assert.equal(at90.staleness, 1);
});

test('scoreTopics: no asked/practiced date is treated as maximally stale', () => {
  const [scored] = scoreTopics(
    [{ topic: 'databases/indexing-partitioning', status: 'gap', asked: null, practiced: null, confidence: null }],
    fixtureTaxonomy, { today: new Date('2026-08-31T00:00:00Z') },
  ).topics;
  assert.equal(scored.staleness, 1);
});

test('scoreTopics: future dates and direct out-of-range confidence stay bounded', () => {
  const [scored] = scoreTopics(
    [{
      topic: 'databases/indexing-partitioning',
      status: 'solid',
      asked: '2026-09-01',
      practiced: null,
      confidence: 99,
    }],
    fixtureTaxonomy,
    { today: new Date('2026-08-31T00:00:00Z') },
  ).topics;
  assert.equal(scored.staleness, 0);
  assert.equal(scored.meanConfidence, null);
  assert.ok(scored.confidenceGap >= 0 && scored.confidenceGap <= 1);
  assert.ok(scored.priority >= 0 && scored.priority <= 100);
});

test('scoreTopics: malformed dates from direct callers cannot produce non-finite scores', () => {
  const [scored] = scoreTopics(
    [{
      topic: 'databases/indexing-partitioning',
      status: 'gap',
      asked: '2026-99-99',
      practiced: 'not-a-date',
      confidence: 2,
    }],
    fixtureTaxonomy,
    { today: new Date('2026-08-31T00:00:00Z') },
  ).topics;
  assert.equal(scored.lastTouched, null);
  assert.equal(scored.staleness, 1);
  assert.ok(Number.isFinite(scored.priority));
  assert.ok(scored.priority >= 0 && scored.priority <= 100);
});

test('scoreTopics: JD matching is boundary-safe for short and punctuation aliases', () => {
  const taxonomy = {
    domains: [
      { id: 'programming', aliases: ['go', 'c++'], topics: ['language-runtime'] },
      { id: 'rag', aliases: ['rag'], topics: ['retrieval-ranking'] },
    ],
  };
  const falseMatches = scoreTopics([], taxonomy, {
    jdText: 'Own ongoing storage improvements.',
    today: new Date('2026-08-31T00:00:00Z'),
  });
  assert.deepEqual(falseMatches.untested, []);

  const punctuationMatch = scoreTopics([], taxonomy, {
    jdText: 'Production C++17 experience required.',
    today: new Date('2026-08-31T00:00:00Z'),
  });
  assert.ok(punctuationMatch.untested.some((topic) => topic.domain === 'programming'));
});

test('scoreTopics: JD alias match sets demand=1, pulls in untested topics domain-wide (in the untested list), but not an unrelated domain', () => {
  const taxonomy = {
    domains: [
      { id: 'llm', label: 'LLM', aliases: ['transformer'], topics: ['transformer-internals', 'tokenization'] },
      { id: 'rag', label: 'RAG', aliases: ['retrieval augmented generation'], topics: ['chunking-strategies'] },
    ],
  };
  const scored = scoreTopics([], taxonomy, { jdText: 'Deep transformer experience required.', today: new Date() });
  assert.equal(scored.topics.length, 0);
  const hit = scored.untested.find((t) => t.topic === 'transformer-internals');
  assert.ok(hit);
  assert.equal(hit.untested, true);
  assert.equal(hit.demand, 1.0);
  assert.equal(hit.weakness, null);
  assert.equal(hit.staleness, null);
  assert.equal(hit.confidenceGap, null);
  assert.equal(hit.priority, 100);
  // A domain-level alias match applies to every topic in that domain.
  assert.ok(scored.untested.some((t) => t.topic === 'tokenization'));
  // An unrelated domain with no alias/id match at all stays excluded.
  assert.ok(!scored.untested.some((t) => t.topic === 'chunking-strategies'));
});

test('scoreTopics: no JD supplied means demand baseline for tracked topics, and unmatched+untested topics are omitted', () => {
  const entries = [
    { topic: 'databases/indexing-partitioning', status: 'solid', asked: '2026-08-01', practiced: null, confidence: 3 },
  ];
  const scored = scoreTopics(entries, fixtureTaxonomy, { today: new Date('2026-08-01T00:00:00Z') });
  assert.equal(scored.topics.length, 1);
  assert.equal(scored.untested.length, 0);
  assert.equal(scored.topics[0].demand, DEMAND_BASELINE);
});

test('scoreTopics: sorts by priority DESC, then domain ASC, then topic ASC', () => {
  const taxonomy = {
    domains: [
      { id: 'zeta', label: 'Zeta', aliases: [], topics: ['topic-a', 'topic-b'] },
      { id: 'alpha', label: 'Alpha', aliases: [], topics: ['topic-a'] },
    ],
  };
  const entries = [
    { topic: 'zeta/topic-a', status: 'gap', asked: '2026-01-01', practiced: null, confidence: 0 },
    { topic: 'zeta/topic-b', status: 'gap', asked: '2026-01-01', practiced: null, confidence: 0 },
    { topic: 'alpha/topic-a', status: 'gap', asked: '2026-01-01', practiced: null, confidence: 0 },
  ];
  const scored = scoreTopics(entries, taxonomy, { today: new Date('2026-08-31T00:00:00Z') }).topics;
  assert.equal(scored.length, 3);
  assert.equal(scored[0].priority, scored[1].priority);
  assert.equal(scored[1].priority, scored[2].priority);
  assert.equal(scored[0].domain, 'alpha');
  assert.equal(scored[1].domain, 'zeta');
  assert.equal(scored[1].topic, 'topic-a');
  assert.equal(scored[2].topic, 'topic-b');
});

test('scoreTopics: bare domain-only topic (no /topic-id) does not count toward any specific topic score', () => {
  const entries = [
    { topic: 'databases', status: 'gap', asked: '2026-08-01', practiced: null, confidence: 0 },
  ];
  const scored = scoreTopics(entries, fixtureTaxonomy, { today: new Date('2026-08-31T00:00:00Z') });
  // No JD, no matching entries for the one real topic -> nothing to report.
  assert.equal(scored.topics.length, 0);
  assert.equal(scored.untested.length, 0);
  assert.equal(scored.unscoredQuestions.domainOnly.length, 1);
  assert.equal(scored.unscoredQuestions.missingTopic.length, 0);
});

test('scoreTopics: reports missing-topic and domain-only entries separately', () => {
  const scored = scoreTopics(
    [
      { question: 'Legacy question?', company: 'Acme', topic: null, status: 'gap' },
      { question: 'Broad database question?', company: 'Beta', topic: 'databases', status: 'solid' },
      { question: 'Specific question?', company: 'Gamma', topic: 'databases/indexing-partitioning', status: 'strong' },
    ],
    fixtureTaxonomy,
    { today: new Date('2026-08-31T00:00:00Z') },
  );
  assert.deepEqual(scored.unscoredQuestions.missingTopic, [
    { question: 'Legacy question?', company: 'Acme', topic: null },
  ]);
  assert.deepEqual(scored.unscoredQuestions.domainOnly, [
    { question: 'Broad database question?', company: 'Beta', topic: 'databases' },
  ]);
  assert.equal(scored.topics[0].totalQuestions, 1);
});

test('scoreTopics: reports unknown topic entries as orphans without remapping or double-counting them', () => {
  const scored = scoreTopics(
    [{ question: 'Evaluate retrieval?', company: 'Acme', topic: 'rag/evaluation', status: 'gap' }],
    { domains: [{ id: 'rag', aliases: [], topics: ['rag-evaluation'] }] },
    { today: new Date('2026-08-31T00:00:00Z') },
  );
  assert.deepEqual(scored.unscoredQuestions, { missingTopic: [], domainOnly: [] });
  assert.deepEqual(scored.topics, []);
  assert.deepEqual(scored.orphanTopics, [{ topic: 'rag/evaluation', count: 1 }]);
});

test('scoreTopics: REGRESSION — a confirmed recent 🔴 topic is not displaced out of --top 5 by untested JD-matched topics in the same domain', () => {
  const taxonomy = {
    domains: [
      {
        id: 'databases',
        label: 'Databases',
        aliases: ['postgres', 'sharding'],
        topics: [
          'schema-design', 'indexing-partitioning', 'query-optimization',
          'transactions-isolation', 'replication', 'database-selection',
        ],
      },
    ],
  };
  const entries = [
    { topic: 'databases/indexing-partitioning', status: 'gap', asked: null, practiced: '2026-08-25', confidence: 2 },
  ];
  const scored = scoreTopics(entries, taxonomy, {
    jdText: 'We need strong Postgres sharding and RAG retrieval experience',
    today: new Date('2026-08-31T00:00:00Z'),
  });
  const confirmedGap = scored.topics.find((t) => t.topic === 'indexing-partitioning');
  assert.ok(confirmedGap, 'confirmed 🔴 topic must appear in the topics list');
  const top5 = scored.topics.slice(0, 5);
  assert.ok(
    top5.some((t) => t.topic === 'indexing-partitioning'),
    'confirmed recent 🔴 must not be displaced out of the top 5 measured topics by untested topics (they are a separate list)',
  );
});

// ── CLI smoke tests ──────────────────────────────────────────────────

test('CLI: --help exits 0 and prints usage', () => {
  const res = runCli(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage:/);
});

test('CLI: --self-test exits 0', () => {
  const res = runCli(['--self-test']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test('CLI: unknown flag exits non-zero', () => {
  const res = runCli(['--bogus-flag']);
  assert.notEqual(res.status, 0);
});

test('CLI: no question bank present does not crash, JSON reports questionBankFound=false', () => {
  const dir = makeTmpDir();
  try {
    const qbPath = join(dir, 'question-bank.md');
    const res = runCli(['--file', qbPath, '--taxonomy', TAXONOMY_FIXTURE]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.metadata.questionBankFound, false);
    assert.equal(parsed.metadata.untestedCount, 0);
    assert.equal(parsed.metadata.returnedUntested, 0);
    assert.equal(parsed.metadata.totalTopics, 0);
    assert.equal(parsed.metadata.returnedTopics, 0);
    assert.equal(parsed.metadata.unscoredEntryCount, 0);
    assert.deepEqual(parsed.topics, []);
    assert.deepEqual(parsed.untested, []);
    assert.deepEqual(parsed.unscoredQuestions, {
      missingTopic: [],
      domainOnly: [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: --file with real entries and --top limits output', () => {
  const dir = makeTmpDir();
  try {
    const qbPath = join(dir, 'question-bank.md');
    writeFileSync(qbPath, [
      '## Acme Corp',
      '- **Q:** Shard a table? Status: 🔴 Gap',
      '  - topic: databases/indexing-partitioning',
      '  - asked: 2020-01-01',
    ].join('\n'));
    const res = runCli(['--file', qbPath, '--taxonomy', TAXONOMY_FIXTURE, '--top', '3']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.metadata.questionBankFound, true);
    assert.ok(parsed.topics.length <= 3);
    assert.ok(parsed.topics.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: --summary produces a human-readable table, not JSON', () => {
  const dir = makeTmpDir();
  try {
    const qbPath = join(dir, 'question-bank.md');
    writeFileSync(qbPath, '## Acme Corp\n- **Q:** X? Status: 🔴 Gap\n');
    const res = runCli(['--file', qbPath, '--taxonomy', TAXONOMY_FIXTURE, '--summary']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /Interview Readiness/);
    assert.match(res.stdout, /Missing topic \(1\)/);
    assert.throws(() => JSON.parse(res.stdout));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: --summary shows measured topics before the untested section, and omits the untested section when empty', () => {
  const dir = makeTmpDir();
  try {
    const qbPath = join(dir, 'question-bank.md');
    writeFileSync(qbPath, [
      '## Acme Corp',
      '- **Q:** Shard a table? Status: 🔴 Gap',
      '  - topic: databases/indexing-partitioning',
      '  - practiced: 2020-01-01',
      '  - confidence: 2',
    ].join('\n'));

    // No JD -> no untested topics -> section omitted entirely.
    const noJd = runCli(['--file', qbPath, '--taxonomy', TAXONOMY_FIXTURE, '--summary']);
    assert.equal(noJd.status, 0, noJd.stdout + noJd.stderr);
    assert.match(noJd.stdout, /Measured/);
    assert.doesNotMatch(noJd.stdout, /Not yet tested/);

    // With a JD that alias-matches other databases topics -> untested section
    // appears, and the measured section is printed first.
    const jdPath = join(dir, 'jd.txt');
    writeFileSync(jdPath, 'We need strong Postgres sharding experience.');
    const withJd = runCli(['--file', qbPath, '--taxonomy', TAXONOMY_FIXTURE, '--jd', jdPath, '--summary']);
    assert.equal(withJd.status, 0, withJd.stdout + withJd.stderr);
    assert.match(withJd.stdout, /Measured/);
    assert.match(withJd.stdout, /Not yet tested/);
    assert.match(withJd.stdout, /returned \/ \d+ total/);
    assert.ok(
      withJd.stdout.indexOf('Measured') < withJd.stdout.indexOf('Not yet tested'),
      'measured section must appear before the untested section',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: --summary keeps JD-derived untested topics visible when the question bank is missing', () => {
  const missingQuestionBank = join(REPO_ROOT, 'tests', 'fixtures', 'intentionally-missing-question-bank.md');
  assert.equal(existsSync(missingQuestionBank), false, 'missing-bank fixture path must remain absent');
  const res = runCli([
    '--file', missingQuestionBank,
    '--taxonomy', TAXONOMY_FIXTURE,
    '--jd', join(REPO_ROOT, 'modes', 'interview', 'ready.md'),
    '--summary',
  ]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /No question bank yet/);
  assert.match(res.stdout, /Not yet tested/);
});

test('CLI: --jd with a missing file exits non-zero with a clear error', () => {
  const res = runCli(['--jd', '/nonexistent/path/jd.md']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /not found/i);
});

test('CLI: --taxonomy with a missing file exits non-zero with a clear error', () => {
  const dir = makeTmpDir();
  try {
    const res = runCli(['--taxonomy', join(dir, 'missing.yml')]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /not found/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
