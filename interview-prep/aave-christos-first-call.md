# Interview Prep - Aave, First Call with Christos

**Company:** Aave (Avara / Aave Labs) - the blue-chip EVM lending protocol
**Role:** Staff Smart Contract Engineer
**Interviewer:** Christos Stergianos - Engineering Talent Relations Partner (confirmed recruiter, NOT an engineer)
**Format:** 20-30 min Google Meet, first round - "skills, experience, qualifications". SCHEDULED for 2026-07-21 (tomorrow).
**Freeze risk:** ~zero - a talent-partner screen has no live coding. Prep the narrative, not Solidity.
**Channel:** warm - PRB + Stani created a TG group; Aave is actively courting laid-off Sablier talent
**Scheduling reply:** `drafts/aave-christos-scheduling-reply.md`

---

## The honest read first (brutal, because you need it)

**Your own targeting rules flag this exact role as a stretch.** Per your profile, Staff/Senior Solidity-writing IC roles at EVM-primary protocols - Aave is *literally named* in that rule - are normally auto-skip, because your recent production work is Solana/Rust and your EVM strength is auditor + execution-layer (SabVM), not years of recent production Solidity. **Staff Smart Contract Engineer at Aave is arguably the single highest EVM/Solidity bar in the industry.** The codebase is elite, the security stakes are enormous, and Staff means you'd be among the people writing/reviewing the most critical lending code in DeFi.

**So hold two things at once:**
1. **Take the call.** It's a warm PRB/Stani intro through a channel where Aave is *proactively* trying to place Sablier people. Worst case: practice + networking + optionality, and possibly a placement at a different level/team than "Staff." Best case: they flex for the pedigree. Declining a warm Aave intro would be silly.
2. **Go in eyes-open.** If this advances past Christos, the technical rounds will be **harder than Perpl and pure Solidity** - no Solana credit, no "I'll ramp" softness. That makes two things non-negotiable before any technical round: the **anti-freeze protocol** (`technical-interview-under-pressure.md`) and **re-warming production Solidity + Aave's domain**. You just froze on an easy problem; Aave's bar is unforgiving. Don't walk into a Staff Solidity loop under-prepared on the freeze fix.

The first call itself is low technical risk - a 20-30 min screen is fit / story / motivation / comp / logistics, not live coding. So nail the narrative here; save the heavy technical drilling for if/when a technical round is booked.

## This is an EVM role - flip your framing

Everything defaults to your **EVM/Solidity + auditor + DeFi** identity, NOT Solana. Per your profile's EVM-CV rule, lead with the four EVM pillars:
- **Sablier V2 audits** (V2-core, V2-periphery, PRBProxy) - elite Solidity security review, and you led technical comms with the audit teams
- **SabVM / EIP-7809** - EVM-internals depth (context-stateful precompile, account-balance model, gas, journaling). Frame as *EVM internals*, not SC work.
- **Pharo ACM** - production Solidity authorship (Hardhat + Foundry)
- **Lobby3 / DeVox** - Solidity code review

Solana is the *recent* work and shows range, but it's not the headline for Aave. Mention it as "most recently I've been building production Anchor programs on Solana, but my roots and a lot of my depth are on the EVM side."

## Aave domain knowledge to have crisp (lending, not perps)

Good news: a lot transfers from the perps mechanics you just learned (liquidations, oracles, health/collateral). Aave is **overcollateralized lending**. Know the vocabulary well enough to hold a conversation:
- **Supply / borrow, aTokens** (interest-bearing supply receipts) and **debt tokens** (variable/stable)
- **Health factor** = weighted collateral / borrows; below 1 -> liquidatable (this is your perps "maintenance margin" analog)
- **Liquidations** - liquidators repay debt, seize collateral at a bonus
- **Interest rate model** - utilization-based (kinked curve), the reserve factor
- **Oracles** - Chainlink price feeds; oracle risk is the classic attack surface (you already know this from Perpl)
- **Flash loans** - Aave's signature primitive; understand the borrow-use-repay-in-one-tx pattern and its security implications (reentrancy, price manipulation)
- **LTV, liquidation threshold, isolation mode, e-mode, the GHO stablecoin** - at least recognize these
- **V3 architecture** at a high level (Pool, PoolConfigurator, portals, supply/borrow caps)

You don't need Aave-codebase depth for a 20-30 min screen, but showing you already speak lending fluently (via the liquidation/oracle knowledge you built for Perpl) lands well.

## Likely first-call questions + how to answer

- **"Walk me through your background."** EVM-first narrative: auditor on V2/PRBProxy -> EVM-internals R&D (SabVM/EIP-7809) -> most recently Solana programs. Continuity = security + protocol depth throughout.
- **"Why Aave / why this role?"** Blue-chip DeFi, the security-critical smart-contract work is exactly where your auditor instincts + protocol depth live, and the warm intro through the Sablier network. Genuine, not gushing.
- **"Why leaving Sablier?"** Live-conversation context is fine here (the whole channel exists because of it), but don't lead with wind-down as a sob story - frame forward: looking for the next place to do deep smart-contract work. Keep it brief and positive. (Never put wind-down in any written/uploaded material.)
- **"Tell me about your most security-critical work."** V2 audit (found/fixed vulns, led auditor comms) + SolSab (externally audited, no critical findings, you led the audit-team comms).
- **"How much recent production Solidity?"** Be honest and precise - Pharo was the last sustained authorship, since then audit + EVM-internals + Solana. Bridge via the SabVM/REVM depth (you've been *inside* the EVM, gas and all). Don't oversell.
- **Comp / logistics:** Staff-level comp; Aave is remote-friendly and distributed, so Iasi is fine. Have your range ready (see `config/profile.yml`).

## Questions to ask Christos (pick 3-4)

- "What does the interview process look like end-to-end, and what do the technical rounds focus on - live coding, take-home, or code review?" (This tells you what to prep, and reduces freeze risk via knowing the format.)
- "Which team / product area is this Staff role on - core protocol, GHO, a new initiative?"
- "What does 'Staff' mean here in terms of scope - IC depth, cross-team design, mentoring?"
- "Is the team distributed, and what timezone overlap do you need?"
- "What's the security process - internal review, external audits, formal verification, competitions?"

## Before any technical round (not the screen)

1. Run the **anti-freeze ritual** until it's reflex (`technical-interview-under-pressure.md`). This is now the #1 priority for the whole process.
2. Re-warm **production Solidity** + practical **gas optimization** (see `perpl-technical-deep-dive.md` sections 1 and 4 - they transfer directly).
3. Drill **Aave/lending mechanics** and do a few **CEI / reentrancy / oracle-manipulation** style problems out loud.
