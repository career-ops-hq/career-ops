"""Read interview stories, rank them, and classify numeric provenance without editing facts."""

from __future__ import annotations

import re
import unicodedata


CLAIMS = (
    ("percent", re.compile(r"\d+(?:\.\d+)?%"), lambda match: (float(match[0][:-1]),)),
    ("plus-noun", re.compile(r"\b(\d+)\+\s+[a-zA-Z]+"), lambda match: (float(match[1]),)),
    ("hour-range", re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:→|->|to)\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b", re.I),
     lambda match: (float(match[1]), float(match[2]))),
    ("scale-hyphen", re.compile(r"\b(\d+)-(?:person|member)\b", re.I), lambda match: (float(match[1]),)),
    ("scale-noun", re.compile(r"\b(\d+)\s+(?:students?|employees?|people|staff|learners?|instructors?|departments?|cohorts?)\b", re.I),
     lambda match: (float(match[1]),)),
)
NUMBERS = re.compile(r"\d+(?:\.\d+)?")
WORD_STOP = frozenset({
    "this", "that", "these", "those", "with", "from", "into", "onto", "over", "were", "have", "while", "about",
    "their", "there", "which", "through", "across", "within", "without", "after", "before", "during", "being",
    "been", "each", "every", "other", "than", "then", "them", "they", "when", "where", "what", "more", "most",
    "some", "such", "only", "also", "just", "like", "very", "used", "using",
})
QUESTION_STOP = frozenset({
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "you", "me", "my", "your",
    "i", "we", "they", "it", "is", "was", "were", "are", "be", "been", "have", "had", "has", "do", "did", "does",
    "tell", "about", "time", "when", "how", "give", "example", "describe", "situation", "where", "what",
})
STORY_HEADER = re.compile(r"^### (.+)$", re.M)
MARKER = re.compile(r"^user-stated\s+\d{4}-\d{2}-\d{2}$")


def stories(text: str, *, require_action: bool = True) -> list[dict]:
    """Keep the Node story-block contract, including source and provenance fields."""
    matches = list(STORY_HEADER.finditer(text))
    parsed = []
    for index, match in enumerate(matches):
        body = text[match.start() + 4:matches[index + 1].start() if index + 1 < len(matches) else len(text)]
        heading = match[1].strip()
        theme_match = re.match(r"\[([^]]+)\]\s*(.+)", heading)
        theme, title = (theme_match[1].strip(), theme_match[2].strip()) if theme_match else ("", heading)
        fields = {}
        for key, value in re.findall(r"^\*\*([^:*]+):\*\*\s*(.+)$", body, re.M | re.I):
            fields.setdefault(key.lower(), value.strip())
        action = fields.get("a (action)", fields.get("action", ""))
        if not title or (require_action and not action):
            continue
        tags = [tag.strip().lower() for tag in re.split(r"[,;]", fields.get("best for questions about", "")) if tag.strip()]
        provenance = fields.get("provenance")
        parsed.append({
            "title": title, "theme": theme, "source": fields.get("source", ""),
            "provenance": provenance.lower() if provenance else None, "body": body,
            "situation": fields.get("s (situation)", fields.get("situation", "")),
            "task": fields.get("t (task)", fields.get("task", "")),
            "action": action, "result": fields.get("r (result)", fields.get("result", "")),
            "reflection": fields.get("reflection", ""), "tags": tags,
        })
    return parsed


def context_words(text: str, start: int, length: int) -> list[str]:
    fragment = text[max(0, start - 90):min(len(text), start + length + 90)].lower()
    return list(dict.fromkeys(word for word in re.findall(r"[a-z0-9]+", fragment)
                              if len(word) >= 4 and word not in WORD_STOP and not word.isdigit()))


def classify_numeric_claims(story_text: str, cv_text: str) -> dict[str, list[dict]]:
    """Preserve explicit unknowns; a coincidental number in the CV proves nothing."""
    cv_context: dict[float, list[list[str]]] = {}
    for match in NUMBERS.finditer(cv_text):
        cv_context.setdefault(float(match[0]), []).append(context_words(cv_text, match.start(), len(match[0])))
    cv_words = set(re.findall(r"[a-z0-9]+", cv_text.lower()))
    buckets = {key: [] for key in ("existing", "supportedByResume", "derivedUnverified", "userCannotConfirm")}
    for story in stories(story_text, require_action=False):
        claims = sorted(
            ((match.start(), kind, match[0], values(match))
             for kind, pattern, values in CLAIMS for match in pattern.finditer(story["body"])),
            key=lambda item: item[0],
        )
        for start, kind, claim, numbers in claims:
            item = {"story": story["title"], "claim": claim, "pattern": kind}
            marker = story["provenance"]
            if marker == "user-cannot-confirm":
                buckets["userCannotConfirm"].append({**item, "reason": "explicit Provenance marker (user-cannot-confirm) — durable, never reclassified"})
                continue
            if marker == "source: cv.md" or (marker and MARKER.fullmatch(marker)):
                buckets["existing"].append({**item, "reason": f"confirmed via Provenance marker ({marker})"})
                continue
            words = context_words(story["body"], start, len(claim))
            if all(any(set(words) & set(nearby) for nearby in cv_context.get(number, ())) for number in numbers):
                buckets["existing"].append(item)
            elif set(words) & cv_words:
                buckets["supportedByResume"].append({**item, "contextWords": words})
            else:
                buckets["derivedUnverified"].append(item)
    return buckets


def provenance_diagnosis(story_bank_exists: bool, cv_exists: bool, story_count: int, claim_count: int) -> str | None:
    """An empty or ungrounded scan is low-confidence, never a clean result."""
    if not story_bank_exists:
        return "no-story-bank"
    if not cv_exists:
        return "no-cv"
    if story_count == 0:
        return "no-stories-parsed"
    if claim_count == 0:
        return "no-numeric-claims-found"
    return None


def tokens(text: str) -> list[str]:
    """Keep letters, combining marks and digits from any script for matching."""
    words = []
    current = []
    for character in text.lower():
        if unicodedata.category(character)[0] in "LMN":
            current.append(character)
        elif current:
            words.append("".join(current))
            current = []
    if current:
        words.append("".join(current))
    return words


def match_stories(story_text: str, question: str, jd: str = "", top: int = 1) -> list[dict]:
    """Rank by explicit tags, title/theme, body and relevant JD tags."""
    if not question.strip() or top < 1:
        raise ValueError("A question and positive top count are required")
    query = [word for word in tokens(question) if word not in QUESTION_STOP]
    jd_signal = set(tokens(jd)) - QUESTION_STOP
    ranked = []
    for story in stories(story_text):
        tags = set(word for tag in story["tags"] for word in tokens(tag))
        title = set(tokens(story["title"] + " " + story["theme"]))
        body = set(tokens(story["action"] + " " + story["result"]))
        score = sum(3 * (word in tags) + 2 * (word in title) + (word in body) for word in query)
        score += sum(2 for tag in story["tags"] if set(tokens(tag)) & jd_signal)
        ranked.append({"story": story, "score": score})
    return sorted(ranked, key=lambda item: -item["score"])[:top]


def format_ats(story: dict) -> str:
    """Keep the legacy 500-word ceiling and short-story warning for candidate review."""
    prose = " ".join(story[key] for key in ("situation", "task", "action", "result", "reflection") if story[key])
    words = prose.split()[:500]
    heading = f"— {story['title']}" + (f" [{story['theme']}]" if story["theme"] else "")
    lines = [heading]
    if story["source"]:
        lines.append(f"   Source: {story['source']}")
    if story["tags"]:
        lines.append(f"   Tags: {', '.join(story['tags'])}")
    lines.extend(("", " ".join(words), "", f"   (~{len(words)} words)"))
    if len(words) < 250:
        lines[-1] += "\n   ⚠️  Under 250 words — consider expanding this story in story-bank.md."
    return "\n".join(lines)
