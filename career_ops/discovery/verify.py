"""Route browser observations before discovered postings enter business storage."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit


from career_ops.context import ROOT
GUARD_CODES = {"invalid_url", "unsupported_protocol", "blocked_host"}


def observe(offers: list[dict], *, headed_fallback: bool = False, throttle_ms: int = 0,
            rediscover_404: bool = False) -> list[dict]:
    """Use the guarded Node browser as a read-only collection tool."""
    timeout = max(900, len(offers) * (120 + 2 * max(throttle_ms, 0) / 1000) + 60)
    with tempfile.TemporaryDirectory(prefix="career-ops-verification-") as temporary:
        source, target = Path(temporary) / "input.json", Path(temporary) / "output.json"
        source.write_text(json.dumps({"offers": offers, "headed_fallback": headed_fallback,
                                      "throttle_ms": throttle_ms, "rediscover_404": rediscover_404}))
        command = ["node", str(ROOT / "adapters/node/browser/_verify-discovery.mjs"), str(source), str(target)]
        try:
            result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            if not target.is_file():
                raise
            result = subprocess.CompletedProcess(command, 0, "", "")
        if result.returncode or not target.is_file():
            raise RuntimeError((result.stderr or result.stdout).strip() or "Posting verification failed")
        observations = json.loads(target.read_text())["results"]
    if not isinstance(observations, list) or len(observations) != len(offers):
        raise ValueError("Browser verification returned a different offer count")
    return observations


def route(offers: list[dict], observations: list[dict]) -> tuple[list[dict], list[dict]]:
    """Keep active/transient URLs and record permanent rejection outcomes."""
    if len(offers) != len(observations):
        raise ValueError("Browser verification returned a different offer count")
    retained, outcomes = [], []
    for offer, check in zip(offers, observations):
        if check.get("url") != offer["url"]:
            raise ValueError("Browser verification returned a mismatched URL")
        result, code = check.get("result"), check.get("code")
        if result == "expired":
            moved_url, moved_check = check.get("moved_url"), check.get("moved_check")
            try:
                moved_domain = urlsplit(moved_url).hostname if isinstance(moved_url, str) else None
            except ValueError:
                moved_domain = None
            if (code == "http_gone" and offer.get("tracked") and offer.get("careersUrlDomain")
                    and moved_domain == offer["careersUrlDomain"] and isinstance(moved_check, dict)
                    and moved_check.get("result") == "active"):
                retained.append({**offer, "url": moved_url, "previousUrl": offer["url"]})
            outcomes.append(({**offer, "reason": check.get("reason")}, "skipped_expired"))
        elif result == "uncertain" and code in GUARD_CODES:
            outcomes.append(({**offer, "code": code, "reason": check.get("reason")},
                             "skipped_blocked_host" if code == "blocked_host" else "skipped_invalid_url"))
        elif result == "uncertain" and code == "no_apply_control":
            outcomes.append(({**offer, "reason": check.get("reason")}, "skipped_no_apply_control"))
        elif result in {"active", "uncertain"}:
            retained.append(offer)
        else:
            raise ValueError("Browser verification returned an invalid result")
    return retained, outcomes
