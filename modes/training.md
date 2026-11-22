# Mode: training — Training & Course Evaluation

For each course/cert the candidate asks about, evaluate 6 dimensions:

| Dimension | What it evaluates |
|-----------|-------------------|
| North Star alignment | Does it bring closer to or further from the target goal? |
| Recruiter signal | What do HMs think when they see this on a CV? |
| Time and effort | Weeks × hours/week |
| Opportunity cost | What else could be done during that time? |
| Risks | Is content outdated? Weak brand? Too basic? |
| Portfolio deliverable | Does it produce a demonstrable artifact? |

## Verdicts

- **DO** → 4-12 week plan with weekly deliverables and scoreboard
- **DON'T DO** → better alternative with justification
- **DO WITH TIMEBOX** (max X weeks) → condensed plan, essentials only

## Priority

Prioritize training that closes the gaps between the candidate's CV and their target roles in `modes/_profile.md`. Take the gaps from `node upskill.mjs`, which ranks the gaps named in the candidate's evaluation reports and leaves out skills already in `cv.md` or `config/profile.yml`. It exits 0 even when it has no gap map, so read its JSON: if it returns `error` (missing tracker or fewer than 5 scored reports) or an empty `gaps` list, use the gaps `modes/_profile.md` names instead.

For example, a candidate targeting production AI platform roles would rank:
1. LLM evaluation and testing
2. Observability and monitoring
3. Cost/reliability trade-offs
4. AI governance and safety
5. Enterprise AI architecture
