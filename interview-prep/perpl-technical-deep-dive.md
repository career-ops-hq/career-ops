# Perpl Prep — Technical Deep Dive (abstract level)

Study companion to `perpl-cto-intro-call.md`. Five topics, kept at the conceptual level you asked for: enough to hold a real conversation with an ex-FPGA CTO, not a textbook. Where something depends on *your actual work* (SabVM), it's flagged **CONFIRM** — verify against your own memory before saying it out loud.

---

## 1. Gas optimization strategies

**The mental model:** gas = cost of compute + state access + memory. The expensive things, in order, are **storage writes >> storage reads >> memory/compute**. Optimization is mostly about *touching storage less*. For Perpl specifically, the whole game is the **<100k-gas post-and-cancel cycle** — so this is the single most role-relevant topic.

**The storage cost hierarchy (know these numbers roughly):**
- `SSTORE` cold zero→nonzero: **~20,000 gas**. Warm/nonzero→nonzero: ~5,000. Setting back to zero gives a **refund**.
- `SLOAD` cold: **~2,100 gas** (EIP-2929). Warm (already touched this tx): **~100 gas**.
- Transient storage (`TSTORE`/`TLOAD`, **EIP-1153**, Cancun): **~100 gas**, wiped at end of tx. Perfect for intra-transaction scratch state (reentrancy locks, temporary accumulators) — no SSTORE cost.
- Memory: cheap but **expansion cost is quadratic** — big memory arrays bite.
- Calldata: cheaper than memory to read; **non-zero byte = 16 gas, zero byte = 4 gas** (so calldata compression / zero-heavy encodings matter).

**The core techniques (abstract):**
- **Storage packing** — a slot is 32 bytes. Pack multiple small fields (`uint128`, `uint64`, `bool`, `address`=20 bytes) into one slot so one `SSTORE` writes many fields. Struct field *ordering* determines packing. This is the biggest single lever.
- **Minimize distinct storage writes** — batch updates, write once at the end, cache storage into memory/stack at the start of a function and write back once (the "warm the slot, mutate in memory, flush once" pattern).
- **Transient storage** for anything that only needs to live within the transaction — reentrancy guards are the canonical example (was 2 SSTOREs, now 2 TSTOREs).
- **Custom errors** (`error InsufficientMargin()`) instead of `require(cond, "string")` — revert strings cost deploy + runtime gas; custom errors are 4-byte selectors.
- **`unchecked { }`** for arithmetic you've proven can't overflow (loop counters, already-bounds-checked math) — skips the 0.8.x overflow checks.
- **`immutable` / `constant`** — values baked into bytecode, read with no SLOAD.
- **Bitmaps / packed data structures** — represent presence/flags/price-levels as bits in a word. Directly relevant to an **orderbook**: tick/price-level occupancy as a bitmap lets you find the next active level in O(1)-ish with bit tricks instead of iterating storage. (Uniswap V3's tick bitmap is the reference design.)
- **Avoid storage in hot loops** — never `SLOAD`/`SSTORE` inside a loop if you can hoist it.
- **Events for data you don't need on-chain** — logs are far cheaper than storage; emit and reconstruct off-chain (an on-chain CLOB emits fills as events; consumers rebuild the book).
- **`--via-ir` / Yul / inline assembly** for hot paths — the compiler's IR pipeline optimizes better; hand-written Yul/assembly for the tightest inner loops (this is where "gas golfing" happens). Expect Perpl's matching hot path to have assembly.
- **Function selector optimization** — cheaper selectors (more leading zero bytes) and ordering frequently-called functions first saves a bit per call; matters at MM frequency.

**How to talk about it:** you don't need to have shipped all of these. Frame it as: "The lever hierarchy is storage-writes first, then reads, then compute — and because I worked at the REVM level I understand *why* each opcode costs what it does, not just the rule of thumb. For an orderbook the interesting part is representing the book so post/cancel touches the minimum number of slots — bitmap price levels, packed order structs, transient storage for intra-tx state."

---

## 2. Testing — Foundry test types

Foundry (Forge) is the standard. Your Sablier V2 audit work already had you *reading* Foundry suites, and your instinct here (test-driven, security-first) is a genuine strength — this section is about naming the taxonomy precisely.

**The test types, from simplest to most powerful:**

| Type | What it is | When |
|---|---|---|
| **Unit tests** | One function, fixed inputs, asserted output. `testXxx()`. | Baseline correctness. |
| **Fuzz tests** | Forge auto-generates random inputs for test parameters (`testFuzz_x(uint256 amount)`). You assert a **property** holds for *all* inputs. Use `vm.assume()` / `bound()` to constrain the input domain. | Catch edge cases you didn't think of (overflow boundaries, zero, max). |
| **Invariant tests** | **Stateful fuzzing.** Forge calls a random sequence of functions (a "handler") across many runs, then checks **invariants** that must *always* hold (e.g. "sum of all user margin == protocol collateral balance", "no position is below maintenance margin without being liquidatable"). Config: runs, depth, `targetContract`/`targetSelector`. | The heavyweight tool for DeFi protocols — this is what finds the deep bugs. Perpl will care a lot about this. |
| **Fork tests** | Run against a **fork of live chain state** (`vm.createFork`, `--fork-url`). Test against real oracles/tokens/deployed contracts. | Integration realism, oracle behavior, mainnet-condition testing. |
| **Differential tests** | Run two implementations against the same inputs, assert equal outputs (e.g. Solidity vs a Python/Rust reference model). | Validating a complex primitive (a matching engine) against a spec model. Quant-team-adjacent. |

**The cheatcode vocabulary (the `vm.*` toolkit — know these names):**
- `vm.prank` / `startPrank` — impersonate `msg.sender`.
- `vm.warp` (set `block.timestamp`) / `vm.roll` (set `block.number`) — time travel. Critical for **funding rate** (hourly) and **liquidation** testing.
- `vm.expectRevert` — assert a call reverts (with a specific custom error).
- `vm.expectEmit` — assert an event fired with expected args.
- `vm.deal` — set ETH balance; `deal` (forge-std) for ERC-20 balances.
- `bound(x, min, max)` / `vm.assume(cond)` — constrain fuzz inputs.
- `vm.mockCall` — stub an external call (mock an oracle price).

**Beyond Forge (name-drop tier):**
- **Gas snapshots** (`forge snapshot`) — track gas per test, catch regressions. For a <100k-gas target this is CI-enforced.
- **Symbolic execution / formal verification** — **Halmos** and **Kontrol** (KEVM) do symbolic testing of Solidity; **Certora** for spec-based FV. For a leverage protocol holding user funds, expect some formal methods. Your **auditor background** is the natural bridge here — you understand adversarial thinking, which is exactly what invariant/formal testing operationalizes.

**How to talk about it:** "Unit for correctness, fuzz for property-based edge cases, and invariant/stateful fuzzing is where a margin protocol actually gets de-risked — you define the solvency invariants and let the handler try to break them. Fork tests for oracle realism, and gas snapshots in CI to protect the <100k target. My auditor time makes the invariant-design part natural, since that's the same 'what must never be true' framing."

---

## 3. EVM internals — what you actually did for SabVM

**The single most important correction: SabVM used PRECOMPILES, not new opcodes.** ([source: EIP-7809 magicians thread / SabVM notes]) Get this exactly right, because it's a factual claim a sharp CTO can probe, and conflating the two would undercut your credibility.

There are **two separate artifacts**, and you should keep them cleanly distinct:

**(a) EIP-7809 "Native Tokens" — the SPEC you co-authored (with Paul).**
This is the *theoretical design*. It proposes changing the EVM so tokens are native (first-class, like ETH), rather than ERC-20 contract-ledger balances. Its design includes:
- **New opcodes**: `MINT`, `BURN`, `BALANCEOF`, `CALLVALUES`, plus native-token call/create variants `NTCALL`, `NTCALLCODE`, `NTCREATE`, `NTCREATE2`.
- **Changing the transaction `value` field** from a single scalar into a `(token_id, token_amount)` pair — or a `native_tokens_list` of such pairs — so one tx can carry multiple native assets. ETH is just `token_id = 0`; a legacy non-zero `value` is equivalent to a single-pair list with ETH's id.
- Related work: **SRF-20** (Sablier RFC — an ERC-20-equivalent standard *for* native tokens) and a **draft Solidity spec** for exposing native tokens in the language.

**(b) SabVM — the IMPLEMENTATION you built (REVM fork).**
This is the *working code*. Key fact: **it implemented native-token support with precompiles rather than the EIP's opcodes, because precompiles were easier to ship at the time.** So the accurate statement is:

> "I co-authored the EIP-7809 spec, which *proposes* native-token opcodes and a multi-asset transaction value field. In the SabVM implementation — our REVM fork — we took the pragmatic route and implemented native-token behavior via **precompiles** instead of new opcodes, since that shipped faster. The Multiple-Native-Tokens (MNT) feature let a single chain recognize multiple native assets at the VM level."

**Why this is still an elite EVM-internals credential** (regardless of precompile-vs-opcode): to build it you had to work inside REVM's guts —
- the **interpreter loop** (how the VM dispatches opcodes, manages the 256-bit **stack** (max depth 1024), byte-addressed **memory** with quadratic expansion cost, persistent **storage**),
- **gas metering** (every opcode's cost, memory-expansion accounting, warm/cold access per EIP-2929),
- the **call model** — `CALL` / `DELEGATECALL` / `STATICCALL` / `CALLCODE`, how value transfer and calldata/returndata move across the call boundary, the call-context/depth,
- the **value-transfer path** and account/balance state — which is exactly what MNT had to generalize from "one native asset (ETH)" to "many,"
- and the **precompile dispatch mechanism** (addresses `0x01..0x0a`: ecrecover, sha256, ripemd160, identity, modexp, ecadd/ecmul/ecpairing, blake2f, point-eval) — which is where you hooked the native-token logic.

**VERIFIED from the `sablier-labs/sabvm` commit history + source (2026-07-16):** it was **precompiles**, confirmed. Your commits show you started opcode-based then pivoted (`4d7747f: use INativeTokens function selectors instead of opcode ids`). What you actually built:

1. **State model:** generalized REVM's `AccountInfo` from a scalar `balance: U256` to `balances: TokenBalances` (a `token_id → U256` map). ETH = `BASE_TOKEN_ID = 0`.
2. **One context-stateful precompile** at `0x7060…0001` (`706` = ASCII sum of "Sablier"). A `ContextStatefulPrecompileMut` — a precompile type with mutable access to journaled state + db + `msg.sender` + `is_static` (stock precompiles are stateless). Dispatches on Solidity 4-byte selectors: `balanceOf`, `mint`, `burn`, `transfer`, `transferMultiple`, `transferAndCall`, `transferMultipleAndCall`, `getCallValues`.
3. **Token identity = access control:** `token_id = keccak256(minter_address ++ sub_id)` — a contract can only mint/burn in its own namespace. EOA callers + static calls rejected.
4. **Transfer-and-call without opcodes** (your `BREAKING CHANGE` commit): extended precompile returns to `ResultOrNewCall` — a precompile can emit `Call(PrimitiveCallInfo{target, token_transfers, calldata})` that makes the outer EVM loop perform a fresh internal call carrying the tokens (native `msg.value` analog).
5. **Call-values + journaling:** callee reads incoming tokens via `getCallValues()` (`mntcallvalues` work); every balance mutation pushes a revertible `JournalEntry`. Kept base-asset `BALANCE` semantics; SabVM passes the Ethereum test suite.

MNT was **single-chain multi-native-asset** — per [[feedback_sabvm_multi_asset_single_chain]], **never frame as cross-chain**. SabVM is **execution-layer Rust, NOT smart-contract work** — use it as EVM-internals depth, exclude it from SC-scoped questions.

**How to talk about it:** lead with the honest precompile fact, then pivot to the depth: "Working on REVM meant living in the interpreter loop, the gas model, and the call/value-transfer path — so when Perpl optimizes for gas, I'm reasoning from how the machine actually meters and executes, not from surface heuristics." *That* is the sentence that makes the Solana-recent problem disappear.

---

## 4. Solidity ramp-up — syntax + the must-know patterns

You know EVM internals cold and you've audited elite Solidity (V2). This is about **reactivating fluency** and being able to speak the practitioner vocabulary. Abstract checklist:

**Language mechanics to refresh:**
- **Data location: `storage` vs `memory` vs `calldata`.** This trips people returning from Rust. `storage` = persistent, reference to state; `memory` = temporary, mutable; `calldata` = read-only input, cheapest. Assigning storage→memory copies; storage→storage aliases.
- **`msg.sender` vs `tx.origin`** — always use `msg.sender` for auth; `tx.origin` is a phishing vector.
- **Visibility**: `public` / `external` / `internal` / `private`. `external` is cheaper for calldata-heavy args.
- **`view` / `pure` / `payable`**, function modifiers, `receive()` / `fallback()`.
- **Custom errors, `require` / `revert` / `assert`**, checked arithmetic default since 0.8 (and `unchecked`).
- **`immutable` / `constant`**, events + `indexed`, enums, structs, mappings, nested mappings.
- **`delegatecall` and storage-layout collisions** — the foundation of proxy/upgradeable patterns; understand why the proxy and implementation must share storage layout.
- **Interfaces, `abstract`, inheritance + linearization (C3)**, `super`, function overriding.
- **ABI encoding** (`abi.encode` vs `encodePacked` — packed can cause hash collisions), **selectors** (`bytes4`), **EIP-712** typed structured signing (relevant if Perpl does off-chain-signed orders relayed on-chain).
- **SafeERC20** (not all tokens return bools / revert cleanly), the approve/allowance model and its race, `permit` (EIP-2612).

**The security patterns every Solidity dev must know (these come up in interviews constantly):**
- **CEI — Checks-Effects-Interactions.** Order every state-changing function as: (1) **Checks** (validate inputs, auth, preconditions), (2) **Effects** (update your own storage), (3) **Interactions** (external calls / token transfers last). This is the #1 defense against **reentrancy** — you update state *before* handing control to an external contract, so a reentrant call sees already-settled state. Be able to explain *why* it works, not just recite it.
- **Reentrancy guards** (`nonReentrant` mutex) — belt-and-suspenders on top of CEI; now cheap via transient storage.
- **Pull-over-push payments** — let users withdraw rather than pushing funds to them (a push to a malicious/reverting contract can brick your loop → griefing).
- **Access control** — `Ownable` / role-based `AccessControl`; principle of least privilege on admin functions.
- **Oracle-manipulation resistance** — never trust a spot price from a manipulable AMM; use TWAPs / aggregated indices / robust oracles. **Directly Perpl-relevant** — the index price for funding & liquidation is *the* attack surface.
- **Integer/rounding discipline** — division truncates; rounding direction should always favor the protocol; beware precision loss in fee/funding math.
- **Front-running / MEV** — order-dependent logic (an on-chain orderbook!) is exposed; commit-reveal, slippage bounds, or design that's fair under reordering.
- **Upgradeability** — Transparent vs **UUPS** proxies, initializer (not constructor) pattern, `__gap` storage slots, storage-layout preservation across upgrades.
- **Signature replay** — nonces + domain separators (EIP-712) so a signed order/message can't be reused.
- **`block.timestamp` caution** — miner-influenceable by seconds; fine for hourly funding, dangerous for fine-grained randomness/deadlines.

**How to talk about it:** you can honestly say the *patterns* are second nature from auditing — "I've reviewed CEI ordering, reentrancy, and oracle-manipulation as an auditor on V2, so the security patterns are muscle memory; what I'm actively re-warming is day-to-day Solidity ergonomics after time in Rust."

---

## 5. EVM vs Monad vs Solana — the specs, compared

This is your **bridge topic** — you're the rare candidate who can speak all three runtimes fluently. Frame it as an asset. The comparison the CTO will enjoy:

| Axis | Ethereum L1 (baseline EVM) | **Monad** (your target) | Solana (your recent home) |
|---|---|---|---|
| **Execution** | Fully **sequential** | **Optimistic parallel** — assume txs are independent, run in parallel across cores, detect state conflicts, **re-execute conflicting ones serially** | **Sealevel** — parallel via **explicitly declared** read/write account lists; scheduler runs non-overlapping txs concurrently |
| **State model** | One **global shared mutable state**; contracts hold their own storage; free composability | **Same as EVM** — global shared state, full composability, **msg.sender**, unchanged Solidity | **Accounts** — programs are **stateless**; all state lives in external accounts; **PDAs**, **rent**, CPI |
| **Parallelism is...** | n/a | **Transparent** — you write normal Solidity, runtime finds the parallelism | **Explicit** — you declare every account a tx touches up front |
| **Consensus/exec coupling** | Coupled | **Deferred/pipelined execution** — consensus orders txs first (MonadBFT), execution happens after, off the consensus critical path | PoH + Tower BFT; leader produces, others replay |
| **State DB** | LevelDB/Merkle-Patricia trie (I/O-bound) | **MonadDB** — async disk I/O, fine-grained concurrent access, built for thousands of parallel state ops | AccountsDB |
| **Block time / throughput** | ~12s / ~15 TPS | **~400-500ms, sub-second finality, ~10,000 TPS** | ~400ms slots, high TPS |
| **Language / tooling** | Solidity/Vyper, Foundry | **Identical — 100% EVM bytecode compatible, Foundry, zero code change** | **Rust/Anchor**, different toolchain entirely |
| **Fees** | Gas, volatile/expensive | EVM gas, **near-zero, predictable** | Compute units + lamports, priority fees |

**The three insights that make you sound like you actually get it:**

1. **Monad gives you EVM semantics back with Solana-class speed** — you keep global shared state, composability, `msg.sender`, and unchanged Solidity, but get parallel execution and sub-second blocks. That's *exactly* the point of Paul's thesis: it's what makes a fully on-chain CLOB feasible where ETH L1 (too slow) and L2s (too gas-expensive) couldn't.

2. **The Solana→Monad mental shift** (say this — it shows self-awareness): "On Solana I had to declare every account a transaction touches and design around PDAs and rent. On Monad that's gone — I'm back to global mutable state and composability. What I *carry over* from Solana is the parallelism intuition: I already think about which state a transaction contends on, which is exactly what matters under Monad's optimistic execution."

3. **The killer, role-specific point — state contention on the orderbook.** Under optimistic parallel execution, transactions that write the **same storage slot serialize** (conflict → re-execute). An orderbook is a **contention hotspot** — every order touches shared book state. So a naive on-chain CLOB would serialize away Monad's parallelism advantage. The design question is: *how do you shard/lay out book state so that orders on different markets (or different price regions) don't conflict, preserving parallelism?* **Raise this as a question, or reason about it out loud** — it demonstrates you understand the actual hard problem of building Perpl, connecting Monad's execution model to their #1 engineering challenge. This is the single most impressive thing you can bring up.

---

## Quick self-test before the call

Can you, in one or two sentences each, explain:
- Why storage writes dominate gas, and how bitmap price-levels help an orderbook? (§1)
- The difference between fuzz and invariant testing, and what invariant you'd write for a margin system? (§2)
- That SabVM used **precompiles**, that **EIP-7809** is the opcode spec, and roughly what you touched in REVM? (§3)
- Why CEI prevents reentrancy? (§4)
- Why an on-chain orderbook is a state-contention hotspot under Monad's optimistic execution, and why that's the core design challenge? (§5)

If yes to all five, you're ready to hold the technical half of this call honestly.
