# Evaluation: Acme AI — Senior AI Platform Engineer

**Date:** 2026-10-29
**URL:** https://jobs.example.com/acme-ai/senior-ai-platform-engineer
**Via:** —
**Archetype:** AI Platform / LLMOps Engineer
**Score:** 4.5/5
**Decision:** Apply
**Legitimacy:** High Confidence
**Work Auth:** ➖ Not needed
**PDF:** output/cv-alex-chen-acme-ai-2026-10-29.pdf

**Apply.** The role's core is production ML platform work the CV already proves, the only gaps are LLM-specific and partial, and Block G returned High Confidence.

---

## Machine Summary

```yaml
company: "Acme AI"
role: "Senior AI Platform Engineer"
job_facts_cache: null
score: 4.5
legitimacy_tier: "High Confidence"
archetype: "AI Platform / LLMOps Engineer"
final_decision: "Apply"
hard_stops: []
soft_gaps:
  - "LLM serving at scale (vLLM / TGI) is not on the CV"
  - "Prompt and eval tooling exists only as an open-source project, not in a production role"
top_strengths:
  - "Led an internal ML platform used by 4 teams at TechFin Corp"
  - "Real-time inference at 50ms p99 (fraud detection)"
  - "LLM Eval Toolkit maps directly to the evaluation-infrastructure requirement"
risk_level: "Low"
confidence: "Medium"
score_evidence:
  cv_match: "supported"
  north_star: "supported"
  compensation: "partial"
  culture: "partial"
  red_flags: "supported"
confidence_gaps:
  - "Equity terms and vesting are not in the JD"
  - "On-call expectations for the platform team are not stated"
next_action: "Tailor the CV summary toward LLM platform work and apply"
work_auth: "not_needed"
discard_reasons: []
via: null
company_confidential: false
advertised_comp: "$190,000 - $230,000 USD"
reports_to: "Head of ML Platform"
posting_location: null
requirement_importance:
  - requirement: "Production ML platform ownership"
    jd_signal: "own the platform our ML and LLM teams ship on"
    evidence: "stated"
    importance: "critical"
    match: "strong"
  - requirement: "LLM serving and inference optimization"
    jd_signal: "serving LLMs in production (vLLM, TGI or similar)"
    evidence: "stated"
    importance: "high"
    match: "partial"
  - requirement: "Evaluation and regression testing for models"
    jd_signal: "Build the evaluation harness that gates every model release"
    evidence: "stated"
    importance: "high"
    match: "strong"
  - requirement: "Kubernetes and cloud infrastructure"
    jd_signal: "Kubernetes, AWS"
    evidence: "stated"
    importance: "high"
    match: "strong"
  - requirement: "Model monitoring and observability"
    jd_signal: "monitoring, drift detection and alerting"
    evidence: "stated"
    importance: "meaningful"
    match: "strong"
  - requirement: "Mentoring other engineers"
    jd_signal: "Responsibilities section: mentor two mid-level engineers"
    evidence: "structural"
    importance: "meaningful"
    match: "strong"
risk_summary:
  legitimacy: "high_confidence"
  classification: "clear"
  culture: "pass"
  interview_redflags: "not_evaluated"
  ai_infra: "consistent"
  ai_screening_disclosure: "not_evaluated"
  fixed_term: "not_detected"
  relocation_purchasing_power: "not_evaluated"
  vacancy_disclosure: "not_evaluated"
  unpaid_placement: "not_evaluated"
  candidate_fees: "not_evaluated"
  accommodation_notice: "not_evaluated"
```

## A) Role Summary

| Field | Value |
|-------|-------|
| **Archetype** | AI Platform / LLMOps Engineer |
| **Domain** | Platform / LLMOps |
| **Function** | Build |
| **Seniority** | Senior (IC4-IC5) |
| **Remote** | Full remote, US time zones |
| **Team size** | 6 engineers on ML Platform |
| **Culture screen** | pass: the JD names the interview stages (recruiter call, take-home with a 4-hour cap, system design, team panel) and states "no on-call rotation in the first 90 days" |
| **TL;DR** | Own the platform Acme's ML and LLM teams ship on: serving, evaluation gates and monitoring |

Work authorization: the role is US-remote and the candidate is US-based, so sponsorship does not apply.

## B) Match with CV

| Requirement | Importance | Match | JD signal | Evidence / gap |
|---|---|---|---|---|
| Production ML platform ownership | critical (stated) | ✅ Strong | "own the platform our ML and LLM teams ship on" | "Led ML platform team (3 engineers), built internal MLOps tooling: model registry, A/B testing framework, feature store" |
| LLM serving and inference optimization | high (stated) | ⚠️ Partial | "serving LLMs in production (vLLM, TGI or similar)" | Real-time inference at "99.7% precision at 50ms p99" proves serving under latency budgets; no LLM serving stack on the CV |
| Evaluation and regression testing for models | high (stated) | ✅ Strong | "Build the evaluation harness that gates every model release" | "LLM Eval Toolkit (Open Source) -- Evaluation framework for LLM applications. Supports custom metrics, regression testing, CI integration" |
| Kubernetes and cloud infrastructure | high (stated) | ✅ Strong | "Kubernetes, AWS" | Skills: "Kubernetes, Kafka, Redis, PostgreSQL, AWS" |
| Model monitoring and observability | meaningful (stated) | ✅ Strong | "monitoring, drift detection and alerting" | "Established model monitoring: drift detection, performance dashboards (Grafana), automated retraining triggers" |
| Mentoring other engineers | meaningful (structural) | ✅ Strong | Responsibilities section: mentor two mid-level engineers | "Led ML platform team (3 engineers)" |

### Gaps

| Gap | Severity | Mitigation |
|-----|----------|------------|
| LLM serving stack (vLLM / TGI) | Medium | Frame the 50ms p99 fraud pipeline as the same latency-budget problem; name the stack as a 30-day ramp, not a claim |
| LLM evaluation in a production role | Low | LLM Eval Toolkit is direct proof; lead with it in the summary |

## C) Level and Strategy

**Detected level:** Senior (IC4-IC5)
**Candidate's natural level:** Senior, with platform-lead scope

**Plan:** Lead with platform ownership at TechFin ("built MLOps for 4 teams"). The JD's mentoring line fits the 3-engineer team lead experience without overselling it as management.

## D) Comp and Demand

| Data Point | Value | Source |
|------------|-------|--------|
| Advertised base | $190,000 - $230,000 USD | The JD |
| Equity | Stated, terms not given | The JD |
| Demand trend | High for LLM platform roles | Comparable postings in the scan history |

The advertised range sits inside the profile's target. Equity terms are the open question for the recruiter call.

## E) Customization Plan

| # | Section | Current | Proposed Change | Why |
|---|---------|---------|-----------------|-----|
| 1 | Summary | "Full-stack AI engineer" | "AI platform engineer: ML serving, evaluation gates, monitoring" | Matches the JD's three pillars |
| 2 | TechFin bullets | Fraud pipeline listed third | Move the 50ms p99 pipeline first | Closest proof for the serving requirement |
| 3 | Projects | Both listed equally | Lead with LLM Eval Toolkit | Direct proof for the evaluation harness |

## F) Interview Plan

| # | JD Requirement | STAR Story | S | T | A | R |
|---|---------------|------------|---|---|---|---|
| 1 | Platform ownership | ML platform at TechFin | 4 teams shipping models by hand | Give them one paved path | Model registry, A/B framework, feature store | Deploy time from 2 weeks to 4 hours |
| 2 | Serving under latency budgets | FraudShield pipeline | Fraud checks had to finish inside checkout | Real-time scoring | Kafka, feature computation, model inference, decision engine | 99.7% precision at 50ms p99 |

**Recommended case study:** LLM Eval Toolkit, for the evaluation-harness requirement.

## G) Posting Legitimacy

**Assessment:** High Confidence

| Signal | Finding | Weight |
|--------|---------|--------|
| Posting age | Posted 6 days ago | Positive |
| Description specificity | Names the stack, the team size, the reporting line and the interview stages | Positive |
| Salary transparency | Base range and equity stated | Positive |
| Employer careers page | Same role listed on Acme's own board | Positive |
| Employment classification | Full-time employee, no contractor language | Neutral |
| Fixed-term contract | No fixed-term language | Neutral |

**Context Notes:** None.

**Role clarity:** reporting line, scope, deliverables and coordinating teams are present; a 90-day success measure is partial ("ship the evaluation gate"). No soft-verb pattern.

## Verdict (lead)

**Apply.** The role's core is production ML platform work the CV already proves, the only gaps are LLM-specific and partial, and Block G returned High Confidence.

## Risk Summary

| Signal | Status |
|--------|--------|
| Posting legitimacy | ✅ High Confidence |
| Employment classification | ✅ clear |
| Culture screen | ✅ pass |
| Interview red flags | — no interview sessions yet |
| AI claims vs. infrastructure | ✅ consistent |
| AI-screening disclosure | — not evaluated |
| Fixed-term contract | ✅ no fixed term disclosed |
| Relocation purchasing power | — not evaluated |
| Vacancy-status disclosure | — not evaluated |
| Unpaid placement | — not evaluated |
| Candidate-paid fee | — not evaluated |
| Accommodation notice | — not evaluated |

## Score Evidence

| Dimension | Status | Source or observation | Unresolved question |
|-----------|--------|-----------------------|---------------------|
| CV match | supported | Block B rows quoted from cv.md | — |
| North Star alignment | supported | Archetype matches a primary target in modes/_profile.md | — |
| Compensation | partial | Base range stated in the JD; equity terms missing | What are the equity terms and vesting schedule? |
| Cultural signals | partial | Interview stages and on-call note in the JD | What does on-call look like after 90 days? |
| Red flags | supported | Block G found none | — |

**Evidence confidence:** Medium — compensation and culture each rest on one line of the JD.

Verification priorities:
1. Equity terms and vesting
2. On-call expectations after the first 90 days

## H) Draft Application Answers

**Why Acme AI?** I've spent four years building the paved path other ML teams ship on, and your posting describes that job for LLM teams: serving, an evaluation gate on every release, and monitoring. The evaluation gate is the part I'd most like to own; I built an open-source version of it in LLM Eval Toolkit.

**Describe a platform you built.** At TechFin Corp I led a three-engineer team that built the internal ML platform for four engineering teams: a model registry, an A/B testing framework and a feature store. It cut model deployment from two weeks to four hours.

---

## Keywords extracted

ML platform, LLM serving, inference optimization, evaluation harness, regression testing, model monitoring, drift detection, alerting, Kubernetes, AWS, Python, CI/CD, feature store, model registry, observability, mentoring

## Keyword Coverage

**ATS coverage: 63%** (10/16 keywords present)

_Scanned: cv-example.md._

**Present (10):** ML platform, regression testing, model monitoring, drift detection, Kubernetes, AWS, Python, CI/CD, feature store, model registry

**Thin — mentioned once, consider reinforcing (8):** regression testing, model monitoring, drift detection, Kubernetes, AWS, Python, CI/CD, model registry

**Missing (6):** LLM serving, inference optimization, evaluation harness, alerting, observability, mentoring

> Diagnostic only. Add a missing keyword **only** if it reflects real experience — reformulated from your background, never fabricated.

## Job Description (archived verbatim)

Posted: 6 days ago

Senior AI Platform Engineer — Acme AI (Remote, US)

Reports to: Head of ML Platform

You'll own the platform our ML and LLM teams ship on. The ML Platform team is 6 engineers, and you'll mentor two mid-level engineers.

What you'll do:
- Keep serving LLMs in production (vLLM, TGI or similar) inside latency and cost budgets
- Build the evaluation harness that gates every model release
- Own monitoring, drift detection and alerting for every model in production
- Keep CI/CD for models fast and boring

What you bring:
- 5+ years building production ML systems in Python
- Kubernetes, AWS
- Experience running a model registry or feature store

Compensation: $190,000 - $230,000 USD base salary, plus equity.

Interview process: recruiter call, take-home (capped at 4 hours), system design, team panel. There is no on-call rotation in the first 90 days.
