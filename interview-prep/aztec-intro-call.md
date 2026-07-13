# Aztec Network — Intro Call Brief

**Candidate:** Iaroslav Mazur (Solana Smart Contracts Engineer @ Sablier Labs)
**Aztec contact:** Joe — TG `@jaosef`. Almost certainly **Joe Andrews, co-founder & Head of Product at Aztec Labs**. He uses `@jaosef` on X and Medium, is London-based, was an original co-founder alongside Zac Williamson (CTO), Tom Pocock, and Arnaud Schenk. Before Aztec he led product at CreditMint and was at Entrepreneur First. Imperial College London (Materials, 2010-2013). He still does hands-on backend work — notably refactoring/migrating the Aztec bridge contracts.
**Intro:** Made by Paul Razvan Berg (CEO Sablier).
**Date:** 2026-05-05 (in 2 days)
**Format:** Exploratory intro, not a technical screen.

> Why this matters: you are not talking to a recruiter. You are talking to a co-founder who likely owns hiring strategy for product-adjacent engineering and who can plug you in across the org. Treat this as a peer-to-peer fit conversation, not a screening.

---

## 1. Aztec at a glance (May 2026)

**What it is.** Aztec is a privacy-first zk-rollup on Ethereum. It is the first L2 on Ethereum to ship a full execution environment for **private smart contracts** — accounts, transactions, and execution can all be private, with the developer choosing per-function what is public vs private. Aztec invented PLONK and the Noir DSL.

**Mainnet status (as of May 2026).**
- **Nov 19, 2025:** Ignition Chain went live on Ethereum mainnet — 500 sequencers staked, blocks producing every 36-72s. Initially empty blocks (consensus-only) while the team monitored for issues.
- **Early 2026:** Transactions enabled. Alpha Network — "first L2 with a full execution environment for private smart contracts" — launched following a unanimous community governance vote.
- **Feb 11-12, 2026:** TGE governance vote passed; AZTEC token transferable. Token sale raised 19,476 ETH from 16.7k+ participants.
- **Mar 17, 2026:** Critical vulnerability discovered in the Alpha v4 proving system. Not exploitable via public re-execution. Fix bundled into **v5 release, planned for July 2026**. Patch is being kept private until v5 ships.
- **Network state today:** 180+ sequencers active (Aztec also reports 3,400+ at peak), 50+ permissionless provers, 99%+ attestation rate. Block times are 36-72s today; target is **4s by end of 2026**.

**Funding.**
- Seed (2018) + Series A (2021): $17M led by Paradigm.
- **Series B (Dec 2022): $100M led by a16z**, with A Capital, King River, Variant, SV Angel, HashKey, Fenbushi, AVG. Used to scale from ~7 to 40+ engineers, then beyond.
- Token sale (early 2026): 19,476 ETH (~$50-70M depending on ETH price at sale).
- No publicly disclosed equity raise after the 2022 Series B — Aztec is now token-funded and treasury-rich.

**Team size.** Tracxn pegs the company at ~118 employees as of Feb 2026. Engineering org includes: Zac Williamson (CTO/co-founder, invented PLONK), **Joe Andrews (Head of Product/co-founder — your contact)**, Charlie Lye (CTO/Engineering — yes, the title overlaps with Zac in different sources, treat both as senior leadership), Ariel Gabizon (Chief Scientist), Michael Connor (Cryptography Engineering Lead), Kev Wedderburn (Noir Lead). Aztec Foundation is a separate entity launched to coordinate ecosystem and decentralization.

**Recent milestones (last 6 months).**
- Ignition mainnet launch (Nov 2025).
- Alpha Network upgrade with full programmable privacy (early 2026).
- AZTEC TGE & Uniswap pool unlock (Feb 2026).
- Aztec Grants program launched (community-led ecosystem funding).
- Critical Alpha v4 vuln disclosure (Mar 2026) — handled transparently.
- Aztec Standards from DeFi Wonderland — reusable token primitives (AIP-20, AIP-721 analogs) for the privacy stack.

**Competitive positioning.** Aztec is the **only privacy L2 on Ethereum that is decentralized, programmable, and combines private + public state in one execution model**. The differentiation matrix:
- **Aleo** — standalone L1, raised ~$200M, $1.45B valuation. Different chain entirely. Leo language.
- **Polygon Miden** — STARK-based, recently took $25M from a16z (Apr 2025). Miden VM, recursive STARK proofs. Same a16z backing, different architecture; arguably Aztec's most direct technical rival now.
- **StarkNet / zkSync / Scroll** — privacy is not the headline; they prioritize scaling. Aztec inverts the priority.
- **Penumbra, Nocturne, Railgun, Tornado-style mixers** — narrow privacy primitives, not general-purpose programmable privacy.

> Aztec's pitch in one line: **PLONK + Noir + hybrid private/public execution + decentralized rollup** — and they're the only ones who have all four shipping on Ethereum L1 today.

---

## 2. The tech stack (with depth)

### Noir DSL
- Rust-flavored DSL for ZK circuits. Build tool is `nargo` (a `cargo` nod). File extension is `.nr`.
- **Backend-agnostic.** Compiles to **ACIR** (Abstract Circuit Intermediate Representation), which can target any ACIR-compatible proving backend. Defaults to Aztec's **Barretenberg** (PLONK / UltraHonk).
- **What feels like Rust:** type system (Field, u8/u32/u64, structs, traits, generics), syntax for fns/match/let, module system, `cargo`-like tooling, ownership-flavored borrowing for references.
- **What is *not* like Rust (the gotchas):**
  - The default execution model is **constrained**. Every statement compiles to circuit constraints. You write programs that produce SNARKs, not that mutate state.
  - **`unconstrained fn`** — escape hatch for off-circuit logic (helpers, witness computation). Calls to unconstrained fns from constrained code must wrap return values in `unsafe { ... }` and you **must add explicit `assert(...)` constraints** to re-validate the result inside the circuit (the "Brillig manual constraint coverage" rule). Forgetting this is a textbook ZK bug.
  - No heap allocation, no dynamic dispatch, no recursion in constrained code (loop bounds must be known at compile time). Vectors are bounded.
  - `Field` is the prime field of the elliptic curve, not an integer. Overflow semantics are different.
  - `assert(...)` is *the* control primitive — failing asserts make the proof unsatisfiable.
  - Type coercions exist (`[T;N] -> [T]`, constrained fn -> unconstrained fn, `&mut T -> &T`) but are limited.
  - `comptime` blocks for compile-time computation (like Zig's comptime).
  - Heavy use of macros via attributes (`#[note]`, `#[storage]`, `#[external("private")]`).

### Aztec.nr (smart contract framework on top of Noir)
- Adds the things Noir alone doesn't have: **state management, events, contract calls, addresses, the notion of a contract itself**.
- **Hybrid state model:**
  - **Private state = Notes (UTXO model).** Each note is encrypted data only the owner can decrypt. The chain stores **note commitments** (hashes) in a Merkle tree (the "note hash tree"). Spent notes are tracked by **nullifiers** (separate tree). This is the same architecture as Zcash, lifted to a programmable contract layer.
  - **Public state = account-based** (like Ethereum). Mutated by `#[external("public")]` functions.
- A single contract can have both: `#[external("private")]` and `#[external("public")]` fns coexist. Private fns can **enqueue** public calls to be executed by the sequencer.
- Storage definition uses a generic `Storage<Context>` struct so the same shape works in both private and public execution contexts. Common types: `PublicMutable<T>`, `PrivateSet<Note>`, `Map<K, V>`, `Owned<T>`.

### AVM (Aztec Virtual Machine)
- The **public execution layer**. EVM-analog, designed specifically for Aztec.
- Public functions compile to **AVM bytecode**. Sequencers execute them in the AVM and produce a **single zkVM proof per transaction's public part** (no per-call recursion the way the private kernel works).
- **Asymmetry to know:** the **private kernel** runs **recursively** for each private call on the **client device**. The AVM does **not** have a public kernel — it produces one aggregated proof for all the public calls in a tx. So: private = client-side, recursive, per-call. Public = sequencer-side, batched, single proof.
- AVM uses a **flat memory model with tagged memory** — bit sizes tracked at the slot level for circuit efficiency. This is the kind of detail that maps directly to your REVM/SabVM background.

### Sequencer / Prover architecture
- **Sequencer** — orders transactions, runs the AVM for public parts, builds blocks. Permissionless: stake 200,000 AZTEC to run one. Block proposal is a separate role from proof generation.
- **Prover** — generates the rollup proofs. Permissionless decentralized prover network, ~50+ operators. Anyone can prove. The protocol pays out for accepted proofs.
- **Validator committee** — provides public re-execution as a defense layer (relevant context: the March 2026 vuln was *not* mitigated by re-execution, which is why it was treated as critical).
- Proving pipeline (per the DeepWiki page on aztec-packages): private kernel circuits (client) → public AVM proof (sequencer) → rollup circuits aggregating both → final root posted to L1.

### L1 contracts (Solidity)
- **Rollup contract on Ethereum** (often called `Rollup.sol` or similar) — verifies rollup proofs, anchors L2 state roots, manages the staking and sequencer registry.
- **Inbox / Outbox pattern** for L1<>L2 messaging. L1 → L2 messages get inserted into the Inbox by L1 contracts, the sequencer pulls them into the L1->L2 message tree on each block. L2 → L1 messages go to the Outbox and are claimed on L1 after rollup finalization.
- **Portals** — application-level L1 contracts paired with L2 contracts. A **TokenPortal.sol** holds bridged ETH/ERC20 on L1 and corresponds to a token contract on L2.
- These are upgradable, governance-controlled contracts. This is close to the kind of work you have already shipped in the Sablier V2 stack and on EVM rollup native-token research — same surface area, different proof system.

### SDK / tooling
- **`aztec.js`** — TypeScript SDK. Deploy, call, simulate. Same role `ethers.js`/`viem` plays for EVM.
- **`aztec` CLI** — compiles contracts, runs the local sandbox, can run individual components (node / pxe / sequencer / prover / archiver / p2p-bootstrap).
- **`aztec-up`** — version manager (think `rustup`).
- **`aztec-wallet`** — CLI wallet for interacting with sandbox/devnet.
- **PXE (Private eXecution Environment)** — runs **client-side**. Holds keys, decrypts notes, runs private function execution, produces witness data and proofs. Listens on `localhost:8080` in sandbox mode. **This is the architectural piece that makes Aztec different from any chain you have shipped on** — there is meaningful client-side compute.
- **Sandbox** — full local Aztec network on your machine over a local Anvil. One command: `aztec start --local-network`.
- Requires Node.js 24+.

---

## 3. Where Iaroslav's experience maps

For each strength, the technical bridge to Aztec.

### SabVM / REVM contributor → AVM and proving-system internals
**Strong fit, 4-5/5.** Building a Rust EVM fork is the closest possible analog to working on a zkVM. You already think in terms of:
- bytecode dispatch and opcode semantics
- gas/cost accounting (relevant: AVM has its own gas model)
- memory models and tagged memory (the AVM uses tagged memory; you've worked at exactly this layer)
- stack vs memory vs storage trees
- precompile semantics

**The bridge to land:** "Working on REVM gave me reps in instruction-level VM design, gas/cost modeling, and the kind of correctness paranoia you need when a single opcode bug creates consensus splits or, in your case, unsound proofs. I haven't worked on circuit-level constraints yet, but the VM-side mental model — opcode semantics, memory tagging, state tree invariants — transfers directly to the AVM."

### EIP-7809 (Native Tokens for EVM rollups) → protocol-level thinking
**Strong fit, 4/5 for signaling, 3/5 for direct application.** Aztec doesn't have a "native tokens" feature in the same sense — they have private tokens via the AIP-20 standard, with privacy-preserving balances. **But** co-authoring an EIP shows you operate at the level of *protocol design* not just Smart Contracts implementation. That's a level Joe (as Head of Product/co-founder) will recognize and value. He himself has refactored bridge contracts hands-on — he respects engineers who think about the system end-to-end.

**The bridge to land:** "EIP-7809 was about adding a tokens-as-first-class-citizens model to EVM rollups. The thinking I did there — what's a token at the execution-layer level, vs application — is the same kind of architectural question Aztec answers differently with notes and AIP-20. I'm interested in how you landed on UTXO + nullifiers as the right abstraction."

### Sablier Solana programs (Lockup, MerkleInstant) → production privacy primitives
**Strong fit, 4/5.** Vesting/streaming and Merkle-airdrop are *exactly* the use cases that get more interesting under privacy. Sablier on Aztec would be a real product:
- Private vesting schedules (employer can't dox employees, but cliff/cliff/full vesting still cryptographically enforced)
- Private airdrop claims (Merkle proofs work natively in Noir; double-hash for nullification)
- Private streaming payments (continuous payments where amounts and recipients are hidden)

DeFi Wonderland's Aztec Standards already has `Escrow` and token primitives that are the building blocks for exactly this. Joe specifically built bridges and wants real DeFi on Aztec.

**The bridge to land:** "I've shipped two Anchor programs on Solana mainnet — Lockup (token streaming) and Merkle Instant (airdrops). Both have privacy versions that don't exist yet on any chain because no one has the right primitives. On Aztec they'd be straightforward. That's the kind of thing I'd want to build here."

### Solidity audits + V2 work → L1 bridge contracts
**Direct fit, 4/5.** Sablier V2 is one of the more rigorously-audited Solidity codebases out there. Aztec's L1 layer is exactly the same surface — upgradeable rollup contracts, portals (bridge contracts), inbox/outbox messaging, staking. You've done audits *and* implementation. Joe will care about this because the L1 contracts are the **trust boundary** for the entire rollup.

**The bridge to land:** "I started at Sablier as the auditor for V2-core and V2-periphery — months reading Solidity for adversarial behavior. Then I shipped the SVM port. The L1 contracts on Aztec — Rollup, Inbox, Outbox, Portals — that's a stack I'd be productive on day one."

---

## 4. The Noir gap — honest framing

**The truth:** zero Noir experience. Don't pretend otherwise.

**Realistic ramp-up for a Rust + Solidity + EVM-internals engineer:**
- **Days 1-3:** syntax, `nargo`, write your first `assert`-based circuit, run the sandbox. The Rust-flavor makes it almost trivial at the surface level.
- **Week 1:** First Aztec.nr contract (Counter, then a token). Understand notes, nullifiers, the public/private split.
- **Weeks 2-4:** Building intuition for **what's hard in a circuit** — non-determinism, branching, lookup tables, when to use `unconstrained fn` and re-validate, how to think about constraint counts. **This is where the real ramp-up is, not syntax.** ZK auditors say the bar is "weeks before you stop writing security bugs."
- **Month 2-3:** Productive contributor for application-layer code. Comfortable reasoning about Aztec.nr storage primitives.
- **Month 6+:** Comfortable on protocol-internal code (kernel circuits, AVM internals). Faster if you have circuit experience already.

The Rust/EVM background **shortens** the ramp at every stage but doesn't eliminate the Phase 2 jump (thinking-in-constraints). Be honest about it.

**The 30-second answer if Joe asks "have you written Noir?":**
> "No, I haven't shipped Noir yet. I've spent the last three years deep on Solidity audits, EVM internals via SabVM, and now Solana programs in Rust — so I have the surrounding muscle: VM semantics, security review, protocol-level thinking. The Rust syntax I'd be productive on quickly. The thing I'd actually have to learn is reasoning in constraints — when an assert is enough, when you need to constrain the result of an unconstrained fn, when non-determinism is leaking soundness. That's a few weeks of reps, and it's the part I'd find genuinely interesting."

That answer signals: (1) honesty, (2) you know what the *real* hard part is — not syntax, but circuit reasoning — and (3) you've thought about your own ramp.

**Two-day pre-call prep (non-zero context to walk in with):**
1. **Spend 2-3 hours installing the toolchain and running the Counter tutorial.** `bash -i <(curl -sL https://install.aztec.network)` → `aztec start --local-network` → clone `aztec-starter` → `nargo compile` → deploy a counter. You'll have *touched* the system. That's gold for an intro call: "I cloned the starter last night and got the counter contract running in the sandbox. The notes/nullifier model clicked for me when I saw the storage struct."
2. **Read three things, in order:**
   - The Aztec docs glossary + the "Notes (UTXOs)" page at `docs.aztec.network` — gives you the right vocabulary.
   - "Introducing Aztec.nr" blog post — frames the framework's purpose.
   - The Counter contract tutorial — shows the simplest possible private state.
3. **Skim Noir docs on `unconstrained fn` and `assert`.** This is the "gotcha" surface.
4. **Bonus:** read the Mar 2026 "Critical Vulnerability in Alpha v4" blog so you can talk about it intelligently if it comes up.

---

## 5. Likely roles being staffed (educated guesses)

Joe is Head of Product. He's *not* hiring core cryptography researchers (that's Ariel Gabizon's domain) or compiler engineers (Kev Wedderburn / the Noir team). He **is** likely involved in hiring around:

| Role | Fit | Framing for Iaroslav |
|------|------|---------|
| **Smart contract / aztec.nr engineer for ecosystem & DX** | ★★★★★ | The natural fit. Smart Contracts engineering is the passion; Aztec.nr is "Solidity but private", and your Smart Contracts + audit + Solana background covers exactly the audience Aztec needs to win over. |
| **L1 / bridge / Portal Solidity engineer** | ★★★★★ | Direct fit. You ship Solidity, you've audited Solidity, you've shipped on EVM rollups. Joe himself has done bridge work — instant rapport. |
| **Application engineer / Aztec Standards / token primitives** | ★★★★ | Sablier-on-Aztec is a real thing you could lead. DeFi Wonderland's Aztec Standards (escrow, AIP-20) is the building block. Your Lockup/MerkleInstant track record sells itself. |
| **Rust core / sequencer / prover orchestration** | ★★★★ | SabVM/REVM background is the bridge. Less of a perfect Smart Contracts fit (more backend), but the role exists and you're qualified. Mention only if Joe steers toward it; don't lead with it. |
| **Protocol / AVM internals (Rust)** | ★★★ | Bigger ramp. The VM-design experience is real but circuit/proving-system context isn't. Frame as "would grow into" not "ready today". |
| **Developer Relations / SDK** | ★★ | Possible but probably not what Paul vouched you for. Don't lead with it. |

**Most likely shape of the role being pitched:** something in the **smart-contract / ecosystem engineering** lane that combines (a) writing aztec.nr contracts, (b) thinking about token/standards primitives, and (c) maybe interfacing with the L1 bridge layer. That's the sweet spot of your CV and what Joe-as-Head-of-Product cares about.

---

## 6. Talking points for the call

### 60-90 second "tell me about yourself" — Aztec-tuned

> "I'm a smart contract engineer at Sablier, three-plus years now. I started as the auditor for Sablier V2 — Solidity, V2-core and V2-periphery — then moved into protocol R&D where I co-authored EIP-7809 with Paul on native tokens for EVM rollups, and was the main contributor to SabVM, our REVM fork. For the last year and a half I've been shipping Solana programs — Sablier Lockup and Merkle Instant on mainnet, both Anchor, both audited.
>
> What got me curious about Aztec: I think privacy is a fundamental human right, and crypto is one of the few places where you can actually build it as a default rather than bolt it on. Most chains treat privacy as an afterthought. Aztec treats it as the architecture. That's the kind of thing I want to spend the next five years on.
>
> I haven't written Noir. I have written REVM, audited Solidity, and shipped Anchor programs to mainnet, so the surrounding muscle is there — VM semantics, security review, production Smart Contracts discipline. The constraint-thinking ramp is the real work and it's the part I'd actually enjoy. Paul's intro is what got me to actually message you about it."

### 3-5 questions to ask Joe (substantive, not generic)

1. **"How does the team think about the asymmetry between the private kernel running recursively client-side versus the AVM producing one batched proof on the sequencer? Where do bottlenecks usually show up — client proving time, AVM gas, or rollup aggregation?"** → Signals you've read the architecture. Opens up to either DX/product or core perf.
2. **"You spent time refactoring the bridge contracts. Where do you sit today on the L1 surface area — is the Inbox/Outbox/Portal layer something the team treats as stable, or is there active work post-Alpha?"** → Personal to him, technical, lets him talk about what he cares about, and surfaces L1-Solidity-shaped work.
3. **"What's the team's view on building real DeFi primitives — vesting, payments, structured products — natively on Aztec? Aztec Standards from Wonderland looks like the start, but I'm curious whether you see that as Aztec Labs' lane or ecosystem work."** → Tees up Sablier-on-Aztec without selling it directly.
4. **"After the March vuln disclosure and the v5 plan for July — how's that shaping the engineering org's priorities through the rest of 2026? Is the team in 'lock down v5' mode or are application/DX threads continuing in parallel?"** → Shows you read the recent news, asks about real org dynamics. Be careful — don't be aggressive about it.
5. **"Where does Aztec see itself differentiating against Miden as that gets more funded? I see the Ethereum-L2 vs standalone-L1 distinction, but I'm curious about the team's view."** → Strategic question Joe (Head of Product) will love. Shows you understand the competitive frame.
6. *(If time permits)* **"What does a senior Smart Contracts engineer's first six months look like at Aztec? Is there a 'land on a single application' track or 'rotate through contracts → bridges → tooling'?"** → Practical, honest about your interest in scoping the role.

### 2-3 questions Joe is *most likely* to ask, with rehearsed-but-natural answers

**Q: "Why Aztec specifically? You've got a Solana role at Sablier."**

> "Two things. One: privacy. I genuinely think it's underbuilt in crypto and I want to work on it where it's the architecture, not a feature. Two: the technical surface is novel for me. Solana taught me high-throughput parallel execution; Sablier V2 taught me Solidity rigor; SabVM taught me VM internals. Aztec is the first thing I've seen that combines all three — there's an EVM-flavored AVM, there's L1 Solidity, and there's circuit-level work I haven't done yet. It's the most interesting environment for the next phase of my work."

**Q: "What's the gap between where you are and where you'd need to be on Noir?"**

> Use the 30-second answer from §4. Be honest. Lead with what transfers, name the real ramp (constraint reasoning, not syntax), give a realistic timeline.

**Q: "Tell me about something you're proud of shipping."**

> Pick **one** of: Sablier Lockup (production polymorphic streaming engine, MPL Core NFTs as ownership tokens, dual SPL/Token2022 support, Chainlink-based dynamic fees), or SabVM (main contributor on a REVM fork), or EIP-7809 (co-authored with the CEO). Lockup is probably the most relatable to a product-minded co-founder because it's a real shipped product. SabVM is more interesting if Joe leans technical. Read the room.

**Q: "What's your bar for the kind of role you'd take?"**

> "Smart contract engineering as the core of the role. I'm a builder; I want my hands on the contracts that ship. Backend or protocol-adjacent work, I'm open to it if the Smart Contracts work is the spine. I'd rather ship one production contract than maintain ten services."

**Q: "Compensation expectations?"**

> Comp anchor (don't lead with it, only if asked):
> - **Target:** $240K base + meaningful tokens/equity.
> - **Floor:** $180K base if total comp (tokens + base) is strong.
> - Aztec is well-funded ($100M Series B, plus token sale) and pays at the senior end for Smart Contracts engineers. Public listings show $104-209K bands but those are for a wide range of seniority and locations; you're senior with rollup + audit experience, top of band is reasonable.
> - **Phrasing:** "I'm targeting around $240K base, but I weight the bundle. If total comp with tokens is strong, I have meaningful flex on base. What's the typical structure for a senior Smart Contracts role here?"

---

## 7. Red flags / things to listen for

- **"100% Noir, no ramp time."** Reasonable senior teams budget weeks-to-months for Noir onboarding. If Joe insists on a Noir-shipped portfolio as a hard gate, the role is wrong for you right now — push for L1/Smart Contracts/Rust roles instead.
- **On-site requirement.** Aztec is London-HQ but remote-first per public listings. Confirm. Hard disqualifier per your policy.
- **"You'd be the only senior Smart Contracts engineer."** Could be opportunity *or* dumping ground. Probe team composition.
- **Token-only or token-heavy comp with no base floor.** Aztec is post-TGE and the token is liquid — that's actually fine and de-risked compared to pre-TGE — but understand the cliff/vest structure. Token sale unlocked 100% at TGE for sale participants; employee grants will have separate vesting.
- **Vagueness about the role itself.** "We'll figure it out" from a Head of Product is a yellow flag. Push for concrete first 90-day scope.
- **Over-rotation on the March vuln.** If Joe sounds defensive or ducks the topic, that's a culture signal. Aztec's public handling has actually been transparent (blog post acknowledging the issue) — that's a good sign.
- **Equity dilution / token allocation for new hires unclear.** Post-TGE companies sometimes have rigid grant structures. Ask: "What does a typical token grant look like for a senior IC?"
- **No clear public roadmap past v5.** If the team can't articulate what they're building Q3-Q4 2026 beyond "fix v5", that's a signal of early-stage chaos.

---

## 8. Logistics checklist (next 48 hours)

**Tonight / Day 1:**
- [ ] Install the Aztec toolchain: `bash -i <(curl -sL https://install.aztec.network)` (Node 24+ required).
- [ ] Clone `aztec-starter` and `aztec-examples`. Run `aztec start --local-network`.
- [ ] Walk through the **Counter contract tutorial** end to end. Deploy it, call it, read the storage layout.
- [ ] Skim the **Aztec.nr** intro blog post and the docs Glossary page.
- [ ] Read the **March 2026 vuln blog** + the **Alpha launch blog** so you have current context.

**Day 2:**
- [ ] Read 1 longer-form piece — pick one: Bankless "Private World Computer" interview with Zac & Joe, or the "Best of Both Worlds: Private and Public State" Aztec blog. The first gives you Joe's voice and worldview; the second gives you the architecture in his framing.
- [ ] Skim **Aztec Standards** (DeFi Wonderland) — escrow, AIP-20 token. So you can credibly say "I looked at how Wonderland's standards approach this."
- [ ] Re-read your tailored CV at `output/aztec-2026-05-01/cv-iaroslav-mazur.pdf`. Make sure the Sablier story rolls off the tongue.
- [ ] Write one paragraph in your own words explaining Aztec's hybrid private/public model. If you can write it, you can say it on the call.

**Hour-of:**
- [ ] Mic + camera test 30 min before. Quiet room. Battery + power.
- [ ] Browser tabs ready: Aztec docs glossary, the questions list above, your tailored CV PDF.
- [ ] Have water. The call will probably go 30-45 minutes; don't dry out 20 min in.
- [ ] Telegram open in case Joe pings on the way.

**Post-call:**
- [ ] Same-day thank-you message via TG. Reference one specific thing he said.
- [ ] If next step is a technical screen — ask explicitly what format (live coding? Take-home? Noir-specific?). Don't walk in blind.
- [ ] Update `data/applications.md` and create a report under `reports/`.

---

## Sources

- Aztec Network official site & blog: https://aztec.network/
- Aztec docs: https://docs.aztec.network/
- Aztec roadmap: https://aztec.network/roadmap
- Announcing Ignition: https://aztec.network/blog/announcing-ignition
- Announcing the Alpha Network: https://aztec.network/blog/announcing-the-alpha-network
- Critical Vulnerability in Alpha v4 (Mar 17, 2026): https://aztec.network/blog/critical-vulnerability-in-alpha-v4
- Alpha Network Security: What to Expect: https://aztec.network/blog/alpha-network-security-what-to-expect
- Road to Mainnet: https://aztec.network/blog/road-to-mainnet
- Introducing Aztec.nr: https://aztec.network/blog/introducing-aztec-nr-aztecs-private-smart-contract-framework
- The Best of Both Worlds (private + public state): https://aztec.network/blog/the-best-of-both-worlds-how-aztec-blends-private-and-public-state
- Privacy Abstraction with Aztec: https://aztec.network/blog/privacy-abstraction-with-aztec
- $AZTEC TGE Vote: https://aztec.network/blog/the-aztec-tge-vote-what-you-need-to-know
- $AZTEC TGE Next Steps: https://aztec.network/blog/aztec-tge-next-steps
- Aztec Foundation launch: https://aztec.network/blog/aztec-foundation-launches-to-accelerate-vision-of-programmable-privacy
- Aztec Grants program: https://aztec.network/blog/introducing-aztec-grants-funding-a-community-led-privacy-ecosystem
- History of Aztec: https://aztec.network/blog/history-of-aztec-pioneering-privacy-in-web3
- Series A Paradigm $17M: https://aztec.network/blog/aztec-network-raises-17-million-series-a-from-paradigm-to-bring-programmable-privacy-to-web3
- Series B a16z $100M (TechCrunch): https://techcrunch.com/2022/12/15/aztec-network-takes-on-encrypted-blockchains-with-100m-round-led-by-a16z/
- Ignition Chain coverage (CoinDesk): https://www.coindesk.com/markets/2025/11/20/privacy-focused-aztec-network-s-ignition-chain-lights-up-on-ethereum
- Alpha launch coverage (The Defiant): https://thedefiant.io/news/blockchains/aztec-launches-alpha-network-ethereum-s-first-l2-for-private-smart-contracts
- Public Execution / AVM docs: https://docs.aztec.network/developers/nightly/docs/foundational-topics/advanced/circuits/public_execution
- Aztec Glossary: https://docs.aztec.network/developers/docs/resources/glossary
- L1↔L2 Messaging (Portals): https://docs.aztec.network/developers/docs/foundational-topics/ethereum-aztec-messaging
- Notes (UTXOs): https://docs.aztec.network/developers/docs/concepts/storage/notes
- Counter Contract tutorial: https://docs.aztec.network/developers/tutorials/codealong/contract_tutorials/counter_contract
- Token Contract tutorial: https://docs.aztec.network/tutorials/codealong/contract_tutorials/token_contract
- Aztec Standards (DeFi Wonderland) on Context7: `/defi-wonderland/aztec-standards`
- Aztec packages monorepo on Context7: `/aztecprotocol/aztec-packages`
- Aztec Starter on Context7: `/aztecprotocol/aztec-starter`
- Noir docs on Context7: `/websites/noir-lang` and `/noir-lang/noir`
- Joe Andrews — Crunchbase profile (co-founder & Head of Product): https://www.crunchbase.com/person/joe-andrews-ddb6
- Joe Andrews — LinkedIn: https://uk.linkedin.com/in/joe-andrews-2783918a
- Joe Andrews on X (@jaosef): https://x.com/jaosef
- Bankless "Private World Computer" with Zac & Joe: https://www.bankless.com/podcast/the-private-world-computer-aztec
- Nansen research on Aztec: https://research.nansen.ai/articles/aztec-a-hybrid-public-private-zk-rollup
- Nethermind ZK auditors on Noir: https://www.nethermind.io/blog/our-first-deep-dive-into-noir-what-zk-auditors-learned
- Miden $25M a16z (Fortune): https://fortune.com/crypto/2025/04/29/miden-a16z-privacy-blockchain-polygon-labs/
- Aztec Tracxn profile (team size data): https://tracxn.com/d/companies/aztec/__LE23OLSU3tSwcB512mod1tOqusASlza36dQp2aaFw6k
- Aztec Web3.career listings (April 2026): https://web3.career/web3-companies/aztec+rust
