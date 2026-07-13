# P2P.org - Staff Engineer, Syncro - Interview Prep

**Role:** Staff Engineer, Syncro
**Ashby JD:** https://jobs.ashbyhq.com/p2p.org/0ab86149-f93a-45ac-a28f-2d16983b0ac9
**Recruiter:** Yuliya Korzhovnik (Senior Talent Acquisition Partner, Warsaw)
**Recruiter email:** yuliya.korzhovnik@p2p.org
**Calendly:** https://calendly.com/yuliya-korzhovnik-p2p/hr-call-30min
**Stage:** Recruiter screen (30 min)
**Employment shape:** Contract, remote, Europe

---

## 1. Company snapshot

- **Founded** 2018 by **Konstantin Lomashuk** (Russia crypto since 2012)
- **HQ:** George Town, Cayman Islands
- **Headcount:** 194 (Mar 31, 2026)
- **Funding:** Series A, $23M raised Apr 2023, led by **Jump Crypto, Bybit, Sygnum**. No later round publicly disclosed. Post-money valuation not public.
- **Business:** Non-custodial institutional staking-as-a-service across 40+ networks

### 2026 leadership shake-up (this is important)

Jan 20, 2026: founder **Lomashuk returned as CEO**, with **Konstantin Zaitcev** (ex-dRPC.org co-founder/CEO) as **Co-CEO** for execution. Previous CEO **Alex Esin** moved to advisory after a 3-year run that delivered 15x client growth, restaking market dominance, and Ethereum validator leadership. **Betsabe Botaitis** appointed CFO around the same time.

Stated strategic pivot: from "validator operations" to "**ultimate yield engine**" - full-stack yield infrastructure, multi-asset, compliance-first, institutional-scale, custody-integrated. Syncro is one of the flagship deliverables of this pivot.

**What this means for you:** the company is in a strategic re-orientation phase. Hiring right now is not maintenance mode - they are staffing up for a new mandate. That's usually candidate-favorable (title flex, comp flex, ramp tolerance) but also higher-scrutiny on adaptability.

---

## 2. Business facts (memorize)

- **$10B+ TVL**, 20%+ market share in **restaking**
- **40+ networks** supported, 23 new protocol integrations in 2025
- **190+ institutional clients** (per Syncro page)
- Named clients: **BitGo, Copper, Crypto.com, Ledger, ByBit, Bitget, OKX, HTX, Bitvavo, SBI, Fireblocks**
- **SOC 2 Type II** certified
- **Zero slashing events**, 99.9%+ uptime historical
- **#1 by TVL on Monad**, **#1 by APR on Solana for 96%+ of 2025**
- Recent 2026 launches: Syncro Sender (Mar 18), HYPE Institutional Stack (Mar 11), EigenLayer updates (Mar 10)

---

## 3. Syncro Sender (the product you'd be building)

**What it is:** a Solana transaction sender built on P2P.org's validator infrastructure. Sits between clients (HFT firms, MMs, MEV searchers, wallets, DEXes) and the Solana validator set. Landing-rate infrastructure.

### Technical architecture (public claims)

- **SWQoS** (Stake-Weighted Quality of Service) priority routing - leverages P2P's staked validator connections to get transactions into leader queues ahead of unstaked traffic
- **Multi-path delivery** - transactions sent through multiple staked connections to **current and upcoming leaders** simultaneously; first path to reach the leader wins
- **Global infra:** endpoints in Amsterdam, Frankfurt, NYC, London, Tokyo, Singapore
- **APIs:** REST + gRPC
- **Integration:** drop-in, no signing-logic changes

### Performance claims (memorize these numbers)

- **99.2% transaction inclusion rate**
- **99% slot 0-1 landing rate**
- **1.2 slots** average latency

### Pricing model

- Public endpoint: **0.0001 SOL per landed transaction** (up to 1 RPS)
- Dedicated endpoint: **0.001 SOL per landed transaction** (up to 50 RPS)
- **Pay-only-when-landed** model (usage-based, not subscription)
- 2-week free trial on dedicated

**What this pricing tells you:** they are competing on landing efficacy, not on flat fees. Volume matters. If you make it into a technical interview, expect a lot of "how would you make landing rates higher" questions.

---

## 4. Competitive landscape (don't walk in blind)

Syncro Sender lives in a crowded 2026 landscape:

- **Helius Sender** - direct competitor. Combines Helius staked connections with Jito MEV auctions in parallel. Marketing angle: "zero-slot execution."
- **Triton Jet** - Triton's landing product. Every dedicated node ships Jito ShredStream by default.
- **QuickNode Lil'JIT** - QuickNode's Jito bundle submission path.
- **RPC Fast / Dysnix** - bare-metal Solana-exclusive infra, Yellowstone gRPC + SWQoS + sub-50ms failover.
- **Jito** (upstream) - the MEV bundle path itself, which most competitors integrate. NOT a direct competitor to Syncro; more of a substrate.

**What differentiates Syncro:**
- P2P.org is a **top-3 Solana validator by stake** - meaning SWQoS access is native, not rented. That's a real moat vs. competitors renting staked connections from third parties.
- Institutional trust (SOC 2, 190+ clients, no slashing) as a distribution channel most pure-infra competitors don't have.

**What doesn't differentiate (yet):**
- The tech itself (SWQoS + multi-path) is table stakes now
- Public benchmarks - everyone claims 99%+ landing rates

**Talking-point implication:** if asked "why P2P.org over Helius or Triton," lead with the **native stake position + institutional distribution**, not with the tech stack.

---

## 5. Role reality check

**What the JD says:**
- 8+ years distributed backend / low-latency systems shipped to production
- Rust expert (systems languages)
- TCP / QUIC / routing / peering hands-on
- Memory layout, lock-free concurrency, cache efficiency, OS-level perf
- Bare-metal + cloud multi-region rollout
- Latency + uptime SLOs
- Sets technical bar via design + code review

**Your bar today (honest self-assessment):**

| Requirement | You | Delta |
|---|---|---|
| 8+ years distributed backend / low-latency | 7 years total SE, 3.5 in Blockchain, 2 in Rust on Solana | Close but sub |
| Rust expert (production) | 2 Anchor programs on Mainnet + SabVM/REVM contributor | Strong on program-layer + execution-layer Rust; NOT lock-free / OS-level HFT-tier |
| TCP / QUIC / routing / peering | Solana RPC + Anchor consumer-side only | Real gap |
| Memory layout / lock-free / cache | None named | Real gap |
| Bare-metal + multi-region infra | None | Real gap |
| Latency / uptime SLOs | Contract-level correctness discipline, no ops SLO ownership | Adjacency only |
| Setting technical bar | Led audit-team comms, but not IC/EM team leadership | Weak |

**Fit score honest: 3.0/5.** Real Staff-level candidates for this role have prior HFT / exchange / MEV-infra backgrounds. You're in the 30-40% stretch zone. **Growth-into-it viable if P2P has ramp appetite; hard walls otherwise.**

---

## 6. Ask these questions on the call (in order of priority)

Yuliya is the recruiter screen, so questions should be about role scope, comp, process, and calibration - not deep tech.

1. **Ramp expectations.** "The JD reads Staff-level with a specific networking-perf depth. My background is Rust-heavy but on the Solana program side, with adjacent latency exposure from embedded C/C++. What's the ramp appetite for someone strong on Rust + Solana ecosystem but ramping on TCP/QUIC + peering?"
2. **Team + scope.** "What's the current Syncro team size and structure? Is this a new function I'd be building out, or joining an existing team as Staff?"
3. **Full-stack yield engine pivot.** "The leadership announcement mentioned the shift to a 'yield engine' mandate. How is Syncro positioned within that - infrastructure for internal yield products, or an external revenue line?"
4. **Comp shape.** "The listing is remote / contract / Europe. Is comp structured as base only, base + token / equity, or purely contract day-rate?" (Get her to name numbers or a range - "competitive base" is a black box)
5. **Process.** "What does the interview loop look like after this call? Timeline expectations from your side?"
6. **Days of coding vs architecture.** "Staff Engineers vary wildly - is this 70% hands-on code, or 40% code / 60% technical leadership?"
7. **Contract structure.** "You mentioned contract remote in Europe. Am I contracting through my Romanian one-person entity, or is there a specific contracting vehicle P2P uses?"

---

## 7. Own the gaps (in the first 5 min of the call)

**Suggested opener (use verbatim or close to it):**

> "Thanks for reaching out. Before we go deep, I want to set expectations. Looking at the Syncro JD, I see this as a stretch role for me: my 7-year SE background is strong on Rust and Solana - two production Anchor programs shipped to Mainnet with external audit, plus execution-layer Rust as main contributor to Sablier's REVM fork. But I don't have hands-on TCP/QUIC/peering work or HFT-tier lock-free performance experience. Is that ramp shape something you're hiring for, or do you need someone operating at full Staff bar day-one? Want to calibrate before we invest more time."

This does three things: (1) shows you read the JD carefully, (2) leads with strengths, not gaps, (3) hands her a clean decision point. She'll either redirect to a better-fit role, confirm Staff needs day-1 bar (clean exit), or say "ramp shape works, let's continue."

---

## 8. Positioning proof points (if the call continues)

Order these by relevance to Syncro specifically:

1. **Rust at two layers** - Solana program-layer (Anchor, 2 production programs, autonomous fund custody) + execution-layer (SabVM as main contributor, REVM fork). Not many candidates have both.
2. **Solana ecosystem depth** - 2 years shipping Mainnet programs means you understand validator/RPC dynamics from the consumer side. You've hit landing issues, you know why priority fees exist, you understand what Syncro is solving because you've been on the other side of it.
3. **Latency-sensitive systems** - C/C++ audio streaming to cloud speech recognition at Continental. Real latency budgets, real embedded constraints.
4. **Adaptation track record** - C/C++ → C# → Solidity → Rust → Solana. Repeatedly ramped on new stacks under production pressure.
5. **Security + correctness discipline** - V2 audit history + SolSab external audit with zero critical findings + led audit-team comms. Staff Engineers need this trait.
6. **Testing frameworks end-to-end** - unit (anchor-bankrun) + fuzz (Trident) on two production programs. This maps to the JD's "build robust testing frameworks" language.
7. **Open source** - REVM, Anchor, anchor-bankrun, mpl-core, Trident contributor. Shows depth, not just Sablier-employee output.

**Do NOT overclaim** networking depth or lock-free concurrency experience. Yuliya may or may not know Rust well, but the actual technical panel will.

---

## 9. Red flags to watch for on the call

- Vague on comp ("competitive base") → push twice, then note as risk
- Vague on ramp expectations → risk of walking into full-bar interview loop
- Vague on team structure → could be joining a nascent function without support
- Contract-only, no benefits → total comp calculation must include equipment/health delta from prior W2 arrangements
- No mention of tokens / equity → unusual for crypto infra, worth probing

---

## 10. Positive signals to look for

- Yuliya having specific answers about ramp / stretch tolerance
- Named team lead / hiring manager
- Concrete interview loop (rather than "we'll get back to you")
- Comp range disclosed voluntarily
- Interest in your Solana program-side experience (as consumer-of-landing perspective)

---

## 11. If they push forward - what the interview loop probably looks like

Based on standard Rust infra hiring at this level:

1. Yuliya (recruiter screen) - 30 min - THIS CALL
2. Hiring manager or Syncro tech lead - 45-60 min - product + role scope + your background deep dive
3. Technical screen 1 - Rust perf / systems - live coding or system design (lock-free structures, memory layout, async runtime internals)
4. Technical screen 2 - Solana / networking depth - probably TPU / QUIC / gossip / SWQoS architecture discussion
5. On-site / final loop - 3-4 rounds mixing systems design, culture, meet-the-team
6. Reference checks

**Rough timeline: 3-6 weeks recruiter-to-offer.**

If you get to step 3, you'll need to prepare deeply on lock-free Rust structures and Solana TPU/QUIC architecture - both real study needs, not bluffable.

---

## 12. Fallback pitch (in case Syncro doesn't fit)

If Yuliya says the Staff bar is firm and you don't clear it, close with:

> "Understood. If Syncro Staff isn't the right shape for me right now, I'd love to stay on your radar for Solana program-layer or execution-layer roles at P2P as your yield engine mandate expands. Rust + Solana Mainnet production + audit-cleared programs is a specific shape I can bring, and it may fit better elsewhere in your team."

This is the recruiter-relationship long game. Never leave a recruiter call without a next step.

---

## 13. Sources

- P2P.org main: https://www.p2p.org/
- Syncro Sender product page: https://www.p2p.org/products/syncro-solana-transaction-sender
- Ashby role listing: https://jobs.ashbyhq.com/p2p.org/0ab86149-f93a-45ac-a28f-2d16983b0ac9
- Lomashuk CEO return (Jan 2026): https://p2p.org/economy/founder-leadership-konstantin-lomashuk-returns-as-ceo-to-build-the-ultimate-yield-engine/
- P2P.org 2025 Wrapped: https://p2p.org/economy/p2p-orgs-2025-wrapped-the-year-we-led-institutional-staking/
- Syncro deep dive (P2P blog): https://p2p.org/economy/solana-transaction-landing-syncro-sender/
- Series A Fortune coverage (Apr 2023): https://fortune.com/crypto/2023/04/20/p2p-crypto-staking-23-million-ethereum-ether/
- Yuliya Korzhovnik LinkedIn: https://www.linkedin.com/in/yuliya-korzhovnik/
- Competitive: https://www.helius.dev/sender (Helius Sender), https://rpcfast.com/blog/solana-infrastructure-providers (2026 provider comparison)
