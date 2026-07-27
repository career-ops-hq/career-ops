# Aave Prep - Technical Deep Dive (Round 2: theoretical, Vault-team focus)

**Round:** 2nd interview - **technical but theoretical / verbal**, 45 min, **two engineers**. They **lead the discussion based on your answers** (so you have real agency to steer). Round 3 after this is **practical**: review a GitHub PR + discuss, then a technical problem at the end.

**CONFIRMED: Thursday 2026-07-30, 12:00 BST = 14:00 your time (Romania), Gmeet.** Test Gmeet on your device beforehand (Christos asked explicitly).

**The interviewers (both Principal Smart Contract Engineers):**
- **Miguel Martinez** - long-time lead smart contract dev at Aave; published the Aave V3 core contracts and governance crosschain bridge packages on npm. A V3 veteran - expect him to probe V3 mechanics depth (aTokens, indexes, liquidations, rate model) and how well you actually understand the protocol you claim to have studied.
- **Dhairya Sethi** - ex-Polygon Labs contracts engineer; gave the "Designing DeFi Resilience: Inside Aave V4's Security Blueprint" talk at DeFi Security Summit 2025 with Certora. He owns the V4 security narrative: security-by-design, Certora formal verification of the Hub + math libraries + Spokes, invariants, the ~345-audit-day program (ChainSecurity, Trail of Bits, Blackthorn), zero crit/high findings. Expect V4 architecture and security/invariant questions from him - and expect "how would you specify an invariant for X?" style follow-ups. Your auditor + differential-testing + state-test background is the perfect counterpart: speak invariants fluently.

**Christos's steer:** look into **Vaults**, **Aave V3 vs V4**, and **theoretical Solidity/EVM**. He wouldn't hand you exact topics on purpose.

**The single most important intel:** Aave has two engineering teams - **Protocol** and **Vaults** - and **the Vaults team needs people more.** So this doc is deliberately **Vault-weighted.** If you can hold a deep, fluent conversation about vault infrastructure, you're aiming at the exact seat they're trying to fill. Steer toward it.

Current-state facts researched 2026-07-21. Full Solidity/EVM detail cross-references `perpl-technical-deep-dive.md`; anti-freeze method in `technical-interview-under-pressure.md`.

---

## 0. Format strategy - how to play a "led-by-your-answers" discussion

This format is a gift: **what you talk about is partly your choice.** The interviewers pull threads from your answers, so plant threads you can go deep on.

- **Answer in layers, then hand them a hook.** Structure every answer: *define → mechanism → tradeoffs → security implications*, then end with a lead-in you're strong on ("...and that's exactly where the ERC-4626 inflation attack becomes relevant, if you want to go there"). You steer without seeming to.
- **Aim the conversation at Vaults.** When any door opens toward vaults / ERC-4626 / yield infra / share accounting, walk through it and show depth. That's the team they're hiring for.
- **Clarify before answering big/ambiguous questions** - the verbal version of the anti-freeze ritual: "Do you mean X or Y?" / "Are we talking V3 or V4 here?" Never a weakness; it's a senior reflex.
- **"I don't know X, but here's how I'd reason about it"** is a strong move. Two engineers can smell bluffing; reasoning from fundamentals beats faking recall. Your REVM/EVM-internals depth means you can *derive* a lot rather than memorize it.
- **Bring your genuine edges in naturally:** auditor's adversarial lens (V2/PRBProxy), EVM-implementation depth (SabVM/REVM), test/security rigor. For a vault team holding user funds, the security mindset is the headline trait.
- **Don't monologue.** 45 min, two people - leave room. Make it a conversation, not a lecture.

---

## 1. Study plan (prioritized - do it in this order)

Budget ~6-8 focused hours. Weighted to where the job is.

**Tier 1 - Vaults (highest ROI, ~40% of your time).** Sections 2 here. Be able to explain ERC-4626 cold, its security failure modes, the 7540/7575 extensions, and Aave's vault products (Aave Vault, Stable Vaults, sGHO). If you nail one thing, nail this.

**Tier 2 - Aave V3 vs V4 (~25%).** Section 3. The Hub-and-Spoke inversion, Risk Premiums, Spoke types (esp. **Vault Spokes** - the bridge to your target team), liquidation/dust. Know the "why," not just the "what."

**Tier 3 - Theoretical Solidity/EVM (~25%).** Section 7. This is your home turf via REVM - lean in. Storage/memory/calldata, gas metering, call types, delegatecall/proxies, transient storage. Be ready to go deep because you *can*.

**Tier 4 - GHO + aTokens + Ethereum state (~10%).** Sections 4-6. Supporting context; GHO matters because sGHO is a vault. Skim to refresh.

**Then:** run 3-4 of the Section 8 problems out loud (they double as prep for the practical round after) and rehearse the anti-freeze ritual verbally.

---

## 2. Vault infrastructure (the priority)

### 2.1 ERC-4626 - the tokenized vault standard (know this cold)

**What/why:** a standard API for **yield-bearing vaults that represent shares of a single underlying ERC-20.** You deposit an asset, receive **shares**; shares appreciate as the vault earns yield. Before 4626, every vault had a bespoke interface - 4626 unified deposit/withdraw/accounting so aggregators, integrators and other contracts compose against one API.

**Core API (be able to list and explain):**
- `asset()` - the underlying token.
- `deposit(assets, receiver)` / `mint(shares, receiver)` - two ways in (fix assets vs fix shares).
- `withdraw(assets, receiver, owner)` / `redeem(shares, receiver, owner)` - two ways out.
- `totalAssets()` - total underlying controlled by the vault (the crux - see security).
- `convertToShares` / `convertToAssets` - the exchange-rate math.
- `previewDeposit/Mint/Withdraw/Redeem` - **must match** what the action actually does (integrators rely on this).
- `maxDeposit/Mint/Withdraw/Redeem` - limits (caps, pauses).

**Share price = `totalAssets / totalShares`.** A share is a proportional claim; as `totalAssets` grows (yield accrues), each share is worth more underlying. This is exactly the **aToken scaled-balance idea generalized** (Section 4) - shares are the scaled balance, the exchange rate is the index.

**Rounding is a security property, not a detail:** always round **in the vault's favor** - shares minted on deposit round **down**, assets paid on redeem round **down**. Preview functions must reflect the real rounding. Getting a direction wrong is an exploit, not a bug.

### 2.2 The extensions (name-drop tier, matters for Aave's roadmap)

- **ERC-7540 - async vaults** (finalized Mar 2024): deposits/redeems that **don't settle in the same transaction** - modeled as **Requests** (request → later claim). Built for **real-world settlement delays**: RWAs, epoch/batch vaults, KYC gating. **Directly relevant to Aave Horizon (institutional RWA)** and any vault touching off-chain assets. If RWA comes up, this is your term.
- **ERC-7575 - multi-asset vaults:** **externalizes the share token** from the 4626 vault so one share token can front **multiple assets** / multiple entry points (e.g. an LP-token-like vault). Use when a single underlying doesn't fit.

### 2.3 Aave's vault products (know what the team actually ships)

- **Aave Vault / Aave Earn** (`aave/Aave-Vault`, GitHub): an **ERC-4626 vault holding aTokens.** You deposit an ERC-20 supported by Aave V3, the vault supplies to Aave and wraps the yield-bearing aToken into 4626 shares; **vault managers can take a fee on the yield.** This is the canonical "vault over Aave" primitive.
- **Stable Vaults** (Aave Labs, 2026): B2B2C infrastructure so **institutions - fintechs, wallets, exchanges, payment apps - can offer predictable stablecoin yield.** Routes deposits across strategies: **Aave V3 & V4 markets, the sGHO vault, and custom ERC-4626 vaults.** This is a major strategic push (Aave Labs even met the SEC Crypto Task Force in June 2026 about the 4626 vault standard) - so the Vault team is building **strategically central, institution-facing infra**, not a side feature.
- **sGHO** - the Savings GHO vault (Section 4): yield-bearing GHO wrapper, no lockup, instant withdrawals; a fixed-4.25%-APR sGHO vault launched Apr 2026.
- **V4 "Earning Chains"** deploy capital across **numerous ERC-4626 vaults on different networks** - vaults are the deployment substrate of V4's yield layer.

### 2.4 Vault security - the team's daily bread (be strongest here)

For a team holding pooled user funds, **you get hired on security instinct.** The canonical ERC-4626 failure modes:

1. **First-depositor / inflation (share-price) attack** - THE 4626 pitfall. Attacker mints 1 wei of shares, then **donates** underlying directly to the vault to inflate `totalAssets`; the next real depositor's shares **round to 0** and their deposit is captured. **Fixes:** OpenZeppelin's **virtual shares/assets offset** (decimals offset, the modern default), seeding **dead shares** at deploy, and/or a minimum initial deposit. Be able to walk the attack step by step.
2. **`totalAssets()` robustness** - if it depends on an external price, an AMM spot, or claimable-but-uncounted rewards, the share price is **manipulable or mispriced**. It must be manipulation-resistant and count all assets (including accrued).
3. **Reentrancy + read-only reentrancy** - CEI + guards; and beware external contracts reading your share price mid-callback when state is inconsistent.
4. **Fee-on-transfer / rebasing / non-standard tokens** - break `totalAssets` accounting; measure **balance deltas**, use `SafeERC20`, or disallow.
5. **Rounding drift / donation attacks** - round toward the vault; don't let direct transfers silently change accounting.
6. **Slippage protection** - `deposit`/`withdraw` should support min-shares-out / max-assets-in so users aren't sandwiched on a moving share price.

### 2.5 The competitive landscape (shows market awareness - engineers love this)

**DeFi lending is modularizing**, and the industry has split into three vault philosophies:
- **Aave** = "**universal bank**" - shared, deep liquidity (V4 Hub-and-Spoke), vaults built *on top*.
- **Morpho** = two layers: **Morpho Blue** (minimal, immutable, permissionless markets) + **Morpho Vaults** (curators - Steakhouse, Gauntlet, MEV Capital - allocate across Blue markets). ~$5.8B TVL; **Coinbase routes USDC lending through a Morpho Vault.** "Prime-brokerage division of labor."
- **Euler** = open modular vaults, independent actors create/connect them. "Connected multi-strategy" model.

**Why Aave is investing in the Vault team:** curated/institutional vaults (Morpho's strength, and where Coinbase-style distribution is going) are the competitive front. Aave's answer is **Stable Vaults + V4 Earning Chains** - keep unified deep liquidity *and* offer the curated/predictable-yield vault layer. If asked "why the vault team / why does it matter," this is the strategic story: **vaults are how Aave meets institutions and defends against the modular-lending challengers.**

**Talking point for "why do you want the Vault team":** it's security-critical smart-contract work on pooled funds (your auditor wheelhouse), it's where Aave is investing for institutional growth, and the ERC-4626 + accounting + share-math domain is exactly the kind of precise, correctness-first engineering you like.

---

## 3. Aave V3 vs V4 (know the "why," not just the "what")

**V3 (the incumbent):** independent **markets per chain**, each an **isolated liquidity pool** with its own asset mix and params. Machinery: the **Pool** + **PoolConfigurator**, **aTokens** + **variable debt tokens** (stable-rate largely deprecated), per-reserve **interest-rate strategy** contracts, **isolation mode**, **E-Mode** (efficiency mode - higher LTV for correlated assets), **supply/borrow caps**, **Portals** (cross-chain). Risk is isolated **by splitting liquidity** - which **fragments capital.**

**V4 (live on Ethereum Mar 30, 2026):** the **Hub-and-Spoke** architecture.
- **Liquidity Hub** (one per network): holds **all** assets centrally, does **unified accounting**, and **authorizes which Spokes can draw which assets, with caps.** Supply through any Spoke → capital lands in the Hub → available to every connected Spoke. Borrow → drawn from the shared Hub.
- **Spokes:** modular, user-facing **market surfaces**. Each owns its **collateral types, risk params, oracle hookups, LTV, pause switches, liquidation rules.** Types include **E-Mode Spokes** (high LTV for correlated assets) and - key for you - **Vault Spokes** (borrow against assets held **ex-protocol**, e.g. in a Safe/vault, with collateralization enforced inside the Spoke). Spokes can be **added/upgraded without migrating liquidity** or disturbing other Spokes → less governance coupling, faster innovation.
- **Risk Premiums:** borrow rate = **Base Rate + Risk Premium**, priced by **collateral quality** rather than a uniform market rate. Riskier collateral pays more - aligning cost with the risk the borrower imposes.
- **Liquidation / dust:** a **`DUST_LIQUIDATION_THRESHOLD`** - if a liquidation would leave debt/collateral below the threshold, the liquidator must **fully clear** the position, preventing dust accumulation.

**The one-line inversion (say this):** *"V3 isolated risk by fragmenting liquidity; V4 unifies liquidity in the Hub and isolates risk at the Spoke - shared capital, compartmentalized blast radius."*

**The Vault bridge:** **Vault Spokes** are where the lending core meets vault infrastructure - assets sitting in a vault/Safe used as collateral, enforced Spoke-side. Connecting "Vaults" and "V3 vs V4" through Vault Spokes is a great way to show you see the whole board.

---

## 4. aTokens - the mechanism (premise corrected)

Not "more tokens minted each block." The trick is **scaled-balance × index**: you store a **constant scaled balance** (`amount / liquidityIndex_at_deposit`), and `balanceOf = scaledBalance × liquidityIndex`, where the **index accrues with time and is computed on read** (projected to `block.timestamp`). Your displayed balance grows every block because the *index* grows, not because tokens are minted - no per-block mint, no tx needed. The stored index is only *written* on interactions but *read* forward to now. **Supply index = linear interest; variable-debt index = compound.** This is the **same share/exchange-rate pattern as ERC-4626** (shares = scaled balance, index = share price) - make that connection explicitly; it ties aTokens straight to the vault domain.

---

## 5. GHO - stablecoin context (matters because sGHO is a vault)

Aave's **decentralized, overcollateralized, governance-steered** stablecoin. Core primitive: **facilitators** (governance-approved mint/burn contracts, each with a capped **bucket**): the V3/V4 Pool, the **GSM** (fixed-rate USDC/USDT swaps defending the peg), FlashMinter, and **CCIP** cross-chain facilitators (one fungible asset across Ethereum/Arbitrum/Base/Avalanche). Rate set by **governance**. History: launched **July 2023**, **traded below peg** 2023-24, **GSM restored it**. 2026: ~**$500-580M** supply, tight peg, **>$14M/yr** to the DAO, central to V4, and **sGHO** is its savings vault. Ties to your target team via sGHO and (future) RWA-backed GHO.

---

## 6. Ethereum / EVM - current state + smart wallets (2026)

- **Upgrades:** **Dencun** (Mar 2024: blobs EIP-4844, transient storage EIP-1153, MCOPY) → **Pectra** (May 2025: **EIP-7702** EOA→smart-account delegation, EIP-7251 max effective balance) → **Fusaka** (Dec 3 2025: **PeerDAS** EIP-7594, per-tx gas cap 2^24 via EIP-7825) → **Glamsterdam** (2026: **ePBS**, **block-level access lists** = parallel execution coming to L1). Gas limit raised to **60M** (Nov 2025), heading higher. Twice-a-year fork cadence.
- **Smart wallets:** **ERC-4337** (SCAs, bundlers, paymasters) + **EIP-7702** (EOAs delegate to contract code, same address). Adopted, **L2-led, opt-in, not the L1 default** (~62M active smart accounts, ~14M EOAs used 7702). **Pay gas in USDC with no ETH: yes**, via ERC-20 paymasters (Circle Paymaster), now for EOAs through 7702 - but **base-layer gas is still ETH**; the paymaster fronts ETH and bills the ERC-20. That distinction is the precise, non-overclaiming answer.

---

## 7. Theoretical Solidity / EVM essentials (your home turf - go deep)

They flagged "theoretical Solidity/EVM," and via REVM you can **derive** most of this rather than recite it. Be ready to whiteboard/verbalize:

**EVM execution model:** stack machine, **256-bit words**, stack depth **1024**; **memory** (linear, byte-addressed, **quadratic expansion cost**); **storage** (persistent 256→256 slots); **calldata** (read-only input, cheapest); **transient storage** (EIP-1153, tx-scoped, ~100 gas).

**Gas metering:** per-opcode cost; **warm vs cold** access (EIP-2929: cold SLOAD ~2100, warm ~100; cold SSTORE ~20k zero→nonzero); memory-expansion cost; the **63/64 rule** on call gas forwarding; refunds. Being able to say *why* storage dominates (state I/O) is the senior signal.

**Call types (context differences):** `CALL` (new context, target's storage, target = msg.sender's callee), `STATICCALL` (no state changes), `DELEGATECALL` (**runs target code in caller's context/storage** - the basis of proxies and libraries), `CALLCODE` (legacy).

**delegatecall + proxies:** storage-layout sharing between proxy and implementation; **constructor→initializer** pattern (constructors don't run in the proxy's context); **UUPS vs Transparent**; **storage collision** and **`__gap`**; why upgrade safety = preserving layout.

**Storage layout:** slot packing (order fields to pack small types), **mappings** at `keccak256(key . slot)`, dynamic arrays layout. This underpins both gas and upgrade safety.

**Contracts & code:** `CREATE` vs **`CREATE2`** (deterministic addresses, counterfactual deployment), the **24KB code limit** (EIP-170) forcing splits/libraries/diamonds, **precompiles** (0x01-0x0a), **events/logs** (cheaper than storage; indexed topics), post-Cancun `selfdestruct` semantics.

**ABI & selectors:** 4-byte selectors, `abi.encode` vs **`encodePacked`** (collision risk), EIP-712 typed signing (+ nonces vs replay).

**Fixed-point math:** WAD (1e18) / RAY (1e27), **`Math.mulDiv`** for full-precision overflow-safe math, deliberate rounding direction - directly relevant to vault share math and index accrual.

**Language safety:** checked arithmetic since 0.8 (`unchecked` to opt out), `immutable`/`constant`, visibility, C3 linearization, `msg.sender` not `tx.origin`, custom errors, `try/catch`.

(Full worked detail: `perpl-technical-deep-dive.md` sections 1, 4.)

---

## 8. Practice problems + pitfalls (for the practical round after - and to sharpen your security verbal)

These are in the `withinTolerance` style: spec → what's tested → the trap → the fix → the clarifying question. Vault-flavored where possible. Run the anti-freeze ritual on each.

- **P1 Reentrancy/CEI** - `withdraw` that sends before updating balance. Fix: CEI + `nonReentrant`. Ask: "can `msg.sender` be a contract / re-enter?"
- **P2 Read-only reentrancy** - a `view` (share price / LP value) read while another protocol is mid-callback returns manipulated state. Fix: reentrancy-aware getters / guarded oracle.
- **P3 ERC-4626 inflation attack** - first depositor donates to inflate share price, next deposit rounds to 0. Fix: virtual offset / dead shares / min deposit. **(Your #1 vault problem to have crisp.)**
- **P4 Rounding direction** - `shares = assets * totalShares / totalAssets`; round toward the vault; use `mulDiv` to avoid intermediate overflow. Ask: "which way should rounding favor?"
- **P5 Oracle manipulation** - valuing collateral off an AMM spot is flash-loanable. Fix: Chainlink/TWAP + sanity + staleness.
- **P6 Stale/invalid oracle** - `latestRoundData` with no `updatedAt`/sign/L2-sequencer check. Fix: validate freshness, `answer>0`, sequencer-uptime feed.
- **P7 Non-standard ERC-20** - USDT no-bool, fee-on-transfer, rebasing break vault accounting. Fix: `SafeERC20`, measure balance deltas.
- **P8 Overflow/units** (the `withinTolerance` cousin) - widen before multiply, divide last, one fixed-point scale, `mulDiv`. Ask: "what are the units/scale - bps, WAD, RAY?"

**Pitfalls quick-reference:** reentrancy (CEI+guard) · read-only reentrancy · oracle manipulation (TWAP/Chainlink) · stale oracle (freshness+sequencer) · vault inflation (virtual offset) · rounding (toward protocol, mulDiv) · non-standard tokens (SafeERC20, deltas) · overflow/units (widen/mulDiv) · `tx.origin` (use msg.sender) · unchecked call returns · signature replay (EIP-712 nonce) · delegatecall/proxy storage collision (`__gap`) · `block.timestamp` nudging.

---

## 9. Anti-freeze - the verbal version

A theoretical round can't trigger a coding freeze, but it can trigger a "mind blank on a broad question." Same ritual, verbal:
1. **Restate / scope it:** "Are we talking V3 or V4? Do you mean the accounting or the security angle?"
2. **Structure the answer:** define → mechanism → tradeoffs → security. Structure prevents rambling and prevents blanking.
3. **Think out loud, and it's OK to pause:** "Let me reason about that for a second" - announced silence reads as thinking.
4. **When you don't know:** "I haven't worked with that directly, but here's how I'd reason about it from first principles" - then use your EVM-internals depth to derive.
5. **End answers with a hook** toward your strengths (vaults, security, EVM internals) so the discussion drifts onto your turf.

You already proved with Alex that the *conversation* is your strength - a 2h chat that clicked. This round is that, minus the live-coding trap. Go be the person who talks about vault share-math and security like it's second nature.
