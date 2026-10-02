"""Flag possible agency cross-listings from retained JD text fingerprints."""

from __future__ import annotations

from datetime import date, timedelta
import hashlib
import re
import unicodedata

from career_ops.discovery.dedup import _text_key


FINGERPRINT_MIN_TEXT = 200
CROSSLIST_THRESHOLD = 0.92
CROSSLIST_WINDOW_DAYS = 90


def normalize_jd(text: object) -> str:
    value = str(text or "").lower()
    value = re.sub(r"<[^>]*>|&[a-z#0-9]+;|https?://\S+", " ", value, flags=re.I)
    return " ".join("".join(char if unicodedata.category(char)[0] in {"L", "N"} else " " for char in value).split())


def fingerprint(text: object) -> str:
    normalized = normalize_jd(text)
    if len(normalized.encode("utf-16-le")) // 2 < FINGERPRINT_MIN_TEXT:
        return ""
    tokens = normalized.split()
    if len(tokens) < 3:
        return ""
    weights = [0] * 64
    for index in range(len(tokens) - 2):
        shingle = " ".join(tokens[index:index + 3]).encode()
        digest = hashlib.sha1(shingle).digest()
        for bit in range(64):
            weights[bit] += 1 if digest[bit >> 3] & (1 << (7 - (bit & 7))) else -1
    value = sum(1 << (63 - bit) for bit, weight in enumerate(weights) if weight > 0)
    return f"{value:016x}"


def similarity(left: str, right: str) -> float:
    if not all(re.fullmatch(r"[0-9a-f]{16}", item or "") for item in (left, right)):
        return 0
    return 1 - (int(left, 16) ^ int(right, 16)).bit_count() / 64


def cross_listings(offers: list[dict], history: list[dict], *, today: date,
                   threshold: float = CROSSLIST_THRESHOLD,
                   window_days: int = CROSSLIST_WINDOW_DAYS) -> list[dict]:
    """Warn on recent different-company near-matches; never drop a posting."""
    cutoff = today - timedelta(days=window_days)
    recent = []
    for row in history:
        if not row.get("fingerprint"):
            continue
        try:
            seen = date.fromisoformat(row["dateStr"])
        except (KeyError, TypeError, ValueError):
            continue
        if seen >= cutoff:
            recent.append(row)
    matches = []
    for offer in offers:
        if not offer.get("fingerprint"):
            continue
        for row in recent:
            if _text_key(offer.get("company")) == _text_key(row.get("company")) or offer.get("url") == row.get("url"):
                continue
            score = similarity(offer["fingerprint"], row["fingerprint"])
            if score >= threshold:
                matches.append({"offer": offer, "row": row, "score": score})
    return sorted(matches, key=lambda match: -match["score"])
