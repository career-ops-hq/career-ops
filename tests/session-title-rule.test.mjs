// tests/session-title-rule.test.mjs — the router's host-optional session-title
// rule (#5303).
//
// Hosts that title sessions automatically name them after the invocation, so a
// week of `/career-ops <url>` runs leaves a sidebar of identical "Career ops
// LinkedIn job" titles. The router now tells an interactive single-posting mode
// to rename the session `{Role}, {Company}` once the JD is read.
//
// These are prompt-contract assertions: they pin the rule's guardrails in the
// text an agent reads, not proof that any given model obeys it. The guardrails
// that matter are the ones whose loss would do harm rather than just look
// different — headless workers renaming nothing, the agency gate coming first,
// JD text treated as data, and a silent no-op on hosts with no rename tool.
import { readFileSync } from 'fs';
import { join } from 'path';
import { fail, pass, ROOT } from './helpers.mjs';
import { knownKeysFromExample, EXAMPLE_PATH } from '../validate-profile.mjs';

console.log('\nRouter session-title rule (#5303)');

const read = (path) => readFileSync(join(ROOT, path), 'utf-8').replace(/\r\n/g, '\n');
const check = (label, cond) => (cond ? pass(label) : fail(label));

const skill = read('.agents/skills/career-ops/SKILL.md');
const section = skill.split('## Session Title (host-optional, #5303)')[1]?.split('\n---')[0] ?? '';

check('router has a Session Title section', section.length > 0);
check('title format is `{Role}, {Company}`', section.includes('`{Role}, {Company}`'));
check('agency titles wait for the agency confirmation handoff',
  section.includes('`{Role}, via {Agency}`') && section.includes('**Agency confirmation handoff**'));
check('no-op when the host cannot rename the session',
  /no way to rename its own session, skip this silently/.test(section));
check('JD-derived title text is treated as untrusted data',
  section.includes('Untrusted External Content') && /skip the rename/.test(section));
check('opt-out key is documented in the rule', section.includes('`session_title: off`'));

const scopeLine = section.match(/^- \*\*Scope:\*\* (.*)$/m)?.[1] ?? '';
const [inScope, outOfScope] = scopeLine.split('Skip');
for (const mode of ['auto-pipeline', 'oferta', 'pdf', 'apply', 'contacto', 'interview-prep']) {
  check(`\`${mode}\` is in scope`, (inScope ?? '').includes(`\`${mode}\``));
}
for (const mode of ['scan', 'pipeline', 'batch', 'ofertas']) {
  check(`multi-posting \`${mode}\` is skipped`, (outOfScope ?? '').includes(`\`${mode}\``));
}
check('delegated/headless workers never rename', /worker never renames anything/.test(outOfScope ?? ''));

// `apply` is in scope but runs in a worker when Playwright drives the form, so
// the parent has to get the role and employer back or nothing ever renames.
const delegated = skill.split('### Modes delegated to subagent')[1]?.split('\n## ')[0] ?? '';
check('delegated `apply` hands role and employer back to the parent for the rename',
  /For `apply` \(with Playwright\), ask the worker to return the role title and employer/.test(delegated)
    && /parent then applies \*\*Session Title\*\*/.test(delegated));
check('delegated `apply` also returns the agency, and the parent waits for its confirmation',
  /and any agency the posting came through/.test(delegated)
    && /parent then applies \*\*Session Title\*\* from those values, after any agency confirmation has resolved/.test(delegated));
check('delegated `apply` worker never renames', /The worker never renames anything itself/.test(delegated));

// The point in the flow where the role and employer first become known.
// Each pointer must also keep the agency deferral, or it reads as "title at
// Step 0" for a `?` employer whose agency is not confirmed yet.
for (const mode of ['modes/auto-pipeline.md', 'modes/oferta.md']) {
  const pointer = read(mode).match(/^\*\*Session title:\*\*.*$/m)?.[0] ?? '';
  check(`${mode} points at the router rule`, pointer.includes('**Session Title** rule'));
  check(`${mode} defers an agency title to the confirmation handoff`,
    pointer.includes('`{Role}, via {Agency}`') && pointer.includes('**Agency confirmation handoff**'));
}

// validate-profile.mjs takes its known keys from the example; an opt-out key
// missing there would be reported as unknown on every profile that sets it.
const known = knownKeysFromExample(readFileSync(EXAMPLE_PATH, 'utf-8'));
check('`session_title` is a documented config/profile.yml key', known.includes('session_title'));
