"""Load and validate the public ATS directories used by reverse discovery."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import random
import re
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from career_ops.http_identity import DEFAULT_USER_AGENT


DATASET_BASE = "https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data"
SOURCES = {name: f"{DATASET_BASE}/{name}_companies.json" for name in
           ("greenhouse", "lever", "ashby", "workday", "icims")}
SLUG = re.compile(r"^[A-Za-z0-9._-]+$")
CACHE_SECONDS = 24 * 60 * 60


def dataset_fingerprint(values: list) -> str:
    """Bind a resume offset to the dataset's exact order and content."""
    payload = json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha1(payload.encode()).hexdigest()[:16]


def fetch_dataset(url: str) -> object:
    with urlopen(Request(url, headers={"User-Agent": DEFAULT_USER_AGENT}), timeout=30) as response:
        return json.load(response)


def load_company_list(name: str, cache_directory: Path, *, fetch=fetch_dataset, now: float | None = None) -> tuple[list, str]:
    """Prefer a 24-hour cache; retain a stale valid list on network failure."""
    if name not in SOURCES:
        raise ValueError(f"unknown ATS source: {name}")
    cache_directory.mkdir(parents=True, exist_ok=True)
    cache_file = cache_directory / f"{name}.json"
    current = now if now is not None else time.time()

    def cached() -> list | None:
        try:
            data = json.loads(cache_file.read_text())
            return data if isinstance(data, list) else None
        except (OSError, ValueError):
            return None

    if cache_file.is_file() and current - cache_file.stat().st_mtime < CACHE_SECONDS:
        if (data := cached()) is not None:
            return data, "ok"
    try:
        data = fetch(SOURCES[name])
        if isinstance(data, list):
            cache_file.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
            return data, "ok"
    except (OSError, ValueError):
        pass
    if (data := cached()) is not None:
        return data, "stale"
    return [], "empty"


def to_entry(source: str, value: object) -> dict | None:
    """Constrain every dataset-supplied coordinate before forming an ATS URL."""
    if source not in SOURCES:
        raise ValueError(f"unknown ATS source: {source}")
    raw = str(value)
    if source == "workday":
        parts = raw.split("|")
        if len(parts) < 3 or not all(SLUG.fullmatch(part) for part in parts[:3]):
            return None
        tenant, instance, site = parts[:3]
        host = f"{tenant}.{instance}.myworkdayjobs.com"
        url = f"https://{host}/{site}"
        name = tenant
    else:
        if not SLUG.fullmatch(raw):
            return None
        name = raw
        host, path = {
            "greenhouse": ("job-boards.greenhouse.io", f"/{raw}"),
            "lever": ("jobs.lever.co", f"/{raw}"),
            "ashby": ("jobs.ashbyhq.com", f"/{raw}"),
            "icims": (f"careers-{raw}.icims.com", "/jobs/search?ss=1&in_iframe=1"),
        }[source]
        url = f"https://{host}{path}"
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != host.lower():
        return None
    return {"name": name, "careers_url": url, "provider": source}


def sample_companies(values: list, limit: int | None, *, shuffle: bool = False, rng=None) -> list:
    sample = values.copy()
    if shuffle and limit is not None and limit < len(sample):
        (rng or random).shuffle(sample)
    return sample[:limit]
