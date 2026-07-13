# Fireblocks - Recruiter Screening Brief

**Candidate:** Iaroslav Mazur (Solana Smart Contracts Engineer @ Sablier Labs)
**Fireblocks contact:** Mirit Aharon, Senior Talent Acquisition Partner. ~10 years in tech recruiting (prior: Anaplan, Dialog). Based in Israel.
**Inbound:** Cold LinkedIn message from Mirit citing "backend experience in the blockchain space".
**Role pitched:** Senior Backend Engineer. Work area named in the message: "DeFi connectivity, multi-chain integrations, transaction execution pipelines."
**Format:** Recruiter screen with TA. ~30 minutes. NOT a technical interview. Goal of the call (hers): basic fit, motivation, comp expectations, location, availability. Goal of the call (yours): get enough signal to decide if it's worth advancing.
**Time zone note:** June 2026, both you (Romania, EEST) and Mirit (Israel, IDT) are on UTC+3. No conversion needed.

> Treat this like dating, not interviewing. Mirit is screening for non-disqualifiers: comp wildly out of band, location mismatch, no interest in the company, attitude problems. Pass those and you advance. Don't oversell.

---

## 1. Fireblocks at a glance (June 2026)

**What it is.** Enterprise digital-asset infrastructure platform. Custody + policy engine + transaction routing + a settlement network, sold as one control plane to banks, exchanges, fintechs, PSPs, and crypto-native enterprises.

**Scale.** ~575 employees globally. 1,800+ institutional customers per Mirit's pitch (consistent with what the company is publishing). Supports 150+ public blockchains. The recruiter quotes "$8.5B" valuation. The last publicly-disclosed number is the **Series E from January 2022: $550M at $8B valuation**, co-led by D1 Capital and Spark Capital. "$8.5B" is either a marketing round-up or reflects a recent secondary not in press. Don't fact-check her on it.

**Funding history.**
- Series A (2020), B (2021), C (2021): rapid step-ups through the 2021 cycle.
- Series E (Jan 2022): $550M at $8B. Total raised since 2018: $1B+.
- No publicly disclosed post-2022 primary. Privately reported secondaries.

**Business model.**
- **Workspace subscription** (per-institution tier): mid-tier customers reportedly $10-50K/month.
- **Transaction fees** on volume routed through the platform.
- **Wallets-as-a-Service / NCW** (non-custodial wallets) subscription, sold to fintechs embedding crypto.
- **Network fees** on Fireblocks Network settlement traffic (institutional stablecoin / asset settlement layer).
- **Tokenization Engine** and add-on modules (DeFi, Staking, Web3 Engine).

**Customers (visible).** BNY, BNP Paribas, Revolut, eToro, Galaxy, Crypto.com, Susquehanna, Wintermute, BNP, ANZ, Nomura, Mastercard (Multi-Token Network pilot 2024), Visa-led stablecoin settlement pilot 2025 (three participating banks).

**Recent product / news (last 18 months).**
- **June 2026: Fireblocks Flow** - stablecoin acceptance infrastructure for PSPs and fintechs. Lets merchants accept any digital asset and settle in the stablecoin of choice. **This is the most relevant recent launch to namedrop.**
- **Jan 2026: Solana institutional treasury partnership.** Native program calls, gasless transactions (no SOL pre-funding for users), tokenization engine for compliant assets. Direct pitch to corporate treasurers.
- **2025: Web3 Engine expanded with Solana DeFi/dApps support.**
- **2025: 46 new chains added** in a single year. New node architecture with multi-node-per-chain redundancy, optimized load balancing, automated fallback. Transactions process 5x faster vs 2024.
- **Visa-led stablecoin settlement pilot** with Fireblocks as custody.
- **Mastercard Multi-Token Network pilot** (2024 stablecoin pilot).

**Competitive frame.**
- **BitGo** - older, more conservative, qualified custodian, more "trust company" than tech platform.
- **Copper** - London-based, ClearLoop settlement, strong in trading workflows.
- **Anchorage Digital** - the only OCC-chartered federal digital bank in the US. Different regulatory shape.
- **Coinbase Custody / Coinbase Prime** - vertically integrated with the exchange.
- **In-house builds** - the big banks' make-vs-buy decision. Fireblocks' pitch: don't reinvent MPC custody, plug us in.

**Headline differentiators in their own words.**
- MPC (multi-party computation) signing as the cryptographic primitive, with their in-house cryptography team.
- Policy engine for granular approval/automation flows.
- Fireblocks Network as a settlement-flow layer (network effects).
- 150+ chain coverage, deepest in market.

---

## 2. What Fireblocks actually sells (mental model + product stack)

**Acronym primer (so the rest of this section reads cleanly):**
- **MPC** = Multi-Party Computation. Cryptographic technique where a private key is split into shares held by different parties; signing requires multiple shares to cooperate, no single party ever holds the full key. Fireblocks' core moat.
- **MPC-CMP** = MPC using the CMP (Canetti-Makriyannis-Peled) protocol variant. Adds non-interactive presigning and faster signing rounds. Fireblocks-developed extension of the academic CMP scheme.
- **TSS** = Threshold Signature Scheme. Umbrella category of schemes MPC-CMP belongs to.
- **PSP** = Payment Service Provider. Companies like Stripe, Worldpay, Adyen, Checkout.com that move money on behalf of merchants. The target customer for Fireblocks Flow.
- **PSP vs fintech vs neobank in Fireblocks-speak:** PSPs = card/payments rails (B2B2C merchant acceptance); fintechs = embedded finance products; neobanks = consumer-facing app banks (Revolut, Nubank).
- **NCW / EW** = Non-Custodial Wallet / Embedded Wallet. Same product, renamed.
- **RWA** = Real-World Asset (tokenized fund shares, bonds, T-bills, real estate).
- **SGX** = Intel Software Guard Extensions. The trusted enclave Fireblocks uses to hold the server-side MPC share.

**One-line mental model.** A bank, exchange, fintech, trading firm, or payment processor wants to handle crypto / tokens / stablecoins safely at scale. Instead of building their own custody + chain integrations + signing infra + treasury + counterparty network, they buy Fireblocks. Think "AWS for institutional digital assets": customer brings the business logic, Fireblocks handles everything that touches keys, chains, and counterparties.

### Product stack

| Product | What it actually does | Concrete use case |
|---------|----------------------|-------------------|
| **Vault** (core custody) | Stores and manages wallets across 150+ chains using MPC-CMP signing. Keys split into shares; no single party (including Fireblocks) can sign alone. | A bank holds $500M of BTC for clients. Vault is where the keys live and how transactions get signed. |
| **Policy Engine** | Programmable approval rules: "transfers > $1M need 2 approvers", "DeFi calls only to whitelisted contracts", "withdrawals to non-KYC addresses blocked". | An exchange enforces multi-sig approval, AML rules, withdrawal limits, time-of-day controls. Customers describe this as the "real center of gravity" of the product. |
| **Fireblocks Network** | Private settlement layer connecting 2,000+ counterparties (exchanges, OTC desks, fiat providers, banks). Move assets between participants from a directory instead of copy-pasting addresses. | Wintermute settles a trade with Galaxy without either side touching a public address. Solves counterparty-address risk (typos, phishing, address-poisoning). |
| **Web3 Engine** | Umbrella for institutional dApp / smart-contract interaction. Sub-modules: DeFi, Staking, Tokenization, dApp browser via WalletConnect + MetaMask Institutional. | A hedge fund LPs into Uniswap v4 pools, stakes ETH via Lido, runs Solana program calls, all from one console with policy approvals on every tx. |
| **DeFi** (inside Web3 Engine) | Direct integrations into Uniswap (Classic + UniswapX), Solana programs, WalletConnect-enabled dApps. | Trading firm runs a market-neutral DeFi strategy with governance approvals on every swap. |
| **Tokenization Engine** (2.0) | No-code issuance of stablecoins and RWA tokens; LayerZero built in for cross-chain (35+ chains). Lifecycle: mint, distribute, freeze, burn, redeem. | A regional bank tokenizes a money-market fund and distributes it across Ethereum, Solana, Arbitrum. |
| **Non-Custodial / Embedded Wallets** (NCW / EW) | White-label MPC wallets for fintechs to embed. End users hold their own keys (one MPC share on device, one on Fireblocks server in SGX). | Revolut and Nubank ship the crypto wallets inside their apps using this. End customer thinks "Revolut wallet"; underneath is Fireblocks NCW. |
| **Treasury** | Treasury workflow product: cash / asset management, yield, stablecoin operations. | Corporate treasurer holds USDC + tokenized T-bills and runs sweeps and yield ops. |
| **Fireblocks Flow** (June 2026) | Stablecoin acceptance rails for PSPs and fintechs. Merchant accepts any digital asset; PSP settles in the stablecoin of choice. | Worldpay-style PSP lets a merchant accept payment in any stablecoin and receive USDC on Solana. Freshest launch; worth namedropping. |

The first three (Vault + Policy Engine + Network) are the historical core. Everything else is monetization expansion built on top of the same MPC infrastructure.

### Concrete problems Fireblocks solves (why customers pay)

1. **Single-point-of-failure key management.** Pre-MPC, institutional custody meant hardware-wallet-and-pray or cold-storage-with-manual-ops. MPC means no full key exists anywhere. The bedrock pitch.
2. **Chain coverage without chain teams.** Adding a new chain in-house = hiring engineers who understand its RPC, fee model, account model, finality. Fireblocks supports 150+ out of the box.
3. **Compliance and governance plumbing.** Approval flows, AML / KYC integration, full audit trail. Regulators and internal risk teams require this; building it is months of work.
4. **Counterparty settlement without exchange custody risk.** The Network lets a customer settle without leaving funds on an exchange (post-FTX, board-level concern).
5. **DeFi access with institutional controls.** Most banks and funds can't open a MetaMask and degen into Uniswap. Fireblocks adds policy gating, contract whitelists, simulation-before-broadcast.
6. **Stablecoin payment rails.** Flow turns stablecoins into a merchant-acceptance product for PSPs that historically only handled card rails.
7. **Tokenization without bespoke smart-contract teams.** A bank tokenizes a fund without hiring three Solidity engineers.

### Customer segments and how each one uses it

| Segment | Named customers | What they use Fireblocks for |
|---------|----------------|------------------------------|
| **Tier-1 banks** | BNY Mellon, BNP Paribas, ANZ, Nomura | Enter crypto without building. Offer custody to wealth and asset-management clients. Stablecoin settlement (Visa pilot 2025 ran on Fireblocks). |
| **Neobanks and fintechs** | Revolut, Nubank, eToro | Hold customer assets in direct custody (replacing exchange dependencies). Network to eliminate manual treasury ops. Embed NCW so end users get a wallet inside the app. Revolut also uses the API to ship new product. |
| **Crypto exchanges** | Crypto.com and others | Hot wallet management, withdrawal pipelines, counterparty settlement. |
| **Market makers and trading firms** | Galaxy, Wintermute, Susquehanna | Secure DeFi access at scale, multi-venue connectivity, off-exchange settlement via Network. |
| **Card networks and PSPs** | Visa (pilot), Mastercard MTN (pilot), Worldpay | Stablecoin settlement and acceptance, especially with Flow. |
| **Token issuers and asset managers** | Various RWA issuers | Tokenization Engine to mint and manage stablecoins and tokenized assets cross-chain. |
| **Crypto-native enterprises** | Many | Treasury, payroll, ops at scale on chain. |
| **Web3 apps and corporates** | Various | Embedded wallets (NCW) for end users, server wallets for programmatic flows. |

### How this maps to the role you're being pitched

Mirit's pitch ("DeFi connectivity, multi-chain integrations, transaction execution pipelines") maps to:

- **Web3 Engine / DeFi team** = the "DeFi connectivity" piece (integrating dApps and protocols)
- **Blockchain Integrations team** = the "multi-chain" piece (adding and maintaining the 150+ chain RPC + tx layer)
- **Wallets / Transactions team** = the "transaction execution pipeline" piece (signing orchestration, broadcasting, retries)

If "DeFi connectivity" is genuinely the headline, the most likely team is **Web3 Engine** or its DeFi sub-team. Confirm on the call.

**One-question shortcut for Mirit:** *"From your message it sounds like Web3 Engine or Blockchain Integrations. Which team is hiring, and is the role more on the DeFi-protocol-integration side or the new-chain-onboarding side?"* That gives you 80% of role clarity in one shot.

---

## 3. The role pitched (parsing Mirit's message)

Mirit wrote: *"DeFi connectivity, multi-chain integrations, transaction execution pipelines - billions of dollars move through decentralized networks daily."*

**Translated:** This is **backend infrastructure work**, not Smart Contracts work. Specifically the team(s) that:
- Maintain chain integrations (each new chain is an integration project: RPC clients, fee estimation, transaction signing, mempool semantics, finality models, gas/fee abstraction).
- Build the transaction execution layer: orchestrating signing (MPC), broadcasting, monitoring, retrying, gas bumping, replacement, batching.
- Integrate DeFi protocols (Uniswap, Aave, Jupiter, Lido, etc.) into the platform so customers can interact from inside Fireblocks' UI/SDK.

**Most likely teams that match this pitch (in priority order):**

| Team | What they do | Fit signal |
|------|-------------|-----------|
| **Blockchain Integrations** | Adds new chains, owns RPC layer, fee models, transaction lifecycle per chain | Strongest match to "multi-chain integrations" and your background |
| **DeFi / Web3 Engine** | Builds the abstractions over DEXes, lending, staking, bridges; SDKs for institutional DeFi access | Strongest match to "DeFi connectivity"; you've built the things they integrate |
| **Wallet / Transactions** | Wallet creation, key/signing orchestration, transaction submission infra | Match to "transaction execution pipelines" |
| **NCW / Embedded Wallets** | Wallets-as-a-Service for fintechs | Less likely from the pitch wording |

**Tech stack (confirmed from open Fireblocks postings):**
- **Mandatory: Node.js + TypeScript.** This is non-negotiable across Fireblocks backend.
- Microservices on AWS / GCP / Azure.
- Kubernetes, Docker, CI/CD.
- Relational + NoSQL databases.
- They mention AI in stack descriptions (likely internal tooling, not the headline).
- Cryptography / security is a *nice-to-have* on Wallet team postings, not a hard requirement.

**Honest read on Node/TS gap.** You have TS in your CV (test tooling for Anchor programs, Vitest). You do not have production Node.js services experience. This is the **single largest gap** for the role. They will ask. Have the answer ready.

---

## 4. The honest backend-vs-Smart-Contracts framing

Per your own positioning: **Smart Contracts is the passion. Backend is "open to it" if the work and comp are right.** Don't manufacture excitement you don't have.

That said, this specific role is **the most interesting flavor of backend a Smart Contracts engineer can take**. The reasons - which you can say out loud:

1. **Chain depth is the moat.** Fireblocks integrates with 150+ chains. Backend engineers who know one chain superficially are common; backend engineers who have shipped to Mainnet on both EVM and Solana and have implemented an EVM at the bytecode level (SabVM) are rare. Your background **uniquely qualifies** you to build the integrations.
2. **You know what you're integrating with from the inside.** When Fireblocks adds Solana support for native program calls (their Jan 2026 launch), they're integrating with programs like the ones you wrote. You're not learning Solana from docs; you wrote production Anchor programs that run on Mainnet.
3. **Transaction execution semantics is exactly your domain.** Fee models, nonce management, retry logic, signing flows, account models - these are the same primitives you reason about when writing the contracts.
4. **Scale of impact.** "Billions move through us daily" is real for Fireblocks. For a Smart Contracts engineer at a single protocol, the operational scale you touch is smaller. This is one of the few places where backend gives you scale that protocol work doesn't.

**What you do NOT say:**
- Don't claim backend has been your passion all along.
- Don't oversell Node/TS experience.
- Don't position this as a permanent pivot away from Smart Contracts work.

**The framing line, ready to deliver:**

> "I'm a Smart Contracts engineer first. The reason this role caught my attention specifically is the chain-depth angle - your platform integrates with 150+ chains and the new Solana native program calls work touches exactly the kind of programs I ship. I know that surface from the inside. I'd be productive on the integration side fast, and over time I'd want to see whether there's space to also touch the Smart Contracts side of what Fireblocks builds, but I'm coming in honest: I'm strongest where chains meet code."

---

## 5. Likely Mirit questions + your answers

This is a recruiter screen. The questions are predictable. Here are the high-probability ones with delivery notes.

### Q1: "Tell me about yourself."

60-90 seconds. Don't recite the CV. Lead with current focus.

> "I'm currently a Solana Smart Contracts Engineer at Sablier Labs. Last year and a half I shipped two production programs to Solana Mainnet - Lockup, which handles token vesting and streaming, and Merkle Instant, which handles airdrop campaigns with Merkle-proof claim validation. Both audited externally with no critical findings, both live now. I led the technical comms with the audit teams during the review cycles.
>
> Before Solana I was deep in EVM at Sablier: I started as the auditor for Sablier V2-core and V2-periphery in Solidity, then moved into protocol R&D. I was the main contributor to SabVM, our Rust fork of REVM where I implemented Multiple Native Tokens for EVM rollup designs, and I co-authored EIP-7809 with our CEO on that same topic.
>
> Before crypto I spent five years in industrial software - automotive embedded C/C++ at Continental, then desktop tooling at Bentley Systems. That's where I got the production discipline that I now apply to Smart Contracts.
>
> I'm available immediately. EU citizen, based in Romania, operate via my one-person company for B2B engagements with international companies."

### Q2: "Why Fireblocks? What got you interested?"

DO NOT lie. DO NOT manufacture enthusiasm. The honest answer is also a good answer.

> "Two specific things. One: the chain coverage. 150+ chains and the recent Solana native program calls launch - that's the kind of work where my background actually maps. I've shipped programs on Solana Mainnet; I know that integration surface from the inside, not from docs. Two: the scale. Billions in daily flow through your platform. For most Smart Contracts engineers the scale of operational impact is much smaller. That combination - chain depth meeting institutional scale - is rare."

### Q3: "What are you looking for in your next role?"

This is where the recruiter is screening for fit. Be direct.

> "Smart Contracts engineering is what I want to spend the next several years on. I'm open to backend or protocol-adjacent work if the chain-side work is genuinely the spine of the role - and from what you described, this sounds like that flavor. I'd want to understand what percentage of the work is integrating with chains and protocols versus pure service plumbing. I'd want the engineering culture to be rigorous; I came from auditing so I'm a stickler for correctness."

### Q4: "Why are you considering leaving Sablier?"

**CRITICAL: do NOT mention Sablier winding down.** This is a hard rule. Talk live in conversation if the topic comes up later; never in writing or to a recruiter you don't know.

> "I'm not actively running a search. I responded to your message because Fireblocks specifically caught my attention - the Solana institutional partnership and the chain-depth work. I'm open to a conversation when something interesting comes through."

If she presses ("are you looking?" / "what's your situation?"):

> "I'm exploring. Sablier is in a transition phase and I'm scoping what comes next. I'd rather have one or two strong conversations than run a wide search."

That's the most you should say. Don't elaborate.

### Q5: "What's your experience with Node.js and TypeScript?"

This is the one risky question. Be honest, don't overclaim.

> "I use TypeScript day-to-day for the test infrastructure around my Anchor programs - Vitest, anchor-bankrun, transaction simulation harnesses. I have not run production Node.js services. The TS itself I'm fluent in. The piece I'd ramp on is the server-side patterns - async at scale, observability, the microservices conventions. That's a few weeks of reps for me given the surrounding context I already have. I'd rather be honest about that than oversell."

### Q6: "What kind of compensation are you looking for?"

Anchor first. Don't lowball yourself.

> "I'm targeting $240K base. I weight the bundle - if the total package with tokens or equity is strong, I have flex on base. What's the typical range for a Senior Backend Engineer at Fireblocks for a remote contractor based in the EU?"

If pushed for a floor:

> "$180K base if total comp is strong. I'd rather pass than take a number that doesn't match the level of work."

**Note:** Levels.fyi data for Fireblocks is Israel-heavy and shows medians around $124K total - that's an Israel data point with low base and low equity. US/remote senior bands are higher. Your $240K target is in band for senior IC in US/UK/EU remote at a Series-E custody platform. Don't anchor on the Israel numbers.

### Q7: "Location and work setup?"

> "Based in Iași, Romania, EU citizen. Fully remote, full time zone flexibility - I overlap easily with Israel, Europe, UK, and US East Coast. I operate via a Romanian B2B contractor entity for international engagements. Open to that structure or to an EOR arrangement, whichever Fireblocks prefers."

Hard line per your policy: **on-site is a disqualifier.** If she says hybrid Tel Aviv or NY mandatory, be polite and end the conversation cleanly.

### Q8: "Availability / notice period?"

> "Available immediately. No notice period."

### Q9: "What does the rest of your process look like? Are you interviewing elsewhere?"

> "I have a couple of conversations in flight, nothing at offer stage yet. Happy to share specifics if it becomes relevant."

Don't name companies. Don't pretend you have offers you don't.

### Q10: "Any questions for me?"

See section 6.

---

## 6. Questions for Mirit (pick 3-4)

Recruiter-appropriate. NOT technical questions for engineers - save those for later rounds.

1. **"Which team specifically would this role sit in? The message mentioned DeFi connectivity, multi-chain integrations, and transaction execution pipelines - those could be three different teams. Which one is hiring right now?"**
   - Gets the team name. Critical for tailoring future rounds.

2. **"What does the interview process look like end-to-end? I've seen reports of 4-7 rounds at Fireblocks - what's the standard for this role and roughly what timeline?"**
   - Sets expectations. Public reports vary 1 week to 4 months. You want to know.

3. **"What's the remote and contractor policy? I'm based in Romania, operate via a one-person B2B entity. Is that a structure Fireblocks works with, or would EOR be the path?"**
   - Disqualifier check upfront. Don't waste rounds if the answer is no.

4. **"What's the comp band for this level and location? Base + tokens or equity, vesting structure?"**
   - Direct. Recruiters are paid to answer this. If she dodges, that's a yellow flag.

5. **"What's the team's current biggest engineering challenge? Is it chain coverage, throughput, reliability, something else?"**
   - Signals you think about the actual work.

6. *(If time)* **"How tightly do the backend teams collaborate with the cryptography team on MPC? Is that an interface engineers touch or is it abstracted?"**
   - Substantive technical curiosity without being a technical question.

**Don't ask:**
- "What does Fireblocks do?" (you already know - shows lack of prep)
- "Tell me about the culture." (recruiters give canned answers)
- "When do I hear back?" (lazy; ask "what's the process" instead)

---

## 7. Red flags to listen for

- **On-site mandatory.** Disqualifier. End the conversation politely.
- **Vague team scope.** If Mirit can't tell you which team, that's a sign the role is loosely defined - probe in a later round.
- **Comp band dodge.** "We don't share that yet" is acceptable from some recruiters but is also a signal they'll lowball. Push gently once.
- **Refusal to consider B2B contractor.** Some companies are EOR-only. Not a dealbreaker but it changes the take-home math (you may negotiate the gross up).
- **"Founding engineer" or "first hire" framing on a team of one.** At a 575-person company, this would be a smell.
- **No mention of tokens or equity.** Possible at this stage; revisit in offer round.
- **Heavy emphasis on on-call rotation without comp.** Custody platform = 24/7 production = real on-call burden. Ask.
- **Israel-only timezone overlap expectation.** Fine if it's still remote, but ask if there's a hidden expectation of 100% overlap.

---

## 8. After-call discipline

**Same-day actions:**
1. Send a short thank-you reply via the LinkedIn thread Mirit messaged you on. Reference one specific thing she said. Two sentences.
2. Update `data/applications.md`: add Fireblocks with status `Evaluated` or `Interview` depending on whether next steps are confirmed.
3. Write a brief `reports/{NNN}-fireblocks-2026-06-15.md` capturing what you learned: role specifics, comp band signal, process length, who you'd meet next.
4. If next step confirmed: ask Mirit by email *what specific format* the next round takes (live coding? system design? blockchain-specific? Node/TS-heavy?). Don't walk in blind.

**Decide before the next round:**
- Is the role within 70%+ of what you actually want? If not, decline cleanly.
- Is the comp likely in range? If clearly not, decline cleanly.
- Does the team owner / hiring manager look like someone you'd want to work with? Look them up on LinkedIn before the next round.

---

## 9. Pre-call checklist (next ~24h)

**Tonight:**
- [ ] Re-read this brief once. Practice the §4 answers out loud, especially Q1, Q2, Q4 (the "why leaving Sablier" one), and Q5 (Node/TS gap). The Q4 answer is the highest-risk one - rehearse so you don't slip and mention winding down.
- [ ] Skim two Fireblocks blog posts so you have something current to reference if natural:
  - *Fireblocks Web3 Engine Expands with Solana DeFi and dApps Support*
  - *Expanding Access to Solana* (Jan 2026 institutional partnership)
- [ ] Glance at Fireblocks Flow (June 2026 stablecoin acceptance launch) - it's the freshest news; if Mirit mentions PSP/fintech direction, you can connect the dots.
- [ ] Confirm video meeting link, calendar invite, time. Confirm the time zone (Israel = UTC+3 in June, Romania = UTC+3 in June, same TZ - low risk but double check).

**Hour-of:**
- [ ] Quiet room. Camera + mic test 20 min before. Power + battery.
- [ ] LinkedIn DM thread with Mirit open in a tab so you can quote her own pitch back.
- [ ] CV ready to share if asked - `cv.md` rendered, or send the PDF in chat if she asks.
- [ ] Water. Recruiter screens often run over 30 min.
- [ ] This brief open on a second screen. Not as a script - as a glance-able cheat sheet.

**State of mind:** You are not selling yourself to a job. You are evaluating whether Fireblocks is worth your next round. The frame is mutual screening.

---

## Sources

- [Fireblocks - Sacra company profile (funding, customers, business model)](https://sacra.com/c/fireblocks/)
- [Fireblocks Series E announcement - $550M at $8B (Jan 2022)](https://www.fireblocks.com/press/fireblocks-raises-550-million-in-series-e-funding-to-become-the-highest-valued-digital-asset-infrastructure-provider)
- [Fireblocks Review 2026 - MPC custody, policy engine, treasury controls (CryptoAdventure)](https://cryptoadventure.com/fireblocks-review-2026-mpc-custody-policy-engine-treasury-controls-and-enterprise-tradeoffs/)
- [Fireblocks Flow launch - stablecoin acceptance for PSPs and fintechs (June 2026, PRNewswire)](https://www.prnewswire.com/news-releases/fireblocks-launches-flow-stablecoin-acceptance-for-psps-and-fintechs-302788865.html)
- [Solana x Fireblocks institutional treasury partnership (Jan 2026)](https://blockchain.news/news/solana-fireblocks-enterprise-treasury-infrastructure)
- [Fireblocks Web3 Engine - Solana DeFi and dApps support](https://www.fireblocks.com/blog/fireblocks-web3-engine-expands-with-solana-defi-and-dapps-support)
- [Fireblocks supports 150 public blockchains (blog)](https://www.fireblocks.com/blog/leader-in-public-blockchain-support-coverage)
- [Fireblocks 2025 infrastructure takeaways](https://www.fireblocks.com/blog/2025-digital-assets-takeaways)
- [Senior Backend Engineer, Wallet (job posting, Tel Aviv)](https://jobs.theblockchainassociation.org/companies/fireblocks/jobs/41171624-senior-backend-engineer-wallet)
- [Senior Backend Engineer, Assets Team (Greenhouse)](https://job-boards.greenhouse.io/fireblocks/jobs/4653838006)
- [Fireblocks careers page](https://www.fireblocks.com/careers)
- [Fireblocks salaries (Levels.fyi - Israel-skewed)](https://www.levels.fyi/companies/fireblocks/salaries/software-engineer)
- [Fireblocks Glassdoor reviews (3.8/5, 199 reviews, 69% recommend)](https://www.glassdoor.com/Reviews/Fireblocks-Reviews-E3531358.htm)
- [Fireblocks interview questions (Glassdoor)](https://www.glassdoor.com/Interview/Fireblocks-Interview-Questions-E3531358.htm)
- [Mirit Aharon - LinkedIn profile](https://www.linkedin.com/in/mirit-aharon-a191a597/)
- [Fireblocks Developer Docs - multichain SDK](https://developers.fireblocks.com/reference/sdk-multichain-deployment)

---

## 10. Salary / comp negotiation thread (WhatsApp, June 2026)

**Where it stands:**
- My expectation stated: $160k/yr (~727k RON) gross (B2B).
- Mirit: that's high vs budget. Clarified Fireblocks hires via EOR, paid in RON.
- Mirit asked for **net** expectation for an **FTE/IEC** contract.
- Mirit's budget for the role: **415,000 - 559,000 RON gross/year**, based on experience level.
- Gap: their range sits below my target. Goal: continue interviews to taste the process, hold position, revisit comp at the end.

### Reply draft (to send)

Thanks for laying that out, Mirit, that's really helpful.

One note on the structure first: I'd strongly prefer a B2B collaboration (invoicing through my own one-person company) over an FTE/IEC contract. The reason is purely tax efficiency - in Romania, the same gross amount ends up roughly 15-20% higher in net under B2B than under standard employment. So my B2B gross and your IEC gross figures aren't quite comparable one-to-one.

On the numbers themselves: I'll be upfront that the range you mentioned sits below what I'm targeting. But I don't think we need to settle that today. I'm genuinely interested in the role and the team, so I'd rather move forward with the interviews, let both sides get a real read on the fit, and come back to compensation toward the end once we have a clearer picture. There's usually more room to find common ground once there's mutual conviction.

Would that work for you? Happy to keep things moving on scheduling in the meantime.

### Strategy notes

- **"sits below what I'm targeting"** keeps me anchored above their range without naming a new number or rejecting outright. Don't appear to accept anything.
- **Deferring the net figure** - Mirit asked for net expectation; declining to hand over a single number now keeps leverage and avoids re-anchoring low.
- **B2B framing as a comparison correction, not a demand** - plants the 15-20% delta so that when revisiting comp, their 559k IEC gross ceiling effectively reads ~15-20% lower than an equivalent B2B figure I'd quote.

**Decision to prep:** If Mirit pushes "I need a net number to move forward," decide whether to give a soft net range or keep holding. Recruiters often can't advance internally without some figure on file.

### Update (2026-06-22): Mirit's response

Mirit replied:
- Appreciated the upfront framing.
- **B2B/contracting is off the table.** Company-wide policy, not her call, no flexibility regardless of market. Role is **FTE-only**.
- She did NOT push back on deferring the comp discussion (the postpone-to-end framing landed).

**Implication:** The 15-20% B2B net advantage is gone. The real comparison is now FTE net vs. my target, and their 559k RON gross ceiling is the hard top. The gap (~559k top vs. ~727k target) is structural, not just a framing artifact. Postpone is still correct, but go into interviews knowing the budget stretch needed is real (~23-30%).

### Reply draft (to send)

Hi Mirit,

Thanks for confirming, that's clear and I appreciate you being straightforward about it. Understood that the role is FTE-only and that B2B isn't on the table - no problem, I'm happy to proceed on that basis.

As for compensation, my suggestion still stands: let's move forward with the interviews so both sides can get a real read on the fit, and circle back on numbers toward the end. I'm genuinely interested in the role and the team, and I'd rather we get to know each other properly before settling that part.

Looking forward to the next steps. What do they look like?

### Strategy notes (this reply)

- **Concede the structure cleanly, hold the number.** Accepting FTE costs nothing now (it's non-negotiable anyway) and buys goodwill; conceding comp would not. Keep them separate.
- **Do NOT re-state the target number.** Repeating ~727k here just reopens the haggle the message is trying to park. Stay light on numbers.
- **Close with a forward question** ("What do they look like?") to keep momentum and put the next move on her.
- **Leverage plan:** let interviews build mutual conviction so there's a reason for them to stretch the budget at the end. The gap is structural, so conviction is the only lever.
