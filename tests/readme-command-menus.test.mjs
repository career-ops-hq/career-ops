// README Usage and the skill discovery menu are the two lists a new user
// sees. Both must name every router input except `inbox` (an alias of
// agent-inbox). Oferta always writes blocks A-G. Block H is included when
// the score is at or above 4.5 (modes/oferta.md). The README used to say
// "A to H" and the discovery menu used to say "A-F".
//
// Run: node --test tests/readme-command-menus.test.mjs

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const skill = readFileSync(join(ROOT, '.agents/skills/career-ops/SKILL.md'), 'utf8');

function fenceAfter(text, marker) {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, `missing marker: ${marker}`);
  const fence = text.slice(at).match(/```[^\n]*\n([\s\S]*?)```/);
  assert.ok(fence, `missing fence after ${marker}`);
  return fence[1];
}

function menuCommands(menu) {
  return new Set(
    [...menu.matchAll(/\/career-ops\s+([a-z0-9][a-z0-9/_-]*)/g)].map((m) => m[1]),
  );
}

const table = skill.slice(
  skill.indexOf('| Input | Mode |'),
  skill.indexOf('**Auto-pipeline detection:**'),
);
const routed = [...table.matchAll(/^\| `([a-z0-9][a-z0-9/_-]*)` \|/gm)]
  .map((m) => m[1])
  .filter((name) => name !== 'inbox');

test('README Usage and the discovery menu list every routed command', () => {
  assert.ok(routed.length >= 30, `parsed ${routed.length} routes`);
  const readmeMenu = menuCommands(fenceAfter(readme, '## Usage'));
  const discovery = menuCommands(fenceAfter(skill, 'Show this menu:'));
  const missingReadme = routed.filter((name) => !readmeMenu.has(name));
  const missingDiscovery = routed.filter((name) => !discovery.has(name));
  assert.deepEqual(missingReadme, [], `README Usage missing: ${missingReadme.join(', ')}`);
  assert.deepEqual(missingDiscovery, [], `discovery menu missing: ${missingDiscovery.join(', ')}`);
});

test('both menus describe oferta as A-G plus a conditional Block H', () => {
  for (const [label, menu] of [
    ['README', fenceAfter(readme, '## Usage')],
    ['discovery', fenceAfter(skill, 'Show this menu:')],
  ]) {
    const line = menu.split('\n').find((row) => /\/career-ops\s+oferta\b/.test(row) && !/\bofertas\b/.test(row));
    assert.ok(line, `${label} lists oferta`);
    assert.match(line, /A-G/, label);
    assert.match(line, /at or above 4\.5/, label);
    assert.match(line, /Block H at or above 4\.5/, label);
    assert.doesNotMatch(line, /only above/, label);
    assert.doesNotMatch(line, /A-F/, label);
    assert.doesNotMatch(line, /A to H/, label);
  }
});
