# Track: AI gigs

Read `tracks.ai_gigs` from `config/profile.yml`: `focus` (archetype ids, empty
means all) and `include_crowd_work`.

This track widens archetype detection for AI work. It does not replace the
user's own targets: where `modes/_profile.md` lists target roles, those still
decide North Star alignment, and an AI archetype below only says which kind of
AI work the posting is.

## Archetypes

| Id | Role family | Typical titles (EN / DE) | What they buy |
|----|-------------|--------------------------|---------------|
| `llm_engineer` | LLM / GenAI engineering | AI Engineer, LLM Engineer, GenAI Developer, KI-Entwickler | Someone who ships LLM features: RAG, prompts, tool use, cost and latency |
| `agent_engineer` | Agents and agentic systems | Agent Engineer, AI Agent Developer | Reliable multi-step agents: orchestration, tools, human in the loop |
| `applied_ai` | Applied AI, forward-deployed | Applied AI Engineer, Forward Deployed Engineer, AI Solutions Engineer | Fast delivery with a client: prototype to production |
| `ml_engineer` | ML engineering, data science | ML Engineer, Data Scientist | Model training, evaluation and serving on proprietary data |
| `llmops` | LLMOps, ML platform | MLOps Engineer, AI Platform Engineer | Serving, observability, evaluation infrastructure |
| `evals` | AI evaluation, quality, safety | LLM Evaluation Lead, AI Quality Engineer, Red Teamer | Evidence that a model or product is good enough: rubrics, benchmarks, red teaming |
| `ai_automation` | AI automation, workflow building | AI Automation Engineer, n8n Developer, KI-Automatisierung | Business processes automated with LLMs and low-code tools |
| `ai_consulting` | AI consulting, enablement | AI Consultant, KI-Berater, Fractional AI Lead | Use-case discovery, roadmaps, workshops, adoption |
| `ai_product` | AI product management | AI Product Manager | Product decisions for AI features |

Step 0 of `oferta` stays as written. In Block A, add an "AI archetype" row
with the best match from this table and the evidence (title words, stack
named in the posting). A posting can be a hybrid of two. "Not an AI role" is
a valid answer and must be given when it is true: an "AI-powered" company
hiring a generic backend engineer is not an AI role.

If `focus` lists archetypes and the posting matches none of them, say so in
Block A and let North Star alignment reflect it.

## Expert work and crowd work

Per-task model-training platforms (data annotation, rating, "AI trainer",
RLHF tasks) are a different product from an engineering or consulting
engagement, and they are often paid by the task or the hour with no
commitment on volume.

- **Expert tier**: asks for domain or coding expertise, a language, rubric
  design or red teaming. Evaluate with `modes/tracks/freelance.md`: hourly
  rate, hours available, exclusivity, payment terms, and how work is assigned.
- **Crowd tier**: generic labelling or rating. When `include_crowd_work` is
  false, mark it as outside the track with a caution and stop at a short
  evaluation. When true, evaluate it as expert work, and state the realistic
  hours, since platforms rarely guarantee any.
- Never present platform sign-up as a job offer. Many of these platforms are
  sign-up only: name them as a link the user can follow, do not create an
  account, and do not submit a profile.

`modes/gig.md` drafts the expert profile these platforms vet against.

## What to verify in an AI posting

- Whether the role builds with models or only sits near them: look for named
  responsibilities (evaluation, retrieval, agents, fine-tuning, serving), not
  the word "AI" in the company description.
- Whether the stack named in the posting matches evidence in `cv.md`. A tool
  the candidate has not used is a gap to state, never a keyword to add.
- For consulting and automation gigs: who owns the outcome, what `done` means,
  and whether the budget is for discovery, a build or a retainer.
