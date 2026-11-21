import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../followup-cadence.mjs', import.meta.url);
const tracker = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2020-01-01 | Acme Corp | Software Engineer | 4 | Interview | — | — | Synthetic fixture note |
| 2 | 2020-01-01 | Globex | Software Engineer | 4 | Interview | — | — | Synthetic fixture note |
| 3 | 2020-01-01 | Initech | Software Engineer | 4 | Applied | — | — | Synthetic fixture note |
| 4 | 2020-01-01 | Example Company A | Software Engineer | 4 | Responded | — | — | Synthetic fixture note |
| 5 | 2020-01-01 | Example Company B | Software Engineer | 4 | Assessment | — | — | Synthetic fixture note |
`;
const touches = `| num | appNum | date | company | role | channel | contact | notes |
|-----|--------|------|---------|------|---------|---------|-------|
| 1 | 2 | 2020-01-02 | Globex | Software Engineer | email | fixture@example.invalid | Synthetic fixture touch |
- next #1 2020-01-03 (set 2020-01-02)
`;

for (const [label, value, enabled] of [
  ['omitted', undefined, true], ['explicit true', true, true],
  ['disabled', false, false], ['quoted false', 'false', true],
]) {
  test(`interview follow-ups: ${label}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'interview-cadence-'));
    try {
      const profile = join(dir, 'profile.yml');
      const apps = join(dir, 'applications.md');
      const log = join(dir, 'follow-ups.md');
      writeFileSync(profile, JSON.stringify({ followup_cadence: { interview_followups: value } }));
      writeFileSync(apps, tracker);
      writeFileSync(log, touches);
      const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PROFILE: profile,
        CAREER_OPS_TRACKER: apps, CAREER_OPS_FOLLOWUPS: log };
      function run(args) {
        const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 30_000 });
        assert.equal(result.status, 0, result.stderr);
        return JSON.parse(result.stdout);
      }
      const core = run(['--input-type=module', '-e', `
        import { computeUrgency, computeNextFollowupDate } from ${JSON.stringify(script.href)};
        console.log(JSON.stringify([null, '2020-01-02'].map(last => ({
          urgency: computeUrgency('interview', 10, last ? 8 : null, last ? 1 : 0),
          date: computeNextFollowupDate('interview', '2020-01-01', last, last ? 1 : 0),
        }))));
      `]);
      assert.deepEqual(core, enabled
        ? [{ urgency: 'overdue', date: '2020-01-02' }, { urgency: 'overdue', date: '2020-01-05' }]
        : [{ urgency: 'waiting', date: null }, { urgency: 'waiting', date: null }]);
      // /api/followups invokes this same CLI; home consumes its due entries.
      for (const flags of [['--json'], ['--json', '--overdue-only']]) {
        const result = run([script.pathname, ...flags]);
        assert.equal(result.cadenceConfig.interview_followups, enabled);
        assert.deepEqual(result.entries.map(e => e.num).sort(), enabled ? [1, 2, 3, 4, 5] : [3, 4, 5]);
        assert.equal(result.metadata.totalTracked, 5);
        assert.equal(result.metadata.actionable, enabled ? 5 : 3);
        assert.equal(result.metadata.overdue, enabled ? 5 : 3);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
