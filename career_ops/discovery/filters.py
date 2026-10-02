"""Apply configured posting filters after provider collection and before storage."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
import math
import re
import unicodedata
from urllib.parse import unquote, urlparse


def _keywords(value: object) -> list[str]:
    values = value if isinstance(value, list) else [value] if value is not None else []
    return [word for item in values if isinstance(item, str) and (word := item.strip().lower())]


def _keyword_match(keyword: str, title: str) -> bool:
    def bounded(term: str) -> bool:
        def word(char: str) -> bool:
            return char == "_" or unicodedata.category(char)[0] in {"L", "M", "N"}

        start = title.find(term)
        while start >= 0:
            end = start + len(term)
            if (start == 0 or not word(title[start - 1])) and (end == len(title) or not word(title[end])):
                return True
            start = title.find(term, start + 1)
        return False

    if keyword.startswith("word:"):
        word = keyword[5:].strip()
        return bool(word and bounded(word))
    if re.fullmatch(r"[a-z]{2,3}", keyword):
        return bounded(keyword)
    return keyword in title


def _positive_match(keyword: str, title: str) -> bool:
    if not re.search(r"\s+\+\s+", keyword):
        return _keyword_match(keyword, title)
    return all(_keyword_match(term.strip(), title) for term in re.split(r"\s+\+\s+", keyword) if term.strip())


def title_match(title: object, config: dict | None) -> tuple[bool, list[str]]:
    """Return eligibility and the raw positive terms used by content overrides."""
    config = config if isinstance(config, dict) else {}
    lower = str(title or "").lower()
    raw = config.get("positive") if isinstance(config.get("positive"), list) else []
    positive = [(word, word.strip().lower()) for word in raw if isinstance(word, str) and word.strip()]
    negative = _keywords(config.get("negative")) if isinstance(config.get("negative"), list) else []
    matched = [raw for raw, word in positive if _positive_match(word, lower)]
    return (not positive or bool(matched)) and not any(_keyword_match(word, lower) for word in negative), matched


TIER_PATTERNS = (
    ("senior", 4, r"\bchief\b|\bvp\b|\bvice\s+president\b|\bdirector\b|\bprincipal\b|\bstaff\b|"
     r"\blead\b|\bsenior\b|\bsr\b|\bsr\.\b|\bhead\s+of\b|\b[a-z]{2,}[\s-](?:iii|iv|v)\b"),
    ("mid", 3, r"\bmid-level\b|\bmid\b|\b[a-z]{2,}[\s-]ii\b|\b(?:l4|l5)\b"),
    ("entry", 2, r"\bentry-level\b|\bentry\b|\bassociate\b|\bjunior\b|"
     r"\b[a-z]{2,}[\s-]i\b|\b(?:l1|l2)\b"),
    ("intern", 1, r"\binternship\b|\bintern\b|\btrainee\b|\bco-op\b"),
)


def classify_tier(title: object) -> str:
    """Use the first seniority marker, with Node's two role-noun safeguards."""
    if not isinstance(title, str):
        return "mid"
    clean = title
    for pattern, replacement in ((r"\bA\.I\.", "AI"), (r"\bA\.I\b", "AI"), (r"\bA\.\s+I\b", "AI"),
                                 (r"\bI\.T\.", "IT"), (r"\bI\.T\b", "IT"), (r"\bI\.\s+T\b", "IT"),
                                 (r"\bi/o\b", "IO")):
        clean = re.sub(pattern, replacement, clean, flags=re.I | re.ASCII)
    associate = re.search(r"\bassociate\b", clean, re.I | re.ASCII)
    if associate:
        junior = re.search(r"\b(?:intern(?:ship)?|trainee|co-op|graduate|junior|entry(?:-level)?)\b",
                           clean, re.I | re.ASCII)
        if not junior or junior.start() > associate.start():
            after = clean[associate.end():]
            if re.match(r"^\s+(?:[a-z]+\s+){0,2}(?:director|vice\s+president|vp|principal|partner|chief|"
                        r"head\s+of|professor|dean|provost|chancellor|superintendent|general\s+counsel)\b",
                        after, re.I | re.ASCII):
                return "senior"
    bridge = re.search(r"\b(?:intern(?:ship)?|trainee|co-op|graduate|junior|entry(?:-level)?)\s+"
                       r"(?:program|scheme|talent|cohort)\b", clean, re.I | re.ASCII)
    if bridge and re.search(r"\b(?:chief|vp|vice\s+president|director|principal|staff|lead|senior|sr\.?|"
                            r"head\s+of|partner)\b", clean[:bridge.start()] + " " + clean[bridge.end():], re.I | re.ASCII):
        return "senior"
    matches = []
    for tier, weight, pattern in TIER_PATTERNS:
        match = re.search(pattern, clean, re.I | re.ASCII)
        if match:
            matches.append((match.start(), -weight, tier))
    if re.search(r"\bgraduate\b", clean, re.I | re.ASCII) and re.search(r"\b(?:program|scheme)\b", clean, re.I | re.ASCII):
        graduate = re.search(r"\bgraduate\b", clean, re.I | re.ASCII)
        matches.append((graduate.start(), -1, "intern"))
    return min(matches)[2] if matches else "mid"


def _location_words(value: object) -> list[re.Pattern]:
    patterns = []
    for keyword in _keywords(value):
        prefix = r"(?<![a-z0-9])" if re.search(r"[a-z0-9]", keyword[0]) else ""
        suffix = r"(?![a-z0-9])" if re.search(r"[a-z0-9]", keyword[-1]) else ""
        patterns.append(re.compile(prefix + re.escape(keyword) + suffix))
    return patterns


def location_hint(url: object) -> str:
    if not isinstance(url, str):
        return ""
    try:
        parsed = urlparse(url)
    except ValueError:
        return ""
    if not (parsed.hostname or "").lower().endswith(".myworkdayjobs.com"):
        return ""
    segments = [item for item in parsed.path.split("/") if item]
    if "job" not in segments:
        return ""
    index = len(segments) - 1 - segments[::-1].index("job")
    if index + 1 == len(segments):
        return ""
    return re.sub(r"\s+", " ", re.sub(r"[-_+]+", " ", unquote(segments[index + 1]))).strip().lower()


def _remote_title(title: object) -> bool:
    if not isinstance(title, str):
        return False
    lower = title.lower()
    return not re.search(r"\b(?:non|not|no)[^a-z]*remote", lower) and bool(
        re.search(r"(?<![a-z])remote(?=$|\s*[^a-z\s]|\s+in\b)", lower))


def location_match(location: object, url: object, title: object, config: dict | None) -> bool:
    if not config:
        return True
    lower = location.strip().lower() if isinstance(location, str) else ""
    hint = location_hint(url)
    if not lower and not hint:
        return True
    matches = lambda key: any(pattern.search(value) for pattern in _location_words(config.get(key)) for value in (lower, hint) if value)
    if matches("block_hard"):
        return False
    if matches("always_allow"):
        return True
    if matches("block"):
        return False
    return not _location_words(config.get("allow")) or matches("allow") or _remote_title(title)


def posting_age_match(posted_at: object, days: object, *, now_ms: float | None = None) -> bool:
    try:
        maximum = float(days)
    except (TypeError, ValueError):
        return True
    if not maximum.is_integer() or maximum <= 0:
        return True
    if not isinstance(posted_at, (int, float)) or isinstance(posted_at, bool) or not math.isfinite(posted_at):
        return True
    now_ms = now_ms if now_ms is not None else datetime.now(timezone.utc).timestamp() * 1000
    return posted_at >= now_ms - maximum * 86_400_000


def posted_date_match(posted_at: object, after: str | None = None, before: str | None = None) -> bool:
    """Apply inclusive CLI date bounds without rejecting undated provider jobs."""
    if not isinstance(posted_at, (int, float)) or isinstance(posted_at, bool) or not math.isfinite(posted_at):
        return True
    if after and posted_at < datetime.combine(date.fromisoformat(after), time.min, timezone.utc).timestamp() * 1000:
        return False
    if before and posted_at > datetime.combine(date.fromisoformat(before), time.max, timezone.utc).timestamp() * 1000:
        return False
    return True


def content_match(description: object, config: dict | None, matched_titles: list[str]) -> bool:
    if not config or not isinstance(description, str) or not description.strip():
        return True
    lower = description.lower()
    overrides = config.get("by_title_keyword") if isinstance(config.get("by_title_keyword"), dict) else {}
    by_title = {key.strip().lower(): value for key, value in overrides.items() if isinstance(key, str) and key.strip()}
    rules = [by_title[key.strip().lower()] for key in matched_titles if key.strip().lower() in by_title]

    def accepted(rule: dict) -> bool:
        rule = rule if isinstance(rule, dict) else {}
        negative, positive = _keywords(rule.get("negative")), _keywords(rule.get("positive"))
        return not any(word in lower for word in negative) and (not positive or any(word in lower for word in positive))

    return any(accepted(rule or {}) for rule in rules) if rules else accepted(config)


def country_match(description: object, config: dict | None, candidate_country: str) -> bool:
    if not config or candidate_country.strip().lower() == "united states":
        return True
    if not isinstance(description, str) or not description.strip():
        return True
    lower = description.lower()
    exclusionary = _keywords(config.get("exclusionary"))
    if not any(word in lower for word in exclusionary):
        return True
    return any(word in lower for word in _keywords(config.get("inclusive"))) or bool(candidate_country.strip() and candidate_country.strip().lower() in lower)


VISA_POSITIVE = ("visa sponsorship", "sponsor a visa", "sponsor visas", "will sponsor", "sponsorship available",
                 "sponsorship is available", "eligible for sponsorship", "provide sponsorship", "offer sponsorship",
                 "immigration support", "h-1b", "h1b", "h-1b1", "h1b1", "o-1 visa")
VISA_NEGATIVE = ("no visa sponsorship", "no sponsorship", "without sponsorship", "unable to sponsor",
                 "not able to sponsor", "cannot sponsor", "do not sponsor", "does not sponsor",
                 "not offer sponsorship", "not provide sponsorship", "sponsorship is not available",
                 "sponsorship not available", "not offer visa sponsorship")


def visa_match(description: object, config: dict | None) -> bool:
    if not config or config.get("enabled") is False:
        return True
    required = config.get("require_mention") is True
    if not isinstance(description, str) or not description.strip():
        return not required
    lower = description.lower()
    negative = _keywords(config["negative"]) if config.get("negative") is not None else VISA_NEGATIVE
    positive = _keywords(config["positive"]) if config.get("positive") is not None else VISA_POSITIVE
    return not any(word in lower for word in negative) and (not required or not positive or any(word in lower for word in positive))


def salary_match(salary: object, config: dict | None) -> bool:
    if not config:
        return True
    try:
        minimum = float(config.get("min") or 0)
        maximum = float(config.get("max") or 0)
    except (TypeError, ValueError):
        return True
    if not all(math.isfinite(value) and value >= 0 for value in (minimum, maximum)) or maximum > 0 and minimum > maximum:
        return True
    if minimum == maximum == 0 or not isinstance(salary, dict):
        return True
    job_min = salary.get("min") if salary.get("min") is not None else salary.get("max")
    job_max = salary.get("max") if salary.get("max") is not None else salary.get("min")
    if job_min is None and job_max is None:
        return True
    currency = str(config.get("currency") or "").strip().upper()
    job_currency = str(salary.get("currency") or "").strip().upper()
    if currency and job_currency and currency != job_currency:
        return False
    def amount(value: object) -> float | None:
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    lowest, highest = amount(job_min), amount(job_max)
    return not ((minimum > 0 and highest is not None and highest < minimum) or
                (maximum > 0 and lowest is not None and lowest > maximum))


def filter_reason(job: dict, config: dict, candidate_country: str, *, now_ms: float | None = None,
                  posted_after: str | None = None, posted_before: str | None = None) -> str | None:
    """Return Node scan's first failing configured filter, preserving its order."""
    title = job.get("title")
    valid_title, matched = title_match(title, config.get("title_filter"))
    if not valid_title:
        return "title"
    skip_tiers = config.get("skip_tiers") if isinstance(config.get("skip_tiers"), list) else []
    if classify_tier(title) in [tier.lower() for tier in skip_tiers if isinstance(tier, str)]:
        return "tier"
    if not location_match(job.get("location"), job.get("url"), title, config.get("location_filter")):
        return "location"
    if not posting_age_match(job.get("postedAt"), config.get("max_posting_age_days"), now_ms=now_ms):
        return "posting_age"
    if not posted_date_match(job.get("postedAt"), posted_after, posted_before):
        return "posted_date"
    if not salary_match(job.get("salary"), config.get("salary_filter")):
        return "salary"
    if not content_match(job.get("description"), config.get("content_filter"), matched):
        return "content"
    if not country_match(job.get("description"), config.get("country_eligibility_filter"), candidate_country):
        return "country_eligibility"
    if not visa_match(job.get("description"), config.get("visa_filter")):
        return "visa"
    return None
