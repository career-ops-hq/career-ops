# Running Career-Ops on a Budget

Token usage costs and rate limits are the most common bottlenecks when setting up a high-volume job search pipeline. Since Career-Ops processes full job descriptions, evaluates them against your CV across 10 dimensions, and tailors resumes/cover letters, the context size can grow quickly.

Fortunately, **Career-Ops is completely AI-agnostic.** The pipeline relies on the AI coding CLI (or standalone scripts) to process prompt files under `modes/`. This means you can point your CLI to cheaper API providers or local models with **zero code changes** in Career-Ops.

---

## 1. The Core Concept: Model Agnosticism

Career-Ops is composed of local templates, Markdown prompts, and Node/Playwright scripts. The AI logic is driven entirely by whichever AI coding CLI you run it in (e.g., Claude Code, OpenCode, Qwen CLI, Codex, Antigravity CLI, or Grok Build CLI).

By choosing a CLI that supports custom model configurations and routing it to a cheaper API provider or local LLM, you can drastically reduce your pipeline running costs without losing any functionality.

---

## 2. Configuring Alternative CLI Setups

Different CLIs offer different levels of flexibility for model routing. The two most common options for budget setups are **OpenCode** and **Qwen CLI**.

### OpenCode CLI
OpenCode is an open-source coding agent that easily routes to custom API providers (like DeepSeek, OpenRouter, Together AI) or local endpoints (Ollama).

To configure OpenCode with a custom provider:
1. Initialize/open OpenCode in the project directory:
   ```bash
   opencode
   ```
2. Open its configuration settings (usually located in `.opencode/config.json` or configured via CLI prompts/settings).
3. Set the `provider` to your chosen endpoint (e.g., OpenRouter or a custom OpenAI-compatible endpoint).
4. Configure the environment variables for custom endpoints if needed:
   ```bash
   # For Git Bash / Linux / macOS:
   export OPENAI_API_BASE="https://openrouter.ai/api/v1"
   export OPENAI_API_KEY="your_openrouter_api_key_here"

   # For Windows CMD:
   set OPENAI_API_BASE=https://openrouter.ai/api/v1
   set OPENAI_API_KEY=your_openrouter_api_key_here

   # For Windows PowerShell:
   $env:OPENAI_API_BASE="https://openrouter.ai/api/v1"
   $env:OPENAI_API_KEY="your_openrouter_api_key_here"
   ```

### Qwen CLI
Qwen CLI natively supports Qwen models but can be configured to point to any custom OpenAI-compatible API base URL:
```bash
# For Git Bash / Linux / macOS:
export QWEN_API_BASE="https://api.deepseek.com/v1"
export QWEN_API_KEY="your_deepseek_api_key_here"

# For Windows CMD:
set QWEN_API_BASE=https://api.deepseek.com/v1
set QWEN_API_KEY=your_deepseek_api_key_here

# For Windows PowerShell:
$env:QWEN_API_BASE="https://api.deepseek.com/v1"
$env:QWEN_API_KEY="your_deepseek_api_key_here"
```

---

## 3. Recommended Cost-Efficient Models

When choosing a budget-friendly model, you need strong reasoning capabilities to handle the multi-dimensional scoring and resume tailoring. Here are the recommended models that hold up well under evaluation:

| Model | Provider / Endpoint | Price per 1M Input / Output Tokens | Why use it |
|-------|---------------------|------------------------------------|------------|
| **DeepSeek V3** | DeepSeek API / OpenRouter | ~$0.14 / ~$0.28 | **Top Recommendation.** Unmatched reasoning-to-price ratio; performs close to frontier models at a fraction of the cost. |
| **DeepSeek-Coder-V2** | DeepSeek API / OpenRouter | ~$0.14 / ~$0.28 | Excellent instruction-following for structured Markdown and resume tailoring. |
| **Qwen-2.5-Coder (32B / 72B)** | OpenRouter / DeepInfra | ~$0.07 - ~$0.30 | Strong coding and structured reasoning, highly cost-effective. |
| **GLM-4-Air / GLM-4** | Zhipu AI / OpenRouter | Very Cheap | Reliable multi-turn reasoning and JSON/Markdown generation. |
| **Gemini 2.5 Flash** | Google AI Studio | Free Tier (15 RPM) | Available via the standalone script `node gemini-eval.mjs`. Excellent for zero-cost low-volume runs, but subject to rate limits. |

> **Standalone evaluator (no CLI config needed):** every OpenAI-compatible provider above (DeepSeek, Qwen, GLM, Together, Groq, OpenRouter, …) works directly through `node openai-eval.mjs` — just set a base URL, model, and key:
> ```bash
> OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
> OPENAI_MODEL=deepseek/deepseek-chat \
> OPENAI_API_KEY=your_key \
> node openai-eval.mjs --file ./jds/job.txt
> ```
> Run `node openai-eval.mjs --help` for per-provider examples. For 100% local/private use, point `--url` at a local server (LM Studio / llama.cpp / vLLM) or use `node ollama-eval.mjs`.

---

## 4. Local LLM Tradeoffs (Ollama / Llama.cpp)

Running a model 100% locally via Ollama is completely free, but it comes with significant tradeoffs:

### The Size vs. Quality Tradeoff
- **Avoid Small Models (e.g., 8B parameters)**: Models like Llama 3 8B or Qwen-2.5-Coder 7B are generally **too weak** for Career-Ops. They frequently fail to follow the complex evaluation schemas (A-G blocks), fail to output valid Markdown/JSON structures, or generate low-quality, generic resume customizations.
- **Minimum Recommended Size**: Use at least a **32B+ or 70B+ model** (such as Qwen 2.5 Coder 32B/72B or Llama 3.1 70B) for reliable scoring and high-quality resume tailoring.

### Hardware & VRAM Requirements
Running 32B or 70B models locally requires substantial system resources:
- A **32B model** requires a GPU with at least **16GB - 24GB VRAM** (e.g., RTX 3090/4090, Mac Studio, or Apple Silicon Mac with 32GB+ unified memory).
- A **70B model** requires at least **48GB VRAM** to run at decent speeds.

> 💡 **Budget Tip**: For most users, running **DeepSeek V3** or **Qwen 2.5 Coder 72B** via a cheap hosted API (like DeepSeek directly or OpenRouter) is far more efficient and cost-effective than investing in local hardware, costing only a few cents for dozens of evaluations.

---

## 5. Token-Saving Best Practices

To prevent unnecessary API costs or hitting rate limits, implement the following practices:

1. **Use the Batch Limit Flag**:
   Instead of manually splitting `batch/batch-input.tsv`, use the `--limit <N>` flag to process only a small capped number of offers (e.g. 5-10) in a single run. This lets you inspect the output quality before committing to a larger run:
   ```bash
   ./batch/batch-runner.sh --limit 5
   ```
2. **Use the Dry Run Flag**:
   Always run a dry run first to verify which offers will be processed:
   ```bash
   ./batch/batch-runner.sh --dry-run
   ```
3. **Resume Interrupted Runs**:
   If a batch run is interrupted by a rate limit or network error, do not restart from scratch. Use the `--resume-paused` flag to continue from where it left off, skipping completed jobs and preventing wasted tokens:
   ```bash
   ./batch/batch-runner.sh --resume-paused
   ```
4. **Use `--verify` on Scans**:
   When running job board scans, use the liveness verifier to filter out expired postings before they enter your pipeline. This prevents wasting LLM tokens evaluating closed jobs:
   ```bash
   npm run scan -- --verify
   ```

---

## 6. Worked Example: Running the Pipeline Cheaply

Here is a concrete, end-to-end walkthrough of scanning for jobs and evaluating a single posting using **DeepSeek V3 via OpenRouter** and the standalone `openai-eval.mjs` evaluator. This bypasses the need for an expensive CLI agent for the heavy evaluation block.

### Step 1: Scan for Job Offers (0 Tokens)
The portal scanner queries ATS APIs directly using Playwright and standard HTTPS requests. It doesn't use the LLM to read job boards.
```bash
node scan.mjs
```
**Cost:** 0 tokens, $0.00.
*(This generates a list of new job URLs and populates `data/pipeline.md`.)*

### Step 2: Fetch the Job Description (0 Tokens)
Open one of the URLs found by the scanner, copy the text of the job description, and save it locally (e.g., `jds/my-target-role.txt`).

### Step 3: Evaluate the Offer (~4,500 Tokens)
We'll run the evaluation against OpenRouter's DeepSeek V3 endpoint. The script reads your `cv.md` and the job description, then generates the full A-G evaluation report and tracker entry.

```bash
OPENAI_API_KEY="sk-or-your_openrouter_key" \
node openai-eval.mjs \
  --url https://openrouter.ai/api/v1 \
  --model deepseek/deepseek-chat \
  --file ./jds/my-target-role.txt
```

**Approximate Token Usage:**
- **Input:** ~3,500 tokens (System prompt + your `cv.md` + JD)
- **Output:** ~1,000 tokens (The A-G evaluation report)
- **Cost:** ~4,500 tokens total. At DeepSeek V3 prices (~$0.14/1M input, ~$0.28/1M output), this costs **less than $0.001** per evaluation.

### Step 4: Generate ATS-Optimized PDF (0 Tokens)
Once you have the evaluation report, the PDF generator uses Playwright to compile your local HTML/CSS into a tailored CV.

```bash
node generate-pdf.mjs
```
**Cost:** 0 tokens, $0.00.

By routing the heaviest step (Evaluation) to a cheap OpenAI-compatible endpoint, a complete end-to-end job application cycle drops from ~$0.05 - $0.15 on frontier models to a fraction of a cent, allowing you to run bulk batch processing affordably.

---

## 7. Zero-Cost Paths (No Claude / Paid CLI Required)

Career-ops ships a full pipeline that runs **entirely on free models** — no Claude Code, no Anthropic API key, no paid CLI subscription. Everything below works out of the box after a one-time `.env` setup.

### Path A: OpenRouter Free Models (`or:*` scripts)

No Claude Code CLI required — uses OpenRouter free models with automatic fallback.

**npm shortcuts** (cover the whole pipeline):

```bash
npm run or:scan        # Scan portals for new listings (Greenhouse API, 0 tokens)
npm run or:pipeline    # Process all pending URLs from data/pipeline.md
npm run or:eval        # Evaluate a single offer (paste URL or text)
npm run or:apply       # Generate draft application answers for a report
```

**Usage** 

```bash
node openrouter-runner.mjs scan              # Scan Greenhouse API companies for new listings
node openrouter-runner.mjs evaluate <url>    # Evaluate a job by URL
node openrouter-runner.mjs evaluate          # Paste job text interactively
node openrouter-runner.mjs pipeline          # Process all pending URLs from pipeline.md
node openrouter-runner.mjs apply <report_no> # Generate draft application form answers
node openrouter-runner.mjs models            # List available free models
node openrouter-runner.mjs help              # Show this help
```

**Setup:**

```bash
1. copy .env.example .env
2. Add OPENROUTER_API_KEY=sk-or-v1-... to .env
3. Free API key: https://openrouter.ai
```

### Path B: Fully Local with Ollama (`ollama:eval`)

If you want **zero network calls** and complete privacy, run evaluations against a local Ollama instance:

```bash
npm run ollama:eval
```

This calls `ollama-eval.mjs` which hits your local Ollama server. No API key, no internet, no cost. See [Section 4](#4-local-llm-tradeoffs-ollama--llamacpp) for model size recommendations (32B+ minimum for reliable scoring).

### Path C: Any OpenAI-Compatible Endpoint (`openai:eval`)

Point at **any** endpoint that speaks the OpenAI chat-completions API — NVIDIA NIM (free tier), Zhipu GLM, Together, Groq, LM Studio, llama.cpp, vLLM, or even Ollama's `/v1` route:

```bash
npm run openai:eval
```

Configure via `.env`:

```dotenv
OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1   # or any compatible base URL
OPENAI_MODEL=meta/llama-3.1-70b-instruct              # model name at that endpoint
OPENAI_API_KEY=your_provider_key_here                  # some free endpoints need a key
```

Run `node openai-eval.mjs --help` for per-provider examples with exact URLs and model names.

**Which to pick:** Start with **Path A** (one env var, full pipeline). Use B for air-gapped/local-only, C if you already run your own inference endpoint.
