#!/usr/bin/env python3
"""generate_cover_letter_pdf.py — JSON cover-letter payload -> PDF via reportlab.

Same lightweight path as generate_cv_pdf.py: no HTML, no browser. Consumes the
JSON schema from modes/cover.md Step 9.
"""

import argparse
import json
import os
import re
import sys

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import HRFlowable, ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

GREY = HexColor("#666666")
ACCENT = HexColor("#1A56A0")
RULE = HexColor("#CCCCCC")

CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
LEADING_BULLET_WORD_RE = re.compile(r"^bullet\s+", re.IGNORECASE)

# Hard-banned GenAI filler (modes/cover.md). Logged at render time; text is not
# auto-rewritten — the agent should fix the payload.
AI_BUZZWORD_RE = re.compile(
    r"\b(leverage|synergy|synergies|seamless(?:ly)?|holistic|robust|cutting-edge|"
    r"spearheaded|championed|orchestrated|passionate|excited|stakeholder alignment|"
    r"actionable insights|move the needle|north star|unique opportunity|perfect fit|"
    r"strong track record|delve|tapestry|landscape|foster|utilize|utilise)\b",
    re.IGNORECASE,
)


def clean(text: str) -> str:
    if not text:
        return ""
    t = CONTROL_CHAR_RE.sub("", str(text))
    # No em dashes in cover letters — comma or full stop instead.
    t = t.replace("—", ", ").replace("–", "-")
    return LEADING_BULLET_WORD_RE.sub("", t.strip())


def contact_parts(candidate: dict) -> list[str]:
    parts = []
    if candidate.get("location"):
        parts.append(clean(candidate["location"]))
    if candidate.get("email"):
        parts.append(clean(candidate["email"]))
    if candidate.get("phone"):
        parts.append(clean(candidate["phone"]))
    if candidate.get("linkedin"):
        parts.append("LinkedIn")
    if candidate.get("github"):
        parts.append("GitHub")
    return parts


def render(payload: dict, output_path: str, page_format: str) -> None:
    candidate = payload.get("candidate") or {}
    letter = payload.get("letter") or {}
    name = clean(candidate.get("name") or "Candidate")

    pagesize = letter if page_format == "letter" else A4
    doc = SimpleDocTemplate(
        output_path,
        pagesize=pagesize,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
    )

    styles = getSampleStyleSheet()
    name_style = ParagraphStyle("Name", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=14, leading=16, spaceAfter=4)
    meta_style = ParagraphStyle("Meta", parent=styles["Normal"], fontName="Helvetica", fontSize=9, textColor=GREY, leading=11, spaceAfter=2)
    title_style = ParagraphStyle("Title", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=11, leading=13, spaceBefore=10, spaceAfter=2)
    body_style = ParagraphStyle("Body", parent=styles["Normal"], fontName="Helvetica", fontSize=10, leading=14, spaceAfter=8, alignment=TA_LEFT)
    bullet_style = ParagraphStyle("Bullet", parent=body_style, leftIndent=12, bulletIndent=0, spaceAfter=4)

    story = []
    story.append(Paragraph(name, name_style))
    contact = " | ".join(contact_parts(candidate))
    if contact:
        story.append(Paragraph(contact, meta_style))
    creds = candidate.get("credentials") or []
    if creds:
        story.append(Paragraph(" | ".join(clean(c) for c in creds), meta_style))

    role = clean(letter.get("role_title") or "Role")
    story.append(Paragraph(f"Cover Letter: {role}", title_style))
    dateline_bits = [clean(letter.get("company") or ""), clean(letter.get("city") or ""), clean(letter.get("date") or "")]
    dateline = "   ".join(b for b in dateline_bits if b)
    if dateline:
        story.append(Paragraph(dateline, meta_style))

    story.append(HRFlowable(width="100%", thickness=0.5, color=RULE, spaceBefore=6, spaceAfter=8))

    if letter.get("greeting"):
        story.append(Paragraph(clean(letter["greeting"]), body_style))

    for key in ("opening", "profile_intro", "problems_section", "closing"):
        if letter.get(key):
            body = clean(letter[key])
            if AI_BUZZWORD_RE.search(body):
                print(f"WARNING: cover letter {key} may sound AI-generated", file=sys.stderr)
            if "—" in letter[key] or "–" in letter[key]:
                print(f"WARNING: cover letter {key} contains an em/en dash — use a comma or period instead", file=sys.stderr)
            story.append(Paragraph(body, body_style))

    achievements = letter.get("achievements") or []
    if achievements:
        items = []
        for ach in achievements:
            lead = clean((ach.get("lead") or "").rstrip(","))
            impact = clean(ach.get("impact") or "")
            text = f"<b>{lead},</b> {impact}" if lead else impact
            if AI_BUZZWORD_RE.search(text):
                print(f"WARNING: cover letter achievement may sound AI-generated: {text[:80]}...", file=sys.stderr)
            items.append(ListItem(Paragraph(text, bullet_style), leftIndent=12))
        # start= must be omitted for bullet lists — start="bullet" prints the literal word.
        story.append(ListFlowable(items, bulletType="bullet", leftIndent=18, spaceAfter=8))

    if letter.get("language_closing"):
        italic = ParagraphStyle("LangClose", parent=body_style, fontName="Helvetica-Oblique")
        story.append(Paragraph(clean(letter["language_closing"]), italic))

    doc.build(story)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a cover-letter JSON payload to PDF.")
    parser.add_argument("input", help="Path to JSON payload")
    parser.add_argument("output", help="Path to write PDF")
    parser.add_argument("--format", choices=["letter", "a4"], default="a4")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        payload = json.load(f)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)) or ".", exist_ok=True)
    page_format = (payload.get("page_format") or args.format or "a4").lower()
    render(payload, args.output, page_format)

    size = os.path.getsize(args.output)
    print(f"PDF generated: {args.output}")
    print(f"Size: {size / 1024:.1f} KB")
    print("##RESULT##" + json.dumps({"outputPath": args.output, "pageCount": 1, "size": size}))


if __name__ == "__main__":
    main()
