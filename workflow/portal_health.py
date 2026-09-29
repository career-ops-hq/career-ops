"""Verify tracked ATS boards and confirm ownership before suggesting slug repairs."""

from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import unicodedata
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

import yaml
from dotenv import load_dotenv

try:
    from workflow.http_identity import DEFAULT_USER_AGENT
except ModuleNotFoundError:
    from http_identity import DEFAULT_USER_AGENT


LATIN = str.maketrans({"ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "đ": "d", "ł": "l",
                       "þ": "th", "ð": "d", "ħ": "h", "ı": "i", "ŋ": "ng", "ŧ": "t", "ĸ": "k", "ſ": "s"})
DESIGNATORS = frozenset("inc incorporated llc llp lp ltd limited plc corp corporation co company "
                        "gmbh ag kg sa sas sarl srl spa bv nv ab as oy aps pty pte kk kft".split())
SUFFIXES = ("ai", "tech", "io", "hq", "labs")
ATS = ("greenhouse", "ashby", "lever")
ROOT = Path(__file__).resolve().parents[1]


def ascii_fold(value: str, *, punctuation: str = "space") -> str:
    value = unicodedata.normalize("NFD", value.lower()).translate(LATIN)
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = re.sub(r"[^a-z0-9 ]", "" if punctuation == "delete" else " ", value)
    return " ".join(value.split())


def slug_candidates(name: str, *, first_word_suffixes: bool = False) -> list[str]:
    words = ascii_fold(name).split()
    if not words:
        return []
    full = "".join(words)
    candidates = [full, "-".join(words), "_".join(words), words[0]]
    for base in ([full, words[0]] if first_word_suffixes else [full]):
        candidates.extend(base + suffix for suffix in SUFFIXES)
        candidates.extend((base + ".tech", base + ".io"))
    return list(dict.fromkeys(candidates))


def identity_matches(company: str, board: str) -> bool:
    def tokens(name: str) -> list[str]:
        name = re.sub(r"\s+", " ", name)
        words = ascii_fold(re.sub(r"\s+&\s+", " and ", name), punctuation="delete").split()
        if len(words) > 1 and words[0] == "the":
            words.pop(0)
        while len(words) > 1 and words[-1] in DESIGNATORS:
            words.pop()
        return words
    left, right = tokens(company), tokens(board)
    return bool(left) and left == right


def board_title_owner(markup: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", markup, re.I | re.S)
    if not match:
        return None
    title = " ".join(html.unescape(match[1]).split())
    return re.sub(r"\s+jobs$", "", title, flags=re.I).strip() or None


def parse_ats_slug(raw_url: str | None) -> dict | None:
    try:
        url = urlsplit(raw_url or "")
    except ValueError:
        return None
    host, path = url.hostname, url.path
    if url.scheme != "https" or not host:
        return None
    patterns = (
        ("boards-api.greenhouse.io", r"/v1/boards/([^/]+)", "greenhouse", False),
        ("job-boards.greenhouse.io", r"/([^/]+)", "greenhouse", False),
        ("job-boards.eu.greenhouse.io", r"/([^/]+)", "greenhouse", False),
        ("boards.greenhouse.io", r"/([^/]+)", "greenhouse", False),
        ("api.ashbyhq.com", r"/posting-api/job-board/([^/]+)", "ashby", False),
        ("jobs.ashbyhq.com", r"/([^/]+)", "ashby", False),
        ("api.lever.co", r"/v0/postings/([^/]+)", "lever", False),
        ("jobs.lever.co", r"/([^/]+)", "lever", False),
        ("api.eu.lever.co", r"/v0/postings/([^/]+)", "lever", True),
        ("jobs.eu.lever.co", r"/([^/]+)", "lever", True),
    )
    for expected, pattern, ats, eu in patterns:
        if host == expected and (match := re.match(pattern, path)):
            result = {"ats": ats, "slug": match[1]}
            if eu:
                result["eu"] = True
            return result
    return None


def fetch_json(url: str) -> object:
    with urlopen(Request(url, headers={"User-Agent": DEFAULT_USER_AGENT}), timeout=10) as response:
        return json.load(response)


def fetch_text(url: str) -> str:
    with urlopen(Request(url, headers={"User-Agent": DEFAULT_USER_AGENT}), timeout=10) as response:
        return response.read(8192).decode("utf-8", errors="replace")


def error_kind(error: Exception, *, status: int | None = None, name: str | None = None) -> str:
    if name == "AbortError" or re.search(
            r"ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network", str(error), re.I):
        return "network"
    status = status or getattr(error, "status", None) or getattr(error, "code", None)
    if status in (404, 410):
        return "slug_gone"
    if status in (401, 403):
        return "auth"
    if isinstance(status, int) and status >= 500:
        return "server"
    if re.search(r"HTTP (?:404|410)", str(error)):
        return "slug_gone"
    if re.search(r"HTTP (?:401|403)", str(error)):
        return "auth"
    if re.search(r"HTTP 5\d\d", str(error)):
        return "server"
    if isinstance(error, (URLError, TimeoutError, ConnectionError)):
        return "network"
    return "unknown"


def board_urls(ats: str, slug: str, *, eu: bool = False) -> tuple[str, str]:
    if ats == "greenhouse":
        root = f"https://boards-api.greenhouse.io/v1/boards/{slug}"
        return root + "/jobs", root
    if ats == "ashby":
        return (f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true",
                f"https://jobs.ashbyhq.com/{slug}")
    if ats == "lever":
        prefix = "eu." if eu else ""
        return f"https://api.{prefix}lever.co/v0/postings/{slug}", f"https://jobs.{prefix}lever.co/{slug}"
    raise ValueError(f"unknown ATS: {ats}")


def probe_slug(ats: str, slug: str, *, eu: bool = False, get_json=fetch_json) -> dict:
    url, _ = board_urls(ats, slug, eu=eu)
    result = {"ats": ats, "slug": slug, "url": url}
    try:
        data = get_json(url)
        jobs = data if ats == "lever" else data.get("jobs") if isinstance(data, dict) else None
        if not isinstance(jobs, list):
            return {**result, "status": "missing", "errorKind": "unknown", "reason": "unexpected response shape"}
        return {**result, "status": "live" if jobs else "empty", "jobCount": len(jobs)}
    except Exception as error:
        return {**result, "status": "missing", "errorKind": error_kind(error),
                "httpStatus": getattr(error, "status", None) or getattr(error, "code", None),
                "reason": str(error)}


def discover_alternate(name: str, *, get_json=fetch_json, get_text=fetch_text) -> dict | None:
    best_empty = None
    for slug in slug_candidates(name):
        for ats in ATS:
            for eu in ((False, True) if ats == "lever" else (False,)):
                result = probe_slug(ats, slug, eu=eu, get_json=get_json)
                if result["status"] not in ("live", "empty"):
                    continue
                _, owner_url = board_urls(ats, slug, eu=eu)
                try:
                    owner = (get_json(owner_url).get("name") if ats == "greenhouse"
                             else board_title_owner(get_text(owner_url)))
                except Exception:
                    continue
                if not isinstance(owner, str) or not identity_matches(name, owner):
                    continue
                if result["status"] == "live":
                    return {**result, **({"eu": True} if eu else {})}
                if best_empty is None:
                    best_empty = {**result, **({"eu": True} if eu else {})}
    return best_empty


def verify_ats_company(company: dict, *, get_json=fetch_json, get_text=fetch_text) -> dict | None:
    match = parse_ats_slug(company.get("api")) or parse_ats_slug(company.get("careers_url"))
    if not match:
        return None
    name = company.get("name") if isinstance(company.get("name"), str) else "(unnamed)"
    result = probe_slug(match["ats"], match["slug"], eu=match.get("eu", False), get_json=get_json)
    if result["status"] == "missing" and result["errorKind"] in ("slug_gone", "unknown"):
        suggestion = discover_alternate(name, get_json=get_json, get_text=get_text)
        if suggestion:
            result["suggested"] = suggestion
    return {"name": name, **result}


def collect_provider_health(company: dict) -> dict:
    with ProviderHealthSession() as session:
        return session.probe(company)


class ProviderHealthSession:
    """Keep one provider process and DNS cache across a sequential portal sweep."""

    def __enter__(self):
        try:
            self.process = subprocess.Popen(["node", str(ROOT / "providers/_health_probe.mjs"), "--stream"],
                                            cwd=ROOT, text=True, bufsize=1, stdin=subprocess.PIPE,
                                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except OSError as error:
            raise RuntimeError(f"provider health process failed: {error}") from error
        return self

    def __exit__(self, *_):
        if self.process.stdin:
            try:
                self.process.stdin.close()
            except OSError:
                pass
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        if self.process.stdout:
            self.process.stdout.close()

    def probe(self, company: dict) -> dict:
        try:
            self.process.stdin.write(json.dumps(company) + "\n")
            self.process.stdin.flush()
            if not select.select([self.process.stdout], [], [], 120)[0]:
                self.process.kill()
                raise TimeoutError("provider health probe exceeded 120 seconds")
            raw = self.process.stdout.readline()
            if not raw:
                raise RuntimeError("provider health process exited")
            return json.loads(raw)
        except (OSError, ValueError, RuntimeError, TimeoutError) as error:
            return {"matched": True, "provider": company.get("provider") or "?", "error": str(error)}


def probe_provider(company: dict, *, collect=collect_provider_health) -> dict:
    name = company.get("name") if isinstance(company.get("name"), str) else "(unnamed)"
    raw = collect(company)
    if not raw.get("matched"):
        return {"name": name, "status": "skipped", "reason": "no provider matched careers_url or api"}
    result = {"name": name, "provider": raw.get("provider") or "?"}
    if raw.get("error"):
        error = RuntimeError(str(raw["error"]))
        return {**result, "status": "missing", "errorKind": error_kind(
                    error, status=raw.get("httpStatus"), name=raw.get("errorName")),
                "httpStatus": raw.get("httpStatus"), "reason": raw["error"]}
    if raw.get("budgetReached"):
        return {**result, "status": "live", "partial": True,
                **({"jobCount": raw["jobCount"]} if raw.get("jobCount", 0) > 0 else {})}
    count = raw.get("jobCount", 0)
    return {**result, "status": "live" if count > 0 else "empty", "jobCount": count}


def verify_companies(companies: list, *, ats_probe=verify_ats_company, provider_probe=probe_provider,
                     ats_only: bool = False) -> list[dict]:
    results = []
    for company in companies:
        if not isinstance(company, dict) or company.get("enabled") is False:
            continue
        ats_result = ats_probe(company)
        if ats_result is not None:
            results.append(ats_result)
        elif not ats_only:
            results.append(provider_probe(company))
    return results


def verify_portals_file(path: Path, *, ats_only: bool = False) -> dict:
    if not path.is_file():
        return {"found": False, "results": []}
    data = yaml.safe_load(path.read_text())
    companies = data.get("tracked_companies", []) if isinstance(data, dict) else []
    if not isinstance(companies, list):
        raise ValueError("tracked_companies must be a list")
    if ats_only:
        results = verify_companies(companies, ats_only=True)
    else:
        with ProviderHealthSession() as session:
            results = verify_companies(companies,
                                       provider_probe=lambda company: probe_provider(company, collect=session.probe))
    return {"found": True, "results": results}


def main(argv: list[str] | None = None) -> int:
    load_dotenv(ROOT / ".env", override=False)
    parser = argparse.ArgumentParser(description="Verify tracked portal reachability")
    parser.add_argument("--file", default=os.environ.get("CAREER_OPS_PORTALS", "portals.yml"))
    parser.add_argument("--add", metavar="COMPANY")
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--ats-only", action="store_true")
    parser.add_argument("--json", action="store_true")
    arguments = parser.parse_args(argv)
    if not arguments.file:
        parser.error("--file requires a value")
    if arguments.add is not None:
        candidates = slug_candidates(arguments.add, first_word_suffixes=True)
        if not candidates:
            parser.error("--add requires a Latin company name with an ASCII slug")
        hits = [row for slug in candidates for ats in ATS
                if (row := probe_slug(ats, slug))["status"] != "missing"]
        if arguments.json:
            print(json.dumps({"candidates": candidates, "hits": hits}))
        else:
            print(f"Probing {len(candidates)} slug candidate(s) for '{arguments.add}'")
            for row in hits:
                print(f"  {row['ats']}/{row['slug']}: {row['status']} ({row['jobCount']} jobs)")
            if hits:
                best = next((row for row in hits if row["status"] == "live"), hits[0])
                print(f"Suggested: careers_url for {best['ats']} → slug '{best['slug']}'")
            else:
                print("No slug variant resolved on any ATS.")
        return 0
    result = verify_portals_file(Path(arguments.file), ats_only=arguments.ats_only)
    if arguments.json:
        print(json.dumps(result))
    elif not result["found"]:
        print(f"No portals file at {arguments.file}; nothing to verify.")
    else:
        for row in result["results"]:
            source = f"{row['ats']}/{row['slug']}" if row.get("ats") else row.get("provider") or "?"
            print(f"{row['name']}: {source} {row['status']}"
                  + (f" → {row['suggested']['ats']}/{row['suggested']['slug']}" if row.get("suggested") else ""))
    return int(arguments.strict and any(row["status"] == "missing" for row in result["results"]))


if __name__ == "__main__":
    sys.exit(main())
