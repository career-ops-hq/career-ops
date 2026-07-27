# Vault Formula Sheet - think in sentences, derive the symbols

Scope: vault infrastructure only (ERC-4626 + Stable Vaults). aTokens/indexes deliberately
excluded until studied. Companion to `aave-technical-deep-dive.md`.

The method: every formula below comes with (a) its English sentence and (b) the thinking
tool that rederives it. In the verbal round, SAY THE SENTENCE; use tiny numbers if pushed
for precision. Nobody will ask for symbols on a whiteboard.

---

## 0. The five thinking tools

1. **Units cancel.** Write the unit next to every quantity (assets, shares, assets/share).
   A formula is correct iff the units cancel to the unit you want. This replaces
   memorizing "do I multiply or divide."
2. **Tiny numbers.** Substitute 1, 2, 10, 10,000 and compute. Ten seconds of arithmetic
   beats a minute of symbol-staring, and it reads as rigor in an interview.
3. **Extremes.** Push a variable to 0 or huge. S -> 0: share price explodes (empty-vault
   attacks live here). A up with S fixed: price rises (that is what yield is).
4. **Conservation.** Accounting never creates value. If someone gained, name who lost.
   Every vault-security question is secretly this question.
5. **One sentence per formula.** If you cannot say it in English you do not own it yet.
   If you can say it, you can rebuild the symbols live.

---

## 1. The master formula

```
P = A / S        price of one share = totalAssets / totalShares
```

Sentence: **one share is worth its slice of the pot.**

## 2. The two conversions

```
assets = shares x A/S
shares = assets x S/A
```

Sentence: **multiply by the ratio whose bottom is what you have, top is what you want.**
Check: `shares x (assets/shares) = assets` - the unit "shares" cancels. Two seconds,
rederivable forever.

## 3. Four functions = two formulas x two rounding directions

| Function | You fix | Vault computes | Formula | Rounds |
|---|---|---|---|---|
| deposit  | assets in | shares out | a x S/A | down |
| mint     | shares out | assets in | s x A/S | up |
| withdraw | assets out | shares burned | a x S/A | up |
| redeem   | shares burned | assets out | s x A/S | down |

Generator sentence: **the computed amount is rounded in the vault's favor** - computed
thing flows TO user -> round down; flows FROM user -> round up.
Why it is a security property: any user-favoring rounding can be looped to drain dust.

## 4. Rounding, mechanically (Solidity)

```
floor:  a / b                              (native truncation; floor for uints)
ceil:   a == 0 ? 0 : (a - 1) / b + 1      (OZ ceilDiv; naive (a+b-1)/b can overflow)
bump:   z = a / b; if (a % b != 0) z += 1
mulDiv: full-precision multiply-then-divide (512-bit intermediate) - use for x*y/d
        because x*y alone can phantom-overflow; ceil variant: +1 if mulmod(x,y,d) != 0
nearest (Aave WadRayMath): (a*b + HALF_RAY) / RAY  - add half the denominator first
```

Sentences: **ceil = floor plus bump-if-remainder.** **Never write x*y/d raw; phantom
overflow.** **Half-up = add half the denominator before dividing.**

## 5. Inflation attack as one inequality

Victim mint: `shares = d x S/A` (integer). Truncates to zero when:

```
d < A/S        deposit smaller than the price of ONE share -> zero shares
```

Attack recipe (fresh vault): deposit 1 wei (S = 1, sole holder), donate 10,000
(A = 10,000; one share now costs ~10,000), victim deposits 9,999 -> 9,999 x 1 / 10,000
= 0 shares -> attacker's single share claims everything.
Profit conditions (both required): **attacker holds ~all shares** (else donation leaks
pro-rata to others - conservation tool) and **price of one share > victim deposit**
(rounding tool). Mature vaults kill condition one; that is why it is the
FIRST-DEPOSITOR attack.

## 6. Mitigations

| Mitigation | Formula/mechanism | Trade-off |
|---|---|---|
| Virtual offset (OZ default) | `shares = a x (S + 10^d) / (A + 1)` | none material; pick d |
| Dead shares (UniV2 style) | burn first 1000 shares to address(0) | needs seed liquidity, dust loss |
| Internal accounting | totalAssets = tracked variable, not balanceOf | donations stuck (sweep = admin surface); does NOT remove truncation itself |
| Zero-share guard | `require(shares != 0)` on mint paths | none; belt-and-braces |

Virtual offset sentence: **phantom shares the attacker cannot own, so the donation leaks
to a ghost** - price per share is capped near A/10^d, so making one share cost X now
costs X x 10^d. Attack cost = 10^d times the potential gain.
Internal accounting sentence: **no asset delta without a share delta** - closes the
donation channel, not integer truncation (legit high price + dust deposit can still
round to zero -> keep the zero-share guard).

## 7. Yield and the sandwich

```
yield recognized: A -> A + H, S unchanged  =>  P jumps by H/S
attacker with fraction f of shares captures f x H
streaming over period T: capture ~ f x H x (t_held / T)  ->  ~0 for one block
```

Sentences: **yield = assets grow, supply does not.** **A step in share price is an
extractable event; streaming smears the step so flash capital earns nothing.**
Access control on harvest() stops attacker-TRIGGERED recognition, not sandwiching of a
predictable harvest - the victim of a sandwich is a price jump, not a function.

## 8. Stable Vaults in two formulas

```
balance(t) = shares x C(t)      C(t) compounds at the SubVault's locked per-second rate
surplus    = actualAssets - SUM(obligations)
interest redemption allowed only when surplus >= 0 (principal senior, not gated)
```

Sentences: **your balance follows a smooth curve that depends only on time.**
**The jagged real yield lands in the surplus; above the promise it is operator revenue,
below it the vault stops paying out interest it does not have.**
Bonus insight: because C(t) is deterministic, an integrator can mirror user balances
off-chain with zero chain reads and reconcile exactly.

## 9. Preview vs convert (one line each)

```
convertToX: idealized A/S rate, NO fees, must not revert  -> display/accounting
previewX:   exact simulation of the real call, fees + same rounding -> quotes/slippage
maxX:       caller-specific limits, checked before previewX
```

Sentence: **convert is the poster on the wall, preview is the cashier's quote, the call
is the receipt.**

---

## Drills (do until ~30s each, out loud)

1. From the single sentence "computed amount rounds in the vault's favor", regenerate
   the full four-function table (section 3) on paper.
2. Run the inflation attack end to end with numbers: 1 wei first deposit, 10,000
   donation, 9,999 victim deposit. State attacker P&L and both profit conditions.
3. Virtual offset with d = 3: how much must the attacker donate to make one share cost
   10,000? (Answer shape: ~10,000 x 1000 - state why: phantom supply of 10^3 keeps the
   denominator big.)
4. Sandwich drill: vault has 100k shares; harvest adds 10k assets; attacker flash-holds
   50k of 150k shares during the jump. Capture? (10k x 50/150 ~ 3,333.) Now stream over
   7 days with a 1-block hold: capture ~ 0. Say why in one sentence.
5. Units drill: without recalling anything, derive "how many shares for 500 assets"
   from unit cancellation alone.
