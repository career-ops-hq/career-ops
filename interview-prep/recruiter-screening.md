# Recruiter Screening - Answers

## 1) In which area do you have the strongest hands-on experience?

**Solana protocols** and **Other (EVM smart contracts + VM-level work).**

- **Solana protocols.** I'm currently a Solana Smart Contracts Engineer at Sablier Labs. I designed and shipped two production Anchor programs deployed on Solana mainnet:
  - **Lockup** - a polymorphic token vesting/streaming engine supporting linear (by-the-second) and tranched models. Integrated MPL Core NFTs as transferable stream-ownership tokens, Chainlink oracles for dynamic fee conversion, and dual SPL Token + Token2022 support.
  - **Merkle Instant** - a configurable airdrop-campaign program. Each campaign is its own PDA holding the Merkle root, the claim window, the fee config, and the remaining deposit; recipients claim a per-leaf amount (variable amounts encoded into the leaves) by submitting a Merkle proof, with double-claims prevented at the account level via per-claimant claim-receipt PDAs. After the expiry window the creator can clawback the unclaimed balance. Supports SPL Token + Token2022 deposits and shares the Chainlink-priced fee conversion path with Lockup.
  - Wrote the full test suite (unit, end-to-end, fuzz) with anchor-bankrun and Vitest, including time-travel simulation.
- **Other - EVM smart contracts + VM-level work.** Audited Sablier V2-core, V2-periphery, and PRBProxy. Was the main contributor to SabVM (Sablier's fork of REVM, the Rust EVM), where I implemented the Multiple Native Tokens (MNT) feature for EVM rollup designs. Co-authored EIP-7809 (Native Tokens).

## 2) What crypto applications do you use every day?

- **Wallets:** Rabby and Phantom (browser + mobile), plus hardware wallets for cold storage.
- **Swap aggregators:** Jupiter on Solana; 1inch / Matcha / CowSwap on EVM.
- **Meta-aggregators / discovery:** DefiLlama (swap meta-aggregator, yield rankings, TVL).
- **Bridges:** Across, Stargate, deBridge, Jumper / LI.FI - whichever route is best at the moment when I need to move across chains.
- **Yield / lending protocols:** Fluid, Silo, Aave, and similar.
- **Block explorers:** Solscan, Etherscan, Solana Explorer.
- **Portfolio tracking:** DeBank, Zerion.

## 3) Do you have experience with on-chain logic?

Yes - it's my day-to-day work.

- **Solana (Anchor / Rust).** At Sablier Labs, I built the Lockup and Merkle Instant programs end to end: account model and PDAs, instruction handlers, the streaming math (linear and tranched), NFT-as-stream-ownership transfer flows via MPL Core, Chainlink-priced fee conversion, dual SPL Token + Token2022 support, the Merkle-proof airdrop campaign logic (campaign PDA, per-claimant claim receipts, variable per-leaf amounts, creator clawback after expiry) - plus the full unit / e2e / fuzz test suite (anchor-bankrun, Vitest).
- **EVM (Solidity + Rust at the VM level).** Audited Sablier V2-core, V2-periphery, and PRBProxy. Main contributor to SabVM (Sablier's REVM fork), where I implemented the Multiple Native Tokens (MNT) feature. Co-authored EIP-7809 (Native Tokens).
