"""Annotate scanned postings with the existing non-dropping trust heuristics."""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlsplit


SUSPICIOUS_DOMAINS = ("bit.ly", "tinyurl.com", "t.co", "forms.gle", "goo.gl", "shorturl.at", "rebrand.ly", "cutt.ly")
ATS_DOMAINS = ("greenhouse.io", "ashbyhq.com", "lever.co", "workday.com", "smartrecruiters.com", "jobvite.com",
               "myworkdayjobs.com", "recruitee.com", "workable.com", "icims.com", "taleo.net", "applytojob.com",
               "breezy.hr", "jazz.co", "bamboohr.com", "teamtailor.com")
FOLD_LATIN = str.maketrans({"ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "đ": "d", "ł": "l", "þ": "th",
                            "ð": "d", "ħ": "h", "ı": "i", "ŋ": "ng", "ŧ": "t", "ĸ": "k", "ſ": "s"})


def _domain_match(hostname: str, domains: tuple[str, ...]) -> bool:
    return any(hostname == domain or hostname.endswith("." + domain) for domain in domains)


def _company_matches(company: str, hostname: str) -> bool:
    if not company or not hostname:
        return True
    decomposed = unicodedata.normalize("NFD", company.lower())
    folded = "".join(char for char in decomposed if unicodedata.category(char)[0] != "M").translate(FOLD_LATIN)
    folded = " ".join(re.sub(r"[^a-z0-9 ]", "", folded).split())
    if not folded:
        return True
    if folded.replace(" ", "") in hostname:
        return True
    return any(word in hostname for word in folded.split() if len(word) >= 3)


def trust(offer: dict, config: dict | None) -> dict:
    """Return score, flags and level without excluding the posting."""
    if not config or config.get("enabled") is False:
        return {"score": 100, "flags": [], "level": "high"}
    suspicious = tuple(str(item).strip().lower() for item in config.get("suspicious_domains", SUSPICIOUS_DOMAINS)
                       if str(item).strip()) if isinstance(config.get("suspicious_domains", SUSPICIOUS_DOMAINS), list) else SUSPICIOUS_DOMAINS
    ats = tuple(str(item).strip().lower() for item in config.get("ats_allowlist", ATS_DOMAINS)
                if str(item).strip()) if isinstance(config.get("ats_allowlist", ATS_DOMAINS), list) else ATS_DOMAINS
    flags = []
    score = 100
    url = offer.get("url").strip() if isinstance(offer.get("url"), str) else ""
    if not url:
        flags.append("missing_apply_url")
        score -= 40
    else:
        try:
            parsed = urlsplit(url)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                raise ValueError("Unsupported URL")
        except ValueError:
            flags.append("invalid_url")
            score -= 50
        else:
            hostname = parsed.hostname.lower()
            if _domain_match(hostname, suspicious):
                flags.append("suspicious_domain")
                score -= 25
            company = offer.get("company").strip() if isinstance(offer.get("company"), str) else ""
            if company and not _domain_match(hostname, ats) and not _company_matches(company, hostname):
                flags.append("company_domain_mismatch")
                score -= 15
    score = max(0, min(100, score))
    return {"score": score, "flags": flags, "level": "high" if score >= 90 else "medium" if score >= 60 else "low"}
