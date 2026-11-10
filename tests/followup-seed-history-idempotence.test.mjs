import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pass, fail, ROOT, NODE } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'followup-history-'));
try {
  const tracker = join(dir, 'applications.md');
  const followups = join(dir, 'follow-ups.md');
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, '{}\n');
  writeFileSync(tracker, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-09-01 | ExampleCo | Engineer | 4.0/5 | Applied | — | — | Applied 2026-09-01 |',
  ].join('\n'));
  const bullet = '- 2026-10-10 · #1 ExampleCo — sent follow-up\n';
  const cases = [
    { name: 'single seed respects an existing legacy follow-up', content: bullet, args: ['1'], expectWrite: false },
    { name: 'backfill respects an existing legacy follow-up', content: bullet, args: ['--backfill'], expectWrite: false },
    { name: 'a follow-up for another application does not suppress seeding', content: bullet.replace('#1', '#2'), args: ['1'], expectWrite: true },
    { name: 'force still reseeds an existing legacy follow-up', content: bullet, args: ['1', '--force'], expectWrite: true },
    { name: 'existing table follow-ups still suppress seeding', content: '| 1 | 1 | 2026-10-10 | ExampleCo | Engineer | Email | | sent |\n', args: ['1'], expectWrite: false },
  ];
  for (const item of cases) {
    writeFileSync(followups, item.content);
    const result = spawnSync(NODE, [join(ROOT, 'followup-seed.mjs'), ...item.args, '--json'], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: dir,
        CAREER_OPS_TRACKER: tracker, CAREER_OPS_FOLLOWUPS: followups, CAREER_OPS_PROFILE: profile },
    });
    const content = readFileSync(followups, 'utf8');
    const correct = result.status === 0 && (item.expectWrite
      ? content.startsWith(item.content) && content.includes('- next #1 2026-09-08')
      : content === item.content);
    if (correct) pass(item.name);
    else fail(`${item.name}: exit=${result.status}, error=${result.error?.message ?? 'none'}, ${result.stderr}, content=${content}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
