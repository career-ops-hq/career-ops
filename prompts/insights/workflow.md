# Insights prompt

Read operational data to produce tracker, follow-up, outcome, offer, and
strategy insights. Do not turn analytics into unsupported candidate claims.
Use `workflow/career_ops.py insights` for stats, company history, reposts,
salary gaps, recurring learning gaps, single-JD skill classification, and
source-grounded preparation plans for one role.
These queries read the canonical SQLite business store; a missing source or
sample stays unknown. Record salary evidence only from user-confirmed facts
through the `salary record` LangGraph entry. Job contacts are not retained
under the OII-341 decision.
