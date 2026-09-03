# Domain Knowledge: AI-Assisted Engineering & Agentic Workflows

## Candidate Positioning
- **Core Stance:** Practical, high-velocity frontend and systems engineering accelerated by AI tooling and autonomous agent workflows.
- **Ownership Invariant:** Human ownership of architecture, technical decisions, security boundaries, business logic, code quality, and production releases.
- **Strict Role Boundary:** This knowledge represents **developer productivity and engineering workflow acceleration**, NOT Machine Learning engineering, training foundation model weights, or data science.

---

## Tools & Environments
- **Primary AI Coding Tools:** Cursor, Claude (Claude Code, Claude 3.5 Sonnet / 3.7 Sonnet), OpenAI (ChatGPT, Codex), Google (Gemini, Antigravity CLI).
- **Tool Selection Principle:** Choosing the right agent and model based on task scope, repository complexity, reasoning requirements, and context window requirements.

---

## Engineering Workflows & Methodologies

### 1. Specification-Driven Development
- Structuring requirements into clear, unambiguous technical specifications before writing code.
- Defining precise acceptance criteria, edge cases, and verification checklists for agent execution.
- Creating and maintaining agent rules, project instructions (`AGENTS.md`, `.agents/skills`), and coding standards to enforce consistency.

### 2. Task Decomposition & Implementation Planning
- Breaking complex refactors or multi-file features into incremental, reviewable subtasks.
- Using LLM reasoning for architectural analysis, dependency investigation, and trade-off evaluation before implementation.
- Formulating step-by-step implementation plans to prevent hallucinations and maintain codebase coherence.

### 3. Code Generation, Refactoring & Debugging
- AI-assisted scaffolding of boilerplate, typed interfaces, and complex utility logic.
- Systematic refactoring of legacy components toward modern patterns (e.g. class components to hooks, Pages to App Router, Knockout to Alpine.js).
- Rapid root-cause analysis of runtime bugs, build errors, and dependency mismatches.

### 4. Code Review & Multi-Tier Validation
- Using automated checks and linting pipelines to validate agent modifications.
- Performing human-in-the-loop line-by-line verification of generated diffs prior to committing.
- Running automated test suites (`npm test`, `node test-all.mjs`, type-checking) as non-negotiable verification gates.

### 5. Guardrails, Security & Data Protection
- Enforcing strict boundaries on tool capabilities and sensitive data handling.
- Preventing secrets, API keys, customer PII, and credentials from entering agent context or prompt history.
- Defining restricted files and directories that agents are prohibited from editing without explicit confirmation.

### 6. Context Engineering & Legacy Code Comprehension
- Providing targeted repository context, schemas, and interface definitions to improve agent accuracy.
- Rapidly understanding unfamiliar or undocumented legacy codebases through AI-assisted dependency tracing and architectural mapping.
- Generating and maintaining living technical documentation and implementation notes.

### 7. Repeatable Agent Pipelines
- Developing multi-step agent workflows for recurring tasks (such as CV tailoring, job evaluation, pipeline scanning, and code formatting) rather than relying on one-off ad-hoc prompts.

---

## Tailoring Application
When applying for roles that emphasize modern developer productivity, AI tool adoption, or AI-integrated web applications (e.g. GitLab Duo, developer tools, AI client interfaces):
- Highlight daily expertise with Cursor, Claude Code, and agentic workflows.
- Emphasize specification-driven development, code quality validation, and security guardrails.
- Reinforce that architecture and production standards remain 100% human-owned.
