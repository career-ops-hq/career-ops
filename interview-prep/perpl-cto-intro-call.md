# Interview Prep — Perpl, Intro Call with Alex Carreira (CTO)

**Type:** Interview intel + prep (career-ops interview-prep, URL/referral entry — no prior report)
**Company:** Perpl — high-performance, orderbook-based perpetuals DEX on Monad
**Role:** Senior Smart Contract Engineer (EVM), founding-scale eng hire
**Interviewer:** Alex Carreira (AC), CTO / co-founder
**When:** ~9pm UK time tomorrow (= ~23:00 Iași / EET). ~30h out.
**Referral:** Paul (pbj / PRB, Sablier founder, Iași) — warm intro, high trust
**JD source:** unconfirmed (Monad job board + docs, fetched without browser; the X `/i/jobs` link is paywalled)

---

## TL;DR — the honest read

This is a **warm, high-trust referral** into a **founding EVM smart-contract role** at a well-funded ($9.25M, Dragonfly-led) perps DEX. That's a strong position to be in. But be clear-eyed:

- **Your genuine edges:** the Paul referral, your **REVM / EVM-internals depth** (rare), your **auditor + audit-comms credibility**, and a **testing/security rigor** that maps perfectly onto this team's "systems that cannot fail" DNA.
- **Your two real gaps:** (1) your **recent hands-on work is Solana/Rust, not production Solidity**, and (2) you've **never built a DEX / perps / orderbook / margin system** — Sablier is streaming/vesting, not derivatives.
- **The interviewer is an ex-FPGA, correctness-obsessed engineer.** He will smell bluffing instantly. The winning move is **precise honesty + demonstrated fast-ramp track record**, not overselling "I tick most of the boxes." You already leaned slightly oversold with Paul ("EVM internals, confident I can switch back"). With the CTO, dial to exact truth and let the real strengths carry it.
- **Spend the 30h closing the domain gap** (perps mechanics + Perpl docs + Monad parallel exec + practical gas optimization) so you can hold a real technical conversation, not just narrate your CV.

One tension worth naming to yourself: per your own profile this is an **EVM-primary role**, which sits outside your stated Solana-first target. You've clearly decided the referral + founding scope + comp justify it. Fine — just go in knowing that's the trade you're making.

---

## 1. The company & the people

**Perpl** — fully on-chain central limit order book (CLOB) perpetual futures exchange, built on **Monad** (high-performance parallel EVM L1). Raised **$9.25M (May 2025), led by Dragonfly**, with CMS, HashKey, Mirana, Brevan Howard Digital, L1D, BHD, Breed, Ergonia. London-based, "in-person first with optional remote flexibility." Not yet mainnet at the time of the funding round.

**Founders (AC + co-founder):** ex-**FPGA hardware engineers**, ~15+ years building together, built **hardware design tools for systems that cannot fail**, US → relocated to **London** to build an international dev team. This background matters: they care about **determinism, correctness, performance, and rigor** far more than most crypto teams. Your **security-auditor + test-driven identity is a direct culture match** — lean into it.

**Alex Carreira (CTO)** — your interviewer. "Late-night person" (hence the 9pm call). Treat this as a **technical + fit conversation with a founder**, not an HR screen. He'll want to know: can you actually build this, do you get the problem, and are you someone he wants in the founding eng seat.

**Paul (pbj / Paul Razvan Berg):** wrote the public thesis thread for Perpl and referred you. He knows your work intimately — you **audited Sablier V2 (his own protocol)** and worked at Sablier 3+ years. This referral is your single biggest asset. **Thank him, and don't waste the trust he's spending on you.**

---

## 2. The product & tech thesis — INTERNALIZE THIS

Paul's thesis thread is the mental model AC will expect you to already understand. Be able to explain it back cold:

**The perp-DEX trilemma:** on-chain matching + speed + EVM composability. Every prior generation had to break one:
- **Ethereum L1** — 12s blocks → can't do on-chain matching → **dYdX v2** put the CLOB **off-chain**, settled on-chain (centralization risk).
- **L2s** — faster blocks but **gas too expensive to run a full CLOB** → **GMX** and others used a **perp AMM** instead (worse pricing for traders, not a real orderbook).
- **Monad** — sub-second finality + **parallel EVM** + 100% EVM compatibility → makes a **fully on-chain CLOB actually feasible**.

**Mental model:** "Uniswap, but a Perpetual Exchange with a CLOB." Everything on-chain, no off-chain matching engine, no centralized point of failure.

**The core SC-engineering challenges (this is what the role IS):**
- **Gas is the master optimization vector.** Their headline target: **<100k gas per market-maker post-and-cancel cycle.** Logic: more gas → fewer MM updates → wider quotes → worse fills. Every design decision bends to this.
- **O(1) orderbook operations**, order modification (change orders), **time-in-force (TIF)** semantics.
- **Matching + risk engine live inside Monad's parallel execution**, processing multiple orders per block, **price-time priority**.
- **Composability wins:** hedge delta on the same chain, use LP positions as collateral, borrow against margin.

**The five on-chain subsystems (from the docs — know what each does):**
1. **Order book** — matches buy/sell by **price-time priority**, on-chain settlement.
2. **Margin / collateral** — ensures traders hold enough to open & sustain positions.
3. **Liquidation** — monitors accounts, triggers when **maintenance margin** is breached.
4. **ADL (auto-deleveraging) + insurance fund** — protects protocol solvency in extreme moves.
5. **Funding rate** — hourly, keeps perp price aligned to a **spot index price aggregated across multiple exchanges**.

**Liquidity:** **PLP vaults**, independently operated, Hyperliquid-inspired. Needs a **price oracle + a stablecoin for margin**.

---

## 3. Your fit — brutally honest

| JD requirement | Your reality | Verdict |
|---|---|---|
| 3+ yrs **production EVM Solidity** | Pharo ACM (Solidity SC eng, ~2022–23), Sablier V2 audit (reviewing, not authoring), Lobby3 review. Recent ~2yrs = **Solana/Rust**. Continuous *authored* production Solidity likely doesn't cleanly total 3 yrs. | **Weakest match — will be probed. Be precise, don't inflate.** |
| **Low-level EVM mechanics + gas optimization** | **SabVM / REVM fork** = you worked at the EVM *implementation* level (opcodes, gas accounting, execution semantics). Rare and elite. BUT implementation-depth ≠ having shipped gas-optimized Yul/assembly Solidity. | **Strong on internals, thinner on applied gas-golfing. Bridge honestly.** |
| **External auditors / security reviews** | Smart Contracts Security Auditor (Sablier V2-core, V2-periphery, PRBProxy). Led **technical comms with audit teams** for SolSab. Both sides of the table. | **Strong — direct hit.** |
| **DeFi protocol design (DEX/AMM/margin/oracles)** | Sablier = streaming/vesting/airdrops. **No DEX, no perps, no orderbook, no margin.** | **Real gap — study perps mechanics in the next 30h.** |
| **High agency / zero-to-one** | Shipped two Solana programs end-to-end (design→deploy→Mainnet) at Sablier. | **Strong.** |
| Preferred: **Rust** | Current daily work (Rust/Anchor). | **Strong.** |
| Preferred: **parallelized EVM / chain infra** | REVM touches execution layer; you know EVM internals. Monad's specific parallel model — **study it.** | **Partial — closeable.** |
| Preferred: **quant / HFT / derivatives** | None. | **Gap — acknowledge, don't fake it.** |

---

## 4. Your core narrative (the Solana→EVM bridge)

Your single best line of argument, and it's **true**:

> "My most recent build work is Solana/Rust, yes. But my EVM roots are deep and not surface-level — I audited Sablier V2 and PRBProxy, and I was the main contributor to SabVM, a REVM fork. I've worked at the level of the EVM *implementation itself* — opcode semantics, gas accounting, execution. So switching back to Solidity isn't relearning a language, it's returning to a machine I already understand from the inside. And a team that lives and dies on <100k-gas post-cancel cycles is exactly where that internals depth pays off."

Why this works: it **converts your apparent weakness (Solana-recent) into the exact strength this gas-obsessed team needs (EVM at the metal)**, without pretending you've been writing production Solidity all year.

**Do NOT say** "I tick most of the boxes" or "I can switch back easily." **Do say** what you actually have and how fast you ramp. Your real ramp evidence: **auditor → EVM R&D (SabVM/EIP-7809) → Solana programs** — you've absorbed paradigm shifts before and shipped each time.

**On the perps/DEX gap, be honest and specific:**
> "I haven't built a derivatives or orderbook system — Sablier is streaming and vesting. So the domain is new to me: funding, mark vs index price, maintenance margin, ADL. I've been going through your docs and the mechanics are tractable. What I bring is the SC-engineering and security half of the equation; the perps domain I'll close fast, the same way I closed Solana."

---

## 5. Likely questions & how to handle them

**Fit / motivation (founder-led):**
- *"Why Perpl / why leave Solana work?"* → Home is smart-contract engineering; this is a founding EVM role on a genuinely hard problem (on-chain CLOB), with Paul's endorsement and a team whose rigor matches how you work. Honest, not gushing.
- *"Paul speaks highly of you — what did you do at Sablier?"* → Audit of V2 (his protocol) → EVM R&D (SabVM/EIP-7809) → shipped two Solana programs to Mainnet. Continuity: security + protocol depth throughout.

**Technical — expect real depth from an ex-FPGA CTO:**
- *EVM / gas:* storage packing, `SSTORE`/`SLOAD` cost model, transient storage (**EIP-1153**), custom errors vs revert strings, `unchecked`, calldata vs memory, bitmap/tick data structures for an orderbook, warm vs cold access. **Refresh these — see prep plan.**
- *EVM internals:* be ready to actually use the REVM credential — how gas is metered, how the interpreter loop works, memory expansion cost. This is your turf; let him find the bottom of it and be impressed.
- *Perps mechanics:* funding rate calc, mark vs index price, initial vs maintenance margin, liquidation triggers, ADL, insurance fund. **You'll be studying these — enough to reason, not to bluff mastery.**
- *Monad:* optimistic parallel execution and what it means for contract design — e.g. **state-access conflicts in a hot orderbook** (many orders touching the same book state serialize; how do you design around that?). Great topic to show you think about their actual problem.
- *Design prompt (likely):* "How would you lay out an on-chain orderbook to hit <100k gas per post+cancel?" → Think out loud: minimize storage writes, packed/bitmap price levels, O(1) insert/cancel via linked structures, transient storage for intra-tx state, event-driven off-chain reconstruction of the book. **You don't need the perfect answer — show the CTO how you reason about gas.**

**Gap probes (prepare, don't improvise):**
- *"How much production Solidity have you actually shipped recently?"* → Straight answer: Pharo was the last sustained Solidity authorship; since then it's audit + EVM-internals + Solana. Then pivot to the REVM/internals bridge.
- *"You've never built a DEX — why you?"* → Security + SC-engineering + EVM-internals half is exactly what a correctness-critical exchange needs; domain I close fast; auditor's adversarial mindset is an asset for a system holding leveraged positions.

---

## 6. Questions YOU should ask (pick 4-5)

Sharp, specific questions signal you understand the problem:

1. "How far is the matching engine — is the <100k-gas post-cancel target already hit on Monad testnet, or still being optimized?"
2. "How are you handling **state-access contention** on the hot orderbook under Monad's parallel execution — does book contention serialize, and how do you design around it?"
3. "What's the split between **Solidity and lower-level (Yul/assembly)** in the codebase today? How much gas-golfing is expected day-to-day?"
4. "How do you think about the **oracle / index-price** trust surface — that's the classic attack vector for on-chain perps. What's the sourcing and manipulation-resistance design?"
5. "What does the **security process** look like — internal review cadence, external audits, formal verification, fuzzing? (I care about this and it's half of what I'd own.)"
6. "What are the first **90 days** for this hire — which subsystem would I own first?"
7. **Logistics/honest:** "The posting says London in-person-first with optional remote — I'm in Iași. What's the actual expectation for a founding eng here?"

---

## 7. 30-hour prep plan (time-blocked)

You have the evening, a night's sleep, and tomorrow before ~9pm UK. Budget ~4-5 focused hours.

**Block A — Domain (perps mechanics), ~90 min. HIGHEST PRIORITY (your biggest gap).**
- Read Perpl docs: `docs.perpl.xyz` → Architecture, Order Book, Margin, Liquidation, Insurance & ADL, Funding, Price Indices, Order Types, PLP Vaults.
- Make sure you can explain, in one sentence each: funding rate, mark vs index price, initial vs maintenance margin, liquidation, ADL, insurance fund, price-time priority.

**Block B — The thesis + Monad, ~45 min.**
- Re-read Paul's thread; be able to narrate the trilemma (ETH L1 / L2-AMM / Monad-CLOB) unprompted.
- Skim Monad's parallel/optimistic execution model and MonadDb — enough to discuss orderbook state contention.

**Block C — Applied Solidity gas optimization, ~90 min. (Reactivate the EVM half of your brain.)**
- Storage packing, SSTORE/SLOAD warm/cold cost, transient storage (EIP-1153), custom errors, `unchecked`, calldata optimization, bitmap/tick structures for orderbooks.
- Tie each back to your REVM knowledge — you understand *why* these cost what they cost. That's your differentiator.

**Block D — Narrative + questions, ~45 min.**
- Rehearse the Solana→EVM bridge line (Section 4) and the two gap answers (Section 5) out loud until they're natural, not memorized.
- Pick your 4-5 questions from Section 6.

**Block E — Logistics, 15 min (day of).**
- Confirm it's **9pm UK = 23:00 Iași** (July = BST, UK+2 for you). Don't miss it by an hour.
- Have your CV, GitHub (`/IaroslavMazur`), and the Perpl docs open in tabs.
- Quiet room, tested mic/cam, water. You've had something until ~20:45 — build buffer so you're not walking in rushed.

---

## 8. Things to clarify on the call (for you, not to over-focus)

- **Location / remote** — role is London in-person-first; you're in Iași. Founding roles often flex for the right person, and they built an international dev team on purpose. Ask directly, calmly. Per your policy: remote/hybrid fine, on-site relocation would be a real decision.
- **Comp shape** — "competitive salary + equity + token package," founding scope. Get the split and vesting when it's natural, but this call is about mutual fit first; don't lead with comp.
- **EVM-primary** — confirm the role is ~all EVM/Solidity going forward (it is). That's outside your stated Solana-first target, so make sure the founding-scope + comp + team genuinely offset that for you before you get emotionally invested.

---

## The one thing to get right

AC is a correctness-obsessed builder who was told this product was impossible and built it anyway. **Meet him with precision and humility, not a sales pitch.** Show you understand the problem deeply, be exact about what you have and haven't done, and let the REVM depth + auditor credibility + Paul's endorsement do the heavy lifting. That combination is genuinely rare — you don't need to embellish it.
