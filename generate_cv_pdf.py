#!/usr/bin/env python3
"""generate_cv_pdf.py -- JSON CV payload -> guaranteed one-page ATS-safe PDF.

Consumes the SAME structured JSON payload defined in modes/pdf.md's "JSON
Input Schema" (the reusable layer under cv.md that the agent builds for every
tailored CV) and renders it directly to PDF via reportlab's Platypus API --
no HTML, no browser. Replaces the old JSON -> build-cv-html.mjs -> Playwright
chain for the primary CV PDF path (cover letters keep their own Playwright
render, untouched).

Usage:
  python3 generate_cv_pdf.py <input.json> <output.pdf> [--format=letter|a4] [--target-pages=N]

Known limitation: right-to-left languages (lang: "ar") are not supported --
this renderer assumes LTR Latin text laid out per the style spec below.
"""

import argparse
import json
import os
import re
import sys

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer
from pypdf import PdfReader

GREY = HexColor("#444444")
RULE_GREY = HexColor("#999999")
DARK = HexColor("#1a1a2e")

DEFAULT_SECTION_TITLES = {
    "summary": "Professional Summary",
    "competencies": "Core Competencies",
    "experience": "Work Experience",
    "projects": "Projects and Case Studies",
    "education": "Education",
    "certifications": "Certifications",
    "skills": "Skills",
}

# Tightening ladder used when the first pass overflows one page. Spacing and
# margins loosen/tighten together (per the style spec's own framing: "tighten
# spacing/margins and regenerate") -- font size is the last lever, since
# shrinking type hurts readability/ATS-scanability more than tighter spacing.
# Index 0 is the spec's own proven starting values; never touched unless the
# content actually overflows.
TIGHTNESS_LADDER = [
    # (margin_top, margin_bottom, margin_lr, body_size, body_leading, tight_space, loose_space, section_space_before)
    (0.42, 0.40, 0.62, 9.1, 11.6, 2.0, 3.0, 8),
    (0.38, 0.36, 0.56, 8.9, 11.2, 1.5, 2.5, 7),
    (0.34, 0.32, 0.50, 8.6, 10.8, 1.0, 2.0, 6),
    (0.30, 0.28, 0.45, 8.3, 10.3, 0.5, 1.5, 5),
]

CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
PRIVATE_USE_RE = re.compile(r"[-]")


def sanitize_text(text):
    """Convert ATS-hostile Unicode to plain ASCII equivalents.

    Mirrors generate-pdf.mjs's normalizeTextForATS() so both PDF paths make
    the same safety guarantee: no em/en-dashes, smart quotes, zero-width
    characters, or bullet/middot glyphs reach the rendered document.
    """
    if not text:
        return ""
    t = str(text)
    t = t.replace("—", "-").replace("–", "-")
    t = re.sub(r"[“”„‟]", '"', t)
    t = re.sub(r"[‘’‚‛]", "'", t)
    t = t.replace("…", "...")
    t = re.sub(r"[​‌‍⁠﻿]", "", t)
    t = t.replace(" ", " ")
    t = re.sub(r"\s*→\s*", " to ", t)
    t = re.sub(r"\s*←\s*", " from ", t)
    t = re.sub(r"\s*[↑↓]\s*", " ", t)
    t = re.sub(r"\s*·\s*", " | ", t)
    t = re.sub(r"\s*•\s*", " | ", t)
    t = t.replace("€", "EUR ")
    t = t.replace("£", "GBP ")
    return t


def to_markup(text):
    """Sanitize, XML-escape, then re-apply **bold** as reportlab's <b> tag."""
    t = sanitize_text(text)
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"\*\*([^*]+?)\*\*", r"<b>\1</b>", t)
    return t


def bullet_line(text):
    return f"- {to_markup(text)}"


def build_styles(level, accent=None, secondary=None):
    accent = accent or GREY
    secondary = secondary or DARK
    m_top, m_bot, m_lr, body_size, body_leading, tight_sp, loose_sp, section_before = TIGHTNESS_LADDER[level]
    name_size = 16 if level == 0 else max(14, 16 - level)
    contact_size = 8.7 if level == 0 else max(8.0, 8.7 - level * 0.3)
    header_size = 10 if level == 0 else max(9.2, 10 - level * 0.3)
    job_title_size = 9.6 if level == 0 else max(8.8, 9.6 - level * 0.3)
    dates_size = 8.5 if level == 0 else max(7.8, 8.5 - level * 0.25)

    styles = {
        "name": ParagraphStyle("Name", fontName="Helvetica-Bold", fontSize=name_size, leading=name_size + 2, alignment=TA_CENTER, textColor=secondary, spaceAfter=0),
        "headline": ParagraphStyle("Headline", fontName="Helvetica", fontSize=contact_size + 0.2, leading=contact_size + 2.2, alignment=TA_CENTER, textColor=accent, spaceAfter=tight_sp),
        "contact": ParagraphStyle("Contact", fontName="Helvetica", fontSize=contact_size, leading=contact_size + 2, alignment=TA_CENTER, textColor=GREY, spaceAfter=loose_sp),
        "section_header": ParagraphStyle("SectionHeader", fontName="Helvetica-Bold", fontSize=header_size, leading=header_size + 1, alignment=TA_LEFT, textColor=accent, spaceBefore=section_before, spaceAfter=0.5),
        "body": ParagraphStyle("Body", fontName="Helvetica", fontSize=body_size, leading=body_leading, alignment=TA_LEFT, spaceAfter=tight_sp),
        "bullet": ParagraphStyle("Bullet", fontName="Helvetica", fontSize=body_size, leading=body_leading, alignment=TA_LEFT, spaceAfter=tight_sp, leftIndent=10),
        "job_title": ParagraphStyle("JobTitle", fontName="Helvetica-Bold", fontSize=job_title_size, leading=job_title_size + 1.5, alignment=TA_LEFT, textColor=secondary, spaceAfter=0.5),
        "dates_location": ParagraphStyle("DatesLocation", fontName="Helvetica-Oblique", fontSize=dates_size, leading=dates_size + 1.5, alignment=TA_LEFT, textColor=GREY, spaceAfter=tight_sp),
        "entry_space": loose_sp,
    }
    return styles, (m_top, m_bot, m_lr)


_ALLOWED_SCHEMES = ("mailto:", "tel:", "http:", "https:")
_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def sanitize_url(url):
    """Allowlist mailto/tel/http(s), coerce bare emails and domains, XML-escape.

    Mirrors sanitizeUrl() in build-cv-html.mjs so a PDF and an HTML build can
    never disagree about what counts as a link. A bare email becomes mailto:,
    a bare domain becomes https:. An explicit but disallowed scheme
    (javascript:, data:, ...) is rejected outright rather than coerced.
    """
    if not url:
        return ""
    u = str(url).strip()
    if not u:
        return ""
    if not u.lower().startswith(_ALLOWED_SCHEMES):
        if _SCHEME_RE.match(u):
            return ""
        u = ("mailto:" + u) if _EMAIL_RE.match(u) else ("https://" + u)
    return u.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")


def link_markup(display, href):
    """Render display text as a real PDF hyperlink annotation.

    A contact line of plain text is what a peer review flagged: the reader has
    to retype every address. reportlab's <a href> emits a /URI annotation, so
    the PDF is actually clickable. Falls back to plain text when the href is
    unusable, so a malformed value can never break the build.
    """
    text = to_markup(display)
    url = sanitize_url(href)
    if not url:
        return text
    return f'<a href="{url}">{text}</a>'


def build_contact_line(candidate):
    links = []
    plain = []

    phone = candidate.get("phone")
    if phone:
        digits = re.sub(r"[^\d+]", "", str(phone))
        links.append((phone, "tel:" + digits if digits else phone))

    email = candidate.get("email")
    if email:
        links.append((email, email))

    for key in ("linkedin", "github", "portfolio"):
        v = candidate.get(key)
        if isinstance(v, dict):
            display = v.get("display") or v.get("url")
            href = v.get("url") or display
        else:
            display = href = v
        if display:
            links.append((display, href))

    location = candidate.get("location")
    if location:
        plain.append(location)

    pieces = [link_markup(d, h) for d, h in links]
    pieces.extend(to_markup(p) for p in plain)
    return " | ".join(p for p in pieces if p)


def section_heading(story, styles, title, accent=None):
    story.append(Paragraph(to_markup(title), styles["section_header"]))
    story.append(HRFlowable(width="100%", thickness=0.6, color=accent or RULE_GREY, spaceBefore=0.5, spaceAfter=1.5))


def render(data, output_path, page_format, level):
    style_block = data.get("style") or {}
    accent_hex = style_block.get("accent_color")
    secondary_hex = style_block.get("secondary_color")
    try:
        accent = HexColor(accent_hex) if accent_hex else None
    except ValueError:
        accent = None
    try:
        secondary = HexColor(secondary_hex) if secondary_hex else None
    except ValueError:
        secondary = None
    styles, (m_top, m_bot, m_lr) = build_styles(level, accent, secondary)
    pagesize = letter if page_format == "letter" else A4
    candidate = data.get("candidate", {}) or {}
    if candidate.get("photo"):
        print("Note: candidate.photo is set but ignored -- this renderer never emits images, per its ATS-safety design.", file=sys.stderr)

    section_titles = {**DEFAULT_SECTION_TITLES, **(data.get("sections") or {})}
    story = []

    if candidate.get("name"):
        story.append(Paragraph(to_markup(candidate["name"]), styles["name"]))
    if data.get("headline"):
        story.append(Paragraph(to_markup(data["headline"]), styles["headline"]))
    contact_line = build_contact_line(candidate)
    if contact_line:
        story.append(Paragraph(contact_line, styles["contact"]))

    if data.get("summary"):
        section_heading(story, styles, section_titles["summary"], accent)
        story.append(Paragraph(to_markup(data["summary"]), styles["body"]))

    competencies = data.get("competencies") or []
    if competencies:
        section_heading(story, styles, section_titles["competencies"], accent)
        story.append(Paragraph(" | ".join(to_markup(c) for c in competencies), styles["body"]))

    experience = data.get("experience") or []
    if experience:
        section_heading(story, styles, section_titles["experience"], accent)
        for i, job in enumerate(experience):
            header_bits = [b for b in (job.get("role"), job.get("company")) if b]
            story.append(Paragraph(" | ".join(to_markup(b) for b in header_bits), styles["job_title"]))
            dl_bits = [b for b in (job.get("dates"), job.get("location")) if b]
            if dl_bits:
                story.append(Paragraph(" | ".join(to_markup(b) for b in dl_bits), styles["dates_location"]))
            for bullet in job.get("bullets") or []:
                story.append(Paragraph(bullet_line(bullet), styles["bullet"]))
            if i < len(experience) - 1:
                story.append(Spacer(1, styles["entry_space"]))

    projects = data.get("projects") or []
    if projects:
        section_heading(story, styles, section_titles["projects"], accent)
        for i, proj in enumerate(projects):
            header_bits = [b for b in (proj.get("name"), proj.get("badge")) if b]
            if header_bits:
                story.append(Paragraph(" | ".join(to_markup(b) for b in header_bits), styles["job_title"]))
            if proj.get("tech"):
                story.append(Paragraph(to_markup(proj["tech"]), styles["dates_location"]))
            description = proj.get("description")
            if not description and proj.get("bullets"):
                description = " ".join(proj["bullets"])
            if description:
                story.append(Paragraph(to_markup(description), styles["body"]))
            if i < len(projects) - 1:
                story.append(Spacer(1, styles["entry_space"]))

    education = data.get("education") or []
    if education:
        section_heading(story, styles, section_titles["education"], accent)
        for edu in education:
            header_bits = [b for b in (edu.get("title"), edu.get("org")) if b]
            line = " | ".join(to_markup(b) for b in header_bits)
            if edu.get("year"):
                line += f" ({to_markup(edu['year'])})"
            story.append(Paragraph(line, styles["job_title"]))
            if edu.get("description"):
                story.append(Paragraph(to_markup(edu["description"]), styles["body"]))

    certifications = data.get("certifications") or []
    if certifications:
        section_heading(story, styles, section_titles["certifications"], accent)
        for cert in certifications:
            header_bits = [b for b in (cert.get("title"), cert.get("org")) if b]
            line = " | ".join(to_markup(b) for b in header_bits)
            if cert.get("year"):
                line += f" ({to_markup(cert['year'])})"
            story.append(Paragraph(line, styles["body"]))

    skills = data.get("skills") or []
    if skills:
        section_heading(story, styles, section_titles["skills"], accent)
        for sk in skills:
            items = sk.get("items")
            items_text = ", ".join(items) if isinstance(items, list) else (items or "")
            line = f"<b>{to_markup(sk.get('category', ''))}:</b> {to_markup(items_text)}"
            story.append(Paragraph(line, styles["body"]))

    doc = SimpleDocTemplate(
        output_path,
        pagesize=pagesize,
        topMargin=m_top * inch,
        bottomMargin=m_bot * inch,
        leftMargin=m_lr * inch,
        rightMargin=m_lr * inch,
        title=candidate.get("name", "CV"),
    )
    doc.build(story)


def verify_pdf(path, target_pages):
    reader = PdfReader(path)
    page_count = len(reader.pages)
    text = "".join(p.extract_text() or "" for p in reader.pages)
    issues = []
    if "�" in text:
        issues.append("replacement character (U+FFFD) in extracted text")
    if CONTROL_CHAR_RE.search(text):
        issues.append("control character in extracted text")
    if PRIVATE_USE_RE.search(text):
        issues.append("private-use-area glyph in extracted text (symbol-font bullet artifact)")
    if "•" in text:
        issues.append("unicode bullet character (•) in extracted text")
    if "—" in text or "–" in text:
        issues.append("em-dash/en-dash in extracted text")
    return page_count, issues


def main():
    parser = argparse.ArgumentParser(description="Render a CV JSON payload to a one-page ATS-safe PDF.")
    parser.add_argument("input", help="Path to the JSON payload (modes/pdf.md JSON Input Schema)")
    parser.add_argument("output", help="Path to write the PDF")
    parser.add_argument("--format", choices=["letter", "a4"], default="letter")
    parser.add_argument("--target-pages", type=int, default=1)
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    page_format = (data.get("page_format") or args.format or "letter").lower()
    os.makedirs(os.path.dirname(os.path.abspath(args.output)) or ".", exist_ok=True)

    level = 0
    page_count = None
    while level < len(TIGHTNESS_LADDER):
        render(data, args.output, page_format, level)
        page_count, issues = verify_pdf(args.output, args.target_pages)
        if issues:
            print(f"PDF verification failed: {'; '.join(issues)}", file=sys.stderr)
            sys.exit(1)
        if page_count <= args.target_pages:
            break
        print(f"Pass {level}: {page_count} pages (target {args.target_pages}) -- tightening spacing/margins and retrying.", file=sys.stderr)
        level += 1
    else:
        print(
            f"Could not fit content to {args.target_pages} page(s) even at maximum tightness "
            f"({page_count} pages remain). Trim content in the source CV/tailored payload -- "
            "content is never auto-truncated.",
            file=sys.stderr,
        )
        sys.exit(1)

    size = os.path.getsize(args.output)
    print(f"PDF generated: {args.output}")
    print(f"Pages: {page_count}")
    print(f"Size: {size / 1024:.1f} KB")
    print(f"Tightness level used: {level}")
    result = {"outputPath": os.path.abspath(args.output), "pageCount": page_count, "size": size, "tightness": level}
    print(f"##RESULT##{json.dumps(result)}")


if __name__ == "__main__":
    main()
