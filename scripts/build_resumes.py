#!/usr/bin/env python3

import argparse
import copy
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

NAVY = colors.HexColor("#1F2D3D")
GOLD = colors.HexColor("#B08D2B")
DARK = colors.HexColor("#2A2A2A")
LIGHT = colors.HexColor("#5B5B5B")


@dataclass
class Experience:
    company_line: str
    role: str
    dates: str
    bullets: List[str] = field(default_factory=list)


@dataclass
class Project:
    name: str
    description: str


@dataclass
class ResumeData:
    name: str
    contact_lines: List[str]
    summary: str
    strengths: List[str]
    project: Optional[Project]
    experiences: List[Experience]
    education: List[str]
    tools: List[str]


def compact(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u2014", "-").replace("\u2013", "-")).strip()


def strip_md(text: str) -> str:
    text = text.replace("**", "").replace("__", "")
    text = text.replace("*", "")
    return compact(text)


def parse_project(line: str) -> Project:
    match = re.match(r"\*\*(.+?)\*\*\s*[—-]\s*(.+)", line.strip())
    if match:
      return Project(name=compact(match.group(1)), description=compact(match.group(2)))
    return Project(name="", description=strip_md(line))


def parse_resume(path: Path) -> ResumeData:
    lines = path.read_text(encoding="utf-8").replace("\r", "").split("\n")
    if not lines or not lines[0].startswith("# "):
        raise ValueError(f"{path} does not start with a markdown H1 name")
    name = compact(lines[0][2:])

    i = 1
    contact_lines = []
    while i < len(lines) and lines[i].strip():
        contact_lines.append(compact(lines[i].replace("  ", " ")))
        i += 1

    sections = {}
    current = None
    buffer: List[str] = []
    for line in lines[i:]:
        if line.startswith("## "):
            if current is not None:
                sections[current] = buffer[:]
            current = line[3:].strip().lower()
            buffer = []
        else:
            buffer.append(line)
    if current is not None:
        sections[current] = buffer[:]

    summary = compact(" ".join([line for line in sections.get("professional summary", []) if line.strip()]))
    strengths = [strip_md(line[2:]) for line in sections.get("core strengths", []) if line.strip().startswith("- ")]

    project = None
    project_lines = [line for line in sections.get("selected project", []) if line.strip()]
    if project_lines:
        project = parse_project(project_lines[0])

    experiences: List[Experience] = []
    exp_lines = sections.get("professional experience", [])
    idx = 0
    while idx < len(exp_lines):
        line = exp_lines[idx].strip()
        if not line:
            idx += 1
            continue
        if line.startswith("### "):
            company_line = strip_md(line[4:])
            idx += 1
            role = ""
            dates = ""
            bullets: List[str] = []
            while idx < len(exp_lines) and not exp_lines[idx].strip():
                idx += 1
            if idx < len(exp_lines) and exp_lines[idx].strip().startswith("**"):
                role = strip_md(exp_lines[idx].strip())
                idx += 1
            while idx < len(exp_lines) and not exp_lines[idx].strip():
                idx += 1
            if idx < len(exp_lines) and not exp_lines[idx].strip().startswith("- ") and not exp_lines[idx].strip().startswith("### "):
                dates = compact(exp_lines[idx])
                idx += 1
            while idx < len(exp_lines):
                cur = exp_lines[idx].strip()
                if cur.startswith("### "):
                    break
                if cur.startswith("- "):
                    bullets.append(strip_md(cur[2:]))
                idx += 1
            experiences.append(Experience(company_line=company_line, role=role, dates=dates, bullets=bullets))
        else:
            idx += 1

    education = [strip_md(line[2:]) for line in sections.get("education and credentials", []) if line.strip().startswith("- ")]
    tools = [strip_md(line[2:]) for line in sections.get("technical tools", []) if line.strip().startswith("- ")]

    return ResumeData(
        name=name,
        contact_lines=contact_lines[:2],
        summary=summary,
        strengths=strengths,
        project=project,
        experiences=experiences,
        education=education,
        tools=tools,
    )


def styles(config):
    sample = getSampleStyleSheet()
    return {
        "name": ParagraphStyle(
            "Name",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=config["name_size"],
            leading=config["name_size"] + 1,
            textColor=NAVY,
            alignment=TA_CENTER,
            spaceAfter=3,
        ),
        "contact": ParagraphStyle(
            "Contact",
            parent=sample["Normal"],
            fontName="Helvetica",
            fontSize=config["contact_size"],
            leading=config["contact_leading"],
            textColor=DARK,
            alignment=TA_CENTER,
            spaceAfter=0,
        ),
        "section": ParagraphStyle(
            "Section",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=config["section_size"],
            leading=config["section_size"] + 1,
            textColor=NAVY,
            spaceBefore=config["section_before"],
            spaceAfter=2,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=sample["Normal"],
            fontName="Helvetica",
            fontSize=config["body_size"],
            leading=config["body_leading"],
            textColor=DARK,
            spaceAfter=0,
        ),
        "muted": ParagraphStyle(
            "Muted",
            parent=sample["Normal"],
            fontName="Helvetica",
            fontSize=config["body_size"],
            leading=config["body_leading"],
            textColor=LIGHT,
            alignment=TA_RIGHT,
        ),
        "company": ParagraphStyle(
            "Company",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=config["body_size"] + 0.2,
            leading=config["body_leading"],
            textColor=NAVY,
        ),
        "role": ParagraphStyle(
            "Role",
            parent=sample["Normal"],
            fontName="Helvetica-BoldOblique",
            fontSize=config["body_size"],
            leading=config["body_leading"],
            textColor=DARK,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=sample["Normal"],
            fontName="Helvetica",
            fontSize=config["body_size"],
            leading=config["bullet_leading"],
            textColor=DARK,
        ),
        "bullet_mark": ParagraphStyle(
            "BulletMark",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=config["body_size"] + 0.2,
            leading=config["bullet_leading"],
            textColor=GOLD,
            alignment=TA_RIGHT,
        ),
        "strength": ParagraphStyle(
            "Strength",
            parent=sample["Normal"],
            fontName="Helvetica",
            fontSize=config["body_size"],
            leading=config["bullet_leading"],
            textColor=DARK,
        ),
        "project_name": ParagraphStyle(
            "ProjectName",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=config["body_size"],
            leading=config["body_leading"],
            textColor=DARK,
        ),
    }


def build_bullet(text: str, s) -> Table:
    row = [
        Paragraph("•", s["bullet_mark"]),
        Paragraph(escape_html(text), s["bullet"]),
    ]
    table = Table([row], colWidths=[0.12 * inch, 6.85 * inch], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return table


def escape_html(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def add_section(title: str, story: list, s, config):
    story.append(Paragraph(title.upper(), s["section"]))
    story.append(HRFlowable(width="100%", thickness=0.8, color=GOLD, spaceAfter=config["rule_after"], spaceBefore=0))


def split_strengths(items: List[str]) -> List[List[str]]:
    return [[item] for item in items]


def build_story(data: ResumeData, config) -> list:
    s = styles(config)
    story = []

    story.append(Paragraph(escape_html(data.name), s["name"]))
    for line in data.contact_lines:
        story.append(Paragraph(escape_html(line), s["contact"]))
    story.append(Spacer(1, 3))
    story.append(HRFlowable(width="100%", thickness=1.0, color=NAVY, spaceAfter=config["header_rule_after"], spaceBefore=0))

    add_section("Professional Summary", story, s, config)
    story.append(Paragraph(escape_html(data.summary), s["body"]))

    add_section("Core Strengths", story, s, config)
    strength_rows = split_strengths(data.strengths)
    strength_cells = []
    for row in strength_rows:
        cell_row = []
        for item in row:
            if item:
                cell_row.append(Paragraph(f'<font color="{GOLD.hexval()}">•</font> {escape_html(item)}', s["strength"]))
            else:
                cell_row.append(Paragraph("", s["strength"]))
        strength_cells.append(cell_row)
    strength_table = Table(strength_cells, colWidths=[6.7 * inch], hAlign="LEFT")
    strength_table.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(strength_table)

    if data.project:
        add_section("Selected Project", story, s, config)
        project_text = f'<b>{escape_html(data.project.name)}</b> - {escape_html(data.project.description)}' if data.project.name else escape_html(data.project.description)
        story.append(Paragraph(project_text, s["body"]))

    add_section("Professional Experience", story, s, config)
    for exp in data.experiences:
        company = Paragraph(escape_html(exp.company_line), s["company"])
        story.append(company)
        role_table = Table(
            [[Paragraph(escape_html(exp.role), s["role"]), Paragraph(escape_html(exp.dates), s["muted"])]],
            colWidths=[4.95 * inch, 2.0 * inch],
            hAlign="LEFT",
        )
        role_table.setStyle(
            TableStyle(
                [
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        story.append(role_table)
        for bullet in exp.bullets:
            story.append(build_bullet(bullet, s))
        story.append(Spacer(1, config["role_gap"]))

    add_section("Education and Credentials", story, s, config)
    for item in data.education:
        story.append(build_bullet(item, s))

    add_section("Technical Tools", story, s, config)
    for item in data.tools:
        story.append(build_bullet(item, s))

    return story


def count_pages(pdf_path: Path) -> int:
    return len(PdfReader(str(pdf_path)).pages)


def render(data: ResumeData, output_pdf: Path, config) -> int:
    doc = SimpleDocTemplate(
        str(output_pdf),
        pagesize=letter,
        leftMargin=config["margin"],
        rightMargin=config["margin"],
        topMargin=config["top_margin"],
        bottomMargin=config["bottom_margin"],
    )
    story = build_story(data, config)
    doc.build(story)
    return count_pages(output_pdf)


def style_variants():
    return [
        {
            "name_size": 17.8,
            "contact_size": 8.8,
            "contact_leading": 9.8,
            "section_size": 9.8,
            "section_before": 4,
            "rule_after": 2,
            "header_rule_after": 4,
            "body_size": 8.8,
            "body_leading": 10.8,
            "bullet_leading": 10.5,
            "margin": 0.42 * inch,
            "top_margin": 0.38 * inch,
            "bottom_margin": 0.34 * inch,
            "role_gap": 3,
        },
        {
            "name_size": 17.2,
            "contact_size": 8.6,
            "contact_leading": 9.4,
            "section_size": 9.6,
            "section_before": 3,
            "rule_after": 1,
            "header_rule_after": 3,
            "body_size": 8.6,
            "body_leading": 10.4,
            "bullet_leading": 10.1,
            "margin": 0.36 * inch,
            "top_margin": 0.34 * inch,
            "bottom_margin": 0.30 * inch,
            "role_gap": 2,
        },
        {
            "name_size": 17.0,
            "contact_size": 8.4,
            "contact_leading": 9.2,
            "section_size": 9.4,
            "section_before": 2,
            "rule_after": 1,
            "header_rule_after": 2,
            "body_size": 8.4,
            "body_leading": 10.1,
            "bullet_leading": 9.8,
            "margin": 0.32 * inch,
            "top_margin": 0.30 * inch,
            "bottom_margin": 0.28 * inch,
            "role_gap": 1,
        },
    ]


def trim_core_strengths(data: ResumeData, changes: list) -> bool:
    for idx, item in enumerate(list(data.strengths)):
        if len(item) > 58 and " with " in item:
            data.strengths[idx] = item.replace(" with ", ": ", 1)
            changes.append({"type": "reword_strength", "index": idx, "from": item, "to": data.strengths[idx]})
            return True
    return False


def shorten_project(data: ResumeData, changes: list) -> bool:
    if not data.project:
        return False
    desc = data.project.description
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", desc) if s.strip()]
    if len(desc) > 145 or len(sentences) > 1:
        shortened = desc
        if sentences:
            shortened = " ".join(sentences[:1])
        if len(shortened) > 140:
            shortened = shortened[:137].rsplit(" ", 1)[0] + "..."
        if shortened != desc:
            data.project.description = shortened
            changes.append({"type": "shorten_project", "from": desc, "to": shortened})
            return True
    return False


def drop_redundant_bullet(data: ResumeData, changes: list) -> bool:
    candidates = [(idx, len(exp.bullets)) for idx, exp in enumerate(data.experiences) if len(exp.bullets) > 0]
    if not candidates:
        return False
    idx = sorted(candidates, key=lambda item: (-item[1], item[0]))[0][0]
    exp = data.experiences[idx]
    removed = exp.bullets.pop()
    changes.append({"type": "drop_bullet", "experience": exp.company_line, "removed": removed})
    return True


def cap_roles(data: ResumeData, changes: list) -> bool:
    changed = False
    for idx, exp in enumerate(data.experiences):
        cap = 3 if idx < 3 else 2
        while len(exp.bullets) > cap:
            removed = exp.bullets.pop()
            changes.append({"type": "cap_role_bullet", "experience": exp.company_line, "removed": removed, "cap": cap})
            changed = True
    return changed


def build_with_fit(data: ResumeData, output_pdf: Path):
    changes = []
    material = False
    best_data = copy.deepcopy(data)
    with tempfile.TemporaryDirectory(prefix="resume-fit-") as tmpdir:
        tmp = Path(tmpdir) / output_pdf.name

        for cfg in style_variants():
            pages = render(copy.deepcopy(best_data), tmp, cfg)
            if pages == 1:
                render(best_data, output_pdf, cfg)
                return {"pages": 1, "changes": changes, "material_changes": material, "config": cfg}

        working = copy.deepcopy(best_data)
        trim_steps = [drop_redundant_bullet, cap_roles, shorten_project, trim_core_strengths]
        final_cfg = style_variants()[-1]
        for step in trim_steps:
            while step(working, changes):
                pages = render(copy.deepcopy(working), tmp, final_cfg)
                if pages == 1:
                    render(working, output_pdf, final_cfg)
                    material = material or any(c["type"] in {"drop_bullet", "cap_role_bullet"} for c in changes)
                    return {"pages": 1, "changes": changes, "material_changes": material, "config": final_cfg}
                material = material or any(c["type"] in {"drop_bullet", "cap_role_bullet"} for c in changes)

        pages = render(working, output_pdf, final_cfg)
        if pages != 1:
            raise RuntimeError("Could not fit resume to one page without exceeding configured trim rules")
        return {"pages": 1, "changes": changes, "material_changes": material, "config": final_cfg}


def render_previews(pdf_path: Path, preview_dir: Path) -> List[str]:
    preview_dir.mkdir(parents=True, exist_ok=True)
    primary = preview_dir / f"{pdf_path.stem}.png"
    cmd = ["sips", "-s", "format", "png", str(pdf_path), "--out", str(primary)]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    stems = [primary.name, pdf_path.name + ".png"]
    found = []
    for stem in stems:
        candidate = preview_dir / stem
        if candidate.exists():
            found.append(str(candidate))
    if not found:
        for child in preview_dir.iterdir():
            if child.suffix.lower() == ".png" and child.stem.startswith(pdf_path.stem):
                found.append(str(child))
    return sorted(found)


def main():
    parser = argparse.ArgumentParser(description="Build a branded one-page resume PDF from a markdown resume file.")
    parser.add_argument("input_md")
    parser.add_argument("output_pdf")
    parser.add_argument("--meta-out")
    parser.add_argument("--preview-dir")
    args = parser.parse_args()

    input_md = Path(args.input_md)
    output_pdf = Path(args.output_pdf)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    data = parse_resume(input_md)
    result = build_with_fit(data, output_pdf)
    previews = []
    if args.preview_dir:
        previews = render_previews(output_pdf, Path(args.preview_dir))

    meta = {
        "input_md": str(input_md),
        "output_pdf": str(output_pdf),
        "page_count": result["pages"],
        "changes_vs_md": result["changes"],
        "material_changes": result["material_changes"],
        "preview_images": previews,
    }
    if args.meta_out:
        Path(args.meta_out).write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
