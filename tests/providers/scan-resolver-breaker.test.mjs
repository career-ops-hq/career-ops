// tests/providers/scan-resolver-breaker.test.mjs — parallelEach honors an
// abort predicate, so a resolver outage can stop a sweep instead of feeding it.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nScan — resolver circuit breaker');

try {
  const { parallelEach } = await import(
    pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href
  );

  // --- parallelEach stops pulling work once shouldStop flips ---
  {
    const items = Array.from({ length: 500 }, (_, i) => i);
    const processed = [];
    let stop = false;

    await parallelEach(items, 20, async (item) => {
      processed.push(item);
      if (processed.length >= 40) stop = true;
    }, null, () => stop);

    // Workers already in flight may finish their current item, so allow the
    // in-flight batch to land — but nothing like the full 500.
    if (processed.length >= 40 && processed.length < 100) {
      pass(`parallelEach stopped early on shouldStop (${processed.length}/500 processed)`);
    } else {
      fail(`parallelEach processed ${processed.length}/500 — expected an early stop`);
    }
  }

  // --- absent predicate keeps the old behaviour ---
  {
    const items = Array.from({ length: 50 }, (_, i) => i);
    let count = 0;
    await parallelEach(items, 5, async () => { count++; });

    if (count === 50) {
      pass('parallelEach without a predicate still processes every item');
    } else {
      fail(`parallelEach processed ${count}/50 without a predicate`);
    }
  }

  // --- the checkpoint callback still fires, and still reports resumeAt ---
  // parallelEach already carried a 4th argument (onItemDone) driving
  // checkpoint/--resume. shouldStop is a 5th, so that contract is unchanged.
  {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const seen = [];
    await parallelEach(items, 4, async () => {}, ({ done, resumeAt }) => {
      seen.push({ done, resumeAt });
    });

    const monotonic = seen.every((s, i) => i === 0 || s.done === seen[i - 1].done + 1);
    if (seen.length === 30 && monotonic && seen[29].resumeAt === 30) {
      pass('onItemDone still fires once per item with a monotonic done count and final resumeAt');
    } else {
      fail(`onItemDone contract broken: n=${seen.length} monotonic=${monotonic} last=${JSON.stringify(seen[seen.length - 1])}`);
    }
  }

  // --- a stopped run still reports progress, so --resume stays correct ---
  {
    const items = Array.from({ length: 200 }, (_, i) => i);
    let processed = 0;
    let stop = false;
    let lastResumeAt = -1;

    await parallelEach(items, 10, async () => {
      processed++;
      if (processed >= 25) stop = true;
    }, ({ resumeAt }) => { lastResumeAt = resumeAt; }, () => stop);

    // Everything below resumeAt finished, so resuming there loses no work.
    if (lastResumeAt > 0 && lastResumeAt <= processed) {
      pass(`a stopped sweep still reports a usable resumeAt (${lastResumeAt} <= ${processed} processed)`);
    } else {
      fail(`resumeAt unusable after stop: resumeAt=${lastResumeAt} processed=${processed}`);
    }
  }
} catch (e) {
  fail(`resolver breaker tests threw: ${e.message}`);
}
