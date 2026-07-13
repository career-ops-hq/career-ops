# Eco - Software Engineer, Protocol & Cross-Chain Infrastructure

**Type:** Intro call prep (recruiter screen with Pat, agency recruiter who knows HoE Matt Sevey personally)
**Date prepped:** 2026-07-09
**Source:** Recruiter DM + Notion JD (public link leaks an "Internal Information" section - use the insight, don't quote it)

---

## TL;DR - the fit verdict

This is one of the cleanest role-to-profile matches you'll see. The line **"EVM is table stakes; SVM, TVM, or alt-VMs is what we want"** describes you almost exactly. Multi-VM production smart-contract engineers who are genuinely fluent on both EVM and SVM are rare, and that rarity is the entire reason this role exists.

**Two things will decide this call, and neither is smart contracts:**
1. **Location / time zone.** They want US, Canada, or North American time zones. You're in Romania (UTC+2/+3). This is the single biggest risk. Prep a real answer (below).
2. **Distributed systems / services.** The role is explicitly full-stack: K8s, AWS, Docker, production services around the contracts. Your CV is contract-heavy. This is your one genuine technical gap - address it head-on, don't let them find it.

Everything else is in your favor. Lead with strength, be honest about the two gaps, and this call goes well.

---

## Company snapshot (know this cold)

**What Eco is now:** B2B stablecoin infrastructure. The current product is **Eco Routes** - an intent-based cross-chain stablecoin settlement layer. Not the consumer app it started as.

**How it works (be able to explain this in one breath):** A team signs a single *intent* - "I have X token on chain A, I want Y token delivered to this address on chain B." A permissionless network of **solvers** competes to fill that intent, racing on fee and fill time. A solver fronts the destination leg immediately and reclaims on the source leg afterward, so settlement feels near-instant (most routes < 60s, p99 target ~180s). Onchain proofs anchor the settlement so the solver can't cheat.

**The clever part** (mention if the product comes up): Routes offers *multiple proof systems* in one routing layer - native storage proofs (Ethereum-grade security, ~7-day finality), Hyperlane message proofs (minutes), Polymer pull-based proofs (much cheaper gas), TEE-backed proofs (real-time), and experimental atomic sequencing. Different partners pick different security/latency/cost trade-offs.

**Chains:** 15+, including Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Unichain, Ink, Celo, Sonic, Worldchain, HyperEVM, Plasma, Ronin, **and Solana**. (Solana coverage = why your SVM work matters directly.)

**History / credibility:**
- Founded 2018, SF. Co-founders: **Andy Bromberg** (CoinList co-founder, now CEO) and Ryan Breslow (Bolt).
- Started as a consumer crypto cashback / savings app; pivoted to stablecoin settlement infra.
- Raised ~$95M+ total: a16z crypto led a $26M round, plus Coinbase Ventures, Pantera, Founders Fund. Serious backers.

**Team:** 27 people, fully remote, engineering is over half the company. Small and senior - minimal management layer.

**Matt Sevey (Head of Engineering, Pat's contact):** Boston-based, 13+ yrs. Co-founder / eng lead of **Sia / Skynet Labs** (decentralized storage and the "decentralized internet"). Deep infra background - decentralized storage networks are heavy distributed-systems work. Worth knowing because (a) Pat name-dropped him as the draw, and (b) it tells you the eng culture prizes systems rigor, not just Solidity.

---

## Role decoded - what they actually want

**Official responsibilities:**
- Deliver new chain integrations and partner features across the full stack - contracts, distributed systems, and the services connecting them
- Write production smart contracts across EVM, SVM, TVM, and emerging alt-VMs
- Own features end-to-end: design → build → test → ship → operate in prod
- Review code, partner on design with a senior distributed team
- Work against partner deadlines visible to the CEO and external partners from day one

**What they're looking for:**
- 2-3+ yrs production web3 ("depth > years" - stated twice, good for you)
- Shipped contracts on multiple VMs; **EVM table stakes, SVM/TVM/alt-VMs is the want**
- Strong TypeScript AND Rust
- Operated production distributed systems on K8s, AWS, Docker
- Thrives in high-pressure, high-visibility, external-deadline environment
- Strong async written communication (non-negotiable for a distributed team)

**Nice-to-haves:** cross-chain protocols (LayerZero, bridges, intent systems), launching/integrating a new chain end-to-end, OSS contributions, solver/intent architecture familiarity.

**Reading between the lines (from the internal section - don't quote it verbatim):**
- **Why now:** their highest-volume pod is bottlenecked. Capacity sits in a few senior engineers, and partner requests for new chains + cross-chain integrations are outpacing them. They want someone who can *flex across contracts AND services* so the pod can parallelize. Translation: they're not hiring a pure contract specialist - the full-stack flex is the point.
- They reference internal priorities ("the Five Tens" - likely their top company OKRs). You can smartly ask "what are the company's top priorities this quarter and how does this pod map to them?" without revealing you saw the term.
- **Outcomes bar:** first 3 months = onboarded, reviewing PRs, shipping with guidance. First year = self-sufficient, can lead a partner integration or chain launch solo.

---

## Your fit - what to lead with

1. **Genuine multi-VM production experience.** You've shipped to **Solana Mainnet** (Sablier Lockup - vesting/streaming; Merkle Instant - Merkle-proof airdrops) *and* worked at the EVM level (SabVM, a fork of REVM; co-authored EIP-7809). This is the rare EVM+SVM combo they're explicitly hunting. This is your headline.
2. **Rust depth.** Anchor programs on Solana + a REVM fork in Rust. Not "I know Rust" - you've built VM-level and program-level Rust in production.
3. **Security instinct.** You started as a smart-contract auditor (Sablier V2-core/periphery, PRBProxy). For *settlement infrastructure moving real stablecoin value*, an engineer who thinks like an auditor is a strong asset. Say this - it differentiates you from a pure builder.
4. **Cross-chain / native-asset systems thinking.** EIP-7809 and SabVM (multiple native tokens at the VM level) show you think about value movement at the protocol layer - adjacent to what intent-based settlement needs.
5. **Broad SWE base.** Before crypto: C/C++ embedded real-time audio at Continental, C# desktop at Bentley. You pick up new stacks by role. Useful when they probe the services/backend side.

---

## Your gaps - handle these honestly (they'll probe)

### 1. Location / time zone (THE big one)
They want US / Canada / North American time zones. You're Romania, UTC+2/+3. NA zones run UTC-4 to -8, so natural overlap is only your late afternoon/evening.

**Don't dodge it. Options to have ready:**
- Ask directly how much real-time overlap the pod needs vs. async. They stress async written comms hard - lean into that: "You emphasize async communication, which fits how I already work remotely across time zones. What's the minimum live overlap the pod needs?"
- Offer concrete overlap: you can commit to working hours that cover a solid block of US-Eastern afternoons (your evening).
- If they're firm on NA-resident-only, better to learn now. But let *them* raise it as a blocker - many "NA time zone" postings flex for the right multi-VM hire.

**Related: comp/employment structure.** The benefits (US medical, 401k, US/Canada residency) read like W2 US employment. You're on an EOR/contractor setup from Romania. Worth surfacing gently: "How do you handle employment for engineers outside the US - EOR, contractor?" Don't lead with it, but have it ready if comp comes up. Do NOT mention Sablier's wind-down.

### 2. Distributed systems / services (K8s, AWS, Docker)
Your production experience is contract-heavy, not backend-services/SRE. The role wants someone who operates production distributed systems.

**How to frame it (honest, not inflated):**
- Own it: "My production depth is on the contract and protocol side across EVM and SVM. On the services side I'm solid in TypeScript and have general systems experience from my C/C++ and C# days, but I haven't run production K8s/AWS at the level you'd want on day one - that's the part I'd ramp into."
- Then pivot to your paradigm-shift track record: you've repeatedly picked up new stacks (embedded C/C++ → C# desktop → Solidity/EVM → Rust/Solana/VM internals). This is your teachability proof.
- Don't fake AWS/K8s war stories. Matt Sevey ran decentralized-storage infra - he'll see through inflation instantly. Auditor-honesty plays well here.

### 3. TVM and intent/solver architecture
You haven't done TON (TVM) or built solver/intent systems or LayerZero/bridge integrations.
- TVM/alt-VMs are "emerging" - EVM+SVM is the core they need; frame TVM as a natural next VM to learn (you've learned VMs before - you literally forked one).
- On intents/solvers: show you understand the architecture (you now do - see product section) and are genuinely interested. Curiosity > false claims.

---

## Likely questions + crisp answers

**"Walk me through your background."**
> Smart-contract engineer, ~3.5 years in blockchain after 7+ in software. Started as a security auditor, then built at the protocol/VM level on EVM (a REVM fork, co-authored an EIP), then shipped two production Anchor programs to Solana Mainnet at Sablier. I work across both EVM and SVM, which is unusual, and I came in through security so I build with an auditor's eye.

**"Why Eco / why this role?"** (Have a real reason - recruiters filter hard on this.)
> The role is a near-exact match to what I already do - multi-VM contract work with Solana as a first-class chain, which most teams still treat as an afterthought. Intent-based cross-chain settlement is a genuinely hard problem I want to work on, and the multi-proof-system approach is a smart design. Small senior team, high ownership, real production stakes - that's the environment I want.

**"Tell me about SVM/Solana work."**
> Two Anchor programs live on Mainnet: Lockup - token vesting and streaming, linear by-the-second and tranched models; and Merkle Instant - airdrop campaigns with Merkle-proof claim validation. Both externally audited with no critical findings, and I led the technical comms with the audit team. Tested with unit and fuzz tests.

**"How comfortable are you on the services/backend side?"** → use the gap-#2 framing above.

**"Are you in a US/NA time zone?"** → use the gap-#1 framing. Be straight.

**"How do you handle high-pressure external deadlines?"** → Shipping audited programs to Mainnet and leading audit-team comms is exactly deadline-under-scrutiny work. Give a concrete example.

---

## Smart questions to ask (pick 3-4)

- "What does the highest-volume pod actually work on day to day - is it more new-chain integrations or partner-specific feature work?" (Shows you understand the bottleneck without quoting the internal doc.)
- "How's the work split between smart-contract development and the services around them for this role? What's the realistic ratio?" (Surfaces how much the distributed-systems gap actually matters.)
- "Solana's in your 15+ chains - how mature is the SVM side of Routes vs. the EVM side? Where does it need the most work?" (Plants your SVM value.)
- "You run five different proof systems - how do partners choose, and who owns that decision?" (Shows you did real homework on the product.)
- "What does the interview process look like after this, and what's the timeline?"
- "What's the biggest technical challenge the pod is facing right now?"
- "How does the team handle async vs. synchronous collaboration across time zones?" (Doubles as intel on the location question.)

---

## Logistics to nail down on this call

- [ ] Real-time overlap required vs. async? Is NA residency a hard requirement or a preference?
- [ ] Employment structure for non-US engineers (EOR? contractor? or US/Canada-only)?
- [ ] Comp range - and is it US-market or adjusted?
- [ ] Full interview process + timeline
- [ ] Is this titled "Senior"? (Notion page title says Senior; recruiter DM said "Software Engineer." Worth clarifying level + scope.)

---

## One-line reminders
- Lead with **multi-VM + Solana + auditor background**. That's your moat.
- Be **straight about time zone and distributed-systems** - honesty reads as senior, especially to an infra-founder HoE.
- **Don't** mention Sablier winding down. Don't quote the internal "Five Tens" term.
- This is a recruiter screen - Pat is selling you too. Warm, concise, confident.
