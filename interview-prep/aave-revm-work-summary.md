# My REVM Work - Complete, Commit-Sourced Summary (for Aave interviews)

Everything below is verified against the `sablier-labs/sabvm` repo history and the
`bluealloy/revm` PR record (checked 2026-07-21). You can assert all of it without risk.
Context: Sablier Labs, Blockchain Engineer, Sep 2023 - Sep 2024. Goal of the project:
R&D for "Sablier Mainnet" - a rollup design where ERC-20-style tokens are **native
assets of the VM itself** (Multiple Native Tokens, MNT), so token transfers get
ETH-grade semantics: no approvals, no `transferFrom`, balance updates enforced by the
VM, atomic with the call that carries them.

---

## 1. The 30-second version (say this first)

> "I spent a year inside the EVM. I was the main contributor to SabVM, Sablier's fork
> of REVM: I redesigned the account model so an account holds a map of native token
> balances instead of a single ETH balance, extended the journaling system so minting,
> burning and multi-token transfers revert correctly, made call frames carry a vector
> of (token, amount) values instead of a single `msg.value`, and exposed the whole
> feature to Solidity through a stateful precompile with a normal ABI. I kept the fork
> passing the official Ethereum state tests throughout. Along the way I co-authored
> EIP-7809 and landed 18 small PRs upstream in REVM itself."

## 2. The two strands (don't blur them)

**Strand A - upstream `bluealloy/revm` contributor.** 18 merged PRs under my GitHub
handle (IaroslavMazur), Nov 2023 - Apr 2024. All small-to-medium quality PRs:
interpreter refactors, `gas/calc.rs` simplifications, `Env.validate_tx()` readability,
a `perf` optimization of `AccountInfo.is_empty()`, cfg-attribute fixes, enum naming,
docs fixes. Honest framing: these are **code-quality and small-perf contributions**,
not core feature work - but they mean my code was reviewed and merged by the REVM
maintainers (rakita, DaniPopes), in one of the most widely used EVM implementations
(it powers Foundry and Reth).

**Strand B - SabVM, the fork.** 134 commits by me across all branches. The final
feature PR (#155, `feat/native-tokens`, merged 2024-09-13) - authored by me: **79
files changed, +3,607 / -506**, including a new 584-line precompile module and a
1,197-line integration test suite. Five branches in the repo tell the iteration story:
`native-assets-2023-09`, `native-assets-2023-11`, `native-assets-2024-05`,
`native-tokens-2024-05` (all now stale), and the merged `feat/native-tokens`. That is
four design iterations before the one that shipped.

## 3. The architecture I built, subsystem by subsystem

### 3.1 Account/state model (`crates/primitives/src/state.rs`)

- Replaced `AccountInfo.balance: U256` with `balances: TokenBalances`, where
  `TokenBalances = HashMap<U256, U256>` (token id -> amount).
- ETH itself becomes just another entry: `BASE_TOKEN_ID = U256::ZERO`. Gas payment,
  tx validation and beneficiary rewards all read `get_base_balance()`.
- Adapted account hashing to the multi-token world (commit `68d804b`): balances are
  **sorted by token id before hashing** so the account hash is deterministic despite
  the HashMap - the kind of consensus-facing detail that breaks networks if you miss it.

### 3.2 Token identity (`crates/primitives/src/utilities.rs`)

- `token_id = keccak256(minter_address ++ sub_id)` via `token_id_address()`.
- This gives **permissionless namespacing**: any contract can mint its own token
  family (one per `sub_id`) and ids cannot collide across minters, because the minter
  address is baked into the id. No registry needed.

### 3.3 Transaction environment and validation (`crates/primitives/src/env.rs`)

- Replaced the single `tx.value` with `tx.transferred_tokens: Vec<TokenTransfer>`
  (commit `a082a61`; `TokenTransfer { id, amount }` with `Ord` implemented so lists
  can be sorted/deduped deterministically).
- Added validation rules I wrote explicitly as commits:
  - reject txs with **duplicate token ids** in the transfer list (`f961bda`);
  - reject when the sender **lacks the balance for any transferred token** (`7c37a7f`);
  - ensure the base asset is not **double-counted** between gas cost and value
    transfer (`c8c4d8b`).

### 3.4 Journaling / revert semantics (`crates/revm/src/journaled_state.rs`, ~320 lines changed)

This is the part I'd emphasize most at Aave, because it IS revert semantics:

- Extended `JournalEntry::BalanceTransfer` to carry `token_id`.
- Added `JournalEntry::TokensMinted` (revert action: burn the minted amount),
  `JournalEntry::TokensBurned` (revert action: refund), and `TokenIdsLoaded`
  (tracks which token ids became known to the state, reverted on unwind).
- Mint/burn/transfer all live as methods on `JournaledState`, so **every token
  operation is checkpointed and unwinds correctly** on revert, at any call depth -
  the same invariant that makes reentrancy analysis tractable on Ethereum.
- Moved token-id computation down into `JournaledState` (`e2a656e`) so the id
  derivation and the balance mutation are a single auditable code path.

### 3.5 Gas (`crates/interpreter/src/gas/`)

- Added gas constants and a **per-transferred-asset gas charge** (`692791b`): a call
  carrying N token values pays proportionally, because the VM does N balance
  updates. Kept the existing cold/warm account access accounting intact.
- The precompile itself has a `BASE_GAS_COST` (15) plus per-operation costs.

### 3.6 Call semantics (`crates/interpreter/src/instructions/contract.rs`, `call_inputs.rs`)

- `CALL`/`CALLCODE`/`DELEGATECALL` inputs carry a **vector of (token_id, amount)**
  instead of a single value (`91b43a2`); `CallInputs` reworked accordingly.
- `DELEGATECALL` semantics: the transferred token context **persists** into the
  delegated frame (`ea9353c`), mirroring how `msg.value` behaves in stock EVM -
  I had to decide and implement what "apparent value" means in a multi-token world.
- Fixed a stack-ordering bug: multi-word results must be **pushed in reverse order**
  so Solidity reads them correctly (`4c7802c`) - a nice war story about how the EVM
  stack ABI actually works.
- `SELFDESTRUCT`: first removed entirely (`cd19eec`, -849 lines - the whole
  bundle-state/revert machinery it drags along), then brought back **as a no-op**
  (`084e826`) for compatibility - independently the same conclusion Ethereum itself
  reached with EIP-6780.

### 3.7 The design pivot: opcodes -> stateful precompile (THE story to tell)

**Phase 1 (Nov 2023 - Apr 2024): new opcodes.** MINT, BURN, BALANCEOF (later folded
into BALANCE), values pushed on the stack, custom opcode ids. This matches the shape
we specified in **EIP-7809 (Native Tokens)**, which I co-authored.

**Phase 2 (May - Sep 2024): pivot to a stateful precompile** (pivot commit `4d7747f`,
"use INativeTokens function selectors instead of opcode ids").

Why we pivoted - the reasoning I can give verbatim:
1. **New opcodes break the toolchain.** Solidity, Vyper, debuggers, fuzzers, static
   analyzers all need to learn them. A precompile with a normal ABI needs zero
   compiler changes - any contract just calls an address.
2. **Smaller consensus surface.** The opcode table stays untouched; all the new
   behavior is behind one address.
3. **Standard Solidity ergonomics**: we defined an `INativeTokens` Solidity interface
   and dispatch on its real function selectors, so from a contract's point of view
   it is just an external call.

The result: a **stateful precompile** (unlike Ethereum's stateless crypto
precompiles, it reads and writes `JournaledState`) at address
`0x7060000000000000000000000000000000000001` - the `706` prefix is the ASCII sum of
"Sablier" (`u64_to_prefixed_address()` in `crates/revm/src/sablier/mod.rs`).

Eight entry points (real selectors from the code):

| Function | Selector |
|---|---|
| `balanceOf` | `0x00fdd58e` (same signature shape as ERC-1155) |
| `transfer` | `0x095bcdb6` |
| `transferMultiple` | `0x99583417` |
| `transferAndCall` | `0xd1c673e9` |
| `transferMultipleAndCall` | `0x822bbe4c` |
| `mint` | `0x836a1040` |
| `burn` | `0x9eea5f66` |
| `getCallValues` | `0x6141a8b9` (the multi-token `msg.value`) |

Two mechanisms I added to make this work, both beyond what normal precompiles can do:

- **Caller context injection** (`b3470a5`): the interpreter passes `msg.sender` and
  the is-static flag into the precompile, so it can enforce that only the minter
  burns/mints its tokens and reject state mutation inside `STATICCALL`.
- **`ResultOrNewCall`** (`bf4de1c`, "internal contract calls triggered w/o EVM
  opcodes"): a precompile normally returns bytes. Mine can instead return
  `ResultOrNewCall::Call(PrimitiveCallInfo)`, which tells the interpreter loop to
  **spawn a brand-new call frame** - that is how `transferAndCall` works.

### 3.8 transfer-and-call flow (the diagram)

```
 Solidity contract A
        |
        |  CALL 0x7060...0001, calldata = transferAndCall(B, token, amt, data)
        v
 EVM interpreter ----CallInputs----> Native Tokens precompile (Rust)
                                        |  1. decode + validate (selector, static?, auth)
                                        |  2. JournaledState.transfer(A, B, token, amt)
                                        |       -> pushes JournalEntry::BalanceTransfer
                                        v
                          ResultOrNewCall::Call(PrimitiveCallInfo { to: B, data, .. })
                                        |
                                        v
                     interpreter spawns a NEW frame into B with `data`
                     (B executes with the tokens ALREADY credited;
                      if B reverts, the journal checkpoint unwinds
                      the transfer - atomicity for free)
```

This is the native-token analogue of ERC-677/ERC-1363 `transferAndCall`, except the
atomicity is enforced by the VM's journal, not by contract code.

### 3.9 Compatibility and testing (the credibility block)

- **The fork passes the official Ethereum state tests** - I fixed the `revme`
  statetest runner and the interpreter to stay green (`3983821`, 27 files). This is
  the strongest single compatibility claim: standard Ethereum semantics were
  preserved unless we deliberately changed them.
- Wrote `test_native_tokens.rs` - **1,197 lines** of integration tests that drive the
  VM end-to-end: EOA-to-EOA and EOA-to-contract transfers via tx, `balanceOf` called
  from inside a contract, mint/burn paths, transfer-multiple - including tests that
  execute **real compiled Solidity bytecode** of a "Native Token Transferrer" test
  contract against the VM (`1fda4b6`), i.e. the Solidity ABI story is tested from the
  contract side, not just unit-tested in Rust.
- Unit tests for MINT/BURN and the precompile protocol along the way (`49d2477`,
  `f048973`, `40912d8`, `56662a5`).
- Added a dedicated CI workflow for the native-token tests (`e5037e7`) and did the CI
  maintenance on the fork (Node 20 upgrades, docs/clippy/Valgrind workflows).

## 4. How to deploy this at Aave (topic -> your material)

Round 2 is theoretical Solidity/EVM with two engineers. This work lets you answer
"from inside the VM" where other candidates recite docs:

- **Revert semantics / reentrancy** -> "I extended REVM's journal myself: every state
  mutation is a JournalEntry with a defined revert action, checkpointed per call
  frame. Reentrancy is dangerous precisely because the journal only protects state
  consistency on revert, not your contract's invariants mid-call." Then bridge to
  CEI and Aave's reentrancy guards.
- **Gas metering** -> you implemented dynamic gas charging (per-asset costs) inside
  the interpreter's gas calculator; you know where warm/cold accounting lives and
  why the 63/64 rule exists at the call-frame boundary you modified.
- **`delegatecall` and `msg.value`** -> you implemented what value-context
  persistence means for delegatecall in a multi-token VM. Natural bridge to proxy
  patterns (Aave's upgradeable contracts) and their storage/context pitfalls.
- **Precompiles vs contracts** -> you built a stateful precompile with a Solidity
  ABI and can contrast it with Ethereum's stateless ones, including why selectors
  beat opcodes for adoption. Relevant vocabulary for Fusaka-era EVM discussions.
- **Token accounting** -> the punchline for the Vaults team: "aTokens and 4626 vaults
  do token accounting at the contract layer; I did token accounting at the VM layer -
  balance maps, mint/burn supply changes, atomic transfer-and-call. Same invariants
  (conservation, no double-spend, correct rounding of nothing - it's integer
  amounts), one level down."
- **EIP process** -> co-authored EIP-7809; you can speak to spec-vs-implementation
  divergence: the spec proposes opcodes, our implementation taught us the precompile
  route is more adoptable. Standards experience, first-hand.
- **Ethereum compatibility discipline** -> "we ran the official state tests on every
  change" is the sentence that lands with protocol engineers.

## 5. Honest boundaries (know these cold, volunteer them if asked)

- SabVM was **R&D**; it was never deployed as a production network. Sablier's rollup
  direction was ultimately shelved. The value is the depth, not a mainnet artifact.
- The **upstream REVM PRs are quality/refactor/small-perf PRs**, not core features.
  Say "18 merged PRs, mostly code-quality and small optimizations" - precise beats
  inflated, and the SabVM work carries the depth anyway.
- EIP-7809 is a **draft/spec contribution**, not a deployed Ethereum feature.
- SabVM = multiple native assets on a **single chain** (VM-level token recognition).
  Never frame it as cross-chain/multi-chain work.
- The fork's base is REVM circa mid-2024 (pre-Prague); if asked about newer REVM
  internals (the crate split, EOF work), say the fork predates them.

## 6. Numbers cheat sheet

| Fact | Value |
|---|---|
| Tenure on this work | Sep 2023 - Sep 2024 |
| My commits in sabvm (all branches) | 134 |
| Design iterations (branches) | 4 stale + 1 merged |
| Final PR | #155, merged 2024-09-13, authored by me |
| Final PR size | 79 files, +3,607 / -506 |
| Precompile module | `sablier/native_tokens.rs`, 584 lines |
| Integration test suite | `test_native_tokens.rs`, 1,197 lines |
| Journal changes | ~320 lines in `journaled_state.rs` |
| Upstream `bluealloy/revm` merged PRs | 18 (Nov 2023 - Apr 2024) |
| Precompile address | `0x7060...0001` (706 = ASCII sum of "Sablier") |
| Token id derivation | `keccak256(minter ++ sub_id)` |
| Base asset | `BASE_TOKEN_ID = 0` (ETH as token zero) |
| Entry points | 8 (balanceOf, transfer, transferMultiple, transferAndCall, transferMultipleAndCall, mint, burn, getCallValues) |
