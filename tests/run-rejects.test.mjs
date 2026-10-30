// tests/run-rejects.test.mjs — runRejects() passes only the intended rejection.
//
// A check that a script refuses bad input used to be `run(...) === null`, and
// run() returns null for every failure. An uncaught exception exits 1 just like
// a deliberate refusal, a timeout kills the child with a signal, and both read
// as "correctly rejected". Each child below fails in one of those ways, carrying
// the expected message, so only the status/signal/stack checks can tell them
// apart from the clean refusal.
//
// The children set `exitCode` rather than calling exit() because runDiscovered()
// refuses a suite whose source matches /\bprocess\.exit\s*\(/, string literals
// included.

import { pass, fail, runRejects, lastRunFailure } from './helpers.mjs';

const NODE = process.execPath;
const QUIET = { stdio: ['pipe', 'pipe', 'pipe'] };
const MSG = 'No URL provided.';

{
  const ok = runRejects(NODE, ['-e', `console.error(${JSON.stringify(MSG)}); process.exitCode = 1;`], { stderr: MSG }, QUIET);
  if (ok) pass('runRejects() accepts a clean exit-1 refusal carrying the message');
  else fail(`runRejects() refused a clean refusal: ${JSON.stringify(lastRunFailure())}`);
}

{
  const ok = runRejects(NODE, ['-e', `console.error(${JSON.stringify(MSG)}); process.exitCode = 2;`], { stderr: MSG, status: 2 }, QUIET);
  if (ok) pass('runRejects() honours an explicit expected status');
  else fail(`runRejects() refused an exit-2 refusal expected as status 2: ${JSON.stringify(lastRunFailure())}`);
}

{
  const ok = runRejects(NODE, ['-e', `console.error(${JSON.stringify(MSG)}); process.exitCode = 2;`], { stderr: MSG }, QUIET);
  if (!ok) pass('runRejects() rejects an exit status other than the expected one');
  else fail('runRejects() accepted exit 2 when status 1 was expected');
}

{
  // Node exits 1 for an uncaught exception, so the status alone cannot catch this.
  const ok = runRejects(NODE, ['-e', `throw new TypeError(${JSON.stringify(MSG)});`], { stderr: MSG }, QUIET);
  const f = lastRunFailure();
  if (f?.status === 1 && f.stderr.includes(MSG)) pass('the crash child exits 1 with the message on stderr (premise)');
  else fail(`crash child premise broken: ${JSON.stringify(f)}`);
  if (!ok) pass('runRejects() rejects an uncaught exception even when its text matches');
  else fail('runRejects() counted an uncaught exception as the intended rejection');
}

{
  const ok = runRejects(
    NODE,
    ['-e', `console.error(${JSON.stringify(MSG)}); setTimeout(() => {}, 10000);`],
    // status: null matches the killed child's status, so only the signal guard
    // can reject it.
    { stderr: MSG, status: null },
    { ...QUIET, timeout: 500 },
  );
  const f = lastRunFailure();
  if (f?.signal && f.status === null && f.stderr.includes(MSG)) pass('the timeout child is killed by a signal with the message on stderr (premise)');
  else fail(`timeout child premise broken: ${JSON.stringify(f)}`);
  if (!ok) pass('runRejects() rejects a child killed by the timeout');
  else fail('runRejects() counted a timed-out child as the intended rejection');
}

{
  const ok = runRejects(NODE, ['-e', 'console.error("something else"); process.exitCode = 1;'], { stderr: MSG }, QUIET);
  if (!ok) pass('runRejects() rejects a refusal with the wrong message');
  else fail('runRejects() accepted a refusal whose stderr lacks the expected message');
}

{
  const ok = runRejects(NODE, ['-e', `console.error(${JSON.stringify(MSG)});`], { stderr: MSG }, QUIET);
  if (!ok) pass('runRejects() rejects a command that succeeded');
  else fail('runRejects() accepted a command that exited 0');
}

{
  const ok = runRejects(NODE, ['-e', `console.error("Invalid value: abc"); process.exitCode = 1;`], { stderr: /Invalid value: "?abc/ }, QUIET);
  if (ok) pass('runRejects() matches a RegExp message');
  else fail(`runRejects() refused a refusal matching its RegExp: ${JSON.stringify(lastRunFailure())}`);
}
