"""Conservatively extract JD skill candidates and compare them with CV evidence."""

from __future__ import annotations

import re

from career_ops.skills import canonicalize, extract_skills


REQUIREMENT_HEADER = re.compile(r"^#{0,6}\s*(?:" + "|".join((
    r"required", r"requirements", r"qualifications", r"must[- ]have", r"preferred", r"nice[- ]to[- ]have",
    r"what\s+we(?:'|’)?\s*re\s+looking\s+for", r"what\s+you(?:(?:'|’)ll|\s+will)?\s+bring",
    r"who\s+you\s+are", r"about\s+you", r"your\s+(?:background|experience|profile)",
    r"you\s+(?:may|might|could)\s+be\s+a\s+good\s+fit", r"you(?:(?:'|’)ll|\s+will)?\s+have",
    r"it(?:'|’)?s\s+important\s+to\s+us\s+that\s+you\s+have",
    r"it\s+would\s+be\s+great\s+if\s+you\s+ha(?:ve|d)", r"ideal\s+candidate",
    r"skills\s+(?:and|&)\s+experience",
)) + r")s?\b.*$", re.I)
NON_REQUIREMENT_HEADER = re.compile(r"^#{0,6}\s*(?:" + "|".join((
    r"you\s+will(?!\s+have)", r"benefits?", r"perks?", r"benefits\s+and\s+perks",
    r"compensation", r"salary", r"pay\s+range", r"what\s+we\s+offer",
    r"why\s+(?:join|work|this\s+role)", r"about\s+(?:us|the\s+company|the\s+team|the\s+role)",
    r"how\s+(?:and\s+where\s+)?we\s+work", r"equal\s+opportunity", r"eeo", r"diversity",
    r"interview\s+process", r"how\s+to\s+apply", r"to\s+apply", r"our\s+(?:stack|process|values|mission)",
)) + r")\b.*$", re.I)
BULLET = re.compile(r"^\s*[-*•]\s*(.+)\r?$")
TOKEN = re.compile(r"\b([A-Z][A-Za-z0-9+.#]{0,29}[A-Za-z0-9+#](?:\.[a-z]{2,4})?)(?!\w)", re.ASCII)
STOPWORDS = frozenset("""
the and for with you your our this that these those must able ability strong excellent proven a an or in of to as is are
bachelor bachelors master masters degree diploma certification certificate experience years year senior junior entry level minimum preferred required
candidates candidate applicants applicant ideal successful knowledge understanding familiarity exposure background skills skill communication team teams work working
deep interest genuine solid comfortable passion passionate track record real bonus plus hands proficiency fluency expertise demonstrated extensive practical good great clear
""".split())
ANY_HEADING = re.compile(r"^#{1,6}\s")


def scan_jd(jd_text: str) -> tuple[list[str], bool]:
    skills: dict[str, None] = {}
    inside = seen = False
    for line in jd_text.split("\n"):
        if NON_REQUIREMENT_HEADER.match(line):
            inside = False
            continue
        if REQUIREMENT_HEADER.match(line):
            inside = seen = True
            continue
        if inside and not line.strip():
            continue
        if inside and ANY_HEADING.match(line):
            inside = False
        bullet = BULLET.match(line)
        if inside and bullet:
            for match in TOKEN.finditer(bullet[1]):
                word = match[1].strip()
                if len(word) > 1 and word.lower() not in STOPWORDS:
                    skills[word] = None
    return list(skills), seen


def diagnose_extraction(jd_text: str, skills: list[str]) -> str | None:
    if skills:
        return None
    if not jd_text.strip():
        return "empty-jd"
    return "no-skill-candidates" if scan_jd(jd_text)[1] else "no-requirements-section"


def skill_mentioned(skill: str, text: str) -> bool:
    return re.search(r"(?<!\w)" + re.escape(skill) + r"(?!\w)", text, re.I | re.ASCII) is not None


def split_skills_section(cv: str) -> tuple[str, str]:
    lines = cv.splitlines()
    heading = next(((index, len(match[1])) for index, line in enumerate(lines)
                    if (match := re.fullmatch(r"(#{1,6})\s*Skills\s*", line, re.I))), None)
    if heading is None:
        return "", cv
    index, level = heading
    start = index + 1
    end = next((line_number for line_number in range(start, len(lines))
                if (match := re.match(r"(#{1,6})\s", lines[line_number])) and len(match[1]) <= level), len(lines))
    section = lines[start:end]
    subheadings = [(offset, match[2].strip().lower()) for offset, line in enumerate(section)
                   if (match := re.match(r"(#{%d})\s+(.+)" % (level + 1), line))]
    if not subheadings or not any(title == "production engineering" for _, title in subheadings):
        return "\n".join(section), "\n".join(lines[:index] + lines[end:])
    named, supported = [], section[:subheadings[0][0]]
    for part, (offset, title) in enumerate(subheadings):
        stop = subheadings[part + 1][0] if part + 1 < len(subheadings) else len(section)
        content = section[offset + 1:stop]
        if title == "production engineering":
            named.extend(content)
        elif title != "in progress":
            supported.extend(content)
    return "\n".join(named), "\n".join(lines[:index] + supported + lines[end:])


def classify_skill_gaps(jd_skills: list[str], cv_text: str) -> dict[str, list[str]]:
    named_text, prose_text = split_skills_section(cv_text)
    named, prose = extract_skills(named_text), extract_skills(prose_text)
    buckets = {"existing": [], "supportedByResume": [], "gap": []}
    for skill in jd_skills:
        canonical = canonicalize(skill)
        known = canonical != skill or bool(extract_skills(skill))
        if known and canonical in named:
            buckets["existing"].append(skill)
        elif known and canonical in prose:
            buckets["supportedByResume"].append(skill)
        elif skill_mentioned(skill, named_text):
            buckets["existing"].append(skill)
        elif skill_mentioned(skill, prose_text):
            buckets["supportedByResume"].append(skill)
        else:
            buckets["gap"].append(skill)
    return buckets
