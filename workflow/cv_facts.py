"""Validate generated candidate documents against source-backed CV claims."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import unicodedata


METRIC_NOUNS = (
    "users customers clients employees engineers teams companies partners organizations organisations "
    "brands countries hours days weeks months years minutes seconds requests tokens documents "
    "workflows pipelines agents interviews applications offers reports cvs resumes enrollments "
    "enrolments completions courses certifications certificates sessions responses surveys cohorts "
    "commits contributions repositories repos modules tools servers guides articles datasets "
    "examples deployments services downloads stars lines projects integrations tests staff "
    "personnel people technicians operators contractors vendors scientists researchers volunteers "
    "students patients crew facilities sites buildings rooms labs laboratories plants machines "
    "devices instruments vehicles units locations acres hectares shifts rounds inspections audits "
    "incidents alarms tickets"
).split()
NOUN_SYNONYMS = {
    "repos": "repositories", "enrolments": "enrollments", "organisations": "organizations",
    "cvs": "resumes", "certificates": "certifications", "articles": "guides",
    "personnel": "staff", "labs": "laboratories",
}
TOOL_PROSE_WORDS = set(
    "a an and at built by containerized deployment deployments for from in of on production "
    "project team the to using with".split()
)
COUNT_CLAIM = re.compile(
    r"\b(\d[\d,.]*(?:[kKmMbB]\b)?)\s*\+?\s*"
    r"(?:[A-Za-z][A-Za-z-]*\s+){0,4}(" + "|".join(METRIC_NOUNS) + r")\b", re.I | re.ASCII,
)
SIMPLE_CLAIMS = (
    re.compile(r"\b\d+(?:\.\d+)?\s?%", re.ASCII),
    re.compile(r"(?<![\w$€£])[$€£]\s?\d[\d,.]*(?:\s?[kKmMbB])?", re.ASCII),
    re.compile(r"\b\d+(?:\.\d+)?\s?x\b", re.I | re.ASCII),
)
EMPLOYER = re.compile(
    r"\b(?:[Ww]orked [Aa]t|[Jj]oined|[Ee]mployer\s*:\s*|[Cc]ompany\s*:\s*)"
    r"\s*([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})", re.ASCII,
)
TITLE = re.compile(
    r"\b(?:[Ss]erved [Aa]s|[Ww]orked [Aa]s|[Tt]itle\s*:\s*|[Rr]ole\s*:\s*)"
    r"\s*(?:an?\s+|the\s+)?([A-Z][\w/-]*(?:\s+(?:of|for|and|the)\s+[A-Z][\w/-]*"
    r"|\s+[A-Z][\w/-]*){0,4})"
    r"|\b(?:[Ww]orked [Aa]t|[Jj]oined)\s+[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4}"
    r"\s+[Aa]s\s+(?:an?\s+|the\s+)?([A-Z][\w/-]*(?:\s+(?:of|for|and|the)"
    r"\s+[A-Z][\w/-]*|\s+[A-Z][\w/-]*){0,4})", re.ASCII,
)
TOOL = re.compile(
    r"\b(?:using|built with|worked with|technologies?\s*:\s*|tech stack\s*:\s*)"
    r"([^.;\n]+?)(?=\s+\bfor\b|[.;\n]|$)", re.I | re.ASCII,
)
TOOL_PHRASE = re.compile(
    r"^(?:[^\W_]|\.)(?:[^\W_]|[+#./-])*(?:\s+(?:[^\W_]|\.)(?:[^\W_]|[+#./-])*){0,2}$"
)
TOOL_SPLIT = re.compile(r",|\band\b|\bwith\b|\bin\b", re.I)


def fold_digits(text: str) -> str:
    """Fold Unicode decimal digits, separators and grouped thousands."""
    folded = unicodedata.normalize("NFKC", text)
    folded = "".join(str(unicodedata.decimal(char)) if char.isdecimal() else char for char in folded)
    folded = folded.translate(str.maketrans({"٪": "%", "٫": ".", "٬": ","}))
    return re.sub(r"(?<!\d)(\d{1,3})[\s\u00a0\u202f](?=\d{3}(?!\d))", r"\1", folded)


def strip_markup(text: str) -> str:
    """Extract comparable prose from HTML, LaTeX and plain text."""
    text = fold_digits(str(text))
    text = re.sub(r"<script\b[^>]*>[\s\S]*?</script\b[^>]*>", " ", text, flags=re.I)
    text = re.sub(r"<style\b[^>]*>[\s\S]*?</style\b[^>]*>", " ", text, flags=re.I)
    text = re.sub(r"</?(?:li|p|div|tr|h[1-6]|section|article|ul|ol|table|br)\b[^>\n]*>", ". ", text, flags=re.I)
    text = re.sub(r"</?[a-zA-Z][^>\n]*>", " ", text)
    text = re.sub(r"\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^}]*)\})?", lambda match: f" {match[1] or ''} ", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return " ".join(text.split())


def normalize_claim(value: str) -> str:
    value = str(value).lower()
    value = re.sub(r"(\d)[,.\s\u00a0\u202f](?=\d{3}(?!\d))", r"\1", value)
    return re.sub(r"[,\s]+", " ", value).strip()


def normalize_fact(value: str) -> str:
    return normalize_claim(value).rstrip(".;:,").strip()


def metric_claims(text: str) -> list[str]:
    clean = strip_markup(text)
    claims = dict.fromkeys(normalize_claim(match.group()) for pattern in SIMPLE_CLAIMS for match in pattern.finditer(clean))
    for match in COUNT_CLAIM.finditer(clean):
        noun = match[2].lower()
        claims[normalize_claim(f"{match[1]} {NOUN_SYNONYMS.get(noun, noun)}")] = None
    return list(claims)


def fact_claims(text: str) -> list[dict[str, str]]:
    clean = strip_markup(text)
    claims = []
    for kind, pattern in (("employer", EMPLOYER), ("title", TITLE), ("tool", TOOL)):
        for match in pattern.finditer(clean):
            if kind == "tool":
                raw = match[1].strip()
                values = [] if re.match(r"^the\s+", raw, re.I) else TOOL_SPLIT.split(raw)
            else:
                values = [match[1] or match[2]]
            for raw in values:
                value = normalize_fact(raw)
                if not value:
                    continue
                if kind == "tool":
                    words = value.split()
                    if (len(raw.strip()) > 80 or len(words) > 3 or
                            any(word in TOOL_PROSE_WORDS for word in words) or
                            not TOOL_PHRASE.fullmatch(raw.strip())):
                        continue
                claims.append({"kind": kind, "value": value})
    return claims


def verify_facts(target: str, source: str, config: dict | None = None) -> dict:
    """Return the Node-baseline verdict and evidence categories."""
    config = config or {}
    for key in ("allow_metrics", "allow_facts", "forbidden_phrases", "warn_phrases"):
        if config.get(key) is not None and not isinstance(config[key], list):
            raise ValueError(f"{key} must be an array")
    allowed = set(metric_claims(source))
    for entry in config.get("allow_metrics") or []:
        allowed.add(normalize_claim(entry))
        allowed.update(metric_claims(str(entry)))
    invented = [claim for claim in metric_claims(target) if claim not in allowed]
    source_normalized = normalize_fact(strip_markup(source))
    allowed_facts = {normalize_fact(value) for value in config.get("allow_facts") or []}
    unsupported = []
    seen = set()
    for claim in fact_claims(target):
        value = claim["value"]
        escaped = re.escape(value).replace(r"\ ", r"\s+")
        boundary = rf"(?:^|[^\w+#/-]|_){escaped}(?=$|[^\w+#/-]|_)"
        key = (claim["kind"], value)
        if value not in allowed_facts and not re.search(boundary, source_normalized, re.I) and key not in seen:
            unsupported.append(claim)
            seen.add(key)
    clean = strip_markup(target).lower()
    forbidden = [phrase for phrase in config.get("forbidden_phrases") or [] if phrase and str(phrase).lower() in clean]
    warnings = [phrase for phrase in config.get("warn_phrases") or [] if phrase and str(phrase).lower() in clean]
    verdict = "block" if invented or unsupported or forbidden else "warn" if warnings else "pass"
    return {"verdict": verdict, "invented": invented, "unsupportedFacts": unsupported,
            "forbidden": forbidden, "warnings": warnings}


def verify_document(target: str, root: Path) -> dict:
    """Check the rendered document with the current candidate sources."""
    cv = root / "cv.md"
    if not cv.is_file():
        raise ValueError("CV fact gate source is unavailable")
    article = root / "article-digest.md"
    source = cv.read_text() + "\n" + (article.read_text() if article.is_file() else "")
    config_path = root / "config" / "cv-facts.json"
    config = json.loads(config_path.read_text()) if config_path.is_file() else {}
    return verify_facts(target, source, config)


def main() -> int:
    """Check a standalone candidate document with the same publication gate."""
    parser = argparse.ArgumentParser(description="Check candidate document claims against source facts")
    parser.add_argument("document", type=Path)
    parser.add_argument("--source", action="append", type=Path)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sources = args.source or [root / "cv.md", root / "article-digest.md"]
    missing = [str(path) for path in sources if not path.is_file()]
    if missing and (args.source or missing[0] != str(root / "article-digest.md")):
        parser.error("source file unavailable: " + ", ".join(missing))
    config_path = args.config or root / "config" / "cv-facts.json"
    config = json.loads(config_path.read_text()) if config_path.is_file() else {}
    result = verify_facts(args.document.read_text(), "\n".join(path.read_text() for path in sources if path.is_file()), config)
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f"CV fact check {result['verdict']}: {args.document}")
        for category in ("invented", "unsupportedFacts", "forbidden", "warnings"):
            for entry in result[category]:
                print(f"  {category}: {entry}")
    return 1 if result["verdict"] == "block" else 0


if __name__ == "__main__":
    raise SystemExit(main())
