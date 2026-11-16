// A rate limit recorded while batch-runner.sh waits for a free slot must hold
// the next offer back.
//
// This is the race behind the occasional [2,1,1] in
// batch-runner-default-parallel.test.mjs: the wait loop checked for the
// throttle before its sleep and not after, so a 429 recorded during that sleep
// still let the next offer start at PARALLEL=3. Waiting for that under load is
// a coin toss, so this suite places it: in a copy of the runner, the throttle
// is recorded just before the loop's sleep, once a slot has freed, and every
// launch logs PARALLEL and whether the throttle exists. The anchors are
// checked, so a reshaped loop fails here instead of passing without the hook.
import { pass, fail } from './helpers.mjs';
import { SRC, runBatch } from './helpers/batch-runner-fixture.mjs';

const sleepAnchor = '        sleep 1\n      done';
const launchAnchor = '      process_offer "${pending_ids[$i]}" "${pending_urls[$i]}" "${pending_sources[$i]}" "${pending_notes[$i]}" &';
const anchorsFound = SRC.split(sleepAnchor).length === 2 && SRC.split(launchAnchor).length === 2;

if (!anchorsFound) {
  fail("the wait loop's sleep or the worker launch is not where this suite expects it in batch-runner.sh, so the race cannot be placed");
} else {
  const src = SRC
    .replace(sleepAnchor, '        if (( running < 3 )) && [[ ! -f "$THROTTLE_FILE" ]]; then : > "$THROTTLE_FILE"; fi\n' + sleepAnchor)
    .replace(launchAnchor, '      echo "${pending_ids[$i]} $PARALLEL $([[ -f "$THROTTLE_FILE" ]] && echo throttled || echo free)" >> "$FIXTURE_DIR/launches.log"\n' + launchAnchor);
  // No 429 from the fake CLI: the hook is the only source of the throttle.
  // Four offers: three fill the slots, and the fourth is the launch in question.
  const { stdout, launches } = runBatch({ offers: 4, src, rateLimitFirst: false });
  const log = launches.join('; ');
  const late = launches.filter((l) => / throttled$/.test(l) && !/ 1 throttled$/.test(l));
  // The launch log first: it names the defect, where the stdout check below
  // would only say that the drop to one worker was never announced.
  if (late.length === 0) pass('no offer starts at PARALLEL > 1 once a rate limit has been recorded');
  else fail(`offers started at PARALLEL > 1 after the throttle was recorded (launch log: ${log})`);
  if (launches.some((l) => / 1 throttled$/.test(l))) pass('the next offer starts on one worker after the throttle');
  else fail(`no offer started after the throttle (launch log: ${log})`);
  if (/Rate limited: running the remaining offers on 1 worker/.test(stdout)) pass('the drop to one worker is announced');
  else fail(`the drop to one worker was never announced:\n${stdout}`);
}
