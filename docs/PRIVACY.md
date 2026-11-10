# Privacy guard — protecting what leaves your machine

career-ops sends your CV, profile and job descriptions to external LLM providers.
This page explains what the **privacy guard** does about that: what it blocks,
what it deliberately allows, where it is enforced, and — importantly — the limits
of what it can promise.

> **A guard is not a guarantee of anonymity.** It is a check at the outbound
> boundary. It catches recognizable, configured and pattern-shaped personal data.
> It does not catch paraphrasing, indirect identification, or values you never
> told it about. Read [Known limitations](#known-limitations) before you rely on it.

---

## The one-sentence version

Immediately before any request goes to an LLM provider, the guard inspects the
**entire serialized request** and, if it finds a protected value, **aborts the
request and sends nothing**. It never silently edits your prompt.

---

## Quick start

```bash
# 1. Copy the sample and fill in your own values.
cp config/privacy.example.yml config/privacy.yml

# 2. Edit config/privacy.yml — replace the fictional placeholders.

# 3. Confirm the guard sees them.
node privacy-status.mjs
```

`privacy-status.mjs` reports how many values are guarded, which pattern
detectors are on, and where its config came from — **without printing any of the
values themselves**.

`config/privacy.yml` is gitignored. The committed `config/privacy.example.yml`
holds only fictional placeholders.

> **Read this before you enable it.** Evaluations send your whole
> `cv.md` to the provider, and the guard inspects the whole request. So if your
> name is listed under `protected:`, or your CV contains an email or phone number
> while `auto_detect` is on, every evaluation that includes the CV is blocked
> until those values are out of `cv.md` or out of this config. List what must
> never leave the machine and is not in your CV, or use `PRIVACY_REDACT=1`
> (see below).

---

## What it blocks

### Tier 1 — configured protected values

Exact values you list under `protected:` in `config/privacy.yml`. Matching is:

- **case-insensitive** for text;
- **digits-only** for numbers and phones, so `+1 555 010 0199`,
  `15550100199` and `(555) 010-0199` all match one entry;
- **length-floored**: a value shorter than 5 characters (or 5 digits) is
  ignored, because guarding it would block ordinary prose. Store salary as an
  absolute annual figure (`145000`) rather than a short form (`145`) so it stays
  guardable.

### Tier 2 — automatically detected PII

Patterns, not your values. Each kind is switchable under `auto_detect:` in
`config/privacy.yml`:

| Kind | In sample config | What it matches |
|------|------------------|-----------------|
| `email` | on | Addresses with a dotted domain (`name@host.tld`) |
| `phone` | on | Phone-shaped numbers with a `+` or separator groups |
| `profile_url` | off | Personal profile URLs (`linkedin.com/in/…`, `github.com/<user>`, …) |

> **No-config policy:** Without a `config/privacy.yml`, pattern detection is
> **opt-in (off by default)**. This ensures ordinary job postings that include
> a recruiter's contact email or telephone are not blocked during evaluation.
> Once you copy `config/privacy.example.yml` to `config/privacy.yml`, the
> enabled patterns above take effect.

---

## What it deliberately allows

Ordinary professional information is **not** blocked:

- skills, employers, job titles, dates, education, achievements;
- the job description itself, including a company's published salary band;
- team sizes, years of experience, posting dates.

The policy is explicit: **nothing is blocked merely for being personal.** A
value is blocked only if you configured it, or it matches an enabled pattern.
This is why the length floors exist — without them, a two-letter "protected
value" would refuse every posting that contains those letters.

---

## Where it is enforced

Two layers, both calling the same function
(`assertLlmRequestAllowed` in `lib/llm-outbound.mjs`):

### 1. Explicit — at the call site (primary)

Each LLM-calling script builds its request body, then checks it immediately
before `fetch`:

| Script | Provider |
|--------|----------|
| `openrouter-runner.mjs` | OpenRouter (both the pinned-model and rotation paths) |
| `openai-eval.mjs`, `openai-tailor.mjs` | any OpenAI-compatible endpoint |
| `ollama-eval.mjs` | Ollama (local *or* remote via `OLLAMA_BASE_URL`) |
| `gemini-eval.mjs`, `batch-evaluate-gemini.mjs`, `scan-hn.mjs` | Google Generative AI SDK |

### 2. Ambient — over global `fetch` (safety net)

`lib/pii-interceptor.mjs` wraps `globalThis.fetch`. Any request to a recognised
LLM host goes through the same check. This exists for two reasons:

- a call site that nobody remembered to instrument;
- **third-party SDKs** — the Google Generative AI SDK issues its own `fetch`, so
  this ambient layer is what covers it with no SDK-specific code.

The evaluators install it themselves, so it is present without any shell
configuration. You can also force it for every `node` command in the checkout:

```bash
NODE_OPTIONS="--import ./lib/pii-interceptor.mjs"
```

Job boards, ATS APIs and general web scraping are **not** inspected — a false
block there would break the scanner. Only known LLM hosts (and LLM-shaped
endpoints) are checked.

---

## Fail-closed behaviour

| Situation | Result |
|-----------|--------|
| Protected value found in the request | **Blocked.** Error names the category and the `protected:` key that matched (`protected.salary.current_base`), never the value. |
| Request body cannot be serialized/read | **Blocked.** "I could not inspect this" is never reported as "clean". |
| Body is a `ReadableStream` / `FormData` / `URLSearchParams` / `Blob` / `ArrayBuffer` | **Blocked.** Their content lives in internal slots JSON cannot see, so the guard refuses them rather than inspecting 2 bytes and clearing the request. Read it to text yourself and pass the string. |
| Body is a `Buffer` / typed array | **Inspected as decoded text.** Not refused: its bytes are decodable, so the guard decodes them and scans that. |
| Config file present but unparseable | **Error.** The guard refuses to run on a config it cannot read. |
| Config file absent | **Allowed, by design.** Documented safe state: no configured checks, and pattern detection is opt-in (disabled by default). Reported as `absent`, not as protection you configured. |
| Config file present but empty | Same as absent, reported as `empty`. |

The label is the YAML **key path** of the value that matched, so a block message
like `Found: configured protected number (protected.salary.current_base)` names
the exact line in `config/privacy.yml` to look at — the only way to locate it,
since the value itself is never echoed. Nested keys report their full dotted path
and array items report `protected.custom[0]`. (An earlier version printed a
flattened position, `entry 3`, which pointed at no visible line once a value was
nested — the case the label exists for.) Configured numbers match as a substring
of any longer digit run, so a block can be triggered by a number you do not
recognise; the key path is what turns that into a fix.

---

## Turning it off (deliberately)

Disabling the guard requires **two** independent factors:

```bash
export PRIVACY_GUARD=off
export PRIVACY_BYPASS_TOKEN=i-understand-the-risk   # any non-empty value
```

With only `PRIVACY_GUARD=off` set, the guard **stays on** and warns. The second
factor exists so a typo, a copied `.env` line or an inherited shell variable can
never silently disable protection in production. Neither variable is set by
career-ops itself.

### Redact mode (opt-in, not the default)

```bash
export PRIVACY_REDACT=1
```

Instead of blocking, this replaces **configured** values with placeholder tokens
on the way out and rehydrates them in the response. It is not the default because
silently altering a prompt changes what the model was asked. Prefer blocking,
or narrowing your config.

---

## Working with a CLI agent (Claude Code, OpenCode, Codex, …)

The guard protects requests **career-ops itself makes**. It cannot see a CLI
agent reading `cv.md` and `config/profile.yml` from disk with its own file tools.
If you use an interactive coding CLI, ensure you do not ask it to send files
containing personal data you want kept off external servers.

---

## Known limitations

Read these. The guard is useful precisely because its edges are stated.

1. **Heuristic, not exhaustive.** Pattern detection catches recognizable
   emails, phones and profile URLs. It does **not** catch indirect,
   spelled-out, encoded, base64'd or paraphrased PII, aliases, or any value you
   did not configure.
2. **Length floors trade recall for precision.** A configured value under 5
   characters / 5 digits is not guarded. A very short personal string (an
   initial, a 4-digit code) cannot be blocked without blocking ordinary text.
3. **Phone detection is the loosest pattern.** It may false-positive on posting
   text. If it does, set `phone: false` under `auto_detect:` and keep the rest.
4. **Coverage is the paths that call the guard.** A future script that talks to
   a provider over a native HTTP client, a child process, or a browser is
   outside both layers. The ambient `fetch` wrapper covers global `fetch`; it
   does not cover a different transport.
5. **Not a guarantee of anonymity.** It reduces the chance that recognized
   personal data leaves your machine. It does not make you anonymous to the
   provider, and it does not see what a CLI agent does with the files on disk.
6. **Your provider still sees your prompt.** Anything not caught by the guard —
   and everything you deliberately allow — reaches the provider as usual.
7. **Redact mode rehydrates only `text()` and `json()`.** In opt-in redact mode
   (`PRIVACY_REDACT=1`) the wrapper un-tokens the response by patching those two
   methods on the live response object. A caller that reads `response.body` as a
   stream receives the placeholder tokens, not your real values. Blocking mode —
   the default — has no equivalent gap.

---

## Files

| File | Role |
|------|------|
| `lib/privacy-guard.mjs` | The policy object: config loading, normalization, detection |
| `lib/llm-outbound.mjs` | The shared boundary — `assertLlmRequestAllowed()` |
| `lib/pii-interceptor.mjs` | Ambient `globalThis.fetch` wrapper |
| `config/privacy.example.yml` | Committed sample (fictional values only) |
| `config/privacy.yml` | Your real config — **gitignored** |
| `privacy-status.mjs` | Diagnostic — reports counts, never values |

Design reference: the `PIIGuard` class in the
[`hunter`](https://github.com/asimthaha/hunter) project — the flattening,
normalization and length floors, the "check the serialized request before the
client call" placement, and the "errors name the category, never the value"
discipline are adapted from it. Pattern detection, the fail-closed config
handling and the ambient fetch layer are career-ops' own additions.
