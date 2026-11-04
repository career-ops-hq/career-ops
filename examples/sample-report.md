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
| Evaluation and regression testing for models | high (stated) | ✅ Strong | "Build the evaluation harness that gates every model release" | LLM Eval Toolkit: "Evaluation framework for LLM applications. Supports custom metrics, regression testing, CI integration" |
| Kubernetes and cloud infrastructure | high (stated) | ✅ Strong | "Kubernetes, AWS" | Skills: "Kubernetes, Kafka, Redis, PostgreSQL, AWS" |
| Model monitoring and observability | meaningful (stated) | ✅ Strong | "monitoring, drift detection and alerting" | "Established model monitoring: drift detection, performance dashboards (Grafana), automated retraining triggers" |
| Mentoring other engineers | meaningful (structural) | ✅ Strong | Responsibilities section: mentor two mid-level engineers | "Led ML platform team (3 engineers)" |

### Gaps

**LLM serving stack (vLLM / TGI).** High importance, ⚠️ Partial. Not a hard blocker: the 50ms p99 fraud pipeline is adjacent experience, but no project on the CV covers LLM serving.
- **Interview risk:** a system design round asks how the candidate would size and batch inference on vLLM or TGI. The CV has no LLM serving to answer from, so a vague answer reads as not ready to own serving, the JD's first duty.
- **Mitigation:** say plainly that these two stacks are new, then walk through the latency budget from the fraud pipeline as the same problem. Don't claim the stack on the CV. Cover-letter phrase: "I've kept real-time inference at 50ms p99 and would apply that discipline to LLM serving."

**LLM evaluation in a production role.** Nice-to-have, since Block B already rates evaluation ✅ Strong. LLM Eval Toolkit is direct proof.
- **Mitigation:** lead with the toolkit in the summary and describe its regression testing and CI integration, without implying it ran at TechFin.

## C) Level and Strategy

**Detected level:** Senior (IC4-IC5)
**Candidate's natural level:** Senior, with platform-lead scope

**"Sell senior without lying" plan:** Lead with platform ownership at TechFin: "an internal MLOps platform serving 4 engineering teams". The JD's mentoring line fits "Led ML platform team (3 engineers)" without overselling it as management.

**"If they downlevel me" plan:** Accept only if the base stays inside the advertised range. Negotiate a review at 6 months, and get the promotion criteria in writing, tied to shipping the evaluation harness.

## D) Comp and Demand

**Company type:** Growth-stage startup / VC-backed startup, medium confidence: equity in the offer and a 6-engineer platform team.

**Compensation reliability:** High. The JD states the figure as base salary.

| Data Point | Value | Source |
|------------|-------|--------|
| Advertised (JD) | $190,000 - $230,000 USD | JD |
| Demand trend | High for LLM platform roles | Comparable postings in the scan history |

No salary research beyond the JD figure is included in this sample.

- **Advertised range:** $190,000 - $230,000 USD
- **Likely guaranteed base:** the same range, since the JD calls it base salary
- **Variable / conditional cash components:** none stated
- **Expected stable cash:** the base, before tax
- **Non-cash benefits:** equity, terms not stated

**HR verification questions:**
1. What is the fixed base salary written in the employment contract, and where in the range does this level sit?
2. Does the advertised range include any bonus or other variable component?
3. What is the equity grant, its vesting schedule, and its last valuation?
4. Is there a probation period, and does it change the base salary?

## E) Customization Plan

**Top 5 CV changes**

| # | Section | Current status | Proposed change | Why |
|---|---------|----------------|-----------------|-----|
| 1 | Summary | "Full-stack AI engineer" | "AI platform engineer: ML serving, evaluation gates, monitoring" | Matches the JD's three pillars |
| 2 | TechFin bullets | Fraud pipeline is the second bullet | Move the 50ms p99 pipeline first | Closest proof for the serving requirement |
| 3 | TechFin bullets | Monitoring is the last bullet | Move it up, wording unchanged | The JD names monitoring and drift detection |
| 4 | Projects | FraudShield listed first | Lead with LLM Eval Toolkit | Direct proof for the evaluation harness |
| 5 | Skills | ML/AI listed first | Lead with MLOps and Infra | The JD names Kubernetes, AWS and a model registry or feature store |

**Top 5 LinkedIn changes**

The LinkedIn profile isn't in the primary files, so check its current text before changing it.

| # | Section | Current status | Proposed change | Why |
|---|---------|----------------|-----------------|-----|
| 1 | Headline | Not reviewed | "AI platform engineer: ML serving, evaluation gates, monitoring" | Same language as the CV summary |
| 2 | About | Not reviewed | Open with the platform serving 4 engineering teams and deployment cut from 2 weeks to 4 hours | Leads with the strongest platform proof |
| 3 | TechFin Corp entry | Not reviewed | Match the reordered CV bullets | The CV and profile should tell one story |
| 4 | Featured | Not reviewed | Link LLM Eval Toolkit and FraudShield | Public proof a reviewer can open |
| 5 | Skills | Not reviewed | Pin MLOps, Kubernetes and Python | All three are on the CV and in the JD |

## F) Interview Plan

| # | JD Requirement | STAR Story | S | T | A | R |
|---|---------------|------------|---|---|---|---|
| 1 | Platform ownership | ML platform at TechFin | Model deployment took 2 weeks | Build an internal platform for 4 engineering teams | Model registry, A/B testing framework, feature store, CI/CD pipeline | Deployment time from 2 weeks to 4 hours |
| 2 | Serving under latency budgets | Fraud detection pipeline at TechFin | Fraud decisions had to run in real time | Design the pipeline | Kafka, feature computation, model inference, decision engine | 99.7% precision at 50ms p99 |

**Recommended case study:** LLM Eval Toolkit, for the evaluation-harness requirement.

## G) Posting Legitimacy

**Assessment:** High Confidence

| Signal | Finding | Weight |
|--------|---------|--------|
| Posting age | Posted 6 days ago | Positive |
| Description specificity | Names the stack, the team size, the reporting line and the interview stages | Positive |
| Salary transparency | Base range and equity stated | Positive |
| Employer careers page | Same role listed on Acme's own board | Positive |
| Employment classification | No contractor language | Neutral |
| Fixed-term contract | No fixed-term language | Neutral |

**Context Notes:** None.

### Role clarity

| Point | Status | Evidence |
|-------|--------|----------|
| Direct supervisor and department | present | "You'll report to the Head of ML Platform."; "The ML Platform team is 6 engineers, and you'll mentor two mid-level engineers." |
| Scope of work | present | "You'll own the platform our ML and LLM teams ship on."; "Own monitoring, drift detection and alerting for every model in production" |
| Deliverables and their format | present | "You will deliver the evaluation harness with documentation and a rollout plan" |
| Success measure in the first 3-6 months | present | "Success looks like every model release passing the evaluation harness within the first 90 days." |
| Teams or people the role coordinates with | present | "You'll work closely with the product and data teams." |
| Delivery cadence | missing | — |

Advisory only: this check has no effect on the score, the Assessment tier or the Verdict.

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

You'll report to the Head of ML Platform. You'll own the platform our ML and LLM teams ship on. The ML Platform team is 6 engineers, and you'll mentor two mid-level engineers. You'll work closely with the product and data teams.

What you'll do:
- Keep serving LLMs in production (vLLM, TGI or similar) inside latency and cost budgets
- Build the evaluation harness that gates every model release
- Own monitoring, drift detection and alerting for every model in production
- Keep CI/CD for models fast and boring
- You will deliver the evaluation harness with documentation and a rollout plan

What you bring:
- 5+ years building production ML systems in Python
- Kubernetes, AWS
- Experience running a model registry or feature store

Compensation: $190,000 - $230,000 USD base salary, plus equity.

Interview process: recruiter call, take-home (capped at 4 hours), system design, team panel. There is no on-call rotation in the first 90 days.

Success looks like every model release passing the evaluation harness within the first 90 days.

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
  - "Evaluation tooling exists only as an open-source project, not in a production role"
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
