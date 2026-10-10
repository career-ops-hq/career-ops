#!/usr/bin/env python3
"""Jev ATS gatekeeper — triage/linter/decide via Vercel AI Gateway or OpenRouter.

Usage:
  python3 scripts/jev_gatekeeper.py <resume.md> <job.txt> triage
  python3 scripts/jev_gatekeeper.py <tailored_resume.md> <job.txt> linter
  python3 scripts/jev_gatekeeper.py [<resume> <job>] --questions <json|@file> \
      [--state <text|@file>] [--model <id>] [--raw]
  python3 scripts/jev_gatekeeper.py --micro --questions <json|@file> \
      --state <text|@file> [--model <id>] [--raw]

The first two are the legacy fixed rubrics: `triage` returns an
`ats_pass_probability` (1-5) plus a `has_core_skills` boolean, and `linter`
returns `is_ai_sibling` / `has_measurable_metrics` booleans. Their stdout shape
is frozen -- callers (`jev-post-linter.mjs`, `jev-pre-screen.mjs`) parse the
exact keys and a new key could be read as a verdict.

The `decide` form is the open channel added for the atomic-core work: it takes
ANY question object (choice / score / noul) supplied by the caller and returns
each answer WITH its raw probability vector and confidence score, so a caller
can build a completeness-escalation policy on top without a second model call.
It is the same single POST: every question runs in parallel server-side.

`--micro` is the isolated single-key escalation channel: exactly ONE question,
and stdout carries just `{"decision": <option-key>, "confidence": <float>}`.
jev-decide.mjs uses it to re-decide a critical categorical (machine enumeration)
decision that came back below its confidence floor, string-in -> string-out,
without regenerating any free text.

Providers (first available key wins):
  OPENROUTER_API_KEY  -> https://openrouter.ai/api/alpha/decisions (typesafe/jev-1.13)
  AI_GATEWAY_API_KEY  -> https://ai-gateway.vercel.sh/typesafe/v1/systemone (typesafe-ai/jev)

Prints one JSON object on stdout, timing/provider notes on stderr;
exit 0 on success, 1 on any failure.
"""

import json
import os
import sys
import time

import requests

TIMEOUT_S = 30
MAX_STATE_CHARS = 120_000

PROVIDERS = (
    {
        "name": "openrouter",
        "env": "OPENROUTER_API_KEY",
        "url": "https://openrouter.ai/api/alpha/decisions",
        "model": "typesafe/jev-1.13",
    },
    {
        "name": "vercel-ai-gateway",
        "env": "AI_GATEWAY_API_KEY",
        "url": "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
        "model": "typesafe-ai/jev",
    },
)

ATS_RUBRIC = [
    "1 — Very unlikely to clear an automated enterprise ATS screen",
    "2 — Unlikely; major keyword or experience gaps versus the posting",
    "3 — Borderline; clears some screens, fails stricter ones",
    "4 — Likely to clear the top-25% screening bar",
    "5 — Strong alignment; expected to clear the screen comfortably",
]

USAGE = (
    "Usage: {prog} <resume> <job> <triage|linter>\n"
    "   or: {prog} [<resume> <job>] --questions <json|@file> "
    "[--state <text|@file>] [--model <id>] [--raw]"
)


def fail(message):
    print(json.dumps({"error": message}))
    sys.exit(1)


def available_providers():
    out = []
    for p in PROVIDERS:
        key = os.environ.get(p["env"])
        if key:
            out.append((p, key))
    if not out:
        envs = " or ".join(p["env"] for p in PROVIDERS)
        fail(f"Missing {envs} env variable.")
    return out


def read_file(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError as e:
        fail(str(e))


def load_spec(spec):
    """A CLI value is either literal text or `@path` pointing at a file."""
    if spec.startswith("@"):
        return read_file(spec[1:])
    return spec


def noul_bool(answer):
    return float(answer.get("noul", 0)) >= 0.5


def score_1_to_5(answer):
    raw = float(answer.get("score", 0))
    return max(1.0, min(5.0, raw + 1.0))


def _number(value):
    # bool is an int subclass in Python; a True/False must not decode as 1/0.
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def extract_confidence(answer):
    """Pull a 0-1 confidence off an answer, wherever the provider puts it.

    The documented location is `providerMetadata.typesafe.confidence`, but a
    gateway may flatten it to `confidence` on the answer itself. Both are read
    defensively rather than assuming one shape, and None means "not reported"
    (which is a valid outcome for noul answers, not an error).
    """
    if not isinstance(answer, dict):
        return None
    for key in ("confidence", "confidence_score"):
        v = _number(answer.get(key))
        if v is not None:
            return v
    meta = answer.get("providerMetadata")
    if isinstance(meta, dict):
        ts = meta.get("typesafe")
        if isinstance(ts, dict):
            v = _number(ts.get("confidence"))
            if v is not None:
                return v
        v = _number(meta.get("confidence"))
        if v is not None:
            return v
    return None


def normalize_probabilities(value):
    """Return a probability vector as a plain JSON object/array, or None."""
    if isinstance(value, dict):
        return {k: (_number(v) if _number(v) is not None else v) for k, v in value.items()}
    if isinstance(value, list):
        return value
    return None


def decode_decision(name, question, answer):
    """Decode one arbitrary answer without collapsing its distribution.

    Unlike the fixed triage/linter decoders, this keeps the raw probability
    vector, the confidence score and the untouched answer object so a caller can
    rank or escalate on them. `value` is the human-facing decode:
      score  -> the numeric level as returned
      choice -> the chosen option key (a string)
      noul   -> boolean thresholded at 0.5 (probability kept alongside)
    """
    qtype = question.get("type") if isinstance(question, dict) else None
    decoded = {
        "type": qtype,
        "value": None,
        "probabilities": None,
        "confidence": None,
        "raw": answer,
    }
    if not isinstance(answer, dict):
        decoded["error"] = "answer was not an object"
        return decoded

    decoded["probabilities"] = normalize_probabilities(answer.get("probabilities"))
    decoded["confidence"] = extract_confidence(answer)

    if qtype == "score":
        s = _number(answer.get("score"))
        if s is None:
            decoded["error"] = "missing numeric score"
        else:
            decoded["value"] = s
    elif qtype == "choice":
        c = answer.get("choice")
        if not isinstance(c, str):
            decoded["error"] = "missing choice"
        else:
            decoded["value"] = c
    else:  # noul / boolean
        p = _number(answer.get("noul"))
        if p is None:
            p = _number(answer.get("probability"))
        if p is None:
            decoded["error"] = "missing noul/probability"
        else:
            decoded["probability"] = p
            decoded["value"] = p >= 0.5
    return decoded


def build_payload(resume_text, job_text, phase, model):
    label = "RESUME" if phase == "triage" else "TAILORED_RESUME"
    state = f"{label}:\n{resume_text}\n\nJOB:\n{job_text}"
    if len(state) > MAX_STATE_CHARS:
        state = state[:MAX_STATE_CHARS] + "\n[truncated]"

    if phase == "triage":
        questions = {
            "ats_pass_probability": {
                "type": "score",
                "instructions": (
                    "Rate the statistical likelihood of this raw profile passing "
                    "an automated enterprise ATS scanner (top 25% bar) using the "
                    "1-5 rubric levels."
                ),
                "criteria": ATS_RUBRIC,
            },
            "has_core_skills": {
                "type": "noul",
                "instructions": (
                    "Does the applicant possess at least 75% of the mandatory "
                    "technical infrastructure listed in the job description?"
                ),
            },
        }
    else:
        questions = {
            "is_ai_sibling": {
                "type": "noul",
                "instructions": (
                    "Does this tailored resume copy-paste job description blocks "
                    "line-for-line, which would trigger AI plagiarism defenses?"
                ),
            },
            "has_measurable_metrics": {
                "type": "noul",
                "instructions": (
                    "Are more than 75% of employment history bullet points backed "
                    "by clear quantifiable metrics?"
                ),
            },
        }
    return {"model": model, "state": state, "questions": questions}


def is_soft_provider_error(status_code, text):
    if status_code in (402, 429):
        return True
    return status_code == 403 and "customer_verification" in text


def post_to_providers(payload_for, api_key_header=True):
    """POST a per-provider payload, returning (resp, provider, elapsed_ms).

    The caller supplies a `payload_for(provider)` builder so both the legacy
    fixed-rubric call and the open decide call share the same fallback loop.
    """
    providers = available_providers()
    last_error = None
    total_ms = 0.0
    for provider, api_key in providers:
        payload = payload_for(provider)
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        started = time.perf_counter()
        try:
            resp = requests.post(provider["url"], json=payload, headers=headers, timeout=TIMEOUT_S)
        except requests.RequestException as e:
            last_error = str(e)
            total_ms += (time.perf_counter() - started) * 1000
            continue
        elapsed_ms = (time.perf_counter() - started) * 1000
        total_ms += elapsed_ms

        if resp.status_code >= 400:
            last_error = f"HTTP {resp.status_code}: {resp.text[:500]}"
            if is_soft_provider_error(resp.status_code, resp.text) and provider is not providers[-1][0]:
                print(
                    f"fallback: {provider['name']} unavailable ({resp.status_code}), trying next provider",
                    file=sys.stderr,
                )
                continue
            fail(last_error)

        try:
            body = resp.json()
        except ValueError:
            fail("Response was not JSON")
        return body, provider, elapsed_ms, total_ms

    fail(last_error or "All providers failed")


def log_provider(provider, body, elapsed_ms, total_ms):
    usage = body.get("usage") or {}
    print(
        f"provider={provider['name']} model={body.get('model', provider['model'])} "
        f"http_ms={elapsed_ms:.0f} total_ms={total_ms:.0f} "
        f"usage={json.dumps(usage, separators=(',', ':'))}",
        file=sys.stderr,
    )


def run_jev_audit(resume_path, job_path, phase, raw=False, model_override=None):
    if phase not in ("triage", "linter"):
        fail(f"Unknown phase: {phase!r} (expected 'triage' or 'linter')")

    resume_data = read_file(resume_path)
    job_data = read_file(job_path)

    def payload_for(provider):
        payload = build_payload(resume_data, job_data, phase, model_override or provider["model"])
        return payload

    body, provider, elapsed_ms, total_ms = post_to_providers(payload_for)

    answers = body.get("answers")
    if not isinstance(answers, dict):
        fail(f"Malformed response: missing answers ({json.dumps(body)[:300]})")

    if phase == "triage":
        needed = ("ats_pass_probability", "has_core_skills")
        if any(k not in answers for k in needed):
            fail(f"Missing triage answers: got {sorted(answers)}")
        out = {
            "ats_pass_probability": score_1_to_5(answers["ats_pass_probability"]),
            "has_core_skills": noul_bool(answers["has_core_skills"]),
        }
    else:
        needed = ("is_ai_sibling", "has_measurable_metrics")
        if any(k not in answers for k in needed):
            fail(f"Missing linter answers: got {sorted(answers)}")
        out = {
            "is_ai_sibling": noul_bool(answers["is_ai_sibling"]),
            "has_measurable_metrics": noul_bool(answers["has_measurable_metrics"]),
        }

    if raw:
        # Opt-in only: the frozen shapes above stay byte-identical when --raw is
        # absent, so no existing caller can observe a change.
        out["_confidence"] = {k: extract_confidence(answers[k]) for k in answers}
        out["_raw_answers"] = answers

    log_provider(provider, body, elapsed_ms, total_ms)
    print(json.dumps(out))


def run_decide(state_text, questions, raw=False, model_override=None):
    if len(state_text) > MAX_STATE_CHARS:
        state_text = state_text[:MAX_STATE_CHARS] + "\n[truncated]"

    def payload_for(provider):
        return {
            "model": model_override or provider["model"],
            "state": state_text,
            "questions": questions,
        }

    body, provider, elapsed_ms, total_ms = post_to_providers(payload_for)

    answers = body.get("answers")
    if not isinstance(answers, dict):
        fail(f"Malformed response: missing answers ({json.dumps(body)[:300]})")

    decisions = {}
    for name, question in questions.items():
        if name not in answers:
            decisions[name] = {
                "type": question.get("type") if isinstance(question, dict) else None,
                "value": None,
                "probabilities": None,
                "confidence": None,
                "raw": None,
                "error": "missing answer",
            }
        else:
            decisions[name] = decode_decision(name, question, answers[name])

    out = {
        "decisions": decisions,
        "provider": provider["name"],
        "model": body.get("model", model_override or provider["model"]),
        "usage": body.get("usage") or {},
    }
    if raw:
        out["raw_answers"] = answers

    log_provider(provider, body, elapsed_ms, total_ms)
    print(json.dumps(out))


def run_micro(state_text, questions, raw=False, model_override=None):
    """Single-key string evaluation for a confidence escalation: re-decide ONE
    isolated critical-categorical question and print ONLY its option-key string,
    confidence, provider and model. The caller (jev-decide.mjs) binds the
    escalation to exactly the data key with the low confidence; the bounded
    option set comes along in the payload so the model answers in closed form.

    Same provider fallback loop and failure contract as run_decide; the output
    shape is the envelope's `--micro` channel: {"decision", "confidence"}.
    """
    if len(state_text) > MAX_STATE_CHARS:
        state_text = state_text[:MAX_STATE_CHARS] + "\n[truncated]"

    def payload_for(provider):
        return {
            "model": model_override or provider["model"],
            "state": state_text,
            "questions": questions,
        }

    body, provider, elapsed_ms, total_ms = post_to_providers(payload_for)

    answers = body.get("answers")
    if not isinstance(answers, dict):
        fail(f"Malformed response: missing answers ({json.dumps(body)[:300]})")

    name, question = next(iter(questions.items()))
    answer = answers.get(name)
    if not isinstance(answer, dict):
        fail(f"Malformed response: missing answer for {name!r} ({json.dumps(body)[:300]})")

    decided = decode_decision(name, question, answer)
    out = {
        "decision": decided.get("value"),
        "confidence": decided.get("confidence"),
        "provider": provider["name"],
        "model": body.get("model", model_override or provider["model"]),
        "usage": body.get("usage") or {},
    }
    if raw:
        out["raw_answer"] = answer

    log_provider(provider, body, elapsed_ms, total_ms)
    print(json.dumps(out))


def parse_cli(argv):
    """Split argv into positionals and flags; no argparse so the 3-arg legacy
    form keeps working verbatim (tests assert exactly three positional args)."""
    flags = {}
    positional = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--questions", "--state", "--model"):
            if i + 1 >= len(argv):
                fail(f"{a} requires a value")
            flags[a[2:]] = argv[i + 1]
            i += 2
            continue
        if a in ("--raw", "--micro"):
            flags[a[2:]] = True
            i += 1
            continue
        positional.append(a)
        i += 1
    return positional, flags


def load_questions(flags):
    spec = flags.get("questions")
    if spec is None:
        fail("--questions is required in decide mode")
    raw = load_spec(spec)
    try:
        questions = json.loads(raw)
    except ValueError as e:
        fail(f"--questions was not valid JSON: {e}")
    if not isinstance(questions, dict) or not questions:
        fail("--questions must be a non-empty JSON object of {name: question}")
    for name, q in questions.items():
        if not isinstance(q, dict) or not isinstance(q.get("type"), str):
            fail(f"question {name!r} needs a string 'type'")
    return questions


def main(argv):
    positional, flags = parse_cli(argv)
    raw = bool(flags.get("raw"))
    model_override = flags.get("model")

    if flags.get("micro"):
        questions = load_questions(flags)
        if flags.get("state") is None:
            fail("decide mode needs --state <text|@file>, or <resume> <job> positional paths")
        run_micro(load_spec(flags["state"]), questions, raw=raw, model_override=model_override)
        return

    if flags.get("questions") is not None:
        questions = load_questions(flags)
        if flags.get("state") is not None:
            state = load_spec(flags["state"])
        elif len(positional) >= 2:
            state = f"RESUME:\n{read_file(positional[0])}\n\nJOB:\n{read_file(positional[1])}"
        else:
            fail("decide mode needs --state <text|@file>, or <resume> <job> positional paths")
        run_decide(state, questions, raw=raw, model_override=model_override)
        return

    if len(positional) != 3:
        fail(USAGE.format(prog=sys.argv[0]))
    run_jev_audit(positional[0], positional[1], positional[2], raw=raw, model_override=model_override)


if __name__ == "__main__":
    main(sys.argv[1:])
