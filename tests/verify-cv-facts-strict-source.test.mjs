// tests/verify-cv-facts-strict-source.test.mjs — --strict-source (#6792): the
// sources alone decide what is supported, so config allowances clear nothing,
// while forbidden and advisory phrase checks still run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { verifyFacts } from '../verify-cv-facts.mjs';

const ROOT = join(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'vcf-strict-'));
const source = join(dir, 'cv.md');
writeFileSync(source, '# CV\n\n- Led a team of 4 engineers.\n');
const cfg = (obj) => { const p = join(dir, `c${Math.random()}.json`); writeFileSync(p, JSON.stringify(obj)); return p; };
const doc = (text) => { const p = join(dir, `t${Math.random()}.html`); writeFileSync(p, `<html><body><p>${text}</p></body></html>`); return p; };
const cli = (target, config, ...extra) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'verify-cv-facts.mjs'), target, '--source', source, '--config', config, ...extra], { encoding: 'utf-8', timeout: 30000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const run = (text, config, strictSource) => verifyFacts(text, { sourcePaths: [source], configPath: config, strictSource });

test('allow_metrics clears a metric by default and not with strictSource', () => {
  const text = 'Led a team of 4 engineers and cut latency by 30%.';
  const config = cfg({ allow_metrics: ['30%'] });
  assert.equal(run(text, config).invented.length, 0);
  assert.ok(run(text, config, true).invented.length > 0);
});

test('allow_facts clears a named fact by default and not with strictSource', () => {
  const text = 'Led a team of 4 engineers using Kubernetes.';
  const config = cfg({ allow_facts: ['kubernetes'] });
  const strict = run(text, config, true);
  assert.equal(run(text, config).unsupportedFacts.length, 0);
  assert.ok(strict.unsupportedFacts.length + strict.invented.length > 0, JSON.stringify(strict));
});

test('allow_swaps clears a verb swap by default and not with strictSource', () => {
  const src = join(dir, 'swap.md');
  writeFileSync(src, '# CV\n\n## Experience\n\n### Acme\n\n- Used Kafka for event streaming.\n');
  const text = '<html><body><li>Led a Kafka migration for event streaming.</li></body></html>';
  const config = cfg({ allow_swaps: ['used -> led'] });
  const go = strictSource => verifyFacts(text, { sourcePaths: [src], configPath: config, strictSource });
  assert.equal(go(false).unsupportedFacts.length, 0, JSON.stringify(go(false)));
  assert.ok(go(true).unsupportedFacts.length > 0, JSON.stringify(go(true)));
});

test('forbidden and warn phrases still run with strictSource', () => {
  const config = cfg({ allow_facts: ['x'], forbidden_phrases: ['rockstar'], warn_phrases: ['synergy'] });
  assert.ok(run('Led a team of 4 engineers, a rockstar.', config, true).forbidden.length > 0);
  assert.notEqual(run('Led a team of 4 engineers with synergy.', config, true).verdict, 'pass');
});

test('CLI: --strict-source blocks an allow_facts-only claim, and default still passes', () => {
  const target = doc('Led a team of 4 engineers and cut latency by 30%.');
  const config = cfg({ allow_metrics: ['30%'] });
  assert.equal(cli(target, config).status, 0);
  assert.equal(cli(target, config, '--strict-source').status, 1);
});

test('CLI: an allowances-only config with --strict-source is not reported as missing', () => {
  const config = cfg({ allow_metrics: [], allow_facts: ['x'], allow_swaps: [] });
  const r = cli(doc('Led a team of 4 engineers.'), config, '--strict-source');
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /did not run|config not found/);
  assert.equal(run('Led a team of 4 engineers.', config, true).configMissing, false);
});

test('CLI: forbidden phrase blocks under --strict-source', () => {
  const config = cfg({ forbidden_phrases: ['rockstar'] });
  assert.equal(cli(doc('Led a team of 4 engineers, a rockstar.'), config, '--strict-source').status, 1);
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

test('CLI: strict-source failure advice never points at ignored config allowances', () => {
  const target = doc('Led a team of 4 engineers and cut latency by 30%.');
  const config = cfg({ allow_metrics: ['30%'] });
  const strict = cli(target, config, '--strict-source').out;
  assert.doesNotMatch(strict, /allow_(metrics|facts|swaps)|config\/cv-facts\.json/);
  assert.match(strict, /Remove the unsupported claims or correct/);
  assert.match(cli(target, cfg({})).out, /A verified exception belongs in config\/cv-facts\.json/);
});

test('CLI: strict-source scope and drift advice names no allowance', () => {
  const src = join(dir, 'scope.md');
  writeFileSync(src, '# CV\n\n## Experience\n\n### Acme\n\n- Supported the Kafka migration for event streaming.\n- Used Kafka for event streaming.\n');
  const target = doc('<li>Led the Kafka migration for event streaming.</li><li>Led a Kafka rollout for event streaming.</li>');
  const config = cfg({});
  const out = (...extra) => { const r = spawnSync(process.execPath, [join(ROOT, 'verify-cv-facts.mjs'), target, '--source', src, '--config', config, ...extra], { encoding: 'utf-8' }); return `${r.stdout}${r.stderr}`; };
  assert.match(out(), /allow_facts|allow_swaps/);
  assert.doesNotMatch(out('--strict-source'), /allow_(metrics|facts|swaps)/);
});
