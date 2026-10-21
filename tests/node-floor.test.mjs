// tests/node-floor.test.mjs
//
// The project's Node floor (lib/node-floor.mjs) and every place that restates
// it. The floor was declared as 18 for months after CI stopped running 18: a
// Renovate bump moved the "Node 18" syntax step to 24 (647ab019) and nothing
// noticed, so `engines` promised compatibility no job checked (#4801). It was
// also wrong on its own terms: doctor passed 22.5–22.12, where node:sqlite still
// needs --experimental-sqlite and tracker.mjs's plain import fails.
//
// These pin the verdict (whose failing branch can't be reached through doctor on
// a machine running a current Node) and make each restatement fail loudly if it
// drifts from NODE_MIN.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { nodeFloor, NODE_MIN, NODE_MIN_23, NODE_ENGINES } from '../lib/node-floor.mjs';

console.log('\n🔎 Node floor (one number, every restatement in step)');

const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));
const floor = NODE_MIN.split('.').slice(0, 2).join('.');

// ── The verdict ──────────────────────────────────────────────────────
{
  ok(NODE_MIN === '22.13.0', 'the floor is 22.13.0, the first 22.x where node:sqlite needs no flag');

  for (const v of ['18.20.4', '20.19.0', '22.5.0', '22.12.0', '21.7.3']) {
    const r = nodeFloor(v);
    ok(r.pass === false, `Node ${v} fails the floor`);
    ok(r.label.includes(v) && r.label.includes(floor), `  and its label names both ${v} and ${floor}`);
    ok(Array.isArray(r.fix) && r.fix.length >= 1, '  and it offers a fix');
  }

  // 23.x unflagged node:sqlite only in 23.4.0, so 23.0–23.3 fail even though
  // they sort above 22.13.
  ok(NODE_MIN_23 === '23.4.0', 'the 23.x floor is 23.4.0, where node:sqlite lost its flag on that line');
  for (const v of ['23.0.0', '23.3.0']) {
    const r = nodeFloor(v);
    ok(r.pass === false, `Node ${v} fails the floor`);
    ok(r.label.includes(v) && r.label.includes('23.4'), `  and its label names both ${v} and 23.4`);
    ok(Array.isArray(r.fix) && r.fix.length >= 1, '  and it offers a fix');
  }

  // 22.5–22.12 is the range doctor used to pass while tracker.mjs could not
  // import node:sqlite there. It must stay a failure, not a warning.
  ok(nodeFloor('22.12.9').warn !== true, '22.12 is a hard failure, not a warning');

  for (const v of ['22.13.0', '22.13.1', '22.20.0', '23.4.0', '23.11.1', '24.11.0', '26.10.0', 'v24.1.0']) {
    ok(nodeFloor(v).pass === true, `Node ${v} passes the floor`);
  }

  for (const junk of ['', 'unknown', undefined, '22']) {
    const r = nodeFloor(junk);
    ok(r.pass === false, `an unreadable version (${JSON.stringify(junk)}) fails closed instead of passing`);
  }
}

// ── Every restatement matches ────────────────────────────────────────
{
  const engines = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')).engines?.node;
  for (const rel of ['package.json', 'scaffolder/package.json']) {
    const got = engines(rel);
    ok(got === NODE_ENGINES, `${rel} engines.node is "${NODE_ENGINES}" (found ${JSON.stringify(got)})`);
  }

  // The CI floor job. Exact match: a bare major ('22') resolves to the newest
  // 22.x, so it would run without testing the floor.
  const wf = readFileSync(join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');
  const step = wf.match(/- name: Set up the Node floor[^\n]*\n(?:[^\n]*\n){0,3}?\s*node-version:\s*'([^']+)'/);
  ok(step !== null, 'test.yml has a "Set up the Node floor" step with a node-version');
  if (step) ok(step[1] === floor, `test.yml's floor step runs Node '${floor}' (found '${step[1]}')`);
}
