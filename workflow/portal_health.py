"""Verify tracked ATS boards and confirm ownership before suggesting slug repairs."""

from __future__ import annotations

import html
import json
import re
import unicodedata
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


LATIN = str.maketrans({"ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "đ": "d", "ł": "l",
                       "þ": "th", "ð": "d", "ħ": "h", "ı": "i", "ŋ": "ng", "ŧ": "t", "ĸ": "k", "ſ": "s"})
DESIGNATORS = frozenset("inc incorporated llc llp lp ltd limited plc corp corporation co company "
                        "gmbh ag kg sa sas sarl srl spa bv nv ab as oy aps pty pte kk kft".split())
SUFFIXES = ("ai", "tech", "io", "hq", "labs")
ATS = ("greenhouse", "ashby", "lever")


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
    with urlopen(Request(url, headers={"User-Agent": "career-ops/1.0"}), timeout=20) as response:
        return json.load(response)


def fetch_text(url: str) -> str:
    with urlopen(Request(url, headers={"User-Agent": "career-ops/1.0", "Range": "bytes=0-65535"}), timeout=20) as response:
        return response.read(65536).decode("utf-8", errors="replace")


def error_kind(error: Exception) -> str:
    status = getattr(error, "status", None) or getattr(error, "code", None)
    if status in (404, 410):
        return "slug_gone"
    if status in (401, 403):
        return "auth"
    if isinstance(status, int) and status >= 500:
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
