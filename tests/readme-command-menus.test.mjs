// The /career-ops discovery menu in each SKILL.md copy is the list a new user
// sees in the agent. It must name every router input, and describe oferta
// the way modes/oferta.md does: blocks A-G always, Block H at or above 4.5.
// README Usage is checked by readme-usage-commands.test.mjs.
//
// Run: node --test tests/readme-command-menus.test.mjs

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const COPIES = [
  '.agents/skills/career-ops/SKILL.md',
  'antigravity-directory/skills/career-ops/SKILL.md',
  'claude-directory/skills/career-ops/SKILL.md',
  'cursor-directory/skills/career-ops/SKILL.md',
  'openai-directory/skills/career-ops/SKILL.md',
];
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SKILL = read(COPIES[0]);

// Same parse as `routes` in readme-usage-commands.test.mjs: router input → mode.
const routes = new Map([...SKILL.matchAll(/^\| `([a-z/-]+)` \| `([^`]+)` \|$/gm)].map((m) => [m[1], m[2]]));

function discoveryMenu(text, label) {
  const at = text.indexOf('Show this menu:');
  assert.ok(at >= 0, `${label}: missing "Show this menu:"`);
  const fence = text.slice(at).match(/```[^\n]*\n([\s\S]*?)```/);
  assert.ok(fence, `${label}: missing menu fence`);
  return fence[1];
}

const menuCommands = (menu) => new Set([...menu.matchAll(/\/career-ops\s+([a-z0-9][a-z0-9/_-]*)/g)].map((m) => m[1]));

test('each discovery menu lists every routed command', () => {
  assert.ok(routes.size >= 30, `only ${routes.size} router inputs parsed — the routing table format changed`);
  for (const rel of COPIES) {
    const listed = menuCommands(discoveryMenu(read(rel), rel));
    // An alias (`inbox`) is covered when the mode it routes to is listed.
    const listedModes = new Set([...listed].map((c) => routes.get(c)));
    const missing = [...routes].filter(([input, mode]) => !listed.has(input) && !listedModes.has(mode)).map(([input]) => input);
    assert.deepEqual(missing, [], `${rel} menu missing: ${missing.join(', ')}`);
  }
});

test('each discovery menu describes oferta as A-G plus Block H at or above 4.5', () => {
  for (const rel of COPIES) {
    const line = discoveryMenu(read(rel), rel).split('\n').find((row) => /\/career-ops\s+oferta\b/.test(row) && !/\bofertas\b/.test(row));
    assert.ok(line, `${rel} lists oferta`);
    assert.match(line, /A-G always/, rel);
    assert.match(line, /Block H at or above 4\.5/, rel);
    assert.doesNotMatch(line, /only above|A-F|A to H/, rel);
  }
});

test('each discovery menu says retro saves proposals and applies only accepted ids', () => {
  for (const rel of COPIES) {
    const line = discoveryMenu(read(rel), rel).split('\n').find((row) => /\/career-ops\s+retro\b/.test(row));
    assert.ok(line, `${rel} lists retro`);
    assert.match(line, /Save the proposals, then apply only accepted ids to the rule files/, rel);
    assert.doesNotMatch(line, /writes only the ids you accept/, rel);
  }
});
