"""Prepare local ATS field guidance from a reviewed resume and candidate profile."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

import yaml


from career_ops.context import INPUT_ROOT
ALLOWED_HOSTS = {
    "boards.greenhouse.io", "greenhouse.io", "jobs.ashbyhq.com", "ashbyhq.com",
    "jobs.lever.co", "jobs.eu.lever.co", "lever.co",
}
ATS_HOSTS = {
    "greenhouse": {"boards.greenhouse.io", "greenhouse.io"},
    "ashby": {"jobs.ashbyhq.com", "ashbyhq.com"},
    "lever": {"jobs.lever.co", "jobs.eu.lever.co", "lever.co"},
}
SAFE_SLUG = re.compile(r"^[A-Za-z0-9._-]+$")


def detect_ats(url: str) -> tuple[str, str, str]:
    """Reject unsupported hosts and return ATS, company slug and job ID."""
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
    except ValueError as error:
        raise ValueError(f"invalid URL: {url}") from error
    if parsed.scheme != "https":
        raise ValueError("URL must use https")
    if host not in ALLOWED_HOSTS:
        raise ValueError(f"{host!r} is not a supported ATS host")
    path = parsed.path
    if host in ATS_HOSTS["greenhouse"]:
        match = re.match(r"^/([^/]+)/jobs/(\d+)", path)
        if match and SAFE_SLUG.fullmatch(match[1]):
            return "greenhouse", match[1], match[2]
    else:
        match = re.match(r"^/([^/]+)/([^/?#]+)", path)
        if match and SAFE_SLUG.fullmatch(match[1]) and SAFE_SLUG.fullmatch(match[2]):
            return ("ashby" if host in ATS_HOSTS["ashby"] else "lever"), match[1], match[2]
    raise ValueError("URL not recognized as Greenhouse, Ashby, or Lever")


def prepare_application(url: str, pdf: Path, cover: Path | None = None, *, root: Path = INPUT_ROOT) -> tuple[str, str | None]:
    """Return a local fill guide and optional missing-cover warning; never submit."""
    output = (root / "output").resolve()
    pdf = (root / pdf).resolve()
    if not pdf.is_relative_to(output) or pdf == output:
        raise ValueError("--pdf must point to a file inside output/")
    if not pdf.is_file():
        raise ValueError(f"PDF not found: {pdf}")
    ats, company, job_id = detect_ats(url)
    profile = yaml.safe_load((root / "profile.yml").read_text(encoding="utf-8")) or {}
    if not isinstance(profile, dict):
        raise ValueError("profile must be a mapping")
    candidate = profile.get("candidate") or {}
    if not isinstance(candidate, dict):
        raise ValueError("profile candidate must be a mapping")
    name = str(candidate.get("full_name") or "")
    first, _, last = name.partition(" ")
    email = str(candidate.get("email") or "")
    phone = str(candidate.get("phone") or "")
    linkedin = str(candidate.get("linkedin") or "")
    portfolio = str(candidate.get("portfolio_url") or "")
    cover_info = None
    warning = None
    if cover is not None:
        cover_file = (root / cover).resolve()
        if not cover_file.is_file():
            warning = f"Warning: cover letter not found at {cover} — skipping"
        else:
            text = cover_file.read_text(encoding="utf-8").strip()
            cover_info = (text, len(text.split()))
    resume = f"{pdf.name}  ← attach this file"
    if ats == "greenhouse":
        fields = [("first_name", first), ("last_name", last), ("email", email),
                  ("phone", phone), ("resume", resume)]
        if cover_info:
            excerpt = cover_info[0][:80].replace("\n", " ")
            fields.append(("cover_letter", f"{cover_info[1]} words — {excerpt}…"))
        if linkedin:
            fields.append(("linkedin_profile", linkedin))
        if portfolio:
            fields.append(("website", portfolio))
    elif ats == "ashby":
        fields = [("firstName", first), ("lastName", last), ("email", email),
                  ("phone", phone), ("resume", resume)]
        if cover_info:
            fields.append(("coverLetter", f"({cover_info[1]} words — paste from cover file)"))
        if linkedin:
            fields.append(("linkedInUrl", linkedin))
    else:
        fields = [("name", name.strip()), ("email", email), ("phone", phone), ("resume", resume)]
        if cover_info:
            fields.append(("comments", f"({cover_info[1]} words — paste from cover file)"))
        if linkedin:
            fields.append(("urls[LinkedIn]", linkedin))
        if portfolio:
            fields.append(("urls[Portfolio]", portfolio))
    width = max(len(key) for key, _ in fields) + 2
    lines = [f"\n── {ats.title()} · {company} · job {job_id} {'─' * 20}", ""]
    lines.extend(f"  {key.ljust(width)}{value or '(not set — check config/profile.yml)'}" for key, value in fields)
    lines.extend([f"\n  PDF     {pdf.name} ({pdf.stat().st_size / 1024:.1f} KB)"])
    if cover_info:
        lines.append(f"  Cover   {cover} ({cover_info[1]} words)")
    lines.extend(["\n── Next step " + "─" * 38, f"  Open:   {url}",
                  "  Fill the form using the values above, attach the PDF, then submit.", ""])
    return "\n".join(lines), warning


def main() -> int:
    parser = argparse.ArgumentParser(description="Print manual ATS application field guidance")
    parser.add_argument("--url", required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--cover", type=Path)
    args = parser.parse_args()
    try:
        guide, warning = prepare_application(args.url, args.pdf, args.cover)
    except (OSError, ValueError, yaml.YAMLError) as error:
        parser.error(str(error))
    if warning:
        print(warning, file=sys.stderr)
    print(guide)
    return 0
