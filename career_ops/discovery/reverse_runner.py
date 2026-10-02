"""Run the reverse ATS directory sweep with Python decisions and SQLite facts."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from typing import TypedDict
import uuid
from urllib.parse import urlsplit

import yaml
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from career_ops.artifacts import cached_artifact, load_artifact, save_artifact
from career_ops.discovery.configured import _blacklist
from career_ops.discovery.dedup import company_role_key, database_snapshot, url_key
from career_ops.discovery.store import DiscoveryStore
from career_ops.discovery.verify import observe
from career_ops.discovery.reverse_checkpoint import compatible, load_checkpoint, resume_at, write_checkpoint
from career_ops.discovery.reverse_discovery import blacklist_offers, output_offer, pre_enrich, retain_jobs
from career_ops.discovery.reverse_sources import SOURCES, dataset_fingerprint, load_company_list, sample_companies, to_entry


from career_ops.context import ROOT
BATCH_SIZE = 50
RESOLVER_FAILURE_LIMIT = 50
SEEDS = {"yc", "a16z"}
SEED_SLUG = re.compile(r"^[A-Za-z0-9._-]+$")
GREENHOUSE_SEED_URL = re.compile(r"job-boards(?:\.eu)?\.greenhouse\.io/([^/?#]+)")
ASHBY_SEED_URL = re.compile(r"jobs\.ashbyhq\.com/([^/?#]+)")


class ReverseState(TypedDict, total=False):
    phase: str
    sweep: dict
    decision: dict
    result: dict


def load_seed(seed: str) -> dict:
    """Use the existing public portfolio parser as a raw source reader."""
    with tempfile.TemporaryDirectory(prefix="career-ops-reverse-seed-") as temporary:
        source, target = Path(temporary) / "input.json", Path(temporary) / "output.json"
        source.write_text(json.dumps({"seed": seed}))
        # The Node YC reader can walk 500 pages with a 20-second request budget per page.
        timeout = 500 * 20 + 60 if seed == "yc" else 900
        try:
            result = subprocess.run(["node", str(ROOT / "adapters/node/seeds/_collect.mjs"), str(source), str(target)],
                                    cwd=ROOT, text=True, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            if not target.is_file():
                raise
            result = subprocess.CompletedProcess([], 0, "", "")
        if result.returncode or not target.is_file():
            raise RuntimeError((result.stderr or result.stdout).strip()[-2000:] or "Portfolio collection failed")
        payload = json.loads(target.read_text())
        companies = payload.get("companies") if isinstance(payload, dict) else None
    if not isinstance(companies, list):
        raise ValueError("Portfolio collector returned invalid companies")
    return {"companies": companies, "partial": payload.get("partial") is True}


def seed_entry(company: dict) -> dict | None:
    """Resolve the old seed URL precedence and provider order in Python."""
    if not isinstance(company, dict):
        return None
    ats_id = company.get("ats_id")
    url = ""
    if isinstance(ats_id, str) and SEED_SLUG.fullmatch(ats_id):
        host = {"greenhouse": "job-boards.greenhouse.io", "lever": "jobs.lever.co",
                "ashby": "jobs.ashbyhq.com"}.get(company.get("ats"))
        if host:
            url = f"https://{host}/{ats_id}"
    slug = company.get("slug")
    if not url and isinstance(slug, str) and SEED_SLUG.fullmatch(slug):
        url = f"https://job-boards.greenhouse.io/{slug}"
    if not url:
        url = company.get("url") or ""
    try:
        parsed = urlsplit(url)
    except (TypeError, ValueError):
        return None
    if not isinstance(url, str):
        return None
    if GREENHOUSE_SEED_URL.search(url):
        provider = "greenhouse"
    elif parsed.hostname in {"jobs.lever.co", "jobs.eu.lever.co"} and parsed.path.strip("/"):
        provider = "lever"
    elif ASHBY_SEED_URL.search(url):
        provider = "ashby"
    else:
        provider = None
    if not provider:
        return None
    return {"name": company.get("name"), "careers_url": url, "provider": provider, "source": company.get("source")}


def write_digest(directory: Path, offers: list[dict], since_days: float, liveness: bool, date: str) -> Path:
    """Write the reverse scan's dated Markdown digest after business persistence."""
    directory.mkdir(parents=True, exist_ok=True)
    lines = [f"# Reverse ATS Scan — {date}",
             f"> {len(offers)} jobs | since {since_days:g}d | {'liveness ✓' if liveness else 'no liveness check'}", ""]
    for offer in offers:
        posted = datetime.fromtimestamp(offer["postedAt"] / 1000, timezone.utc).date().isoformat() if offer.get("postedAt") else "n/a"
        lines.append(f"- [{offer['title']} @ {offer['company']}]({offer['url']}) — {offer.get('location') or 'N/A'} | {offer['source']} | {posted}")
    path = directory / f"{date}.md"
    path.write_text("\n".join([*lines, ""]))
    return path


def collect_boards(targets: list[dict], cutoff_ms: float, include_undated: bool, concurrency: int) -> list[dict]:
    """Use the existing Node providers only for raw board fetches."""
    if not isinstance(concurrency, int) or isinstance(concurrency, bool) or not 1 <= concurrency <= 20:
        raise ValueError("concurrency must be an integer from 1 to 20")
    with tempfile.TemporaryDirectory(prefix="career-ops-reverse-collect-") as temporary:
        source, target = Path(temporary) / "input.json", Path(temporary) / "output.json"
        progress = Path(str(target) + ".progress")
        source.write_text(json.dumps({"targets": targets, "since_ms": cutoff_ms,
                                      "include_undated": include_undated, "synthetic_entries": True,
                                      "concurrency": concurrency, "mode": "reverse"}))
        timeout = max(900, math.ceil(len(targets) / concurrency) * 300 + 60)
        timeout_error = None
        try:
            result = subprocess.run(["node", str(ROOT / "adapters/node/providers/_collect.mjs"), str(source), str(target)],
                                    cwd=ROOT, text=True, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            timeout_error = error
            if not target.is_file() and not progress.is_file():
                raise
            result = subprocess.CompletedProcess([], 0, "", "")
        if result.returncode or not target.is_file():
            if not timeout_error or not progress.is_file():
                raise RuntimeError((result.stderr or result.stdout).strip()[-2000:] or "Reverse provider collection failed")
            rows = [None] * len(targets)
            for line in progress.read_text().splitlines():
                try:
                    item = json.loads(line)
                except ValueError:
                    break
                index = item.get("index")
                if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(rows) \
                        or not isinstance(item.get("row"), dict):
                    raise ValueError("Reverse collector wrote invalid progress")
                rows[index] = item["row"]
            if not any(row is not None for row in rows):
                raise timeout_error
        else:
            rows = json.loads(target.read_text())["results"]
    if not isinstance(rows, list) or len(rows) != len(targets):
        raise ValueError("Reverse collector returned a different board count")
    return rows


def directory_concurrency(name: str, batch: list[dict]) -> int:
    """Keep shared-host Workday directory batches from flooding one WAF."""
    if name in {"greenhouse", "lever", "ashby"}:
        return 6
    if name == "workday":
        hosts = [urlsplit(entry["careers_url"]).hostname for entry in batch]
        if len(hosts) != len(set(hosts)):
            # ponytail: serializes mixed batches too; use per-host semaphores if throughput becomes limiting.
            return 1
    return 20


def enrich_dates(jobs: list[dict], *, timeout_seconds: float = 300) -> tuple[list[dict], bool]:
    """Ask the guarded iCIMS detail reader only about Python-selected rows."""
    if not jobs:
        return [], True
    if timeout_seconds <= 0:
        return [], False
    with tempfile.TemporaryDirectory(prefix="career-ops-reverse-enrich-") as temporary:
        source, target = Path(temporary) / "input.json", Path(temporary) / "output.json"
        source.write_text(json.dumps({"jobs": jobs}))
        try:
            result = subprocess.run(["node", str(ROOT / "adapters/node/providers/_enrich.mjs"), str(source), str(target)],
                                    cwd=ROOT, text=True, capture_output=True, timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            progress = Path(f"{target}.progress")
            completed = []
            if progress.is_file():
                for line in progress.read_text().splitlines():
                    item = json.loads(line)
                    if item.get("index") != len(completed) or not isinstance(item.get("job"), dict):
                        raise ValueError("iCIMS enrichment wrote invalid progress")
                    completed.append(item["job"])
            if len(completed) > len(jobs):
                raise ValueError("iCIMS enrichment wrote too many jobs")
            return completed, False
        if result.returncode or not target.is_file():
            raise RuntimeError((result.stderr or result.stdout).strip()[-2000:] or "iCIMS enrichment failed")
        enriched = json.loads(target.read_text())
    if not isinstance(enriched, list) or len(enriched) != len(jobs):
        raise ValueError("iCIMS enrichment returned a different job count")
    return enriched, True


def decide_reverse_offers(offers: list[dict], blacklist_path: Path, *, include_blacklisted: bool,
                          liveness: bool, verify) -> tuple[list[dict], int, int]:
    """Apply the final blacklist and live-posting gates before publication."""
    blacklist = _blacklist(blacklist_path)
    final, filtered, annotated = blacklist_offers(offers, blacklist, include_blacklisted=include_blacklisted)
    if liveness and final:
        observations = verify(final)
        if len(observations) != len(final):
            raise ValueError("Browser verification returned a different offer count")
        for offer, check in zip(final, observations):
            if check.get("url") != offer["url"] or check.get("result") not in {"active", "uncertain", "expired"}:
                raise ValueError("Browser verification returned an invalid observation")
        final = [offer for offer, check in zip(final, observations) if check["result"] != "expired"]
    final.sort(key=lambda offer: offer.get("postedAt") or 0, reverse=True)
    return final, filtered, annotated


def publish_reverse_offers(store: DiscoveryStore, final: list[dict], run_id: str, summary: dict,
                           health: list[dict], *, md_out: Path | None, since_days: float,
                           liveness: bool) -> tuple[Path | None, str | None]:
    """Retain offers and one run, then write the optional digest."""
    for offer in final:
        store.ingest(offer, offer["source"])
    store.scan_run_once("global", run_id, summary, health)
    digest_path, digest_error = None, None
    if md_out and final:
        try:
            digest_path = write_digest(md_out, final, since_days, liveness,
                                       datetime.now(timezone.utc).date().isoformat())
        except OSError as error:
            digest_error = str(error)
    return digest_path, digest_error


def discover_global(directory: Path, config_path: Path, *, ats: list[str] | None = None,
                    seeds: list[str] | None = None, liveness: bool = False, md_out: Path | None = None,
                    verbose: bool = False,
                    since_days: float = 3, limit: int | None = None, include_undated: bool = False,
                    include_blacklisted: bool = False, shuffle: bool = False, resume: bool = False,
                    dry_run: bool = False, collect=collect_boards, load_source=load_company_list,
                    enrich=enrich_dates, load_portfolio=load_seed, verify=observe,
                    now_ms: float | None = None, input_root: Path | None = None) -> dict:
    """Sweep selected public ATS directories and retain the final Python decision."""
    input_root = input_root or config_path.parent
    seeds = list(seeds or [])
    sources = ([] if seeds else list(SOURCES)) if ats is None else list(ats)
    unknown = set(sources) - set(SOURCES)
    if unknown:
        raise ValueError("unknown ATS source(s): " + ", ".join(sorted(unknown)))
    if set(seeds) - SEEDS:
        raise ValueError("unknown seed source(s): " + ", ".join(sorted(set(seeds) - SEEDS)))
    if not math.isfinite(since_days) or since_days <= 0:
        raise ValueError("since_days must be positive and finite")
    if limit is not None and (not isinstance(limit, int) or isinstance(limit, bool) or limit <= 0):
        raise ValueError("limit must be a positive integer")
    if shuffle and resume:
        raise ValueError("shuffled reverse scans cannot resume")
    if dry_run:
        with tempfile.TemporaryDirectory(prefix="career-ops-reverse-dry-run-") as temporary:
            scratch = Path(temporary)
            database = directory / "opportunities.db"
            if database.is_file():
                with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as source, \
                        sqlite3.connect(scratch / "opportunities.db") as target:
                    source.backup(target)
            if resume:
                checkpoint = directory / "cache" / "ats-full-checkpoint.json"
                if checkpoint.is_file():
                    (scratch / "cache").mkdir(parents=True, exist_ok=True)
                    shutil.copy2(checkpoint, scratch / "cache" / checkpoint.name)
                company_cache = directory / "cache" / "ats-companies"
                if company_cache.is_dir():
                    shutil.copytree(company_cache, scratch / "cache" / "ats-companies")
            result = discover_global(scratch, config_path, ats=sources, seeds=seeds, liveness=liveness,
                                     verbose=verbose,
                                     since_days=since_days, limit=limit,
                                     include_undated=include_undated, include_blacklisted=include_blacklisted,
                                     shuffle=shuffle, resume=resume, collect=collect, load_source=load_source, enrich=enrich,
                                     load_portfolio=load_portfolio, verify=verify,
                                     now_ms=now_ms, input_root=input_root)
            return {**result, "saved": False, "dry_run": True}
    if not config_path.is_file():
        raise ValueError(f"Portal configuration is missing: {config_path}")
    config = yaml.safe_load(config_path.read_text()) or {}
    if not isinstance(config, dict):
        raise ValueError("Portal configuration must be an object")
    checkpoint_path = directory / "cache" / "ats-full-checkpoint.json"
    checkpoint = load_checkpoint(checkpoint_path) if resume else None
    if resume and not compatible(checkpoint, ats=sources, seeds=seeds, limit=limit,
                                 include_undated=include_undated, shuffle=shuffle):
        raise ValueError("No compatible reverse sweep checkpoint found")
    if not resume and checkpoint_path.is_file():
        print(f"Warning: unfinished reverse sweep checkpoint at {checkpoint_path} will be overwritten; "
              "pass --resume to continue it", file=sys.stderr)
    current_ms = now_ms if now_ms is not None else time.time() * 1000
    cutoff_ms = checkpoint["cutoff_ms"] if checkpoint else current_ms - since_days * 86_400_000
    counters = {"companies_scanned": 0, "companies_available": 0, "errors": 0, "undated": 0,
                "content": 0, "capped_boards": 0, "no_date_skip_companies": 0, "no_date_skip_jobs": 0}
    if checkpoint:
        counters.update(checkpoint.get("counters") or {})
        counters["companies_available"] = 0
    offers = list(checkpoint["offers"]) if checkpoint else []
    completed = set(checkpoint.get("completed_sources", [])) if checkpoint else set()
    seed_sizes = dict(checkpoint.get("seed_sizes", {})) if checkpoint else {}
    seed_statuses = dict(checkpoint.get("seed_statuses", {})) if checkpoint else {}
    run_id = checkpoint.get("run_id") if checkpoint else uuid.uuid4().hex
    graph_attempt = checkpoint.get("graph_attempt", 0) if checkpoint else 0
    pending_current = checkpoint.get("current") if checkpoint else None
    dataset_status: dict[str, str] = {}
    health = {item["company"]: item for item in checkpoint["source_health"]} if checkpoint else {}
    failures: list[dict] = []
    cap_hit = False
    stopped = False
    resumable = False
    checked_at = datetime.now(timezone.utc).isoformat()
    blacklist_path = input_root / "blacklist.md"
    blacklist_hash = hashlib.sha256(json.dumps(_blacklist(blacklist_path), sort_keys=True,
                                             ensure_ascii=False).encode()).hexdigest()
    decision_inputs = {"liveness": liveness, "include_blacklisted": include_blacklisted,
                       "blacklist_hash": blacklist_hash}
    store = DiscoveryStore(directory / "opportunities.db")
    try:
        snapshot = database_snapshot(store.db, today=datetime.now().date())
        seen_urls, seen_roles = snapshot["seen"], snapshot["seen_company_roles"]
        for offer in offers:
            seen_urls.add(url_key(offer.get("url")))
            seen_roles.add(company_role_key(offer.get("company"), offer.get("title")))

        def save(current: dict | None) -> bool:
            nonlocal pending_current
            pending_current = current
            return write_checkpoint(checkpoint_path, {
                "run_id": run_id, "cutoff_ms": cutoff_ms, "ats": sources, "seeds": seeds, "limit": limit,
                "include_undated": include_undated, "completed_sources": sorted(completed),
                "current": current, "offers": offers, "counters": counters, "source_health": list(health.values()),
                "seed_sizes": seed_sizes, "seed_statuses": seed_statuses,
                "graph_attempt": graph_attempt,
            })

        def sweep_state() -> dict:
            return {"stopped": stopped, "cap_hit": cap_hit, "dataset_status": dataset_status,
                    "failures": failures, "resumable": resumable, "counters": counters.copy()}

        def restore_sweep(state: ReverseState) -> None:
            nonlocal stopped, cap_hit, dataset_status, failures, resumable
            snapshot = state["sweep"]
            stopped = snapshot["stopped"]
            cap_hit = snapshot["cap_hit"]
            dataset_status = snapshot["dataset_status"]
            failures = snapshot["failures"]
            resumable = snapshot["resumable"]
            counters.update(snapshot["counters"])

        if not checkpoint and not checkpoint_path.is_file():
            resumable = save(None)
        def scan_directories(state: ReverseState) -> dict:
            nonlocal cap_hit, stopped, resumable
            for name in sources:
                values, status = load_source(name, directory / "cache" / "ats-companies")
                dataset_status[name] = status
                counters["companies_available"] += len(values)
                source_capped = limit is not None and limit < len(values)
                cap_hit |= source_capped
                if name in completed:
                    continue
                fingerprint = dataset_fingerprint(values)
                entries = [entry for value in sample_companies(values, limit, shuffle=shuffle)
                           if (entry := to_entry(name, value)) is not None]
                start = resume_at(checkpoint, name, values, fingerprint, entries_len=len(entries)) if checkpoint else 0
                print(f"global {name}: {len(entries)} boards" + (f", resuming at {start}" if start else ""),
                      file=sys.stderr, flush=True)
                resolver_failures = 0
                source_incomplete = status != "ok" or source_capped or name in health
                for offset in range(start, len(entries), BATCH_SIZE):
                    batch = entries[offset:offset + BATCH_SIZE]
                    try:
                        outcomes = collect(batch, cutoff_ms, include_undated, directory_concurrency(name, batch))
                    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
                        counters["errors"] += 1
                        if verbose:
                            failures.append({"source": name, "company": batch[0]["name"], "error": str(error)})
                        stopped = True
                        source_incomplete = True
                        resumable = save({"name": name, "resume_at": offset,
                                          "dataset_len": len(values), "dataset_hash": fingerprint})
                        break
                    if len(outcomes) != len(batch):
                        raise ValueError("Reverse collector returned a different board count")
                    for index, (entry, outcome) in enumerate(zip(batch, outcomes)):
                        if outcome is None:
                            counters["errors"] += 1
                            source_incomplete = stopped = True
                            resumable = save({"name": name, "resume_at": offset + index,
                                              "dataset_len": len(values), "dataset_hash": fingerprint})
                            break
                        counters["companies_scanned"] += 1
                        if outcome.get("status") != "fetched":
                            counters["errors"] += 1
                            if verbose:
                                failures.append({"source": name, "company": entry["name"],
                                                 "error": outcome.get("error") or outcome.get("status")})
                            source_incomplete = True
                            resolver_failures = resolver_failures + 1 if outcome.get("resolver_failure") else 0
                            if resolver_failures >= RESOLVER_FAILURE_LIMIT:
                                stopped = True
                        else:
                            resolver_failures = 0
                            jobs = outcome.get("jobs", [])
                            if not isinstance(jobs, list):
                                raise ValueError("Provider jobs must be a list")
                            if name == "icims":
                                positions = [i for i, job in enumerate(jobs) if isinstance(job, dict) and pre_enrich(job, config, cutoff_ms)]
                                if positions:
                                    try:
                                        deadline_ms = outcome["deadline_ms"]
                                        if not isinstance(deadline_ms, (int, float)) or isinstance(deadline_ms, bool) or not math.isfinite(deadline_ms) or deadline_ms <= 0:
                                            raise ValueError("iCIMS collector returned invalid deadline")
                                        remaining_seconds = (deadline_ms - time.time() * 1000) / 1000
                                        updated, complete = ([], False) if remaining_seconds <= 0 else enrich(
                                            [jobs[i] for i in positions], timeout_seconds=remaining_seconds)
                                        if not isinstance(updated, list) or len(updated) > len(positions):
                                            raise ValueError("iCIMS enrichment returned invalid progress")
                                        if complete and len(updated) != len(positions):
                                            raise ValueError("iCIMS enrichment omitted jobs")
                                        for position, job in zip(positions, updated):
                                            jobs[position] = job
                                        if not complete:
                                            jobs = jobs[:positions[len(updated)]] if len(updated) < len(positions) else jobs
                                            source_incomplete = True
                                            counters["errors"] += 1
                                    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
                                        jobs = jobs[:positions[0]]
                                        source_incomplete = True
                                        counters["errors"] += 1
                            accepted, dropped = retain_jobs([job for job in jobs if isinstance(job, dict)],
                                                           f"{name}-full", config, cutoff_ms, seen_urls, seen_roles,
                                                           include_undated=include_undated)
                            offers.extend(accepted)
                            counters["undated"] += dropped["undated"]
                            counters["content"] += dropped["content"]
                            if outcome.get("no_date_skip"):
                                counters["no_date_skip_companies"] += 1
                                counters["no_date_skip_jobs"] += len(jobs)
                            if outcome.get("truncated") and outcome.get("truncation_kind") == "network" and name == "workday":
                                try:
                                    retry = collect([entry], cutoff_ms, include_undated, 1)[0]
                                    if not isinstance(retry, dict) or retry.get("status") != "fetched":
                                        raise RuntimeError((retry.get("error") if isinstance(retry, dict) else None) or "Workday retry failed")
                                    if not isinstance(retry.get("jobs"), list):
                                        raise ValueError("Workday retry returned invalid jobs")
                                    retried, retried_dropped = retain_jobs(retry["jobs"], f"{name}-full", config, cutoff_ms,
                                                                            seen_urls, seen_roles, include_undated=include_undated)
                                    offers.extend(retried)
                                    counters["undated"] += retried_dropped["undated"]
                                    counters["content"] += retried_dropped["content"]
                                    if retry.get("truncated"):
                                        raise RuntimeError("Workday board remains truncated after quiet retry")
                                except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
                                    counters["errors"] += 1
                                    source_incomplete = True
                            if outcome.get("capped") or outcome.get("truncation_kind") in {"page_cap", "coverage_gap"}:
                                counters["capped_boards"] += 1
                                source_incomplete = True
                            elif outcome.get("truncated") and not (name == "workday" and outcome.get("truncation_kind") == "network"):
                                counters["errors"] += 1
                                source_incomplete = True
                        if stopped:
                            resumable = save({"name": name, "resume_at": offset + index + 1,
                                              "dataset_len": len(values), "dataset_hash": fingerprint})
                            break
                    if stopped:
                        break
                    resumable = save({"name": name, "resume_at": offset + len(batch),
                                      "dataset_len": len(values), "dataset_hash": fingerprint})
                    print(f"global {name}: {offset + len(batch)}/{len(entries)} boards, "
                          f"{len(offers)} retained candidates, {counters['errors']} unreachable",
                          file=sys.stderr, flush=True)
                if stopped:
                    health[name] = {"company": name, "status": "network", "timestamp": checked_at}
                    resumable = save(pending_current)
                    break
                completed.add(name)
                health[name] = {"company": name, "status": "incomplete" if source_incomplete else "reachable",
                                "timestamp": checked_at}
                resumable = save(None)
            return {"phase": "directories", "sweep": sweep_state()}

        def scan_seeds(state: ReverseState) -> dict:
            nonlocal cap_hit, resumable
            restore_sweep(state)
            for seed in seeds:
                if seed in completed:
                    counters["companies_available"] += seed_sizes.get(seed, 0)
                    dataset_status[seed] = seed_statuses.get(seed, "ok")
                    cap_hit |= limit is not None and limit < seed_sizes.get(seed, 0)
                    continue
                try:
                    portfolio = load_portfolio(seed)
                    companies = portfolio["companies"] if isinstance(portfolio, dict) else portfolio
                    partial = portfolio.get("partial") is True if isinstance(portfolio, dict) else False
                except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
                    counters["errors"] += 1
                    if verbose:
                        failures.append({"source": seed, "error": str(error)})
                    dataset_status[seed] = "error"
                    health[seed] = {"company": seed, "status": "network", "timestamp": checked_at}
                    continue
                if not companies:
                    dataset_status[seed] = "empty"
                    health[seed] = {"company": seed, "status": "incomplete", "timestamp": checked_at}
                    continue
                dataset_status[seed] = "partial" if partial else "ok"
                selected = sample_companies(companies, limit, shuffle=shuffle)
                counters["companies_scanned"] += len(selected)
                counters["companies_available"] += len(companies)
                seed_sizes[seed] = len(companies)
                seed_capped = limit is not None and limit < len(companies)
                cap_hit |= seed_capped
                entries = [entry for company in selected if (entry := seed_entry(company))]
                source_incomplete = partial or seed_capped
                for offset in range(0, len(entries), BATCH_SIZE):
                    batch = entries[offset:offset + BATCH_SIZE]
                    try:
                        outcomes = collect(batch, cutoff_ms, include_undated, 20)
                    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
                        outcomes = [{"status": "error", "error": str(error)} for _ in batch]
                    if len(outcomes) != len(batch):
                        raise ValueError("Seed collector returned a different board count")
                    for entry, outcome in zip(batch, outcomes):
                        if not isinstance(outcome, dict) or outcome.get("status") != "fetched":
                            counters["errors"] += 1
                            source_incomplete = True
                            if verbose:
                                failures.append({"source": seed, "company": entry["name"],
                                                 "error": (outcome.get("error") or outcome.get("status"))
                                                 if isinstance(outcome, dict) else "collector timed out"})
                            continue
                        jobs = outcome.get("jobs", [])
                        if not isinstance(jobs, list):
                            raise ValueError("Seed provider jobs must be a list")
                        if outcome.get("truncated") or outcome.get("capped"):
                            source_incomplete = True
                            if outcome.get("capped") or outcome.get("truncation_kind") in {"page_cap", "coverage_gap"}:
                                counters["capped_boards"] += 1
                            else:
                                counters["errors"] += 1
                        accepted, _ = retain_jobs([job for job in jobs if isinstance(job, dict)],
                                                  f"{seed}-seed", config, cutoff_ms, seen_urls, seen_roles,
                                                  include_undated=include_undated)
                        offers.extend(accepted)
                if source_incomplete:
                    dataset_status[seed] = "partial"
                seed_statuses[seed] = dataset_status[seed]
                health[seed] = {"company": seed, "status": "incomplete" if source_incomplete else "reachable",
                                "timestamp": checked_at}
                completed.add(seed)
                resumable = save(pending_current)
            return {"phase": "seeds", "sweep": sweep_state()}

        def decide(state: ReverseState) -> dict:
            path = directory / "cache" / "reverse-discovery" / run_id / str(graph_attempt) / "decision.json"
            cached = cached_artifact(path)
            if cached and load_artifact(cached).get("inputs") == decision_inputs:
                return {"phase": "decided", "decision": cached}
            final, filtered, annotated = decide_reverse_offers(
                offers, blacklist_path, include_blacklisted=include_blacklisted,
                liveness=liveness, verify=verify)
            return {"phase": "decided", "decision": save_artifact(path, {
                "inputs": decision_inputs, "offers": final, "filtered": filtered, "annotated": annotated})}

        def publish(state: ReverseState) -> dict:
            restore_sweep(state)
            decision = load_artifact(state["decision"])
            final = decision["offers"]
            summary = {"run_id": run_id, "found": len(final), "errors": counters["errors"], "sources": sources,
                       "stopped": stopped, "dataset_status": dataset_status}
            digest_path, digest_error = publish_reverse_offers(
                store, final, run_id, summary, list(health.values()),
                md_out=md_out, since_days=since_days, liveness=liveness)
            incomplete = stopped or cap_hit or counters["errors"] > 0 or counters["capped_boards"] > 0 or any(
                status != "ok" for status in dataset_status.values())
            incomplete |= any(item["status"] == "incomplete" for item in health.values())
            result = {"status": "partial" if incomplete else "completed",
                      "date": datetime.now(timezone.utc).date().isoformat(),
                      "sources": sources, "resumed": bool(checkpoint), "sinceDays": since_days,
                      "companiesAvailable": counters["companies_available"],
                      "companiesScanned": counters["companies_scanned"],
                      "capHit": cap_hit, "stoppedByOutage": stopped, "resumable": stopped and resumable,
                      "datasetStatus": dataset_status, "postingsKept": len(final),
                      "postingsDroppedNoDate": counters["undated"], "postingsFilteredBlacklist": decision["filtered"],
                      "postingsAnnotatedBlacklisted": decision["annotated"], "postingsDroppedContent": counters["content"],
                      "unreachableBoards": counters["errors"], "cappedBoards": counters["capped_boards"],
                      "saved": bool(final), "digest": str(digest_path) if digest_path else None,
                      **({"digestError": digest_error} if digest_error else {}),
                      **({"failures": failures} if verbose else {}),
                      "offers": [output_offer(offer) for offer in final]}
            path = directory / "cache" / "reverse-discovery" / run_id / str(graph_attempt) / "result.json"
            return {"phase": "published", "result": save_artifact(path, result)}

        graph = StateGraph(ReverseState)
        graph.add_node("scan_directories", scan_directories)
        graph.add_node("scan_seeds", scan_seeds)
        graph.add_node("decide", decide)
        graph.add_node("publish", publish)
        graph.add_edge(START, "scan_directories")
        graph.add_edge("scan_directories", "scan_seeds")
        graph.add_edge("scan_seeds", "decide")
        graph.add_edge("decide", "publish")
        graph.add_edge("publish", END)
        graph_cache = directory / "cache" / "reverse-discovery"
        graph_cache.mkdir(parents=True, exist_ok=True)
        with SqliteSaver.from_conn_string(str(graph_cache / "checkpoints.db")) as saver:
            compiled = graph.compile(checkpointer=saver)
            graph_config = {"configurable": {"thread_id": f"{run_id}:{graph_attempt}"}}
            prior = compiled.get_state(graph_config)
            stale_decision = (prior.values.get("decision")
                              and load_artifact(prior.values["decision"]).get("inputs") != decision_inputs)
            finished_outage = (prior.values.get("result")
                               and load_artifact(prior.values["result"])["stoppedByOutage"])
            if resume and (stale_decision or finished_outage):
                graph_attempt += 1
                if not save(pending_current):
                    raise OSError("Could not checkpoint the next reverse graph attempt")
                graph_config = {"configurable": {"thread_id": f"{run_id}:{graph_attempt}"}}
                outcome = load_artifact(compiled.invoke({"phase": "start"}, graph_config)["result"])
            elif prior.next:
                outcome = load_artifact(compiled.invoke(None, graph_config)["result"])
            elif prior.values.get("result"):
                outcome = load_artifact(prior.values["result"])
            else:
                outcome = load_artifact(compiled.invoke({"phase": "start"}, graph_config)["result"])
        if not outcome["stoppedByOutage"]:
            checkpoint_path.unlink(missing_ok=True)
        return outcome
    finally:
        store.close()
