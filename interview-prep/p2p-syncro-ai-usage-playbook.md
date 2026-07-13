# P2P Syncro Coding Round - AI-Usage Playbook (the "Coding With AI" half)

## What they're actually testing

Not "can you prompt an AI". They're testing whether you use AI **like a senior engineer**: as a force multiplier you keep under your own judgment. Two signals dominate:

1. **Do you drive, or does the AI drive you?** Senior = you decide the algorithm, the data structures, the interface; AI fills in the mechanical parts.
2. **Do you catch the AI's mistakes?** AI-generated Rust often has subtle bugs: wrong bounds, off-by-one, an `unwrap` that panics, a borrow that won't compile, an O(n^2) hidden in a `.contains()` inside a loop. Catching these live is the strongest senior signal in this half.

A junior pastes AI output and hopes. A senior treats AI output as a **draft from a fast but unreliable colleague** - reviewed before it's trusted.

## The loop to demonstrate (say these steps out loud)

1. **Restate the problem + constraints** in your own words. ("So we've got a stream of up to N items, we need the top-K by score, and it should handle updates.")
2. **State your approach + Big-O BEFORE touching the AI.** ("I'll use a min-heap of size K, that's O(n log K) time, O(K) space.") This makes clear the thinking is yours.
3. **Delegate the mechanical part** while narrating the core idea yourself. ("Let me have the assistant scaffold the struct and the BinaryHeap boilerplate while I keep the comparison logic in my head.")
4. **Review every generated line.** Read it aloud or point at it: "This looks right, but it's using `Vec::remove(0)` which is O(n) - I'd swap that for a `VecDeque`." Even when it's correct, *say* you checked.
5. **Run the tests, iterate.** Let the test loop, not the AI, be the source of truth.
6. **State what you verified and why you trust it.** ("Tests pass for the empty case, single element, and duplicates - I'm confident in it.")

## What to delegate to AI

- **Boilerplate**: struct/enum defs, trait impls (`Ord`/`PartialOrd` for a heap), `Default`, test scaffolding, sample-input generators.
- **Syntax recall you'd otherwise stall on**: "min-heap in Rust" -> `BinaryHeap<Reverse<T>>`; the exact signature of `slice::windows` / `chunks`; `entry().or_insert_with()`.
- **Fast compiler-error triage**: paste an E0502 borrow error, get the fix explained - then apply it yourself.
- **Edge-case brainstorming**: "what edge cases am I missing for this sliding-window solution?" - a legit senior use of a second brain.
- **Generating tests**: unit tests for boundaries, or a quick property-style test.

## What to OWN (never visibly outsource)

- **Problem decomposition + algorithm choice.** The interviewer wants to see *your* reasoning here. If you ask the AI "how do I solve this", you've handed them the answer to the thing they're evaluating.
- **Complexity analysis.** State Big-O yourself, unprompted, for both your approach and any alternative. Don't ask the AI to compute it in view.
- **Data-structure tradeoffs.** "Vec vs VecDeque vs HashMap here" is exactly the judgment they're paying for.
- **Final correctness call.** You decide the code is right, backed by tests you understand - not because the AI said so.

## Anti-patterns (these read as junior)

- **Silent dead air** while the AI generates and you stare. Narrate continuously; the AI working is not an excuse to stop talking.
- **Paste-and-pray** - accepting a block of generated code without reading it. Even if it's correct, you look like you got lucky.
- **Letting the AI pick the algorithm.** If your first prompt is "solve this problem", you've failed the main test.
- **Over-asking for trivia you should know cold** - `for i in 0..n`, `vec.iter().map()`, basic match. Asking AI for these signals shaky fundamentals. Know the basics; delegate the tedium.
- **Fighting the AI's style** instead of your own. If it generates something you wouldn't write, change it and say why - don't just accept a foreign style into "your" solution.

## Verbatim narration lines (adapt, don't robotically recite)

- "Before I bring in the assistant, my plan is X, which is O(n log n) time and O(n) space because..."
- "I'll let it scaffold the struct and derive macros - the interesting part is the update logic, which I'll write myself."
- "Let me read what it generated... this is fine, except this line does a linear scan inside the loop, so I'll replace it with a HashMap lookup to keep it O(n)."
- "I don't fully trust this yet - let me add a test for the empty and single-element cases before I move on."
- "That compiles and passes, and I've read through it, so I'm confident. If I had more time I'd also fuzz it."

## Tooling logistics (decide + rehearse Day 2)

- **Pick ONE primary AI surface** so you don't fumble window-switching on camera:
  - Inline completion (Copilot/Supermaven-style) - fast for boilerplate, stays in the editor.
  - A chat window (Claude/ChatGPT/Cursor chat) - better for "review this / what am I missing / explain this error".
- Recommended combo: inline completion for typing speed + one chat tab for reasoning. Rehearse both in Mock #3 so switching is muscle memory.
- Have the chat tab already open in your fresh browser profile before the call (see env-setup doc). Don't log in on camera.
- If they specify a particular tool (e.g. "use Cursor"), practice in that exact tool Day 2-3.

## The meta-move

At least once, **overrule the AI out loud** with a correct reason. "The assistant suggested a `BTreeMap` here, but I only need point lookups, not ordering, so a `HashMap` is the right call - O(1) vs O(log n)." One clean moment like that does more for your senior signal than a perfect solution.
