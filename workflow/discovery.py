"""Collect provider postings and retain discovery decisions in the business store."""

from __future__ import annotations

import json
import hashlib
import math
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlsplit

import yaml

try:
    from workflow.discovery_cooldown import cooldown, load_windows
    from workflow.discovery_dedup import company_aliases, company_role_key, database_snapshot, url_key, _text_key
    from workflow.discovery_filters import filter_reason
    from workflow.discovery_fingerprint import cross_listings, fingerprint
    from workflow.discovery_prescreen import candidate_source_hash, write_placeholder
    from workflow.discovery_store import DiscoveryStore
    from workflow.discovery_trust import trust
    from workflow.discovery_verify import observe, route
except ModuleNotFoundError:
    from discovery_cooldown import cooldown, load_windows
    from discovery_dedup import company_aliases, company_role_key, database_snapshot, url_key, _text_key
    from discovery_filters import filter_reason
    from discovery_fingerprint import cross_listings, fingerprint
    from discovery_prescreen import candidate_source_hash, write_placeholder
    from discovery_store import DiscoveryStore
    from discovery_trust import trust
    from discovery_verify import observe, route


ROOT = Path(__file__).resolve().parents[1]


def capture_jd(directory: Path, url: str) -> dict | None:
    """Refresh one discovered posting with the existing guarded browser reader."""
    try:
        result = subprocess.run(
            ["node", str(ROOT / "lib" / "scan-jd.mjs"), url, str(directory)],
            cwd=ROOT, text=True, capture_output=True, timeout=45,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode:
        return None
    try:
        snapshot = json.loads(result.stdout).get("snapshot")
    except (AttributeError, json.JSONDecodeError):
        return None
    if not isinstance(snapshot, dict) or snapshot.get("status") != "captured":
        return None
    if any(not isinstance(snapshot.get(key), str) or not snapshot[key].strip()
           for key in ("text", "url", "retrieved_at")):
        return None
    return snapshot


def _blacklist(path: Path) -> dict[str, dict]:
    if not path.is_file():
        return {}
    entries = {}
    for line in path.read_text().replace("\r", "").splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.split("|")]
        company = cells[1] if len(cells) > 1 else ""
        if not company or company.lower() == "company" or set(company) <= {"-", ":", " "}:
            continue
        key = _text_key(company)
        if key and key not in entries:
            entries[key] = {"company": company, "since": cells[2] if len(cells) > 2 else "",
                            "scope": cells[3] if len(cells) > 3 else "", "reason": cells[4] if len(cells) > 4 else ""}
    return entries


def _config(path: Path) -> dict:
    if not path.is_file():
        raise ValueError(f"Portal configuration is missing: {path}")
    loaded = yaml.safe_load(path.read_text()) or {}
    if not isinstance(loaded, dict):
        raise ValueError("Portal configuration must be an object")
    return loaded


def collect_provider_results(targets: list[tuple[dict, bool]], since_ms: float | None) -> tuple[list, list[str]]:
    """Call the Node provider adapters and return their complete batch and coverage warnings."""
    with tempfile.TemporaryDirectory(prefix="career-ops-provider-") as temporary:
        input_path, output_path = Path(temporary) / "input.json", Path(temporary) / "output.json"
        input_path.write_text(json.dumps({"targets": [entry for entry, _ in targets], "since_ms": since_ms,
                                          "mode": "configured"}, ensure_ascii=False))
        collector_timeout = max(900, math.ceil(len(targets) / 10) * 600 + 60)
        try:
            result = subprocess.run(["node", str(ROOT / "providers" / "_collect.mjs"), str(input_path), str(output_path)],
                                    cwd=ROOT, text=True, capture_output=True, timeout=collector_timeout)
        except subprocess.TimeoutExpired:
            if not output_path.is_file():
                raise ValueError(f"Provider scanner exceeded its {collector_timeout}-second budget") from None
            result = subprocess.CompletedProcess([], 0, "", "")
        except OSError as error:
            raise ValueError(f"Provider scanner unavailable: {error}") from error
        if result.returncode or not output_path.is_file():
            raise ValueError((result.stderr or result.stdout).strip()[-4000:] or "Provider collection failed")
        try:
            collected = json.loads(output_path.read_text())["results"]
        except (OSError, ValueError, KeyError, TypeError):
            raise ValueError("Provider collector returned invalid output") from None
        collector_warnings = list(dict.fromkeys(line.strip() for line in result.stderr.splitlines() if line.strip()))
    if not isinstance(collected, list) or len(collected) != len(targets):
        raise ValueError("Provider collector returned a different target count")
    return collected, collector_warnings


def discover(directory: Path, config_path: Path, company_filter: str | None = None,
             *, capture=None, verify: bool = False, verification_observer=None,
             headed_fallback: bool = False, throttle_ms: int = 0,
             rediscover_404: bool = False, posted_after: str | None = None,
             posted_before: str | None = None, since_days: float | None = None,
             include_blacklisted: bool = False, dry_run: bool = False, resume: bool = False,
             input_root: Path | None = None, profile_path: Path | None = None) -> dict:
    """Collect with Node provider plugins; decide and retain business facts in Python."""
    input_root = input_root or config_path.parent
    profile_path = profile_path or input_root / "config" / "profile.yml"
    if dry_run:
        if resume:
            raise ValueError("Configured discovery dry runs cannot resume a retained run")
        with tempfile.TemporaryDirectory(prefix="career-ops-discovery-dry-run-") as temporary:
            scratch = Path(temporary)
            database = directory / "opportunities.db"
            if database.is_file():
                with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as source, \
                        sqlite3.connect(scratch / "opportunities.db") as target:
                    source.backup(target)
            result = discover(scratch, config_path, company_filter, capture=lambda *_: None,
                              verify=verify, verification_observer=verification_observer,
                              headed_fallback=headed_fallback, throttle_ms=throttle_ms,
                              rediscover_404=rediscover_404, posted_after=posted_after,
                              posted_before=posted_before, since_days=since_days,
                              include_blacklisted=include_blacklisted,
                              input_root=input_root, profile_path=profile_path)
            return {**result, "dry_run": True}
    for label, value in (("posted_after", posted_after), ("posted_before", posted_before)):
        if value is not None:
            try:
                valid = len(value) == 10 and date.fromisoformat(value).isoformat() == value
            except (TypeError, ValueError):
                valid = False
            if not valid:
                raise ValueError(f"--{label.replace('_', '-')} expects YYYY-MM-DD")
    if since_days is not None and (not math.isfinite(since_days) or since_days <= 0):
        raise ValueError("since_days must be positive and finite")
    config = _config(config_path)
    try:
        since_date = (datetime.now(timezone.utc) - timedelta(days=since_days)).date().isoformat() if since_days else None
    except OverflowError as error:
        raise ValueError("since_days is too large to express as a date") from error
    effective_after = max(filter(None, (posted_after, since_date)), default=None)
    since_ms = None
    if effective_after:
        since_ms = datetime.combine(date.fromisoformat(effective_after), datetime.min.time(), timezone.utc).timestamp() * 1000
        age = config.get("max_posting_age_days")
        try:
            age = float(age)
            if age.is_integer() and age > 0:
                since_ms = max(since_ms, datetime.now(timezone.utc).timestamp() * 1000 - age * 86_400_000)
        except (TypeError, ValueError):
            pass
    try:
        profile = yaml.safe_load(profile_path.read_text()) if profile_path.is_file() else {}
    except yaml.YAMLError:
        profile = {}
    profile = profile if isinstance(profile, dict) else {}
    targets = []
    for section, board in (("tracked_companies", False), ("job_boards", True)):
        values = config.get(section) if isinstance(config.get(section), list) else []
        for entry in values:
            if not isinstance(entry, dict) or entry.get("enabled") is False:
                continue
            if not isinstance(entry.get("name"), str) or not entry["name"].strip():
                continue
            if company_filter and company_filter.lower() not in entry["name"].lower():
                continue
            targets.append((entry, board))

    def collector_failure(message: str, run_id: str) -> dict:
        directory.mkdir(parents=True, exist_ok=True)
        store = DiscoveryStore(directory / "opportunities.db")
        try:
            store.scan_run_once("configured", run_id,
                                {"status": "failed", "companies": sum(not board for _, board in targets),
                                 "boards": sum(board for _, board in targets), "found": 0,
                                 "newAdded": 0, "errors": 1,
                                 "failures": [{"company": "provider-collector", "error": message}]}, [])
        finally:
            store.close()
        return {"status": "failed", "error": message}
    from workflow.discovery_graph import run_discovery_graph

    inputs = {"config": config, "profile": profile, "blacklist": (input_root / "data" / "blacklist.md").read_text()
              if (input_root / "data" / "blacklist.md").is_file() else "",
              "company_filter": company_filter, "verify": verify, "headed_fallback": headed_fallback,
              "throttle_ms": throttle_ms, "rediscover_404": rediscover_404,
              "posted_after": posted_after, "posted_before": posted_before, "since_days": since_days,
              "include_blacklisted": include_blacklisted, "candidate_source_hash": candidate_source_hash(input_root, profile_path),
              "profile_path": str(profile_path),
              "input_root": str(input_root)}
    inputs_hash = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

    def decide(collected: list, warnings: list[str], cutoffs: dict, run_id: str) -> dict:
        return _decide_collected(
            directory, config, profile, input_root, profile_path, targets, collected, warnings,
            company_filter=company_filter, verify=verify,
            verification_observer=verification_observer, headed_fallback=headed_fallback,
            throttle_ms=throttle_ms, rediscover_404=rediscover_404,
            effective_after=cutoffs["effective_after"], posted_before=posted_before,
            include_blacklisted=include_blacklisted, run_id=run_id,
        )

    return run_discovery_graph(
        directory, inputs_hash, {"effective_after": effective_after, "since_ms": since_ms}, resume=resume,
        collect=lambda cutoffs: collect_provider_results(targets, cutoffs["since_ms"]),
        decide=decide, publish=lambda decision, run_id: _publish_decision(directory, decision, capture, run_id),
        collector_failure=collector_failure,
    )


def _decide_collected(directory: Path, config: dict, profile: dict, input_root: Path, profile_path: Path,
                       targets: list[tuple[dict, bool]], collected: list, collector_warnings: list[str],
                       *, company_filter: str | None, verify: bool, verification_observer,
                       headed_fallback: bool, throttle_ms: int, rediscover_404: bool,
                       effective_after: str | None, posted_before: str | None,
                       include_blacklisted: bool, run_id: str) -> dict:
    """Apply provider, trust, filter, deduplication and verification policy."""
    directory.mkdir(parents=True, exist_ok=True)
    store = DiscoveryStore(directory / "opportunities.db")
    counts = {name: 0 for name in ("title", "tier", "location", "posting_age", "posted_date", "salary", "content",
                                   "country_eligibility", "visa", "blacklist", "cooldown", "dupes")}
    accepted, failures = [], []
    found = companies = boards = 0
    try:
        today = date.today()
        history_config = config.get("scan_history") if isinstance(config.get("scan_history"), dict) else {}
        raw_recheck = history_config.get("recheck_after_days")
        try:
            match = re.match(r"^\s*([+-]?\d+)", str(raw_recheck)) if not isinstance(raw_recheck, bool) else None
            recheck = int(match.group(1)) if match else None
            recheck = recheck if recheck is not None and recheck >= 0 else None
        except ValueError:
            recheck = None
        aliases = company_aliases(config.get("company_aliases"))
        snapshot = database_snapshot(store.db, today=today, recheck_after_days=recheck, aliases=aliases)
        seen_urls, seen_roles = snapshot["seen"], snapshot["seen_company_roles"]
        blacklist = _blacklist(input_root / "data" / "blacklist.md")
        windows = load_windows(profile)
        country = profile.get("location", {}).get("country", "") if isinstance(profile.get("location"), dict) else ""
        source_hash = candidate_source_hash(input_root, profile_path)
        cooldown_offers, handoffs, health = [], [], []
        failures.extend({"company": "provider-collector", "error": line, "kind": "coverage_warning"}
                        for line in collector_warnings)
        annotated_blacklisted = 0
        checked_at = datetime.now(timezone.utc).isoformat()
        for (entry, board), outcome in zip(targets, collected):
            status = outcome.get("status")
            if status == "unmatched":
                continue
            if status == "handoff":
                handoffs.append({"company": entry["name"], "method": "websearch", "query": outcome.get("query", "")})
                continue
            if status == "error" and outcome.get("kind") == "configuration":
                failures.append({"company": entry["name"], "error": outcome.get("error", "Unknown provider")})
                continue
            boards += int(board)
            companies += int(not board)
            health_status = "reachable"
            if status == "error":
                health_status = outcome.get("kind") or "unknown"
                failures.append({"company": entry["name"], "error": outcome.get("error", "Provider failure"),
                                 "kind": outcome.get("kind")})
            elif status == "fetched":
                jobs = outcome.get("jobs", [])
                if not isinstance(jobs, list):
                    raise ValueError("Provider result jobs must be a list")
                found += len(jobs)
                if not jobs and not board:
                    health_status = "empty"
                if outcome.get("warning"):
                    failures.append({"company": entry["name"], "error": outcome["warning"]})
                if outcome.get("truncated") or outcome.get("capped"):
                    failures.append({"company": entry["name"], "error": "Provider collection stopped before all pages were fetched",
                                     "kind": "coverage_warning", "reason": outcome.get("truncation_kind") or "page_cap"})
                    kind = outcome.get("truncation_kind")
                    health_status = kind if kind in {"network", "auth", "server"} else "incomplete"
                source = "local-parser" if outcome["provider"] == "local-parser" else outcome["provider"] + "-api"
                for job in jobs:
                    if not isinstance(job, dict):
                        failures.append({"company": entry["name"], "error": "Provider returned a non-object job"})
                        continue
                    offer = {**job}
                    trust_result = trust(offer, config.get("trust_filter"))
                    offer.update({"trustScore": trust_result["score"], "trustFlags": trust_result["flags"],
                                  "trustLevel": trust_result["level"]})
                    blacklisted = blacklist.get(_text_key(offer.get("company") or entry["name"]))
                    if blacklisted:
                        if not include_blacklisted:
                            counts["blacklist"] += 1
                            continue
                        annotated_blacklisted += 1
                        offer["blacklisted"] = True
                        label = "blacklisted" + (f": {blacklisted['reason']}" if blacklisted["reason"] else "")
                        offer["note"] = f"{label} — {offer['note']}" if isinstance(offer.get("note"), str) and offer["note"].strip() else label
                    reason = filter_reason(offer, config, country,
                                           posted_after=effective_after, posted_before=posted_before)
                    if reason:
                        counts[reason] += 1
                        continue
                    url = url_key(offer.get("url"))
                    if url in seen_urls:
                        counts["dupes"] += 1
                        continue
                    identity = company_role_key(offer.get("company"), offer.get("title"), aliases)
                    if identity in seen_roles:
                        counts["dupes"] += 1
                        continue
                    cooled = cooldown(offer, windows, today=today)
                    if cooled["skip"]:
                        counts["cooldown"] += 1
                        cooldown_offers.append({**offer, "source": source, "status": cooled["reason"]})
                        continue
                    seen_urls.add(url)
                    seen_roles.add(identity)
                    try:
                        careers_domain = urlsplit(entry.get("careers_url") or "").hostname
                    except ValueError:
                        careers_domain = None
                    accepted.append({**offer, "source": source, "tracked": bool(careers_domain),
                                     "careersUrlDomain": careers_domain})
            else:
                failures.append({"company": entry["name"], "error": "Invalid provider result"})
                health_status = "unknown"
            health.append({"company": entry["name"], "status": health_status, "timestamp": checked_at})
        verification_outcomes = []
        if verify and accepted:
            browser = verification_observer or observe
            accepted, verification_outcomes = route(accepted, browser(
                accepted, headed_fallback=headed_fallback, throttle_ms=throttle_ms,
                rediscover_404=rediscover_404))
        for offer in accepted:
            offer["fingerprint"] = fingerprint(offer.get("description"))
        crosslist = cross_listings(accepted, snapshot["fingerprint_history"], today=today)
        summary = {"companies": companies, "boards": boards, "found": found, "dupes": counts["dupes"],
                   "newAdded": len(accepted), "errors": len(failures), "handoff": len(handoffs),
                   "filtered": counts, "failures": failures, "handoff_sources": handoffs}
        try:
            threshold = int(config.get("portal_health_threshold") or 3)
        except (TypeError, ValueError):
            threshold = 3
        streaks = store.health_streaks(health)
        persistent_failures = sorted({item["company"] for item in health
                                      if streaks[item["company"]] >= threshold})
        incomplete = bool(failures or handoffs or company_filter and not companies + boards)
        return {"accepted": accepted, "cooldown_offers": cooldown_offers,
                "verification_outcomes": verification_outcomes, "source_hash": source_hash,
                "today": today.isoformat(), "summary": summary, "health": health,
                "result": {"status": "partial" if incomplete and found else "failed" if incomplete else "completed",
                           "sources": companies + boards, "checked": found, "added": len(accepted), "errors": len(failures),
                           "handoff": len(handoffs), "failures": failures, "handoff_sources": handoffs,
                           "filtered": counts, "cross_listings": crosslist,
                           "recheck_eligible": snapshot["recheck_eligible"],
                           "persistent_failures": persistent_failures,
                           "annotated_blacklisted": annotated_blacklisted}}
    except (Exception, KeyboardInterrupt) as error:
        try:
            store.scan_run_once("configured", run_id, {"status": "failed", "companies": companies, "boards": boards,
                                          "found": found, "newAdded": 0, "errors": len(failures) + 1,
                                          "filtered": counts,
                                          "failures": [*failures, {"company": "workflow", "error": str(error)}]}, [])
        except Exception:
            pass
        raise
    finally:
        store.close()


def _publish_decision(directory: Path, decision: dict, capture, run_id: str | None = None) -> dict:
    """Capture accepted JDs and commit the decided business facts."""
    store = DiscoveryStore(directory / "opportunities.db")
    try:
        if run_id and store.db.execute("SELECT 1 FROM scan_runs WHERE operation='configured' AND run_id=?",
                                       (run_id,)).fetchone():
            return decision["result"]
        capture = capture or capture_jd
        for offer in decision["accepted"]:
            try:
                snapshot_value = capture(directory, offer["url"])
            except (OSError, TimeoutError, ValueError):
                snapshot_value = None
            if snapshot_value:
                offer["scan_jd"] = {"text": snapshot_value["text"], "final_url": snapshot_value["url"],
                                    "retrieved_at": snapshot_value["retrieved_at"],
                                    "content_hash": hashlib.sha256(snapshot_value["text"].encode()).hexdigest()}
            write_placeholder(offer, decision["source_hash"], directory / "prescreen-cache")
            store.ingest(offer, offer["source"], observed_on=decision["today"])
        for offer in decision["cooldown_offers"]:
            store.scan_outcome(offer, offer["status"])
        for offer, status in decision["verification_outcomes"]:
            store.scan_outcome(offer, status)
        if run_id:
            store.scan_run_once("configured", run_id, decision["summary"], decision["health"])
        else:
            store.scan_run("configured", decision["summary"], decision["health"])
        return decision["result"]
    except (Exception, KeyboardInterrupt) as error:
        summary = decision["summary"]
        try:
            completed = run_id and store.db.execute(
                "SELECT 1 FROM scan_runs WHERE operation='configured' AND run_id=?", (run_id,)).fetchone()
            if not completed:
                failure = {"status": "failed", "companies": summary["companies"],
                           "boards": summary["boards"], "found": summary["found"],
                           "newAdded": 0, "errors": summary["errors"] + 1,
                           "filtered": decision["result"]["filtered"],
                           "failures": [*summary["failures"], {"company": "workflow", "error": str(error)}]}
                if run_id:
                    store.scan_run_once("configured", run_id + ":failure", failure, [])
                else:
                    store.scan_run("configured", failure, [])
        except Exception:
            pass
        raise
    finally:
        store.close()
