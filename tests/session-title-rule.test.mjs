// tests/session-title-rule.test.mjs — the router's host-optional session-title
// rule (#5303), and the progress titles that extend it to scans and single
// evaluations.
//
// Hosts that title sessions automatically name them after the invocation, so a
// week of `/career-ops <url>` runs leaves a sidebar of identical "Career ops
// LinkedIn job" titles. The router tells an interactive single-posting mode to
// rename the session `{Role}, {Company}` once the JD is read. A scan or a single
// evaluation also shows its stage, and a scan a `{remaining}/{found}` counter.
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

const bullet = (name) => section.match(new RegExp(`^- \\*\\*${name}\\*\\*.*(?:\\n  - .*)*`, 'm'))?.[0] ?? '';

const scopeLine = section.match(/^- \*\*Scope:\*\* (.*)$/m)?.[1] ?? '';
const [inScope, outOfScope] = scopeLine.split('Skip');
for (const mode of ['auto-pipeline', 'oferta', 'pdf', 'apply', 'contacto', 'interview-prep', 'scan', 'pipeline']) {
  check(`\`${mode}\` is in scope`, (inScope ?? '').includes(`\`${mode}\``));
}
for (const mode of ['batch', 'ofertas']) {
  check(`\`${mode}\` is skipped`, (outOfScope ?? '').includes(`\`${mode}\``));
}
check('a multi-URL `pipeline` that did not follow a scan is skipped',
  /a `pipeline` run on 2\+ URLs that did not follow a scan/.test(outOfScope ?? ''));
check('delegated/headless workers never rename', /worker never renames anything/.test(outOfScope ?? ''));

// Whose session. Hosts such as the Claude desktop app take a session id, so a
// parent could retitle its children or a child its parent; and a session that
// another session started is still one the user opens and talks to.
const whose = bullet('Whose session:');
check('renames only its own session, never another by id',
  /rename only your own session/.test(whose) && /never another session by its id/.test(whose));
check('a session started by another session titles itself, and its starter leaves it alone',
  /counts as interactive even when another session started it/.test(whose)
    && /the session that started it leaves that title alone/.test(whose));
check('a subagent or headless run has no session of its own and returns its values',
  /has no session of its own/.test(whose) && /returns its values to the session that runs it/.test(whose));

// The progress titles. The strings and numbers are the design's own examples,
// so a rewording that loses one changes what the user sees in the sidebar.
const single = bullet('Single evaluation');
const scan = bullet('Scan');
for (const title of ['`Career-ops eval (fetching)`', '`{Role}, {Company} (evaluating)`', '`{Role}, {Company} (CV)`',
  'end on plain `{Role}, {Company}`', '`{Role}, {Company} (on hold)`']) {
  check(`single evaluation title ${title}`, single.includes(title));
}
for (const title of ['`Career-ops scan (scanning)`', '`{remaining}/{found}`', '`Career-ops scan (checking, 5/15)`',
  '`Career-ops scan (evaluating, 3/15)`', '`Career-ops scan (none left, 0/15)`', '`Career-ops scan (3/15)`']) {
  check(`scan title ${title}`, scan.includes(title));
}
const foundRule = scan.match(/^  - `found` .*$/m)?.[0] ?? '';
check('`found` counts filtered postings and search hits, and stays fixed for the run',
  /scanner's filters/.test(foundRule) && /search hit/.test(foundRule) && /stays fixed for the run/.test(foundRule));
check('older inbox entries never move the scan counter',
  /removing one of them leaves `remaining` alone/.test(foundRule));
check('an evaluated posting stays counted', scan.includes('An evaluated posting stays counted.'));
check('one posting left switches to its own title', /When `remaining` reaches 1, switch to that job's `\{Role\}, \{Company\}`/.test(scan));

// Guardrails on how often and how long. Each lost one costs the user: a flood
// of approval prompts, a truncated sidebar, or a rename loop after a decline.
check('renames only when the stage or the count changes', /only when the stage or the count changes/.test(section));
check('titles stay under 60 characters', /under 60 characters, stage included/.test(section));
check('a declined or failed rename stops renaming for the rest of the run',
  /After a rename errors or is declined, stop renaming for the rest of the run/.test(section));
check('approval prompts are bounded by the decline rule and the opt-out',
  /\*\*Approval prompts:\*\*.*The first decline ends renaming for the run, and `session_title: off` ends it for good/.test(section));
check('an open agency question titles the role alone, never the agency',
  section.includes('While that question is open, the title is the role alone: `{Role} (on hold)`'));
check('the parent renames at the points it can see in a delegated run',
  /a worker cannot rename its parent's session, so the parent renames at the points it can see/.test(section));

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
check('delegated `scan` and `pipeline` workers return their counts to the parent',
  /Ask the worker to return both counts alongside its result/.test(delegated)
    && /Give a `pipeline` worker that follows a scan the scan's `found` and the URLs it counted/.test(delegated)
    && /A `scan` worker also returns the URLs of the postings still counted/.test(delegated)
    && /put the `found` and `remaining` definitions from \*\*Session Title\*\* in the worker prompt/.test(delegated));

// A worker gets the mode file, not the router, so the count hand-back has to
// be in the mode files too.
const scanCounts = read('modes/scan.md').match(/^\*\*Session title counts:\*\*.*$/m)?.[0] ?? '';
check('modes/scan.md ends its summary with the title counts and the counted URLs',
  scanCounts.includes('end the summary with `Title counts: {remaining}/{found}` and the URLs of the postings still counted'));
check('modes/scan.md defines `found` and `remaining` for a worker that never reads the router',
  /`found` is every posting that passed the scanner's filters/.test(scanCounts) && /`remaining` is `found` less each one removed/.test(scanCounts));
const pipelineMode = read('modes/pipeline.md').split('## Session title')[1]?.split('\n## ')[0] ?? '';
check('modes/pipeline.md keeps the scan counter and returns the title counts',
  pipelineMode.includes('**Session Title** rule') && pipelineMode.includes('`Title counts: {remaining}/{found}`')
    && /removal of a posting the scan counted/.test(pipelineMode)
    && /An `unreadable` posting the scan counted is an unconfirmed link: it stays in Pending, but it leaves this run's count, once/.test(pipelineMode)
    && /never renames anything/.test(pipelineMode));

// The point in the flow where the role and employer first become known.
// Each pointer must also keep the agency deferral, or it reads as "title at
// Step 0" for a `?` employer whose agency is not confirmed yet.
for (const mode of ['modes/auto-pipeline.md', 'modes/oferta.md']) {
  const pointer = read(mode).match(/^\*\*Session title:\*\*.*$/m)?.[0] ?? '';
  check(`${mode} points at the router rule`, pointer.includes('**Session Title** rule'));
  check(`${mode} names the progress titles`,
    pointer.includes('`Career-ops eval (fetching)`') && pointer.includes('`{Role}, {Company} (evaluating)`')
      && pointer.includes('`(on hold)`'));
  check(`${mode} defers an agency title to the confirmation handoff`,
    pointer.includes('`{Role}, via {Agency}`') && pointer.includes('**Agency confirmation handoff**'));
}

// validate-profile.mjs takes its known keys from the example; an opt-out key
// missing there would be reported as unknown on every profile that sets it.
const known = knownKeysFromExample(readFileSync(EXAMPLE_PATH, 'utf-8'));
check('`session_title` is a documented config/profile.yml key', known.includes('session_title'));
