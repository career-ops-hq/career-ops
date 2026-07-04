# {Your Name} — Triage Brief

<!-- ============================================================
     THIS FILE IS YOURS. Copy it to `modes/_brief.md` (doctor.mjs
     auto-copies it on first run) and fill in the placeholders.
     It is USER LAYER — never auto-updated by `node update-system.mjs`.

     PURPOSE: Compact context for first-pass triage agents
     (`modes/triage.md`). It replaces reading the full evaluation
     stack — cv.md + _shared.md + _profile.md + profile.yml +
     oferta.md (tens of thousands of tokens) — with a single small
     read (~1.5–2K tokens). Full context is still used in full eval.

     KEEP IT SHORT. Every line here is read once per role during a
     batch triage. Include only what changes a go/no-go decision:
     archetypes, comp floor, location policy, hard disqualifiers,
     and your strongest proof points. Leave the deep narrative,
     negotiation scripts, and STAR stories in _profile.md / cv.md.
     ============================================================ -->

## Identity
{One line: seniority, discipline, years, location/timezone, work-authorization
constraints. e.g. "Senior Backend Engineer — 10+ yrs. Remote (ET). US citizen,
no sponsorship."}

## Target Archetypes
The roles you actually want. Triage scores "archetype fit" against this list.
A direct hit scores 4–5; an adjacent title scores 3; a mismatch scores 1–2.

| # | Archetype | What they buy (your proof) |
|---|-----------|----------------------------|
| 1 | **{Archetype name}** | {the capability/experience that makes you a fit} |
| 2 | **{Archetype name}** | {...} |
| 3 | **{Archetype name}** | {...} |

<!-- Optional: "analog" archetypes — same skills, different titles. List them so
     triage recognizes them as valid targets instead of scoring them as misses. -->

## Proof Points (use exact metrics in matching)
Your strongest, quantified accomplishments. Triage checks how many map to a JD.
- {Accomplishment — metric, scope, impact}
- {Accomplishment — metric, scope, impact}
- {Accomplishment — metric, scope, impact}

## Comp Strategy
| Target | Requirement |
|--------|-------------|
| ~{$X}  | {conditions — e.g. fully remote, low intensity} |
| {$Y}+  | {conditions — e.g. higher intensity acceptable} |

**Hard floor: {$X}. Below that, FAIL regardless of other signals.**

## Location Scoring
How to score the "location" dimension. Adjust to your own policy.
- Fully remote / async-first → **5.0**
- Light hybrid (flexible, few days/month) → **4.0–5.0**
- Regular hybrid or on-site, local (no move) → **{your score / comp condition}**
- On-site requiring relocation → **{your score / comp condition}**
- High travel (>25%) → **deduct 0.5–1.0**

## Hard DQ Criteria — instant FAIL (< 3.0)
Score ≤ 2.5 immediately and skip detailed analysis if ANY apply. These are the
hard gaps you cannot bridge — be specific so triage can pattern-match them.
- {e.g. Active license/clearance you do not hold}
- {e.g. Primary hands-on skill outside your discipline}
- {e.g. Stated comp ceiling below your floor}
- {e.g. Travel above your limit for the role type}

## Quick Scoring Guide
| Score | Verdict | What it means |
|-------|---------|---------------|
| 4.5–5.0 | **PASS** | Strong archetype + comp + location, no hard DQs |
| 4.0–4.4 | **PASS** | Clear fit, 1–2 soft/bridgeable gaps |
| 3.0–3.9 | **MARGINAL** | Borderline — shown to user as one line |
| < 3.0 | **FAIL** | Does not clear bar — filtered |

## Soft Red Flags (−0.5 each, additive)
Not disqualifiers, but they lower the score.
- {e.g. A "required" cert you list as a gap}
- {e.g. A delivery model or domain that needs a framing rewrite}
- {e.g. Company stage/size you'd rather avoid}

## Priority Override List — always return PASS regardless of score
Companies you want surfaced no matter what (specific interest, warm intro, etc.).
- {Company name — reason}
