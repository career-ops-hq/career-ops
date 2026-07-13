# micro1 / Zara — JS/TS + Fullstack fundamentals (interview prep)

**Interview:** AI conversation + coding exercise, up to 48 min.
**Focus areas (stated):** Fullstack Fundamentals · JS/TS Proficiency · Problem Solving & Debugging · Ownership & Learning Velocity.
**Last date:** 2026-05-27 14:25.

How to use this doc: full read once tonight (~25 min). Skim §8 cram card 10 min before the call.

---

## 1. JS vs TS — the single most important mental model

- **TS = JS + a static type checker.** It's a superset. Every valid JS is valid TS.
- **TS erases at compile.** The compiler (`tsc`) drops the types and emits plain JS. **At runtime there is no TS** — no type info, no checks, nothing. If someone says "the type system catches that at runtime", they're wrong.
- **What TS adds:** static types, generics, interfaces/aliases, narrowing, editor tooling (autocomplete, refactors), structural type checks at compile time, declaration files for libraries.
- **What TS doesn't change:** the runtime is still JS — same coercion rules, same `this`, same prototype chain, same event loop, same Promise semantics. **Knowing TS without knowing JS is a footgun.**
- **Why teams pick it:** catches a class of bugs early, makes refactors cheap, makes APIs self-documenting. Trade-off: build step, type ceremony, sometimes fighting the compiler.

If asked "what is TS in one line": *a compile-time type system on top of JS that erases to plain JS at runtime.*

---

## 2. JS theory — the gaps to close

### Types & equality

- **Primitives:** `string`, `number`, `boolean`, `null`, `undefined`, `symbol`, `bigint`. Everything else is an **object** (arrays, functions, dates, regex, plain objects).
- `typeof null === "object"` — historical bug, baked in.
- `typeof []  === "object"` — arrays are objects; use `Array.isArray(x)`.
- `typeof function(){} === "function"`.
- **`==` does coercion, `===` doesn't. Always use `===`.** Traps:
  - `null == undefined` is `true` (only thing `==` is allowed for, but still avoid).
  - `[] == false` → `true`. `"" == 0` → `true`. `"0" == false` → `true`.
  - `NaN === NaN` → `false`. Use `Number.isNaN(x)`.

### Variables & scope

- `var` — function-scoped, hoisted, **initialized to `undefined`** before the line is reached. Avoid.
- `let`/`const` — block-scoped, hoisted but in the **TDZ** (Temporal Dead Zone): touching them before the declaration throws `ReferenceError`.
- **Default to `const`.** `const` means the binding doesn't rebind — the object it points to can still mutate (`const obj = {}; obj.x = 1` is fine).
- `let` only when you reassign.

### Hoisting

- Declarations move to the top of the scope; **initializations do not**.
- `function foo(){}` declarations are fully hoisted (callable above their definition).
- `const foo = () => {}` / `function expressions` — only the variable binding hoists (and TDZ for `const`/`let`).

### Closures

- A closure = function + the lexical environment it was defined in. Inner function "remembers" outer variables by reference, not by value.
- Canonical interview snippet:
  ```js
  for (var i = 0; i < 3; i++) setTimeout(() => console.log(i), 0);
  // prints 3, 3, 3  (one shared `i`, hoisted)

  for (let i = 0; i < 3; i++) setTimeout(() => console.log(i), 0);
  // prints 0, 1, 2  (fresh `i` per iteration)
  ```
- Closures power: data privacy (factory functions), partial application, memoization, React `useState` setter capture.

### `this` — 4 binding rules (precedence high to low)

1. **`new` binding** — `new Foo()` → `this` is the new instance.
2. **Explicit** — `fn.call(obj, ...)`, `fn.apply(obj, [...])`, `fn.bind(obj)`.
3. **Implicit** — `obj.fn()` → `this` is `obj`. *Losing the receiver*: `const f = obj.fn; f()` → `this` is `undefined` (strict) or `globalThis`.
4. **Default** — bare `fn()` → `undefined` in strict mode, `globalThis` otherwise.

**Arrow functions have no own `this`** — they capture from the enclosing lexical scope. `bind/call/apply` can't change it. This is why arrow callbacks "just work" in class methods.

### Prototypes & classes

- JS inheritance is **prototypal**, not classical. `class` is sugar.
- Every object has an internal `[[Prototype]]` link (`Object.getPrototypeOf(x)`, legacy `__proto__`).
- Property lookup walks the prototype chain until found or `null`.
- `class Foo { bar(){} }` — `bar` lives on `Foo.prototype`, not on each instance.
- `instanceof` walks the chain.

### Event loop (key for async questions)

- **Call stack** — synchronous execution.
- **Microtask queue** — `Promise.then/catch/finally` callbacks, `queueMicrotask`, `MutationObserver`. Drains **fully** between every macrotask.
- **Macrotask queue** — `setTimeout`, `setInterval`, I/O, UI events. One per loop tick.
- Rule of thumb: a `Promise.resolve().then(...)` runs **before** a `setTimeout(..., 0)` scheduled before it.

  ```js
  console.log("A");
  setTimeout(() => console.log("B"), 0);
  Promise.resolve().then(() => console.log("C"));
  console.log("D");
  // A, D, C, B
  ```

### Promises & async/await

- A Promise has 3 states: pending → fulfilled or rejected. Settled = fulfilled-or-rejected.
- `await p` unwraps the value or throws if rejected. **`try/catch` is the right error handler** in async functions.
- Combinators:
  - `Promise.all([...])` — resolves when **all** resolve; **fails fast** on first reject.
  - `Promise.allSettled([...])` — waits for all; never rejects; returns `{status, value|reason}[]`.
  - `Promise.race([...])` — first to settle (fulfill or reject) wins.
  - `Promise.any([...])` — first to **fulfill** wins; rejects only if all reject (`AggregateError`).
- Don't `await` in a `forEach` and expect sequential — `forEach` ignores the returned Promise. Use `for...of` for sequential, or `Promise.all(items.map(...))` for parallel.

---

## 3. TS essentials

### Structural typing

- Two types with the **same shape** are assignable. No `implements` needed.
  ```ts
  type Point = { x: number; y: number };
  const p: Point = { x: 1, y: 2, z: 3 }; // error on object literal (excess property check)
  const obj = { x: 1, y: 2, z: 3 };
  const p2: Point = obj; // OK — extra props allowed via aliasing
  ```

### `type` vs `interface`

- **`interface`** — declaration-merging, can `extends`. Default for object shapes / public API contracts.
- **`type`** — composes with unions, intersections, conditionals, mapped/utility types. Use for everything that isn't a plain object shape.
- Both are erased at compile.

### Generics

```ts
function identity<T>(x: T): T { return x; }
function first<T>(arr: T[]): T | undefined { return arr[0]; }
function pluck<T, K extends keyof T>(obj: T, key: K): T[K] { return obj[key]; }
```

- `extends` adds a constraint. `K extends keyof T` is the common pattern for "key of this object".

### Narrowing

- TS narrows types as you check them:
  ```ts
  function fmt(x: string | number) {
    if (typeof x === "string") return x.toUpperCase(); // narrowed to string
    return x.toFixed(2);                                // narrowed to number
  }
  ```
- `instanceof`, `in` operator, equality on literal values all narrow.
- **Discriminated unions** — the workhorse pattern:
  ```ts
  type Shape =
    | { kind: "circle"; r: number }
    | { kind: "square"; side: number };

  function area(s: Shape): number {
    switch (s.kind) {
      case "circle": return Math.PI * s.r * s.r;
      case "square": return s.side * s.side;
    }
  }
  ```
- User-defined type guard: `function isCat(a: Animal): a is Cat { return "meow" in a; }`.

### Must-know utility types

- `Partial<T>` — all props optional.
- `Required<T>` — all props required.
- `Pick<T, K>` — keep only keys `K`.
- `Omit<T, K>` — drop keys `K`.
- `Record<K, V>` — `{ [k in K]: V }`.
- `ReturnType<F>` — return type of a function.
- `Awaited<T>` — unwrap a `Promise<X>` to `X`.
- `Readonly<T>` — make all props readonly.

### `unknown` vs `any`

- `any` — opt out of typing. Avoid.
- `unknown` — "I don't know yet" — you **must** narrow before using. Right type at I/O boundaries (`JSON.parse`, fetch responses).

### Common gotchas

- `?.` optional chaining: `a?.b?.c` short-circuits on `null`/`undefined`.
- `??` nullish coalescing: `x ?? y` — `y` only if `x` is `null` or `undefined`. Unlike `||`, which falls back on any falsy (`0`, `""`, `false`).
- `as const` — narrows literals: `const x = "a" as const` has type `"a"`, not `string`.
- `satisfies` (TS 4.9+) — type-check without widening: `const cfg = { ... } satisfies Config`.

---

## 4. Fullstack frame

### HTTP

| Verb   | Semantics                | Idempotent? |
|--------|---------------------------|-------------|
| GET    | read                     | yes         |
| POST   | create (or non-idempotent action) | no |
| PUT    | full replace             | yes         |
| PATCH  | partial update           | usually     |
| DELETE | remove                   | yes         |

- Status code families:
  - **2xx** ok — `200 OK`, `201 Created`, `204 No Content`.
  - **3xx** redirect — `301`, `302`, `304 Not Modified`.
  - **4xx** client — `400 Bad Request`, `401 Unauthorized` (not logged in), `403 Forbidden` (logged in, can't access), `404 Not Found`, `409 Conflict`, `422 Unprocessable Entity`, `429 Too Many Requests`.
  - **5xx** server — `500 Internal`, `502 Bad Gateway`, `503 Unavailable`, `504 Gateway Timeout`.
- 401 vs 403 is the classic gotcha.

### REST conventions

- Resource-oriented URLs: `/users/123/orders/45`. Verbs in HTTP, not in URL (`POST /users`, not `POST /createUser`).
- Plural nouns for collections. Nest sparingly.
- Use query params for filtering/sorting/pagination: `/users?role=admin&page=2`.

### APIs — design + consumption

The transferable framing: you've integrated Chainlink oracles, the Sablier SDK, and Solana RPC clients. That's API-consumption experience even if the word "REST" wasn't on the surface. Land that if asked.

**Request/response shape**
- `Content-Type: application/json` for JSON bodies. The server uses this header to parse.
- `Accept: application/json` says what the client wants back.
- Body: usually JSON; can be `multipart/form-data` for file uploads or `application/x-www-form-urlencoded` for old-school forms.
- Response: status code (semantics) + body (data or error). Don't put error info in a `200` body with a `success: false` flag — use the right status code.

**Structured error responses** — pick a shape, stick to it across the API:
```json
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "No user with id 42",
    "details": { "id": 42 }
  }
}
```

**Authentication**
- **API key** — `Authorization: Bearer <key>` or `X-API-Key: <key>`. Simple, long-lived. Avoid putting in URL query params (leaks to logs).
- **JWT (JSON Web Token)** — self-contained signed token. Three parts: `header.payload.signature`. Server verifies signature, reads claims (`sub`, `exp`, `iat`). Stateless: no server-side session lookup needed. **Don't put secrets in the payload — it's base64, not encrypted.**
- **Session cookies** — server stores session, client sends cookie. Stateful. Needs `HttpOnly`, `Secure`, `SameSite` flags for safety.
- **OAuth 2.0** — flow for delegated access ("log in with Google"). Authorization code flow with PKCE is the modern default for SPAs/mobile. You don't need to memorize the dance — just know what "OAuth" means and that PKCE is the secure variant.

**Pagination**
- **Offset/limit** — `?offset=40&limit=20`. Easy, but slow on large tables (DB scans + skips) and unstable under inserts (rows shift between pages).
- **Cursor-based** — `?cursor=<opaque>&limit=20`. Stable, scales. Cursor is usually an encoded last-seen ID or timestamp. Preferred for feeds, infinite scroll, or large datasets.
- **Page-based** — `?page=2&size=20`. Sugar over offset/limit.

**Idempotency**
- **Idempotent** = running it twice has the same effect as running it once. GET/PUT/DELETE are idempotent by spec; POST is not.
- For payments / sensitive POSTs: client sends an `Idempotency-Key: <uuid>` header; server stores the response keyed by it and returns the same result on retry. Stripe is the canonical example.

**Rate limiting**
- `429 Too Many Requests`. Server sends `Retry-After: <seconds>` or `X-RateLimit-Reset: <epoch>`.
- Client behavior: exponential backoff with jitter on retry. Don't hammer.

**Versioning** — `/v1/users` in the path, or `Accept: application/vnd.micro1.v2+json` in headers. Path versioning is the pragmatic default.

**CORS** (the question that bites every fullstack new grad)
- Browsers block cross-origin XHR/`fetch` unless the server **opts in** via `Access-Control-Allow-Origin` (and friends).
- Preflight: browser sends `OPTIONS` first for non-simple requests (custom headers, non-GET/POST/HEAD, JSON bodies). Server responds with allowed methods/headers. The actual request only fires if preflight passes.
- CORS is a **browser** thing — server-to-server calls don't trigger it. If `fetch` works in Postman but not in the browser, suspect CORS.

**Consuming an API in TS — the pattern**
```ts
type User = { id: number; name: string };

async function getUser(id: number): Promise<User> {
  const res = await fetch(`/api/users/${id}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GET /users/${id} failed: ${res.status}`);
  }
  const data: unknown = await res.json();
  // Narrow before trusting:
  if (typeof data !== "object" || data === null || !("id" in data)) {
    throw new Error("Invalid user payload");
  }
  return data as User;
}
```

Two things to call out about this snippet if it comes up:
- **`fetch` does NOT reject on 4xx/5xx.** Only on network failure. Always check `res.ok`. This is the #1 fetch gotcha.
- **`await res.json()` returns `unknown`** in safe TS — narrow before trusting. In real code, use Zod or a similar runtime validator at the boundary.

**REST vs GraphQL vs RPC (one line each)**
- **REST** — resources + HTTP verbs. Cacheable, well-tooled, multiple round-trips for nested data.
- **GraphQL** — one endpoint, client picks the fields. Solves over-fetching/under-fetching. Harder to cache, easier to over-query.
- **RPC / tRPC** — call a function, get a value. Tightest client/server type sharing (especially `tRPC` with TS). Less HTTP-ish.

### React mental model

- Components are functions of props → JSX.
- **State drives re-render.** `setState(newValue)` schedules a re-render with the new state.
- **One-way data flow:** parent passes data down via props; child notifies parent via callbacks.
- **Don't mutate state.** Replace it: `setItems([...items, newItem])`, not `items.push(newItem)`.
- `useState(initial)` — local state per component instance.
- `useEffect(fn, deps)` — runs **after** render. Use for syncing with external systems (subscriptions, fetch, DOM).
  - Empty deps `[]` → runs once after mount.
  - With deps `[x, y]` → re-runs when any dep changes.
  - No deps → runs after every render (almost always a bug).
  - Return a cleanup function for teardown.
- Keys on lists: stable, unique IDs. **Don't use array index** if the list can reorder.

### Node / Express minimal vocabulary

- Express app = a middleware pipeline.
- Middleware signature: `(req, res, next) => { ... next(); }`.
- Error-handling middleware has 4 args: `(err, req, res, next)`.
- `req.params`, `req.query`, `req.body` (need `express.json()` middleware to populate body).
- `res.status(201).json({...})` — set status + body in one call.

### SQL

- `SELECT cols FROM t WHERE pred GROUP BY g HAVING agg_pred ORDER BY o LIMIT n`.
- Joins:
  - `INNER JOIN` — only matching rows.
  - `LEFT JOIN` — all left rows + matching right (NULLs where no match).
  - `RIGHT JOIN` / `FULL OUTER JOIN` — mirror / both.
- **Index** the columns you filter or join on. An index on `(a, b)` covers queries filtering by `a` or by `a AND b`, but **not** by `b` alone.
- **Transactions** for multi-statement writes that must atomically succeed or fail: `BEGIN; ... COMMIT;` (or `ROLLBACK;`).
- N+1 query problem — fetching a list then 1 query per item. Fix with a JOIN or batched `IN` query.

---

## 5. Live-coding & debugging — heuristics for the screen-share

The AI interviewer scores reasoning, not just the final code. Treat it like a pair-programming session where you narrate.

### Process

1. **Read the prompt twice. Restate it back.** "So you want me to take a list of integers, return the longest contiguous subarray that sums to K. Input may be empty. Negatives allowed. Sound right?"
2. **Clarify ambiguities before coding.** Input ranges, types, expected output shape, edge cases.
3. **Walk through 1–2 small examples by hand.** Out loud.
4. **State the approach before typing.** "I'll do a hash map of prefix-sum → first index, scan once, O(n)."
5. **Type. Talk. Test.** Run after each meaningful chunk.
6. **Mention complexity once it works.** "This is O(n) time, O(n) space."

### When stuck

- **Smallest failing example.** Shrink input until the bug isolates.
- **Print the invariant.** "At iteration i, `seen[sum]` is the first index where prefix sum equals `sum`." If you can't state the invariant, the bug is conceptual.
- **`console.log` with tags.** `console.log("after dedup:", arr)` — readable when you're scrolling.

### Don't

- Pre-optimize. Correct first, then complexity.
- Silently delete code without explaining.
- Try to be clever. Boring, readable code wins on these timed exercises.

### Edge-case checklist (verbalize)

- Empty input.
- Single element.
- Duplicates.
- Negative numbers / zero.
- Very large input (mention you'd profile if relevant).
- `null`/`undefined` ambiguity.
- Mixed types (if a JS array might contain strings + numbers).

### JS-specific traps to call out before they bite

- **Integer safety** — JS numbers are IEEE-754 floats. Safe int up to `2 ** 53 - 1` (`Number.MAX_SAFE_INTEGER`). Use `BigInt` for larger.
- **Floating point** — `0.1 + 0.2 === 0.3` is `false`. Compare with a tolerance.
- **`Array.sort()` is lexicographic by default.** `[10, 2, 1].sort()` → `[1, 10, 2]`. Pass a comparator: `.sort((a, b) => a - b)`.
- **`Array(3)`** creates a sparse array of length 3 with empty slots. `.map` skips empty slots. Use `Array.from({length: 3}, (_, i) => i)`.
- **Object key order** — string keys preserve insertion order, but **integer-like string keys are sorted numerically first** (`{2:'a', 1:'b'}` iterates as `1, 2`). Surprises happen.
- **`JSON.stringify` quietly drops `undefined`, functions, symbols.** Dates become strings. Round-trip with care.
- **Shallow vs deep copy.** `{...obj}` is shallow. Nested objects share references. Use `structuredClone(obj)` (modern) or a library for deep.

### Common JS coding patterns to have on muscle memory

- Two-pointer / sliding window.
- Hash-map prefix sums.
- Frequency counter (`Map<string, number>`).
- Recursion + memo (object or `Map`).
- BFS/DFS on a graph represented as `Map<node, node[]>` adjacency.
- Sort + scan.

---

## 6. Ownership & Learning Velocity — STAR scaffolds (~2 min each)

Reused from report 020 §F. Land the **reflection** sentence — that's what the AI scoring weights.

### Story 1 — The Sablier ramp (best fit for "Learning Velocity")

- **S:** Joined Sablier in Mar 2023 as a Solidity smart-contracts auditor. Three months later, asked to lead R&D on a Rust execution-layer fork (SabVM, derived from REVM).
- **T:** Ramp on Rust + EVM internals fast enough to fork an interpreter, ship the MNT (Multiple Native Tokens) feature, and co-author EIP-7809.
- **A:** Read REVM end-to-end alongside the Ethereum yellow paper. Paired with the existing maintainers. Shipped MNT and the EIP draft in months. A year later, was asked to lead a third pivot — Anchor on Solana with zero prior Solana exposure — and shipped two production programs (Lockup, Merkle Instant) on mainnet.
- **R:** Three stack rebuilds in two years at the same company; each one shipped to production.
- **Reflection:** *"Ramping isn't about courses. It's about reading the codebase and the protocol docs in parallel, and shipping something small early to test what you actually understand."*

### Story 2 — Lockup end-to-end ownership

- **S:** Sablier needed a Solana token-vesting/streaming primitive.
- **T:** Own it from spec to mainnet.
- **A:** Wrote the spec, designed the account model + PDA derivation, implemented the polymorphic streaming engine (linear + tranched), integrated MPL Core NFTs as transferable stream-ownership tokens, integrated Chainlink for dynamic fees, dual-supported SPL Token + Token2022. Tested with anchor-bankrun + Vitest (time-travel), fuzzed with Trident.
- **R:** Live on mainnet. Zero security incidents. Iterated based on real user feedback.
- **Reflection:** *"End-to-end ownership produces better designs because the person who deploys it feels every spec decision."*

### Story 3 — Audit → build, the tradeoff muscle

- **S:** Transitioned from auditor to builder at Sablier (Jul 2023).
- **T:** Carry audit-grade rigor into a build role without slowing it down.
- **A:** Used the audit muscle to triage what mattered in code review. Three months of audits had drilled the security model deep enough that I could make faster + safer calls on the Solana side.
- **R:** Shipped faster code reviews with better signal.
- **Reflection:** *"The senior-vs-junior tradeoff isn't speed vs quality. It's knowing which 3 things to do carefully and which 50 things to do fast."*

### Story 4 — The new-grad-title reframe (if asked "why this role")

- *"I see this as a stack pivot, not a level reset. I'd want to ramp on React + Node + Postgres at the same speed I ramped on Anchor in 2024 — which was full speed, end-to-end ownership inside weeks. I don't expect to know your codebase day one, and the new-grad shape — mentorship, ramp budget, growth-oriented — might actually fit a senior pivoting into a new domain better than a senior-titled role with no ramp budget."*

---

## 7. Red-flag questions — answers verbatim

- **"Why are you applying for a new-grad role with 8 years of experience?"** → Adaptability + curiosity. The comp band fits. The AI era is where I want to spend the next chapter, and Zara is fullstack-on-an-LLM, which is the right shape for someone learning the AI product surface. The new-grad framing gives me a ramp window I'd rather have than not.
- **"What's your salary expectation?"** → $240K base, open on structure. (Top of the posted $180–250K band.)
- **"Can you really work PST hours sustainably from Romania?"** → Short-term yes, months are fine. Long-term, years of 5pm-1am EET isn't sustainable for anyone. Better to find an overlap shape that works for both sides early.
- **"Have you shipped AI products?"** → No shipped AI work. Genuine interest, hands-on with LLM tooling personally. Honest gap. The fullstack-around-an-LLM shape is closer to product engineering than to ML, which is where my end-to-end track record applies cleanly.
- **"What's your weakness?"** → Practical-to-theoretical gap. Strong shipping track record on systems I built ground-up; less formal vocabulary in web ecosystems I've used as a tool rather than studied. Closing it actively. *(This is the honest one. Don't manufacture a fake weakness.)*

---

## 8. Cram card — skim 10 min before the call

1. `===` always. `==` only between `null` and `undefined` if you must.
2. `const` default, `let` when reassigning, never `var`.
3. TDZ — touching `let`/`const` before declaration throws.
4. Closures capture by reference. `var` in loops shares one binding; `let` makes one per iteration.
5. `this` precedence: `new` > explicit (`bind/call/apply`) > implicit (`obj.fn()`) > default. Arrows have no own `this`.
6. Classes are prototype sugar. Methods live on `.prototype`.
7. Event loop: microtasks (Promises) drain fully between macrotasks (setTimeout, I/O).
8. `Promise.all` fails fast; `Promise.allSettled` waits all; `race` first-to-settle; `any` first-to-fulfill.
9. `await` errors via `try/catch`. Don't `await` inside `.forEach`.
10. TS is JS + erased static types. Runtime is still JS.
11. `type` for unions/composition, `interface` for object shapes / extendable contracts.
12. Generics with `<T>` and constraints with `extends`. `K extends keyof T` is the common one.
13. Narrow with `typeof` / `instanceof` / `in` / discriminated unions (`kind` field).
14. Utility types: `Partial`, `Pick`, `Omit`, `Record`, `ReturnType`, `Awaited`.
15. `unknown` not `any` at I/O boundaries. Narrow before use.
16. `??` only coerces `null`/`undefined`. `||` coerces any falsy.
17. HTTP: 401 = not logged in, 403 = logged in but forbidden, 409 = conflict, 422 = unprocessable, 429 = rate-limited.
18. **`fetch` does NOT reject on 4xx/5xx — always check `res.ok`.** `await res.json()` is `unknown` in safe TS — narrow before trusting.
19. APIs: bearer token in `Authorization` header; JWT is signed-not-encrypted (don't put secrets in it); cursor pagination beats offset on big datasets; `Idempotency-Key` header for retry-safe POSTs; CORS is a browser-only opt-in via `Access-Control-Allow-Origin`.
20. REST = resources + verbs; GraphQL = one endpoint, client picks fields; RPC/tRPC = call a function, get a value.
21. React: one-way data flow, state replaces (don't mutate), `useEffect` deps control re-runs, stable keys on lists.
22. SQL: INNER vs LEFT JOIN. Index the columns you filter/join. Transactions for atomic multi-writes.
23. Live coding: restate prompt → walk an example → state the approach → talk while typing → name the invariant → mention complexity → list edge cases. Correct first, optimize after.

**JS number traps to remember:** `Number.MAX_SAFE_INTEGER = 2^53 - 1`. `0.1 + 0.2 !== 0.3`. `[].sort()` is lexicographic. `NaN === NaN` is false.

Three sentences to have ready going in:
- **One-line identity:** *"I'm a senior smart-contracts engineer at Sablier — Solana mainnet programs, three stack rebuilds in two years, now pivoting into the AI product layer."*
- **One-line why this role:** *"Fullstack on top of an LLM is the shape I want to learn next, and the new-grad ramp window fits a senior coming in fresh on a new stack."*
- **One-line gap admission:** *"My TS is practical, not theoretical — I've used it as a tool, not studied it. Closing that gap actively."*
