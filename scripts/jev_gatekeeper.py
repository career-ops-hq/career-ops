#!/usr/bin/env python3
"""Jev ATS gatekeeper — triage/linter via Vercel AI Gateway or OpenRouter.

Usage:
  python3 scripts/jev_gatekeeper.py <resume.md> <job.txt> triage
  python3 scripts/jev_gatekeeper.py <tailored_resume.md> <job.txt> linter

Providers (first available key wins):
  OPENROUTER_API_KEY  -> https://openrouter.ai/api/alpha/decisions (typesafe/jev-1.13)
  AI_GATEWAY_API_KEY  -> https://ai-gateway.vercel.sh/typesafe/v1/systemone (typesafe-ai/jev)

Prints one JSON decision object on stdout, timing/provider notes on stderr;
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


def noul_bool(answer):
    return float(answer.get("noul", 0)) >= 0.5


def score_1_to_5(answer):
    raw = float(answer.get("score", 0))
    return max(1.0, min(5.0, raw + 1.0))


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


def run_jev_audit(resume_path, job_path, phase):
    providers = available_providers()

    if phase not in ("triage", "linter"):
        fail(f"Unknown phase: {phase!r} (expected 'triage' or 'linter')")

    try:
        with open(resume_path, "r", encoding="utf-8") as r:
            resume_data = r.read()
        with open(job_path, "r", encoding="utf-8") as j:
            job_data = j.read()
    except OSError as e:
        fail(str(e))

    last_error = None
    total_ms = 0.0
    for provider, api_key in providers:
        payload = build_payload(resume_data, job_data, phase, provider["model"])
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

        usage = body.get("usage") or {}
        print(
            f"provider={provider['name']} model={body.get('model', provider['model'])} "
            f"http_ms={elapsed_ms:.0f} total_ms={total_ms:.0f} "
            f"usage={json.dumps(usage, separators=(',', ':'))}",
            file=sys.stderr,
        )
        print(json.dumps(out))
        return

    fail(last_error or "All providers failed")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        fail(f"Usage: {sys.argv[0]} <resume> <job> <triage|linter>")
    run_jev_audit(sys.argv[1], sys.argv[2], sys.argv[3])
