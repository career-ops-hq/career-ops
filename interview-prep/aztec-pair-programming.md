# Aztec Pair Programming Interview Prep

**When:** Mon May 11, 2026, 12:00 Europe/Bucharest (~24h from now)
**With:** Alvaro Rodriguez Villalba
**Duration:** ~1 hour, TypeScript likely
**Prompt arrives:** ~11:00 Bucharest (1h before)

---

## What is actually being tested

Solving the problem is table stakes. AI can solve it. Differentiation is **reasoning, communication, and engineering hygiene**. Specifically:

- Problem decomposition under uncertainty
- Clarifying questions BEFORE coding
- Verbal trade-off articulation while coding
- Code organization (naming, types, structure)
- Testing instincts
- How you handle being stuck (collaborate vs. freeze)
- Self-awareness ("I don't know X, here's what I'd verify")

**The trap:** rush to code -> freeze -> silence. A 70% solution with rich narration beats a 100% solution delivered silently.

---

## Mental framework: UPBVI

Five phases. Each phase has: what to do / what to say / what to ask.

### 1. UNDERSTAND (~5-10 min, no code yet)

**Do:** Restate the problem in your own words. Identify inputs, outputs, invariants, constraints, performance expectations.

**Say:**
- "Let me restate to confirm I have it right: the input is X, the output is Y, the constraint is Z."
- "Edge cases I want to clarify: empty input, duplicates, malformed data, very large N."
- "Performance expectations: are we optimizing for time, memory, or readability?"

**Ask Alvaro:**
- Edge cases: empty? null? duplicates? out-of-order?
- Scale: how big is N? does it need to be streamed?
- Failure mode: throw? return null? log?
- Output shape if ambiguous

**Artifact:** A list of inputs / outputs / edge cases on screen, agreed with Alvaro.

### 2. PLAN (~5-10 min)

**Do:** Identify 2-3 approaches. Pick one with explicit trade-offs. Sketch types and data structures.

**Say:**
- "Two approaches: A uses [structure] -> O(...) but costs [memory/complexity]. B is slower but simpler. I'll start with A because [reason]."
- "Modeling as: [interface], [interface]. State lives in [Map/Set/Array] keyed by [...]."
- "I'll defer [aspect]. If there's time we tighten it; if not, we discuss it."

**Ask:** "Does this approach match what you'd expect, or would you push me elsewhere?"

**Artifact:** Type signatures and module breakdown sketched (in comments or skeleton code).

### 3. BUILD (~25-30 min)

**Do:** Write iteratively. Get a slow correct version. Narrate continuously.

**Say:**
- "Starting with the happy path. Wiring up the type and a stub..."
- "Now handling [edge case]. Cleanest way is..."
- "Extracting this into a helper because [reason]."
- "Two ways to write this loop - going with [X] for readability."

**Tactics:**
- Define types FIRST (interfaces/aliases). Forces clarity before code.
- Prefer pure functions (easier to reason about and test).
- Names matter. No `i`, `tmp`, `data`. Be specific.
- Stuck on syntax? "I'd normally double-check the docs - let me write intent and we'll fix the syntax."

**Don't:**
- Premature optimization.
- Clever one-liners.
- Generics, decorators, conditional types. Keep TS boring.

### 4. VERIFY (~10-15 min)

**Do:** Write tests. Walk through inputs. Confirm edge cases.

**Say:**
- "Running through the cases we identified. Empty -> []. One element -> [...]."
- "Edge case: what if X overflows Y? Tracing it..."
- "I'd add a test for [property], but in interest of time let me describe what I'd test."

**With vitest set up:** actually run tests. Green tests > discussed tests.

### 5. ITERATE (~5 min if time)

**Do:** Reflect on what you'd improve given more time.

**Say:**
- "Things I'd revisit: [type tightening, error handling, perf]. Deferred them because [...]."
- "If this scaled 100x, I'd switch to [...]."
- "Production: I'd add logging, metrics, boundary validation."

This shows seniority. Knowing what's missing without doing it is a senior signal.

---

## The 1-hour prep window (11:00 -> 12:00)

| Min | Phase |
|-----|-------|
| 00-10 | Read prompt 3x. Skim, then identify I/O + edges, then identify what's NOT specified |
| 10-25 | Pseudocode + data structure choice. NO TypeScript yet |
| 25-40 | Sketch type signatures (interface/type) on paper |
| 40-50 | List 5 test cases: happy, empty, single, max-size, malformed |
| 50-55 | Open scratch project, run vitest watch, confirm green |
| 55-60 | Water, restroom, breathe, login 5 min early |

**DO NOT pre-solve the entire problem.** Alvaro wants live reasoning. Pre-solving makes you sound rehearsed and limits recovery if the problem shifts mid-call.

---

## TONIGHT checklist (do before bed)

### 1. Set up the scratch project. Verify it works.

```bash
mkdir -p ~/aztec-pair && cd ~/aztec-pair
npm init -y
npm i -D typescript tsx vitest @types/node
npx tsc --init --target es2022 --module nodenext --moduleResolution nodenext --strict
mkdir src
```

Edit `package.json` scripts:

```json
"scripts": {
  "test": "vitest",
  "run": "tsx src/index.ts"
}
```

Create `src/index.ts`:

```typescript
export function add(a: number, b: number): number {
  return a + b;
}
```

Create `src/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { add } from './index';

describe('add', () => {
  it('adds two numbers', () => {
    expect(add(1, 2)).toBe(3);
  });
});
```

Run `npm test`. Confirm green.

### 2. Dry-run the scaffold once

Solve a tiny problem (two-sum, fibonacci, balanced parentheses) start to finish in this scratch repo. Time yourself. Goal: muscle memory for create file -> write fn -> write test -> run -> green.

### 3. Skim the TS cheat sheet below

Don't memorize. Just refresh recall.

### 4. Set up the call environment

- Zoom / Meet / whatever they sent: tested, logged in, audio + camera + screenshare confirmed
- Editor: readable font (16+), close other tabs/Slack
- Water + paper + pen
- Quiet space confirmed

### 5. Sleep early

Real edge: a rested brain. Don't pull a late prep night.

---

## TypeScript 80/20 cheat sheet

```typescript
// Types
interface User { id: string; name: string; age?: number }
type Status = 'pending' | 'done' | 'failed'
type Pair<T> = [T, T]

// Collections
const arr: number[] = [1, 2, 3]
const map = new Map<string, number>()
map.set('x', 1); map.get('x'); map.has('x'); map.delete('x')
const set = new Set<number>()
set.add(1); set.has(1)

// Iteration
for (const [k, v] of map) { /* k, v are key, value */ }
for (const v of set) {}
arr.map(x => x * 2)
arr.filter(x => x > 0)
arr.reduce((acc, x) => acc + x, 0)
arr.find(x => x > 5)
arr.some(x => x > 0); arr.every(x => x > 0)

// Async
async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`/users/${id}`)
  return res.json() as Promise<User>
}

// Destructuring
const { name, age = 0 } = user
const [first, ...rest] = arr

// Nullish vs falsy
const x = input ?? 'default'   // null/undefined only
const y = input || 'default'   // any falsy (0, '', false too)

// Optional chaining
user?.address?.zip

// Class
class Queue<T> {
  private items: T[] = []
  push(item: T) { this.items.push(item) }
  pop(): T | undefined { return this.items.shift() }
  get size() { return this.items.length }
}

// Type guards
function isUser(x: unknown): x is User {
  return typeof x === 'object' && x !== null && 'id' in x
}

// Common gotchas
// === / !== always (never == / !=)
// undefined vs null: prefer undefined for "absent"
// Array.from(map.keys()) to materialize
// Object.entries(obj) for k/v iteration over plain objects
```

**Avoid (high regret, low value):**
- Conditional types, mapped types
- Fancy generics beyond `<T>`
- Decorators
- `as any` without saying so

---

## Pair programming verbal patterns

### Opening

- "Let me restate to confirm I have the problem right..."
- "A few things I want to clarify before I write code..."
- "My approach is X because Y. Does that match what you'd want to see?"

### While coding

- "Starting with the type signature so we have a contract..."
- "I'll write a slow correct version first, then optimize."
- "Choosing [structure] over [other] because [trade-off]."
- "Handling [edge] by [strategy] for now - revisit-able."

### When stuck

- "Let me think out loud." Then actually think out loud.
- "Two options: X or Y. X gives [...]. Y gives [...]. Trying X."
- "Second-guessing the data structure. Worth revisiting now or push through?"
- "Hitting a TS type issue. In production I'd dig in - for now loosening and revisiting."
- "What's your intuition - am I on the right path?"

### When you don't know

- "More on the Solidity side day-to-day, so let me double-check [syntax]."
- "Not 100% on this API. Writing intent, we'll fix the call."
- "Normally a quick docs check. Push through with best guess?"

### Recovering from a mistake

- "Wait, missed an edge case. Backing up."
- "This won't work because [...]. Rethinking for a moment."
- "I want to revise. Can I take a minute to redraft?"

### Closing

- "More time, I'd [...]. Prioritized [done] because [...]."
- "What would you have done differently?"
- "Things I'd test that I didn't get to: [...]."

---

## Common pitfalls (avoid)

1. **Silent thinking.** No talk = no signal. Talk through everything.
2. **Pretending to know.** Costlier than admitting a gap.
3. **Skipping clarification.** Half the senior signal lives in the questions you ask.
4. **Premature optimization.** Correct first, then improve.
5. **Refusing help.** When Alvaro nudges, take it. Pride is expensive.
6. **No types.** Untyped TS undermines the language and signals laziness.
7. **No tests.** Even one test signals quality.
8. **Defensive vs. curious.** Treat questions as collaboration, not critique.

---

## Likely problem domains (educated guesses)

Aztec context suggests:
- Data transformation (parsing, normalizing structured data, encoding)
- Graph/tree (Merkle ops, dependency resolution, BFS/DFS)
- State machine (slasher voting, queue scheduler)
- Event/concurrency (pub/sub, simple event handler)
- Number/math (fee calc, share allocation, unit conversion)

If protocol-flavored -> lean on Solidity intuition. You have an edge.
If pure CS -> stay calm, use UPBVI.

Either way: the framework holds.

---

## Final note

The hour before is for thinking, not coding. The hour during is for thinking aloud, not impressing. Alvaro has done many of these - they spot rehearsal instantly. Be real. Be calm. Verbalize.

Worst realistic case: you don't finish. That's fine if reasoning was strong.
Best realistic case: you finish with time to discuss extensions.

The bar is engineering judgment, not TS syntax. You've shipped real EVM systems, authored an EIP, built SabVM. Bring that.
