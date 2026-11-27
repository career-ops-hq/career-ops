import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFactConfig, verifyFacts } from '../verify-cv-facts.mjs';
import { candidateOwnWords, voiceIssues } from '../cv-voice.mjs';

const CONFIG = JSON.stringify({
  allow_metrics: ['10 users'],
  allow_facts: ['spearheaded the on-call rota'],
  forbidden_phrases: [],
  warn_phrases: [],
});

function withBomConfig(run) {
  const root = mkdtempSync(join(tmpdir(), 'cv-facts-bom-'));
  try {
    mkdirSync(join(root, 'config'));
    const configPath = join(root, 'config', 'cv-facts.json');
    writeFileSync(configPath, `\uFEFF${CONFIG}`);
    writeFileSync(join(root, 'cv.md'), '- Ran the weekly release train for the payments app\n');
    run(root, configPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the fact gate reads a cv-facts.json saved with a byte order mark', () => {
  withBomConfig((root, configPath) => {
    assert.deepEqual(loadFactConfig(configPath).config.allow_metrics, ['10 users']);
    const result = verifyFacts('Ran the weekly release train for 10 users', { sourcePaths: [join(root, 'cv.md')], configPath });
    assert.equal(result.verdict, 'pass');
  });
});

test('the voice check reads the allow lists of a cv-facts.json saved with a byte order mark', () => {
  withBomConfig((root) => {
    const issues = voiceIssues('She spearheaded the on-call rota', candidateOwnWords(root));
    assert.equal(issues.some((issue) => issue.value === 'spearheaded'), false);
  });
});
