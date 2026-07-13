# Aztec - Travis Call Prep (Solidity / L1 Contracts Focus)

**Date:** 2026-05-07 (tomorrow)
**Counterpart:** Travis - Global Talent Partner at Aztec (recruiter, not eng).
**Format:** Likely 25-30 min screening via Calendly link. Camera, casual.
**Pipeline so far:** Paul → Joe Andrews (co-founder) → Travis → Mitch (eng, deep dive).
**Hypothesis on role:** Solidity engineer to own/co-own the L1 (Ethereum) contracts that Joe described - rollup, staking, token, periphery. Possibly with a foot in Noir/Aztec.nr later, but L1 is the headline need.

---

## What Travis Cares About

A recruiter screening filters on three things: **legitimate background, role-fit signals, logistics.** Be sharp and specific on (1) and (2); for (3) just keep the door open.

What he'll ask, roughly in order:
1. Walk me through your background.
2. What are you working on at Sablier today?
3. What kind of role are you looking for next? Why Aztec?
4. Strengths in Solidity / EVM specifically (he's pre-screening for the L1 role).
5. Logistics - location, timezone, work authorization, contract vs employee, comp expectations.
6. Any questions for him.

His job is to decide: *does this person clear the bar to spend Mitch's time on?*
Your job is: *(a) clear that bar without overselling, (b) extract real info on the role, comp band, and process, (c) make him an ally inside Aztec.*

---

## Your Pitch (60-90 sec)

Open in this order. Use it as the answer to "walk me through your background":

> Software engineer since 2018, blockchain full-time for the last 3+ years.
> At Sablier I started as a security auditor on their Solidity protocol, then moved
> deeper into protocol-level work as the main contributor to SabVM - their fork of
> REVM, the Rust EVM - and co-authored EIP-7809 (Native Tokens). Most recently
> I shipped two Anchor programs to Solana mainnet, Lockup and Merkle Instant.
> So my range is Solidity + EVM internals, Rust, and Solana - with a security-first
> default from the audit days.
> Paul connected me to Joe. The L1 contracts scope Joe described - rollup,
> staking, token, periphery - is exactly the kind of work I want to own. Privacy as
> a foundation matters to me, and Aztec is one of the few teams actually shipping
> a real privacy L2.

**Why this works for the L1 role:**
- "Security auditor" lands hard for a contracts role - that's the floor they need.
- "Main contributor to SabVM" + "co-authored EIP-7809" = serious EVM / Solidity depth, not just userland.
- Solana is acknowledged but framed as range, not direction. He won't think you're trying to pivot away.

**Don't:**
- Don't say "I haven't written Noir." He didn't ask. If he asks about Aztec.nr / Noir specifically, see the Noir framing below.
- Don't dwell on Sablier products (streams, airdrops). Stay at the protocol layer.
- Don't oversell privacy passion - one sentence is plenty.

---

## What Their L1 Codebase Actually Is

You need a one-screen mental model so when Travis says *"the L1 stack"* you can speak fluently for 20 seconds and stop.

**Repo:** `AztecProtocol/aztec-packages`, default branch `next`, contracts under `l1-contracts/`. Foundry-based. Uses Bulloak + branching tree technique for tests. Custom solhint fork (LHerskind/solhint), Slither + Slitherin.

**Three layers under `src/`:**

### 1. Core - the rollup + bridge
| File | Job |
|---|---|
| `core/Rollup.sol` + `RollupCore.sol` | State machine. Tracks pending/proven checkpoints, processes `propose()` and `submitEpochRootProof()`, advances state, prunes on missed proofs. |
| `core/messagebridge/Inbox.sol` | L1→L2 messages. Users call `sendL2Message`, frontier tree per checkpoint, lag mechanism so a proposer can't consume their own slot's messages. |
| `core/messagebridge/Outbox.sol` | L2→L1 messages. Rollup inserts root after proof; portals consume with merkle paths. BitMap for nullification. |
| `core/messagebridge/FeeJuicePortal.sol` | Deposit fee-juice ERC20 from L1 (enqueues claim message), distribute fees back from rollup to L1. |
| `core/EscapeHatch.sol` | Emergency exit path. |
| `core/slashing/Slasher.sol` + `SlashingProposer.sol` | Slashing. Proposers vote during their slot (2-bit votes), round tally produces a `SlashPayload`, Slasher executes after delay unless Vetoer kills it. |

### 2. Governance - upgrade path + staking
| File | Job |
|---|---|
| `governance/Registry.sol` | Tracks the canonical Rollup version. Upgrade = new Rollup deployed + Registry updated. |
| `governance/Governance.sol` | Snapshot-based voting. Proposals are payload contracts that get executed. Timelock pipeline: votingDelay → votingDuration → executionDelay → gracePeriod. |
| `governance/GSE.sol` | **The staking contract.** "Governance Staking Escrow." Validators deposit ≥ ACTIVATION_THRESHOLD, register attester + BLS keys, optionally `moveWithLatestRollup` so they auto-migrate to new versions via a "bonus instance." 2-phase exit: `withdraw()` queues, `finalizeWithdraw()` settles after delay. Voting power is delegated through GSE to Governance. |
| `governance/CoinIssuer.sol` | Mints the AZTEC token within an annual budget cap. |
| `governance/RewardDistributor.sol` | Rollup pulls from this for sequencer/prover payouts. |
| `governance/proposer/GovernanceProposer.sol` + `EmpireBase.sol` | Proposer-side governance helpers. |

### 3. Periphery - upgrade payloads + helpers
| File | Job |
|---|---|
| `periphery/RegisterNewRollupVersionPayload.sol` | Payload that, when executed by Governance, registers a new Rollup in Registry + GSE. **This is the upgrade in practice.** |
| `periphery/SlashPayload.sol` + `SlashPayloadCloneable.sol` | Slashing payloads, cloneable for gas. |
| `periphery/DateGatedRelayer.sol`, `FlushRewarder.sol` | Time-gated execution and reward batching helpers. |

**Critical design point Joe was hinting at:**
Contracts are **non-upgradable** - no proxy, no UUPS. Every release means deploying fresh `Rollup.sol`, fresh whatever-changed, then a governance proposal to point the Registry + GSE at the new version. The "bonus instance" in GSE means active stakers automatically migrate to the new rollup if they opted in. **This is what Joe meant by "update all of the contracts in an immutable fashion."** The work is: plan changes carefully, ship them as a fresh deploy, write the migration payload, manage the governance vote.

**Token contract:** Not in `aztec-packages`. CoinIssuer mints from an external `IMintableERC20` - the AZTEC ERC20 itself lives elsewhere (likely a separate repo or shared contracts repo; `AztecProtocol/governance` is a sibling repo with AZIPs/AZUPs governance docs but not contract source). If Travis asks where the token is, say "I saw CoinIssuer in `aztec-packages` mints from an external mintable ERC20 - haven't traced where the token contract itself is deployed yet, do you know?"

### Mainnet Deployed Addresses (as of 2026-05)
For credibility, you can drop these if relevant:

- Registry: `0x35b22e09ee0390539439e24f06da43d83f90e298`
- Rollup: `0xae2001f7e21d5ecabf6234e9fdd1e76f50f74962`
- Inbox: `0x8dbf0b6ed495baab6062f5d5365af3c1b2ed4578`
- Outbox: `0xc9698b7adef9ee63f3bf5cff38086e4e836579f0`
- Governance: `0x1102471eb3378fee427121c9efcea452e4b6b75e`

Source: docs.aztec.network/networks. Don't rattle these off unprompted - it's name-droppy. But if you want to demonstrate seriousness ("yeah I pulled up the Etherscan for the deployed Rollup last night, it's ~"), have them ready.

---

## What "Maintain L1 Contracts" Actually Means

If Travis asks what you'd be doing day-to-day, lead with this. Six categories:

1. **Versioned redeploys.** Each protocol release = new Rollup (or affected contract) deployed, governance payload to register it, migration mechanics in GSE. Plan, write, test, ship.
2. **Audit & security maintenance.** They had a vuln in March 2026, fix targeted for v5 (July 2026). Ongoing: invariant tests, fuzz, slither, internal review, external audit coordination.
3. **Gas & DX optimization on `propose()`.** Sequencers call this every slot - any waste costs every operator forever. The `gas_benchmark` infrastructure is already there to track regressions per PR.
4. **Bridge integrity.** Inbox/Outbox correctness is where rollups historically lose user funds. Lag math, merkle proofs, BitMap nullification - all contract-side trust assumptions live here.
5. **Slashing & validator economics.** Tuning slash amounts, exit delays, veto authority, cloneable payload patterns. Economic security work, not just code.
6. **Test/CI/tooling.** Forge tests, Bulloak `.tree` files, gas snapshot diffs, slither markdown diff in CI. The repo standards are tight.

**Pick the angle that matches your CV best when answering.** For you that's likely (1), (2), (3) given SabVM and audit experience. (4) connects to your messaging-bridge work mental model from EVM. (5) is plausible but newer territory. (6) you're solid on - you ship Foundry tests on Sablier daily.

---

## Questions Travis Will Ask + What to Say

### "What's your Solidity / EVM depth?"
> Five-ish years writing and auditing Solidity, three years professionally. At Sablier
> I audited the V2 protocol, then maintained it. SabVM took me a layer below - I'm
> the main contributor to a Rust fork of REVM, so I work with EVM internals
> (opcodes, gas accounting, storage layout, precompiles) at a code level, not just
> as a Solidity user. That's also where EIP-7809 came from - we needed primitive
> token semantics in the EVM and ended up writing the spec. So the L1 rollup +
> bridge work is right in my zone.

### "Why are you leaving Sablier?"
> Not actively shopping - this came in via Paul. I love the Sablier work. But
> Aztec is one of two or three teams I'd seriously consider, and the L1 scope Joe
> described is too good to not explore. If it's a fit, great. If not, I keep doing
> what I'm doing.

(Cool, not desperate. Don't badmouth Sablier - Paul made the intro.)

### "Why Aztec specifically?"
> Three reasons. One, privacy as a base-layer property is one of the few things
> in this industry I think actually matters. Two, the contract scope is genuinely
> hard - non-upgradable rollup, GSE staking, governance-driven migrations - and
> rare. Three, I worked next to Paul long enough to trust his read on people, and
> Joe was sharp on the call. Team quality matters more than anything else.

### "Have you worked with Noir / Aztec.nr?"
> Not yet. I've read the framework docs and tried a couple of toy contracts in
> the sandbox, but I haven't shipped Noir in production. My instinct is that's a
> 1-2 month onboarding curve for someone with a Rust + Solidity + EVM
> background - the syntax and circuit constraints are new, but the mental model
> isn't far from constraint-based testing I've already done. Where Joe and I
> landed was that the immediate need is L1 / Solidity, which I can hit the ground
> running on, and Noir is something I'd ramp into over time.

(This is your prepared answer to the Noir gap. Don't volunteer it.)

### "What about Solana? Is that where you want to keep going?"
> Solana is a tool, not a destination. I shipped Anchor programs because Sablier
> needed them - similar with Cosmos earlier. The work I want to be doing is
> protocol-level, and the EVM ecosystem is where most of that lives. The L1
> rollup contract scope is much closer to what I want than maintaining Anchor
> programs.

### "Location? Timezone? Work authorization?"
> EU citizen, based in Romania, full timezone flexibility. I'd work as a
> contractor through my Romanian one-person company, or via EOR like Deel if
> entity structure requires it - Joe mentioned Deel is what Aztec uses, so that's
> straightforward.

### "Comp expectations?"
**Don't anchor here.** Travis isn't authorized to negotiate; if you give him a number it becomes the floor of the band he reports up. Deflect:

> I'd rather have that conversation once we both know the shape of the role and
> the equity / token component. Joe mentioned post-TGE equity and an EOR setup,
> which has tax implications I'm still working through with my accountant. Can
> you share the band Aztec has in mind for this level, and we can work from
> there?

If he pushes:

> Honestly, I want to understand the full package before throwing a number out -
> the equity grant, vesting, the EOR vs contractor structure, all of it changes
> the math by 20-30%. What's the band you're hiring this role within?

If he forces a number, give a wide range tied to total comp:

> For total comp on a senior protocol role at a well-funded L2 in this market, I'd
> expect the band to start around the high-200s base equivalent and scale with
> equity. But I'm flexible on the split.

(Reasoning: Aztec is a16z/Paradigm-backed at $125M raised, hiring senior protocol engineers. Senior protocol contractor day rates in this market are typically $1,000-$1,500/day = $250-$375K annualized. Equity adds another 0.05-0.2% post-TGE. Don't drop a hard $X number.)

---

## Questions to Ask Him

Pick 3-4. Don't fire all six.

1. **Scope confirmation:** "Joe described the L1 work as the rollup contract, the staking contract, the AZTEC token, and a few more. Is this hire scoped to L1/Solidity, or split between L1 and Aztec.nr / Noir?"
   *Why:* Pins down the Noir question without you raising it. If he says "primarily L1," you're golden.

2. **Team shape:** "Who would I work most closely with on the L1 stack? Is there an existing team I'd be joining, or is this building out a new pillar?"
   *Why:* spalladino is the lead per recent PRs - if he says "spalladino's team" you know the seniority dynamic. If he says "we're building this team out," that's a different signal.

3. **Process:** "What does the interview process look like from here? After you, what are the rounds and the timeline?"
   *Why:* always-ask, gets you the next-step shape. Likely Mitch deep dive next, then maybe a take-home or live coding, then leadership.

4. **The vuln:** "I'm aware there was an issue earlier this year that's tied to a v5 release in July. From a hiring standpoint, is that informing the kind of background you're looking for - more security-leaning, more shipping-leaning, both?"
   *Why:* Shows you've done your homework. Audit background is your strongest card; if he says "security-leaning matters a lot" you double-down on that in subsequent rounds.

5. **Comp band (if he hasn't given one):** "What's the band Aztec has in mind for this role? Just so we're calibrated."
   *Why:* puts the ball back in his court. He may not give you the number, but it's information either way.

6. **Token vs equity:** "Joe mentioned post-TGE equity instead of tokens. Is that the standard structure for this hire, or is there flexibility on tokens for someone joining this close to TGE?"
   *Why:* sets up the Mitch conversation. Equity is illiquid and tax-heavy via EOR; tokens (post-TGE) are liquid. The delta matters.

---

## Things to NOT Volunteer

- **Don't bring up the Sablier IP-assignment risk** (the AfterQuery risk applies less here since you'd be moving roles, not moonlighting). Aztec is fine on that front.
- **Don't bring up tax structure detail** - "EOR has tax implications, working through with my accountant" is enough.
- **Don't drop the "I haven't shipped Noir" line proactively.** Wait for the question.
- **Don't bring up the March 2026 vuln** unless he does first or you're using question #4 above strategically.
- **Don't talk about other companies you're talking to.** Implies you're shopping.
- **Don't quote a comp number first.** Ever.

---

## If It Goes Well

End with: *"Thanks Travis. From your side, anything else you need from me to move to the next round?"*

This makes him the gatekeeper-ally. He'll either say "no, you're set, you'll hear from me" or "send me a more recent CV / references / GitHub" - which is gold because now you know what was missing.

If he wants references, your strongest are: Paul (already in the loop), and one of your audit-firm contacts from the Sablier days.

---

## Cheat-Sheet (Last 5 min Before the Call)

- Six contracts you can name without thinking: **Rollup, Inbox, Outbox, GSE, Registry, Governance.**
- One-line on upgrades: **non-upgradable, redeploy + Registry update, GSE auto-migrates stakers.**
- One-line on you: **Solidity + EVM internals (SabVM, EIP-7809) + audit background.**
- Comp answer: **deflect to band, equity/EOR shape changes the math.**
- Noir answer: **haven't shipped, ramp expected, Joe and I aligned that L1 is the immediate need.**
- Three questions you'll ask: **scope, team shape, process timeline.**
