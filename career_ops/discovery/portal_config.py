"""Validate portal policy and tracked company shapes before a workflow run."""

from __future__ import annotations

import argparse
import math
import os
import re
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

from dotenv import load_dotenv
import yaml


from career_ops.context import ROOT
TITLE_FIELDS = ("positive", "negative", "seniority_boost")


def _issue(items: list[dict], path: str, message: str) -> None:
    items.append({"path": path, "message": message})


def _object(value: object) -> bool:
    return isinstance(value, dict)


def _keywords(value: object, path: str, errors: list[dict]) -> None:
    if value is None:
        return
    for index, item in enumerate(value if isinstance(value, list) else [value]):
        if not isinstance(item, str):
            _issue(errors, f"{path}[{index}]", "keyword must be a string")
        elif not item.strip():
            _issue(errors, f"{path}[{index}]", "keyword must not be empty")


def _url(value: object, path: str, errors: list[dict]) -> None:
    if value is None or value == "":
        return
    if not isinstance(value, str):
        _issue(errors, path, "must be a string URL")
        return
    try:
        parsed = urlsplit(value)
    except ValueError:
        parsed = None
    if not parsed or not parsed.scheme or not (parsed.netloc or parsed.scheme not in {"http", "https"}):
        _issue(errors, path, f"invalid URL: {value}")
    elif parsed.scheme not in {"http", "https"}:
        _issue(errors, path, f"unsupported URL protocol: {parsed.scheme}:")


def _positive_number(value: object) -> bool:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(number) and number > 0


def _parser(value: object, path: str, errors: list[dict]) -> None:
    if value is None:
        return
    if not _object(value):
        _issue(errors, path, "parser must be an object")
        return
    if not isinstance(value.get("command"), str) or not value["command"].strip():
        _issue(errors, f"{path}.command", "parser.command must be a non-empty string")
    if "script" in value and (not isinstance(value["script"], str) or not value["script"].strip()):
        _issue(errors, f"{path}.script", "parser.script must be a non-empty string when set")
    if "args" in value and not isinstance(value["args"], list):
        _issue(errors, f"{path}.args", "parser.args must be an array when set")
    for key in ("timeout_ms", "max_buffer_bytes"):
        if key in value and not _positive_number(value[key]):
            _issue(errors, f"{path}.{key}", f"parser.{key} must be a positive number when set")


def validate_config(config: object, *, provider_ids: set[str] | None = None) -> dict:
    """Return Node-compatible ordered errors and warnings without changing input."""
    errors: list[dict] = []
    warnings: list[dict] = []
    provider_ids = provider_ids or set()
    if not _object(config):
        _issue(errors, "<root>", "portals config must be a YAML object")
        return {"errors": errors, "warnings": warnings}

    for field in ("title_filter", "title_filter_full", "location_filter", "content_filter", "visa_filter"):
        if field not in config:
            continue
        section = config[field]
        if not _object(section):
            _issue(errors, field, f"{field} must be an object")
            continue
        if field == "title_filter_full":
            for key in section:
                if key not in TITLE_FIELDS:
                    _issue(errors, f"{field}.{key}",
                           f"unknown title_filter_full field - expected one of {', '.join(TITLE_FIELDS)}")
        keys = {
            "title_filter": TITLE_FIELDS,
            "title_filter_full": TITLE_FIELDS,
            "location_filter": ("always_allow", "allow", "block", "block_hard"),
            "content_filter": ("positive", "negative"),
            "visa_filter": ("positive", "negative"),
        }[field]
        if field == "visa_filter":
            for key in ("enabled", "require_mention"):
                if key in section and not isinstance(section[key], bool):
                    _issue(errors, f"{field}.{key}", "must be a boolean when set")
        for key in keys:
            _keywords(section.get(key), f"{field}.{key}", errors)
        if field == "content_filter" and "by_title_keyword" in section:
            rules = section["by_title_keyword"]
            if not _object(rules):
                _issue(errors, "content_filter.by_title_keyword",
                       "by_title_keyword must be an object keyed by title_filter.positive keyword")
            else:
                titles = config.get("title_filter")
                positive = titles.get("positive") if _object(titles) else None
                known = {item.strip().lower() for item in positive if isinstance(item, str)} \
                    if isinstance(positive, list) else set()
                for keyword, rule in rules.items():
                    path = f"content_filter.by_title_keyword.{keyword}"
                    if str(keyword).strip().lower() not in known:
                        _issue(warnings, path,
                               f'"{keyword}" does not match any title_filter.positive keyword and will never apply')
                    if not _object(rule):
                        _issue(errors, path, "must be an object with positive/negative keyword lists")
                        continue
                    for key in ("positive", "negative"):
                        _keywords(rule.get(key), f"{path}.{key}", errors)

    for section in ("tracked_companies", "job_boards"):
        companies = config.get(section)
        if section in config and not isinstance(companies, list):
            _issue(errors, section, f"{section} must be an array when set")
        seen: dict[str, str] = {}
        if isinstance(companies, list):
            for index, company in enumerate(companies):
                base = f"{section}[{index}]"
                if not _object(company):
                    _issue(errors, base, "company entry must be an object")
                    continue
                if company.get("enabled") is False:
                    continue
                name = company.get("name")
                if not isinstance(name, str) or not name.strip():
                    _issue(errors, f"{base}.name", "enabled company must have a non-empty string name")
                else:
                    normalized = " ".join(name.lower().split())
                    if normalized in seen:
                        _issue(warnings, f"{base}.name", f"duplicate enabled company name also seen at {seen[normalized]}")
                    else:
                        seen[normalized] = f"{base}.name"
                _url(company.get("careers_url"), f"{base}.careers_url", errors)
                _url(company.get("api"), f"{base}.api", errors)
                if "provider" in company:
                    provider = company["provider"]
                    if not isinstance(provider, str) or not provider.strip():
                        _issue(errors, f"{base}.provider", "provider must be a non-empty string when set")
                    elif provider not in provider_ids:
                        _issue(errors, f"{base}.provider", f'unknown provider "{provider}"')
                _parser(company.get("parser"), f"{base}.parser", errors)
                if company.get("provider") == "search":
                    search = company.get("search")
                    if not isinstance(search, dict):
                        _issue(errors, f"{base}.search", "search must be an object")
                        continue
                    if search.get("method") not in ("web", "linkedin"):
                        _issue(errors, f"{base}.search.method", "must be web or linkedin")
                    sites = search.get("sites")
                    if not isinstance(sites, list) or not sites or any(
                        not isinstance(site, str) or not re.fullmatch(r"[a-zA-Z0-9.-]+(?:/[a-zA-Z0-9_./-]*)?", site)
                        for site in sites
                    ):
                        _issue(errors, f"{base}.search.sites", "must contain source domains or domain/path scopes")
                    locations = search.get("locations", [])
                    if not isinstance(locations, list) or any(not isinstance(x, str) or not x.strip() for x in locations):
                        _issue(errors, f"{base}.search.locations", "must be an array of non-empty strings")
                    if search.get("method") == "linkedin" and (sites != ["linkedin.com/jobs/view"] or not isinstance(locations, list) or len(locations) != 1):
                        _issue(errors, f"{base}.search", "LinkedIn requires one location and linkedin.com/jobs/view")
                    limit = company.get("max_results", 50)
                    if type(limit) is not int or not 1 <= limit <= 500:
                        _issue(errors, f"{base}.max_results", "must be an integer from 1 to 500")
    return {"errors": errors, "warnings": warnings}


def provider_ids() -> set[str]:
    result = subprocess.run(["node", str(ROOT / "adapters/node/providers/_ids.mjs")], cwd=ROOT,
                            text=True, capture_output=True, timeout=30, check=True)
    return set(yaml.safe_load(result.stdout))


def validate_file(path: Path) -> dict:
    if not path.is_file():
        raise FileNotFoundError(f"file not found: {path}")
    return validate_config(yaml.safe_load(path.read_text()), provider_ids=provider_ids())


def main(argv: list[str] | None = None) -> int:
    load_dotenv(ROOT / ".env", override=False)
    parser = argparse.ArgumentParser(description="Validate portals.yml policy and company entries")
    parser.add_argument("--file", default=os.environ.get("CAREER_OPS_PORTALS", "portals.yml"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        result = validate_config({"title_filter": {"positive": ["AI", ""]},
                                  "tracked_companies": [{"name": "Acme", "provider": "not-real"}]})
        if len(result["errors"]) != 2:
            raise RuntimeError("portal self-test failed")
        print("validate-portals self-test OK")
        return 0
    if not args.file:
        parser.error("--file requires a path")
    path = Path(args.file).resolve()
    try:
        result = validate_file(path)
    except (OSError, ValueError, subprocess.SubprocessError, yaml.YAMLError) as error:
        parser.exit(1, f"validate-portals failed: {error}\n")
    print(f"validate-portals: {path}")
    for kind in ("warnings", "errors"):
        for issue in result[kind]:
            print(f"{kind[:-1]}: {issue['path']}: {issue['message']}")
    print(f"{len(result['errors'])} errors, {len(result['warnings'])} warnings")
    return int(bool(result["errors"]))
