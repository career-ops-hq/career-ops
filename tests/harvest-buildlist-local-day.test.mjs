// tests/harvest-buildlist-local-day.test.mjs — the portals.yml block
// harvest-buildlist.mjs writes is stamped with the LOCAL calendar day (#3070).
//
// renderPortalsYaml() wrote "# Harvested <day>" and each entry's
// "via BuildList <day>" note from new Date().toISOString(), the UTC day. West
// of Greenwich, an evening harvest was stamped with tomorrow's date.
//
// The clock is frozen at an instant where the two days differ, as in
// tests/local-today-gates.test.mjs: a test reading the real clock would pass
// for most of the day with the bug in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// 01:30 UTC on the 18th is still the 17th in New York.
const INSTANT = '2026-08-18T01:30:00Z';

function renderAt(tz) {
  const script =
    `const RealDate = Date;` +
    `const FROZEN = new RealDate('${INSTANT}');` +
    `globalThis.Date = class extends RealDate {` +
    `  constructor(...a) { if (a.length === 0) { super(FROZEN.getTime()); } else { super(...a); } }` +
    `  static now() { return FROZEN.getTime(); }` +
    `};` +
    `const { renderPortalsYaml } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'harvest-buildlist.mjs')).href)});` +
    `process.stdout.write(renderPortalsYaml({ resolved: [{ name: 'Globex', buildlistSlug: 'globex', vendor: 'ashby', slug: 'globex',` +
    `  board: 'https://jobs.ashbyhq.com/globex', profile: { sector: 'AI' }, alternates: [] }] }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT, encoding: 'utf-8', timeout: 30_000, env: { ...process.env, TZ: tz },
  });
  assert.equal(r.error, undefined, describeSpawn(r));
  assert.equal(r.status, 0, describeSpawn(r));
  return r.stdout;
}

test('an evening harvest in New York is stamped with New York\'s day', () => {
  const out = renderAt('America/New_York');
  assert.match(out, /# Harvested 2026-08-17 /);
  assert.match(out, /via BuildList 2026-08-17/);
  assert.doesNotMatch(out, /2026-08-18/);
});

test('control: in UTC the local day and the UTC day agree', () => {
  const out = renderAt('UTC');
  assert.match(out, /# Harvested 2026-08-18 /);
  assert.match(out, /via BuildList 2026-08-18/);
});
