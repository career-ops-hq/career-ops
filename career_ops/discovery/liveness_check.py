"""Select current opportunities and report read-only liveness checks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from typing import Callable

from dotenv import load_dotenv


from career_ops.context import ROOT


def current_urls(database: Path) -> list[str]:
    """Map Pending, Scored and Awaiting Confirmation to current business rows."""
    with sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True) as connection:
        rows = connection.execute(
            "SELECT url FROM opportunities "
            "WHERE state IN ('discovered', 'evaluating', 'eligible', 'evaluated') "
            "AND application_state IN ('none', 'preparing') ORDER BY id"
        ).fetchall()
    return list(dict.fromkeys(url for (url,) in rows))


def input_urls(args: argparse.Namespace) -> list[str]:
    if args.file:
        return [line.strip() for line in args.file.read_text().splitlines()
                if line.strip() and not line.lstrip().startswith("#")]
    if args.urls:
        return args.urls
    return current_urls(args.directory / "opportunities.db")


def observe(urls: list[str], *, headed_fallback: bool, throttle_ms: int) -> list[dict]:
    """Use the retained Node API/browser readers as one bounded collection tool."""
    with tempfile.TemporaryDirectory(prefix="career-ops-liveness-") as directory:
        source, target = Path(directory) / "input.json", Path(directory) / "output.json"
        source.write_text(json.dumps({"urls": urls, "headed_fallback": headed_fallback,
                                      "throttle_ms": throttle_ms}))
        timeout = max(900, len(urls) * (120 + 2 * throttle_ms / 1000) + 60)
        command = ["node", str(ROOT / "adapters/node/browser/_liveness-observe.mjs"), str(source), str(target)]
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
        if result.returncode or not target.is_file():
            raise RuntimeError((result.stderr or result.stdout).strip() or "Liveness collection failed")
        observations = json.loads(target.read_text())["results"]
    if (not isinstance(observations, list) or len(observations) != len(urls)
            or any(row.get("url") != url or row.get("result") not in {"active", "expired", "uncertain"}
                   or not isinstance(row.get("via_api"), bool)
                   for row, url in zip(observations, urls))):
        raise ValueError("Liveness collection returned invalid observations")
    return observations


def check(*, select_urls: Callable[[], list[str]], reader: Callable[[list[str]], list[dict]]) -> dict:
    """Read observations once and summarize them without persistent execution state."""
    observations = reader(select_urls())
    counts = {"active": 0, "expired": 0, "uncertain": 0, "via_api": 0}
    for observation in observations:
        counts[observation["result"]] += 1
        counts["via_api"] += int(observation["via_api"])
    return {"observations": observations, "summary": counts}


def main(argv: list[str] | None = None) -> int:
    load_dotenv(ROOT / ".env", override=False)
    argv = list(sys.argv[1:] if argv is None else argv)
    argv = ["--throttle=5000" if value == "--throttle" else value for value in argv]
    parser = argparse.ArgumentParser(description="Check current opportunity URLs without changing business state")
    parser.add_argument("--directory", type=Path, default=ROOT / "data")
    parser.add_argument("--file", type=Path)
    parser.add_argument("--no-fallback", action="store_true")
    parser.add_argument("--throttle")
    parser.add_argument("urls", nargs="*")
    args = parser.parse_args(argv)
    if args.file and args.urls:
        parser.error("--file cannot be combined with URLs")
    try:
        throttle_ms = int(args.throttle) if args.throttle is not None else 0
    except ValueError:
        parser.error("--throttle requires milliseconds")
    if throttle_ms < 0:
        parser.error("--throttle must be nonnegative")
    if args.throttle is not None and throttle_ms == 0:
        throttle_ms = 5000
    notes = []
    if not args.no_fallback:
        notes.append("headed fallback on challenge")
    if throttle_ms:
        notes.append(f"throttle ~{throttle_ms / 1000:g}-{2 * throttle_ms / 1000:g}s")
    suffix = f" ({', '.join(notes)})" if notes else ""

    def select_urls() -> list[str]:
        urls = input_urls(args)
        print(f"Checking {len(urls)} URL(s)...{suffix}\n", flush=True)
        return urls

    try:
        result = check(select_urls=select_urls,
                       reader=lambda values: observe(values, headed_fallback=not args.no_fallback,
                                                     throttle_ms=throttle_ms))
    except (OSError, sqlite3.Error, subprocess.SubprocessError, ValueError, RuntimeError) as error:
        parser.exit(1, f"Liveness check failed: {error}\n")
    for observation in result["observations"]:
        icon = {"active": "✅", "expired": "❌", "uncertain": "⚠️"}[observation["result"]]
        print(f"{icon} {observation['result']:<10}{'(api) ' if observation['via_api'] else '      '}{observation['url']}")
        if observation["result"] != "active":
            print(f"           {observation.get('reason', '')}")
    counts = result["summary"]
    print(f"\nResults: {counts['active']} active  {counts['expired']} expired  "
          f"{counts['uncertain']} uncertain  ({counts['via_api']} via API, no browser)")
    return int(bool(counts["expired"] or counts["uncertain"]))
