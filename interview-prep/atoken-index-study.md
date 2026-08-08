# aTokens and Indexes - study block (Miguel territory)

Method: same as `vault-formula-sheet.md` - every formula gets an English sentence and a
tiny-numbers check. Bridge everything back to the 4626 share model you already know.

---

## 0. The bridge (memorize this first)

A 4626 vault: your SHARE COUNT is fixed, the SHARE PRICE grows, `balanceOf` shows shares.
An aToken: same machine, different display - `balanceOf` multiplies before showing:

```
4626:    balanceOf(you) = shares                      (price shown separately)
aToken:  balanceOf(you) = scaledBalance x liquidityIndex   (price baked into the number)
```

Sentence: **an aToken is a vault share that multiplies by the share price before showing
you the number.** scaledBalance = shares. liquidityIndex = share price. Everything you
know transfers 1:1.

Consequence: 1 aUSDC always equals 1 USDC (redeemable at par); yield appears as your
BALANCE growing, not the price growing. This is called rebasing. The 4626 view (fixed
balance, growing price) is non-rebasing. Aave ships both: aToken (rebasing) and the
stata/static wrapper (4626-style, for integrations that cannot handle balances that
move on their own).

## 1. What is stored vs what is computed

```
storage:   scaledBalance(you)                (written only when YOU act)
storage:   liquidityIndex                    (written on every pool interaction)
computed:  balanceOf(you) = scaledBalance x liquidityIndex     (on READ, every call)
```

On supply of `a` assets:    scaledBalance += a / liquidityIndex
On withdraw of `a` assets:  scaledBalance -= a / liquidityIndex

Units check (tool 1): a [assets] / index [assets per scaled unit] = [scaled units]. Same
as shares = assets x S/A with index playing A/S.

Tiny numbers (tool 2): index 1.00 at launch. Supply 100 -> scaled 100. Two years later
index 1.10 -> balanceOf = 110. Supply another 110 now -> scaled += 100. Symmetric.

**THE MISCONCEPTION TO NEVER VOICE: nothing is minted per block.** No loop touches user
balances, ever. Your balance "grows every second" because balanceOf recomputes
scaled x index on each read, and the index embeds elapsed time. Interest accrues TO THE
INDEX, not to users.

## 2. The index

Sentence: **the index is the cumulative growth factor since day one - the share price,
starting at 1.0.** Stored in RAY = 27-decimal fixed point (1 RAY = 1e27); rayMul/rayDiv
are just multiply/divide that keep 27 decimals.

Why an index at all: O(1) accrual. One storage write updates the implied balance of
every supplier simultaneously. The alternative (loop over users) is impossible on-chain.
This is THE design idea of the whole system.

When does it update: **lazily, on every state-changing interaction with the reserve**
(supply, withdraw, borrow, repay, liquidation, flash loan). Each interaction
fast-forwards the index by "rate x time since last update", then applies the action.
Between interactions the index is stale in storage but every read computes the
up-to-date value the same way.

## 3. Two indexes, two growth laws

```
liquidityIndex      (supply side):  index *= 1 + rate x dt          LINEAR between updates
variableBorrowIndex (debt side):    index *= (1 + rate/sec)^dt      COMPOUND (approximated)
```

(dt in seconds, rate annualized, sec = seconds per year. The compound formula is
computed with a 3-term binomial expansion in MathUtils - "approximated Taylor" is
enough said.)

Why the asymmetry (favorite interview question):
- Debt compounds: interest on unpaid interest is the correct economics of a loan, and
  it favors the protocol.
- Supply is linear BETWEEN updates: simple interest slightly understates true
  compounding, so suppliers are credited a touch less than borrowers are charged.
  Direction of error favors the protocol -> solvency, never insolvency.
- Practical gap is tiny because busy pools update many times a day, and every update
  multiplies the index (so supply effectively compounds at interaction frequency).

Sentence: **debt compounds continuously, deposits accrue simply between touches - both
asymmetries lean the same way: the pool can pay what it owes.**

## 4. Where the rate comes from (the kinked curve)

```
U = totalDebt / totalLiquidity                    (utilization)
borrowRate = base + slope1 x U/Uopt                     (below the kink)
           = base + slope1 + slope2 x (U-Uopt)/(1-Uopt) (above the kink - steep)
liquidityRate = borrowRate x U x (1 - reserveFactor)
```

Sentences: **utilization is the lever; the kink makes the last liquidity expensive** (so
the pool never fully drains - withdrawals stay possible). **Suppliers earn the
borrowers' rate, scaled by how much of the pool is actually working (U), minus the
protocol's cut (reserveFactor).**

Conservation (tool 4): interest paid by borrowers = interest credited to suppliers
+ treasury cut (reserveFactor, minted to treasury as aTokens) + small slack from the
linear-vs-compound gap and rounding, which stays in the pool as buffer. If someone
earns, name who pays: suppliers earn because borrowers pay.

## 5. Debt tokens

variableDebtToken = the same scaled pattern against variableBorrowIndex:

```
debtOf(you) = scaledDebt x variableBorrowIndex     (grows on read - you owe more)
borrow a:  scaledDebt += a / variableBorrowIndex
repay a:   scaledDebt -= a / variableBorrowIndex
```

Non-transferable, non-approvable. Sentence: **you cannot push a liability to someone
who did not sign for it.** (Also blocks trivial "transfer debt away, withdraw
collateral" exploits.)

Stable-rate debt existed, was economically fragile and an attack vector, got disabled
and removed - "stable rate borrowing is deprecated" is all you need, plus the Stable
Vaults contrast: fixedness moved from inside the rate model to an operator's balance
sheet on top of variable rates.

## 6. Full lifecycle, tiny numbers (rehearse out loud)

Launch: both indexes 1.0. Reserve factor 10%. 
1. Alice supplies 1,000 USDC -> scaled 1,000. 
2. Bob deposits collateral elsewhere, borrows 500 USDC -> scaledDebt 500. U = 50%.
   Say borrowRate lands at 10%; liquidityRate = 10% x 0.5 x 0.9 = 4.5%.
3. One year passes, nobody touches the pool. Storage still shows old indexes.
4. Bob repays in full. The interaction first fast-forwards indexes:
   variableBorrowIndex ~ 1.105 (compound 10%), so Bob owes 500 x 1.105 ~ 552.5.
   liquidityIndex ~ 1.045 (linear 4.5%), so Alice's balance reads ~1,045.
5. Checks: Bob paid ~52.5 interest; Alice earned 45; treasury accrued ~5.25 in aTokens;
   remainder is the pool's linear-vs-compound slack. Nobody's balance was ever
   "updated" - only two index writes happened.

## 7. Rounding note (connect to your strength)

WadRayMath rounds HALF-UP (adds half the denominator before dividing) - round to
nearest, unlike 4626's strict directional rounding. Fine for index math where errors do
not accumulate directionally; the 4626-style wrappers on top apply directional rounding
at their boundary. If asked "is half-up safe in a vault?": not by itself - security
wants worst-case direction; nearest wants average fairness. Name the difference, cite
that newer Aave code adds explicit floor/ceil variants where an adversary could farm
the half.

## 8. When losses are too big for the slack: deficit accounting + Umbrella (MUST-KNOW, April 2026)

Three loss-absorption layers, by size:

```
dust losses      -> unbooked slack (claim-free assets; no variable, no event)
real bad debt    -> reserve.deficit (v3.3, explicit uint128) -> Umbrella slashing
legacy era       -> governance treasury proposals (e.g. CRV bad debt, Nov 2022, ~$1.6M)
```

Mechanics with code anchors:
- Bad debt is CREATED in `LiquidationLogic.executeLiquidationCall`: when a liquidation
  seizes ALL remaining collateral and debt is left over (`hasNoCollateralLeft`), the
  leftover debt tokens are burned (`_burnBadDebt` -> `_burnDebtTokens`) and the amount is
  added to `reserve.deficit`. Claims (aTokens) stay untouched - the hole is now BOOKED.
- Deficit is ELIMINATED via `Pool.eliminateReserveDeficit(address asset, uint256 amount)`,
  guarded `onlyUmbrella` - the Umbrella staking contract supplies aTokens which get
  burned, shrinking claims back to match assets. Read it: `Pool.getReserveDeficit(asset)`.
- The slack itself has NO code path to cover anything - it works by not existing as a
  claim. `AToken.rescueTokens` even has `require(token != _underlyingAsset)` so it can
  never be swept.

**The live event (know this cold for the interview):** 2026-04-18, KelpDAO cross-chain
bridge exploit, ~116.5k rsETH (~$292M) stolen; attacker posted stolen rsETH as Aave
collateral and borrowed WETH; liquidation found the collateral worthless -> ~$200M WETH
bad debt. As of 2026-07-27 on-chain: `reserve.deficit` for WETH ~= 52,964 WETH; DAI
~= 2,700 DAI. First major real-world test of Umbrella's automated slashing coverage.
Measured slack the same day (my own eth_call sweep): USDC ~+31.4k on 2.14B supply
(~0.0015%), USDT ~+405, DAI ~+53 - dust, exactly as theory predicts.

Sentence: **dust dies in the slack silently; real bad debt gets booked in
`reserve.deficit` and paid by Umbrella stakers - nothing "behind the curtains."**

## 9. Rapid-fire drill (answers in one sentence each, out loud)

1. Why does my aUSDC balance grow with no transactions? -> balanceOf recomputes
   scaled x index on read; the index embeds elapsed time; nothing is minted.
2. What is written to storage when I supply 100 USDC? -> your scaledBalance rises by
   100/index; the reserve's index and rates are refreshed; nothing else per-user.
3. Why is the debt token non-transferable? -> liabilities need consent; transferable
   debt = dump-your-loan exploit.
4. Why does debt compound but supply accrue linearly? -> correct loan economics vs
   protocol-favorable understatement; both errors point toward solvency.
5. What triggers an index update? -> any state-changing pool interaction; lazy
   fast-forward by rate x elapsed time.
6. aToken vs 4626 vault in one line? -> same share model; aToken multiplies by the
   share price before showing the number (rebasing), 4626 shows raw shares.
7. Where does the supplier yield come from? -> borrowers' interest, scaled by
   utilization, minus the reserve factor.
8. What is RAY? -> 27-decimal fixed point; rayMul/rayDiv keep index math precise.
