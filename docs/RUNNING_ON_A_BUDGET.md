# Running Career-Ops on a Budget

Token usage costs and rate limits are the most common bottlenecks when setting up a high-volume job search pipeline. Since Career-Ops processes full job descriptions, evaluates them against your CV across five weighted dimensions, and tailors resumes/cover letters, the context size can grow quickly.

Fortunately, **Career-Ops is completely AI-agnostic.** The pipeline relies on the AI coding CLI (or standalone scripts) to process prompt files under `modes/`. This means you can point your CLI to cheaper API providers or local models with **zero code changes** in Career-Ops.

---

## 1. The Core Concept: Model Agnosticism

Career-Ops is composed of local templates, Markdown prompts, and Node/Playwright scripts. The AI logic is driven entirely by whichever AI coding CLI you run it in (e.g., Claude Code, OpenCode, Qwen CLI, Codex, Antigravity CLI, or Grok Build CLI).

By choosing a CLI that supports custom model configurations and routing it to a cheaper API provider or local LLM, you can drastically reduce your pipeline running costs without losing any functionality.

---

## 2. Pick Your Spend Tier

Before diving into CLI configuration, know that career-ops has a built-in knob for controlling evaluation cost: the `spend_tier` setting in [`config/profile.yml`](../config/profile.example.yml). It controls which model tier your CLI uses to evaluate offers — no provider setup required.

| Tier | Behaviour |
|------|-----------|
| **economy** | Cheapest/fastest model, no extended thinking. Best for high-volume scanning. |
| **standard** | Balanced model, no extended thinking. Default if the key is absent. |
| **premium** | Most capable model, adaptive extended thinking. Best for high-stakes offers. |

The **economy** tier is the high-volume scanning choice — it processes the most offers per dollar. On **standard** and **premium**, a pre-screen gate automatically trims batch spend by skipping obvious mismatches before the full evaluation runs.

Set it once in your profile:

```yaml
# config/profile.yml
spend_tier: standard
```

The actual model behind each tier depends on your CLI. See the mapping table in [`modes/_shared.md`](../modes/_shared.md) for the full breakdown.

---

## 2b. Already Paying for a Subscription? Make Sure You Are Using It

If you pay for a plan (Claude Pro/Max, or the equivalent on another CLI) and you are *also* being charged per token, the usual cause is an API key sitting in your environment: **most CLIs prefer an explicit key over your logged-in subscription.** The tool cannot tell that you would rather spend the plan you already bought.

This section is Claude Code specific because that is where the question comes up most. Other CLIs have their own precedence rules: check their docs, but the shape of the problem is the same.

### Check which one you are on

```bash
echo $ANTHROPIC_API_KEY     # anything printed here is being billed per token
```

Inside Claude Code, `/status` reports the active login and shows an API-key row when a key is in use, and `/usage` shows plan usage on a subscription versus a session dollar cost on a key.

### Switch to the subscription

1. Remove the key from wherever it is exported (`~/.zshrc`, `~/.bashrc`, `~/.profile`, a project `.env`, or another tool that sets it for you). `unset ANTHROPIC_API_KEY` only affects the current shell, so edit the file too or it comes back on the next terminal.
2. Restart the terminal.
3. Run `/login` in Claude Code and sign in.

`ANTHROPIC_AUTH_TOKEN` and the cloud-provider switches (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`) take precedence too, so check those if a stray key is not the culprit.

### The batch mode is the exception worth knowing

`batch/batch-runner.sh` drives `claude -p` workers, and the headless path does not use the interactive login. If you want batch runs on your subscription rather than on credits, generate a long-lived token once:

```bash
claude setup-token          # requires an active Claude subscription
```

Then export the value it prints as `CLAUDE_CODE_OAUTH_TOKEN` in the environment the batch runs in. It is a credential: treat it like one, and never commit it.

### Two things worth expecting

- **Plan limits are windows, not balances.** On a subscription you get rolling usage windows rather than a credit balance, so a heavy scan can pause you until the window resets. `spend_tier: economy` and the pre-screen gate above exist precisely to make high-volume days cheaper.
- **Details change.** Auth precedence and command names come from the CLI, not from career-ops. If something here does not match what you see, the vendor's own docs are the source of truth: [Claude Code authentication](https://code.claude.com/docs/en/authentication) and [managing costs](https://code.claude.com/docs/en/costs).

---

## 3. Configuring Alternative CLI Setups

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
### Kimi K2.5 via OpenCode (Verified)

> **Kimi the model, not Kimi the CLI.** This recipe runs the Kimi K2.5 *model* through the **OpenCode** CLI. That is a different thing from using the standalone **Kimi CLI** as your host (see [Supported CLIs](SUPPORTED_CLIS.md)). The names collide; the setups don't. Follow the steps below inside OpenCode.

The following configuration was verified with Career-Ops using OpenCode and Moonshot AI's OpenAI-compatible API.

#### opencode.json

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "moonshot": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Moonshot Kimi",
      "options": {
        "baseURL": "https://api.moonshot.ai/v1",
        "apiKey": "{env:MOONSHOT_API_KEY}"
      },
      "models": {
        "kimi-k2.5": {
          "name": "Kimi K2.5"
        }
      }
    }
  },
  "model": "moonshot/kimi-k2.5"
}
```

#### Environment variable

Linux/macOS

```bash
export MOONSHOT_API_KEY="your_api_key"
```

Windows PowerShell

```powershell
$env:MOONSHOT_API_KEY="your_api_key"
```

Windows CMD

```cmd
set MOONSHOT_API_KEY=your_api_key
```

#### Verification

This configuration was verified locally by running a complete Career-Ops evaluation.

Observed during verification:

- Evaluation completed successfully.
- Markdown evaluation report was generated successfully.
- Applications tracker was updated successfully.
- No malformed structured output was observed during this verification run.
- PDF generation was skipped because Playwright MCP was not configured in the local environment.

#### Notes

- The measured runtime reflects the complete Career-Ops pipeline (job retrieval, prompt loading, report generation, and tracker updates), not raw model inference latency.
- Kimi K2.5 worked correctly with the Moonshot OpenAI-compatible endpoint during verification.

#### Comparison

| Option | Cost | Notes |
|---------|------|------|
| OpenRouter `:free` | Free tier | Easy setup. Subject to model availability and rate limits. |
| Kimi K2.5 | Moonshot API | Verified working with OpenCode using the Moonshot OpenAI-compatible endpoint. |
| Ollama | Local | No API cost, but requires suitable local hardware and larger recommended models for reliable evaluations. |

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

## 4. Recommended Cost-Efficient Models

When choosing a budget-friendly model, you need strong reasoning capabilities to handle the multi-dimensional scoring and resume tailoring. Here are the recommended models that hold up well under evaluation:

| Model | Provider / Endpoint | Price per 1M Input / Output Tokens | Why use it |
|-------|---------------------|------------------------------------|------------|
| **DeepSeek V3** | DeepSeek API / OpenRouter | ~$0.14 / ~$0.28 | **Top Recommendation.** Unmatched reasoning-to-price ratio; performs close to frontier models at a fraction of the cost. |
| **DeepSeek-Coder-V2** | DeepSeek API / OpenRouter | ~$0.14 / ~$0.28 | Excellent instruction-following for structured Markdown and resume tailoring. |
| **Qwen-2.5-Coder (32B / 72B)** | OpenRouter / DeepInfra | ~$0.07 - ~$0.30 | Strong coding and structured reasoning, highly cost-effective. |
| **GLM-4-Air / GLM-4** | Zhipu AI / OpenRouter | Very Cheap | Reliable multi-turn reasoning and JSON/Markdown generation. |
| **Gemini 2.5 Flash** | Google AI Studio | Free Tier (15 RPM) | Available via the standalone script `node gemini-eval.mjs`. Excellent for zero-cost low-volume runs, but subject to rate limits. |
| **Kimi K2.5** | Moonshot AI | API pricing applies | Verified with OpenCode using the Moonshot OpenAI-compatible endpoint. Produces structured Markdown suitable for Career-Ops evaluations. See the verified OpenCode recipe below. |


> **Standalone evaluator (no CLI config needed):** every OpenAI-compatible provider above (DeepSeek, Qwen, GLM, Together, Groq, OpenRouter, …) works directly through `node openai-eval.mjs` — just set a base URL, model, and key:
> ```bash
> OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
> OPENAI_MODEL=deepseek/deepseek-chat \
> OPENAI_API_KEY=your_key \
> node openai-eval.mjs --file ./jds/job.txt
> ```
> Run `node openai-eval.mjs --help` for per-provider examples. For 100% local/private use, point `--url` at a local server (LM Studio / llama.cpp / vLLM) or use `node ollama-eval.mjs`.

> NVIDIA NIM also works (hosted `https://integrate.api.nvidia.com/v1` or a self-hosted container's `/v1`), e.g. `--model meta/llama-3.3-70b-instruct`. The hosted free tier can queue for minutes, so raise `OPENAI_TIMEOUT_MS` above the 300s default.

## 5. Local LLM Tradeoffs (Ollama / Llama.cpp)

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

## 6. Token-Saving Best Practices

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

## 7. Worked Example: Running the Pipeline Cheaply

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
- **Input:** ~20,000 tokens. The static prefix alone is **17,728**: the script sends `modes/_shared.md` (4,127) plus `modes/oferta.md` (13,601) as the system prompt, and your `cv.md` and the JD come on top of that.
- **Output:** ~1,000 tokens (the A-G evaluation report).
- **Cost:** at DeepSeek V3 prices (~$0.14/1M input, ~$0.28/1M output), roughly **$0.003 per evaluation**. Still cheap, and cheap enough that the number below matters more than this one.

Measure it yourself rather than trusting this paragraph, because these files grow with every release:

```bash
node --input-type=module -e "
import { estimateTokens } from './lib/context-budget.mjs';
import { readFileSync } from 'fs';
for (const f of ['modes/_shared.md','modes/oferta.md','AGENTS.md'])
  console.log(f, estimateTokens(readFileSync(f,'utf8')));"
```

### What the default path costs (this is the number most people are actually paying)

The figures above are for the standalone script. **If you paste a job URL into your CLI instead, the agent loads `AGENTS.md` (8,285) + `modes/_shared.md` (4,127) + `modes/oferta.md` (13,601) = about 26,000 tokens of instructions per evaluation**, before your CV, the job description, or any tool output. That is the real floor of an interactive evaluation, and it is why a long session of pasting URLs burns a quota that a batch of standalone script calls would not.

Two things follow from that, and they are the cheapest wins available:

- **Batch beats pasting** when you have several roles: `batch/batch-runner.sh` reuses one worker instead of re-sending the instructions per role.
- **One evaluation is not the risk; unbounded research is.** A single evaluation used to be able to fan out into dozens of subagents and burn tens of millions of tokens (issue #1235). The modes now cap web research at five queries and forbid spawning subagents for it, so an evaluation stays bounded. If you write your own mode, keep that cap: it is the difference between a $0.003 evaluation and an exhausted five-hour limit.

### Step 4: Tailor the CV HTML (~3,000 Tokens)

Now, use the headless tailor to inject JD keywords, reorder experience, and build the customized HTML for the role.

```bash
OPENAI_API_KEY="sk-or-your_openrouter_key" \
node openai-tailor.mjs \
  --url https://openrouter.ai/api/v1 \
  --model deepseek/deepseek-chat \
  --jd ./jds/my-target-role.txt \
  --report reports/001-companyname-2026-07-07.md
```

**Cost:** ~3,000 tokens (less than $0.001). This outputs a customized HTML file in the `output/` directory.

### Step 5: Generate ATS-Optimized PDF (0 Tokens)

Once you have the tailored HTML file, the PDF generator uses Playwright to compile it into a tailored CV PDF.

```bash
node generate-pdf.mjs output/cv-candidate-companyname.html output/cv-candidate-companyname-2026-07-07.pdf --format=letter --report=001
```

**Cost:** 0 tokens, $0.00.

By routing the heaviest step (Evaluation) to a cheap OpenAI-compatible endpoint, a complete end-to-end job application cycle drops from ~$0.05 - $0.15 on frontier models to a fraction of a cent, allowing you to run bulk batch processing affordably.

---

## 8. Zero-Cost Paths (No Claude / Paid CLI Required)

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

This calls `ollama-eval.mjs` which hits your local Ollama server. No API key, no internet, no cost. See [Section 5](#5-local-llm-tradeoffs-ollama--llamacpp) for model size recommendations (32B+ minimum for reliable scoring).

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
