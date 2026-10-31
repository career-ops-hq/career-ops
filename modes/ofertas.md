# Mode: ofertas — Multi-Job Comparison

Scoring matrix with 10 weighted dimensions. Score every dimension against the user's own targeting, not a default candidate's: the North Star and level in `modes/_profile.md`, the comp range in `config/profile.yml` → `compensation`, the location policy in `modes/_profile.md` and `config/profile.yml` → `compensation.location_flexibility`, and the culture criteria in `config/profile.yml` → `culture_screen`. Where the user has set nothing for a dimension, score it against the market for the role.

| Dimension | Weight | Criteria 1-5 |
|-----------|------|----------------|
| North Star alignment | 25% | 5=exact target role, 1=unrelated |
| CV match | 15% | 5=90%+ match, 1=<40% match |
| Level fit | 15% | 5=the level the user targets, 3=one step from it, 1=far from it in either direction |
| Estimated compensation | 10% | 5=top quartile, 1=below market |
| Growth trajectory | 10% | 5=clear path to next level, 1=dead end |
| Location fit | 5% | 5=matches the user's location policy, 1=conflicts with it |
| Company reputation | 5% | 5=top employer, 1=red flags |
| Tech stack modernity | 5% | 5=current, well-supported stack for the user's target roles, 1=legacy or end-of-life |
| Time-to-offer speed | 5% | 5=fast process, 1=6+ months |
| Cultural signals | 5% | 5=meets the user's `culture_screen` criteria, 1=contradicts them (none set: score it as `modes/_shared.md` → "How to score the Cultural signals dimension" says) |

For each job: score per dimension and total weighted score.
Final ranking + recommendation with time-to-offer considerations.
All reports must include **URL:** and **Legitimacy:** fields in the output header.

Ask the user for job postings if they are not in context. These can be text, URLs, or references to jobs already evaluated in the tracker.
