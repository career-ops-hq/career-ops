"""Resolve company names to live ATS boards while preserving the user portal file."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
from queue import Empty, Queue
import re
import stat
import subprocess
import tempfile
from threading import Lock, Thread
from urllib.parse import urlsplit

import yaml


ROOT = Path(__file__).resolve().parents[1]
SLUG = re.compile(r"^[A-Za-z0-9._-]+$")
WORKDAY_SEGMENT = re.compile(r"^[A-Za-z0-9_-]+$")
WORKDAY_URL = re.compile(r"https?://([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([^/?#]+)")
WORKDAY_INSTANCES = ("wd1", "wd2", "wd3", "wd5", "wd10", "wd12", "wd101", "wd103")
VENDORS = {
    "gh": ("greenhouse", "job-boards.greenhouse.io", "https://job-boards.greenhouse.io/{slug}"),
    "ashby": ("ashby", "jobs.ashbyhq.com", "https://jobs.ashbyhq.com/{slug}"),
    "lever": ("lever", "jobs.lever.co", "https://jobs.lever.co/{slug}"),
    "workable": ("workable", "apply.workable.com", "https://apply.workable.com/{slug}"),
    "smartrecruiters": ("smartrecruiters", "careers.smartrecruiters.com", "https://careers.smartrecruiters.com/{slug}"),
    "recruitee": ("recruitee", "{lower}.recruitee.com", "https://{lower}.recruitee.com"),
    "bamboohr": ("bamboohr", "{lower}.bamboohr.com", "https://{lower}.bamboohr.com"),
    "breezy": ("breezy", "{lower}.breezy.hr", "https://{lower}.breezy.hr"),
    "pinpoint": ("pinpoint", "{lower}.pinpointhq.com", "https://{lower}.pinpointhq.com"),
    "rippling": ("rippling", "ats.rippling.com", "https://ats.rippling.com/{slug}/jobs"),
    "join": ("join", "join.com", "https://join.com/companies/{slug}"),
}
VENDOR_ORDER = tuple(VENDORS)


def derive_slug(name: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", name.lower()))


def parse_company_input(raw_yaml: str, names: list[str]) -> tuple[list[dict], list[str]]:
    """File entries win over duplicate positional names; malformed rows are reported."""
    warnings: list[str] = []
    by_name: dict[str, dict] = {}

    def add(raw: object, origin: str) -> None:
        if not isinstance(raw, dict):
            if raw is not None:
                warnings.append(f"{origin}: dropped non-object entry")
            return
        name = raw.get("name", "")
        name = name.strip() if isinstance(name, str) else ""
        if not name:
            warnings.append(f"{origin}: dropped entry with missing/empty name")
            return
        if name.lower() in by_name:
            return
        entry = {"name": name}
        for field in ("slug", "website"):
            value = raw.get(field)
            if isinstance(value, str) and value.strip():
                entry[field] = value.strip()
        hint = raw.get("workday")
        if isinstance(hint, str) and hint.strip():
            entry["workday"] = hint.strip()
        elif isinstance(hint, (dict, list)):
            entry["workday"] = hint
        elif hint is not None and hint != "":
            warnings.append(f'{origin}: ignored "workday" hint for "{name}" — expected a URL string or {{tenant, site}} object')
        by_name[name.lower()] = entry

    if raw_yaml.strip():
        try:
            document = yaml.safe_load(raw_yaml)
        except yaml.YAMLError as error:
            warnings.append(f"input: malformed YAML — {error}")
            document = None
        if isinstance(document, list):
            entries = document
        elif isinstance(document, dict) and isinstance(document.get("companies"), list):
            entries = document["companies"]
        else:
            entries = []
            if document:
                warnings.append("input: expected a top-level `companies:` list (or a bare YAML list)")
        for item in entries:
            add({"name": item} if isinstance(item, str) else item, "input")
    for name in names:
        if name.strip():
            add({"name": name.strip()}, "args")
    return list(by_name.values()), warnings


def parse_workday_hint(company: dict) -> dict | None:
    hint = company.get("workday")
    if isinstance(hint, dict):
        tenant, site, instance = (hint.get(key) for key in ("tenant", "site", "instance"))
        if all(isinstance(value, str) and WORKDAY_SEGMENT.fullmatch(value) for value in (tenant, site)):
            return {"tenant": tenant, "site": site,
                    "instance": instance if isinstance(instance, str) and WORKDAY_SEGMENT.fullmatch(instance) else None}
    for raw in (hint, company.get("careers_url"), company.get("website")):
        if isinstance(raw, str) and (match := WORKDAY_URL.search(raw)):
            tenant, instance, site = match.groups()
            if all(WORKDAY_SEGMENT.fullmatch(value) for value in (tenant, instance, site)):
                return {"tenant": tenant, "instance": instance, "site": site}
    return None


def candidate_urls(company: dict, vendors: tuple[str, ...]) -> tuple[list[dict], list[str], list[str]]:
    """Construct only pinned ATS hosts; reject vendor-specific invalid slug shapes."""
    slug = company.get("slug") or derive_slug(company["name"])
    candidates, skipped, unsupported = [], [], []
    for vendor in vendors:
        provider, host_pattern, url_pattern = VENDORS[vendor]
        if not SLUG.fullmatch(slug):
            skipped.append(vendor)
            continue
        host = host_pattern.format(lower=slug.lower())
        url = url_pattern.format(slug=slug, lower=slug.lower())
        if urlsplit(url).hostname != host:
            skipped.append(vendor)
            continue
        if (("{lower}" in host_pattern and not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug.lower()))
                or (vendor == "workable" and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", slug))
                or (vendor == "pinpoint" and not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", slug.lower()))
                or (vendor == "rippling" and not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?", slug))):
            unsupported.append(vendor)
            continue
        candidates.append({"vendor": vendor, "provider": provider, "slug": slug, "careers_url": url})
    return candidates, skipped, unsupported


def probe_board(name: str, provider: str, careers_url: str) -> dict:
    """Ask the selected Node provider for one board's live status, without business decisions."""
    with tempfile.TemporaryDirectory(prefix="career-ops-board-probe-") as temporary:
        input_path, output_path = Path(temporary) / "input.json", Path(temporary) / "output.json"
        input_path.write_text(json.dumps({"name": name, "provider": provider, "careers_url": careers_url}))
        try:
            result = subprocess.run(["node", str(ROOT / "providers" / "_probe.mjs"), str(input_path), str(output_path)],
                                    cwd=ROOT, text=True, capture_output=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired) as error:
            return {"status": "error", "jobCount": 0, "error": str(error)}
        if result.returncode or not output_path.is_file():
            return {"status": "error", "jobCount": 0, "error": (result.stderr or result.stdout).strip()[-1000:]}
        return json.loads(output_path.read_text())


class ProviderProbeSession:
    """Reuse one provider process so its DNS cache and vendor rate limits apply to the run."""

    def __enter__(self):
        self.stderr = tempfile.TemporaryFile(mode="w+")
        self.lock = Lock()
        self.pending: dict[int, Queue] = {}
        self.next_id = 0
        self.process = subprocess.Popen(["node", str(ROOT / "providers" / "_probe.mjs"), "--stream"],
                                        cwd=ROOT, text=True, bufsize=1, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.stderr)
        self.reader = Thread(target=self._read, daemon=True)
        self.reader.start()
        return self

    def __exit__(self, *_):
        if self.process.stdin:
            try:
                self.process.stdin.close()
            except BrokenPipeError:
                pass
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.reader.join(timeout=5)
        self.stderr.close()

    def _read(self) -> None:
        for line in self.process.stdout:
            try:
                response = json.loads(line)
                identifier = response["id"]
                result = response["result"]
            except (ValueError, KeyError, TypeError):
                continue
            with self.lock:
                waiting = self.pending.pop(identifier, None)
            if waiting is not None:
                waiting.put(result)
        with self.lock:
            waiting = list(self.pending.values())
            self.pending.clear()
        for item in waiting:
            item.put({"status": "error", "jobCount": 0, "error": "provider probe process exited"})

    def probe(self, name: str, provider: str, careers_url: str) -> dict:
        waiting: Queue = Queue(maxsize=1)
        try:
            with self.lock:
                if self.process.poll() is not None:
                    raise RuntimeError("provider probe process exited")
                identifier = self.next_id
                self.next_id += 1
                self.pending[identifier] = waiting
                self.process.stdin.write(json.dumps({"id": identifier, "name": name, "provider": provider,
                                                     "careers_url": careers_url}) + "\n")
                self.process.stdin.flush()
            return waiting.get(timeout=120)
        except Empty:
            self.process.kill()
            return {"status": "error", "jobCount": 0, "error": "provider probe exceeded 120 seconds"}
        except (BrokenPipeError, OSError, RuntimeError) as error:
            return {"status": "error", "jobCount": 0, "error": str(error)}


def resolve_company(company: dict, vendors: tuple[str, ...] = VENDOR_ORDER, *, include_workday: bool = True,
                    probe=probe_board) -> dict:
    """Preserve first-live-board priority and distinguish definitive absence from unknown status."""
    candidates, skipped, unsupported = candidate_urls(company, vendors)
    tried, empty, errors = [], [], []
    for candidate in candidates:
        vendor, url = candidate["vendor"], candidate["careers_url"]
        tried.append(vendor)
        result = probe(company["name"], candidate["provider"], url)
        if result["status"] == "match":
            resolved = {"name": company["name"], "vendor": candidate["provider"], "slug": candidate["slug"],
                        "careers_url": url, "jobCount": result["jobCount"]}
            if vendor == "gh":
                resolved["api"] = f'https://boards-api.greenhouse.io/v1/boards/{candidate["slug"]}/jobs'
            return {"resolved": resolved}
        if result["status"] == "empty":
            empty.append({"vendor": vendor, "careers_url": url})
        else:
            error = {"vendor": vendor, "error": result.get("error", "unknown probe error")}
            if isinstance(result.get("httpStatus"), int):
                error["httpStatus"] = result["httpStatus"]
                if result["httpStatus"] in (404, 410):
                    error["definitive"] = True
            errors.append(error)
    coords = parse_workday_hint(company) if include_workday else None
    if coords:
        tried.append("workday")
        last_error = None
        for instance in (coords["instance"],) if coords["instance"] else WORKDAY_INSTANCES:
            url = f'https://{coords["tenant"]}.{instance}.myworkdayjobs.com/{coords["site"]}'
            result = probe(company["name"], "workday", url)
            if result["status"] == "match":
                return {"resolved": {"name": company["name"], "vendor": "workday", "provider": "workday",
                                     "slug": coords["tenant"], "careers_url": url, "jobCount": result["jobCount"]}}
            if result["status"] == "empty" and not any(item["vendor"] == "workday" for item in empty):
                empty.append({"vendor": "workday", "careers_url": url})
            elif result["status"] == "error":
                last_error = result.get("error", "unknown probe error")
        if not any(item["vendor"] == "workday" for item in empty) and last_error is not None:
            errors.append({"vendor": "workday", "error": last_error})
    hint = company.get("workday")
    hint_given = include_workday and ((isinstance(hint, str) and bool(hint.strip())) or isinstance(hint, (dict, list)))
    if empty:
        reason = "board(s) found but currently list 0 jobs — re-run later or force-add manually"
    elif errors and not coords and not all(error.get("definitive") for error in errors):
        reason = "probe error(s) occurred — board status unknown, see errors[] and re-run"
    elif hint_given and not coords:
        reason = "Workday hint given but rejected (invalid/missing tenant or site) — check the `workday` field and re-run"
    elif coords:
        reason = "Workday coordinates given but no live board with open jobs found at the probed host(s)."
    elif not candidates and unsupported:
        slug = company.get("slug") or derive_slug(company["name"])
        reason = (f'slug "{slug}" is not a valid board slug for any probed vendor '
                  f'({", ".join(unsupported)}) — nothing was probed; fix the `slug` field and re-run.')
    else:
        reason = ("no supported ATS board found. If this company uses Workday, add a hint — "
                  "a full careers URL (workday: https://<tenant>.wd<N>.myworkdayjobs.com/<site>) or "
                  "workday: {tenant, site} — and re-run; resolve-company will confirm and add it.")
    unresolved = {"name": company["name"], "triedVendors": tried, "reason": reason}
    if skipped:
        unresolved["skippedUnsafeSlug"] = skipped
    if unsupported:
        unresolved["unsupportedSlugShape"] = unsupported
    if empty:
        unresolved["emptyBoards"] = empty
    if errors:
        unresolved["errors"] = errors
    if company.get("website"):
        unresolved["website"] = company["website"]
    return {"unresolved": unresolved}


def dedupe_matches(matches: list[dict], existing: list[dict]) -> tuple[list[dict], list[dict]]:
    def url_key(value: object) -> str:
        return str(value or "").strip().lower().rstrip("/")

    names, urls = set(), set()
    for entry in existing:
        if not isinstance(entry, dict):
            continue
        if isinstance(entry.get("name"), str):
            names.add(entry["name"].strip().lower())
        for field in ("careers_url", "api"):
            if entry.get(field):
                urls.add(url_key(entry[field]))
    fresh, duplicates = [], []
    for match in matches:
        name = str(match.get("name", "")).strip().lower()
        match_urls = {url_key(match["careers_url"])}
        if match.get("api"):
            match_urls.add(url_key(match["api"]))
        if name in names or match_urls & urls:
            duplicates.append(match)
        else:
            fresh.append(match)
            names.add(name)
            urls.update(match_urls)
    return fresh, duplicates


def yaml_scalar(value: object) -> str:
    text = str(value or "")
    if not text or text[0].isspace() or text[-1].isspace() or re.search(r'''[:#"'{}\[\],&*!|>%@`]''', text):
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def portal_entry(match: dict) -> str:
    lines = [f'  - name: {yaml_scalar(match["name"])}', f'    careers_url: {match["careers_url"]}']
    for field in ("api", "provider"):
        if match.get(field):
            lines.append(f'    {field}: {match[field]}')
    lines.append("    enabled: true")
    if match.get("notes"):
        lines.append(f'    notes: {yaml_scalar(match["notes"])}')
    return "\n" + "\n".join(lines) + "\n"


def insert_tracked_companies(file_text: str, snippets: list[str]) -> str:
    if not snippets:
        return file_text
    block = "".join(snippets)
    header = re.search(r"^tracked_companies:[ \t]*$", file_text, re.MULTILINE)
    if header is None:
        return file_text + ("\n" if file_text.endswith("\n") else "\n\n") + "tracked_companies:" + block
    boundary = re.search(r"\n[^\s#][^\n]*:", file_text[header.end():])
    insert_at = header.end() + boundary.start() if boundary else len(file_text)
    before = file_text[:insert_at]
    before = re.sub(r"\n[ \t]*(?=\n*$)", "\n", before)
    return before + block + file_text[insert_at:]


def resolve_boards(portals_path: Path, *, input_path: Path | None = None, names: list[str] | None = None,
                   vendors: tuple[str, ...] = VENDOR_ORDER, include_workday: bool = True,
                   write: bool = False, probe=probe_board) -> dict:
    """Preview by default; an explicit write atomically appends only new boards."""
    unknown = set(vendors) - set(VENDOR_ORDER)
    if unknown:
        raise ValueError("unknown vendor(s): " + ", ".join(sorted(unknown)))
    raw_yaml = input_path.read_text() if input_path is not None else ""
    companies, warnings = parse_company_input(raw_yaml, names or [])
    resolved, unresolved = [], []
    if companies and probe is probe_board:
        with ProviderProbeSession() as session:
            with ThreadPoolExecutor(max_workers=min(8, len(companies))) as executor:
                results = list(executor.map(
                    lambda company: resolve_company(company, vendors, include_workday=include_workday, probe=session.probe),
                    companies,
                ))
    else:
        results = [resolve_company(company, vendors, include_workday=include_workday, probe=probe)
                   for company in companies]
    for result in results:
        if "resolved" in result:
            resolved.append(result["resolved"])
        else:
            unresolved.append(result["unresolved"])
    existing = []
    if portals_path.is_file():
        try:
            config = yaml.safe_load(portals_path.read_text())
            if isinstance(config, dict) and isinstance(config.get("tracked_companies"), list):
                existing = config["tracked_companies"]
        except yaml.YAMLError as error:
            warnings.append(f"portals.yml: could not parse for dedupe — {error}")
    fresh, duplicates = dedupe_matches(resolved, existing)
    snippets = [portal_entry(match) for match in fresh]
    written = False
    if write and fresh and portals_path.is_file():
        current = portals_path.read_text()
        replacement = insert_tracked_companies(current, snippets)
        descriptor, temporary = tempfile.mkstemp(prefix=portals_path.name + ".tmp-", dir=portals_path.parent)
        try:
            with os.fdopen(descriptor, "w") as stream:
                stream.write(replacement)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, stat.S_IMODE(portals_path.stat().st_mode))
            os.replace(temporary, portals_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        written = True
    elif write and fresh:
        warnings.append(f"--write given but portals.yml not found at {portals_path} — printing entries instead")
    elif not write and fresh:
        count = len(fresh)
        warnings.append(f"preview only — {count} new entr{'y' if count == 1 else 'ies'} shown in pendingEntries; re-run with --write to append them to portals.yml")
    output = {
        "metadata": {"resolved": len(resolved), "unresolved": len(unresolved), "duplicatesSkipped": len(duplicates),
                     "fresh": len(fresh), "freshWritten": len(fresh) if written else 0, "written": written,
                     "previewOnly": not written, "portalsPath": str(portals_path), "warnings": warnings},
        "resolved": resolved, "unresolved": unresolved,
    }
    if not written and companies:
        output["pendingEntries"] = "".join(snippets)
    return output


def format_summary(result: dict) -> str:
    """Present the same resolved and manual-follow-up facts as the JSON result."""
    resolved, unresolved = result["resolved"], result["unresolved"]
    count = result["metadata"]["duplicatesSkipped"]
    lines = ["", "=" * 78, "  ATS Discovery — career-ops",
             f"  resolved: {len(resolved)} | unresolved: {len(unresolved)} | duplicates skipped: {count}",
             "=" * 78, ""]
    if resolved:
        lines.extend(["  " + f'{"Company":24}{"Vendor":12}{"Jobs":7}Board', "  " + "-" * 90])
        lines.extend("  " + f'{item["name"][:22]:24}{item["vendor"]:12}{item["jobCount"]!s:7}{item["careers_url"]}'
                     for item in resolved)
        lines.append("")
    if unresolved:
        lines.append("  Unresolved (manual follow-up):")
        lines.extend(f'    - {item["name"]}{" [" + item["website"] + "]" if item.get("website") else ""}: {item["reason"]}'
                     for item in unresolved)
        lines.append("")
    return "\n".join(lines)
