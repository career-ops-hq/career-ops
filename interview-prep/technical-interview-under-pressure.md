# Handling Technical Problems Under Pressure (the anti-freeze protocol)

Written after the Perpl call with Alex Carreira (2026-07-17), where the 2h conversation went great but a 15-min technical problem (`withinTolerance`) triggered a freeze: mind blank, couldn't parse the problem, didn't know how to ask questions without "sounding stupid." This file exists so it never happens again. It's reusable for every future technical round (Perpl/Anton, Aave, all of them).

## The core reframe (read this first)

**Asking clarifying questions is not a weakness signal. At senior/staff level it is THE signal.** A junior grabs an ambiguous spec and starts coding. A senior stops and says "let me make sure I understand the problem before I write anything." Interviewers are *explicitly* watching for this. The engineer who asks "can you give me a concrete example?" scores **higher** than the one who silently guesses - and infinitely higher than the one who freezes.

You had the instinct exactly backwards: you thought asking would make you look weak, so you stayed silent and froze. **The silence is what costs points, not the question.** Alex was clearly a kind interviewer who *wanted* to help - the question would have been welcomed, not judged.

## Why freezing happens (so you can defuse it)

Freeze is a stress response, not a competence problem. Your working memory tries to hold the whole problem *plus* the pressure *plus* the fear of looking dumb, all at once, and it blanks. The fix is mechanical: **externalize immediately.** The moment you feel the blank, stop trying to think silently and start *moving* - talk, write, draw an example. Motion breaks freeze. A blank mind cannot think its way out of a blank; it can only act its way out.

## The ritual - run this EXACT sequence on every technical problem

Having a fixed opening move means under pressure you don't have to invent what to do. You just run the ritual. Memorize these five steps:

**1. Restate the problem in your own words.**
> "Let me restate to make sure I've got it: you want a function that returns true if `value` is close enough to `reference`, where 'close enough' is defined by `tolerancePer100K`. Is that right?"

This buys time, confirms understanding, and shows structured thinking. It's impossible to freeze while restating - the words are already there.

**2. Ask for / construct a concrete example.** This is the single most powerful move and the one you missed.
> "Can I work through a concrete example to anchor myself? Say `reference = 100` and `tolerancePer100K = 1000`. What should the function return for `value = 105`?"

You can even **propose your own example and ask them to confirm** - that's just as senior and doesn't require them to hand you anything:
> "Let me assume `tolerancePer100K = 1000` means a 1% band, so with `reference = 100`, values 99 to 101 pass. Tell me if I'm reading the units wrong."

Asking "what does `reference` represent here?" is a **completely normal, senior question.** Naming a variable you don't understand and asking about it is precisely what a careful engineer does. It is never stupid.

**3. State your approach in one sentence before coding.**
> "OK, my plan: compute the absolute difference between value and reference, compute the max allowed deviation as reference times tolerance over 100,000, and return whether the diff is within that. Sound reasonable?"

This lets the interviewer course-correct you *before* you write a line, and it converts a scary blank into a concrete first line of code.

**4. Narrate while you code.** Silence reads as freezing; narration reads as thinking. Even "let me think about overflow here for a second" is good - it tells them your brain is working. It is 100% fine to say **"give me a moment to think"** and have 10 seconds of quiet, *as long as you announced it.*

**5. Call out edge cases unprompted** - this is free senior points, especially in Solidity:
> "Edge cases I'd want to handle: underflow if value < reference, overflow when I multiply reference by tolerance so I'd widen to uint256, and what happens when reference is 0."

## The verbal toolkit (steal these phrases)

- "Before I start, let me make sure I understand the problem."
- "Can you give me an example input and the expected output?"
- "What does `X` represent here?"
- "Let me restate what I think you're asking..."
- "Let me pick an example and check my understanding: [example]. Is that right?"
- "Give me a moment to think about this." (then it's OK to be quiet)
- "My plan is [one sentence]. Does that match what you're looking for?"
- "Let me talk through the edge cases."

None of these sound stupid. All of them sound like a staff engineer.

## How to practice so the ritual is automatic

The ritual only saves you if it's reflex under stress. Reading it isn't enough. Before the next technical round:
- Do 5-10 timed problems **out loud, alone**, forcing yourself to run steps 1-5 every time, even on easy ones. The goal is muscle memory, not the answer.
- Do at least one **mock interview** (a friend, or me role-playing) where you're made slightly uncomfortable, so the ritual holds under mild pressure.
- Practice the physiological reset: when you feel the freeze, one slow breath + say "let me think for a second" out loud. That sentence is your circuit-breaker.

---

## Post-mortem: `withinTolerance` was easy (proof)

`withinTolerance(uint32 value, uint32 reference, uint32 tolerancePer100K)` -> is `value` within `tolerancePer100K` parts-per-100,000 of `reference`?

- **What `reference` means** (the thing that confused you): it's the **baseline** you measure deviation *against*. The tolerance is *relative to reference*. In a perps/oracle context: `reference` = index price, `value` = mark price, "is the mark within X of the index?"
- **`tolerancePer100K`** is a fixed-point percentage: `100_000` = 100%, `1_000` = 1%, `100` = 0.1%, `10` = 1 basis point. On-chain you can't use floats, so fractions get expressed as parts-per-something. This is the whole reason the param is named that way.

```solidity
function withinTolerance(uint32 value, uint32 reference, uint32 tolerancePer100K)
    internal
    pure
    returns (bool)
{
    // |value - reference|, guarding against underflow (reverts in 0.8+)
    uint256 diff = value >= reference
        ? uint256(value) - reference
        : uint256(reference) - value;

    // allowed deviation = reference * tolerance / 100_000
    // widen to uint256 FIRST so uint32 * uint32 can't overflow
    uint256 maxDeviation = (uint256(reference) * tolerancePer100K) / 100_000;

    return diff <= maxDeviation;
}
```

**The two things they were really testing** (classic Solidity):
1. **Overflow:** `reference * tolerancePer100K` in `uint32` would overflow and revert for realistic inputs. Widening to `uint256` before multiplying is the fix. This is the trap.
2. **Underflow:** `value - reference` reverts if `value < reference` in Solidity 0.8+, so you need the abs-diff pattern.
Bonus: integer division truncates, so `maxDeviation` rounds down (slightly stricter) - worth *mentioning* and asking if that rounding direction is acceptable.

**The one question that would have unlocked the whole thing:**
> "If `reference = 100` and `tolerancePer100K = 1000`, that's a 1% band, so `value` from 99 to 101 passes and 102 fails - right?"

That single sentence resolves what `reference` is, that tolerance is relative to it, and the units - the exact three things that blanked you. You didn't lack the ability. You lacked the *permission you give yourself to ask.* Give yourself that permission. It's the senior move.
