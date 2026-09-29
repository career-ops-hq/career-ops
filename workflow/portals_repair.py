"""Apply verified ATS slug repairs without reformatting the user portal file."""

from __future__ import annotations

import argparse
from datetime import date
import os
from pathlib import Path
import re

import yaml

from workflow.portal_health import verify_ats_company


NAME_LINE = re.compile(r"^([ \t]*)-\s*name:\s*(.+?)\s*$")
SLUG = re.compile(r"^[A-Za-z0-9._-]+$")
BLOCK_SCALAR = re.compile(r"^[|>][-+]?\d*\s*(#.*)?$")
DOUBLE_QUOTED = re.compile(r'^"((?:[^"\\]|\\.)*)"[ \t]*(#.*)?$')
SINGLE_QUOTED = re.compile(r"^'((?:[^']|'')*)'[ \t]*(#.*)?$")


def _blocks(lines: list[str]) -> dict[str, tuple[int, int, str]]:
    found = {}
    active = None
    for index, line in enumerate(lines):
        match = NAME_LINE.fullmatch(line)
        if not match:
            continue
        if active:
            found[active[0]] = (active[1], index, active[2])
        active = (match[2].strip(), index, match[1])
    if active:
        found[active[0]] = (active[1], len(lines), active[2])
    return found


def _field(lines: list[str], indent: str, name: str) -> int | None:
    pattern = re.compile(rf"^{re.escape(indent)}{re.escape(name)}:\s*(.*)$")
    return next((index for index, line in enumerate(lines) if pattern.fullmatch(line)), None)


def _urls(suggestion: dict) -> tuple[str, str | None]:
    ats, slug = suggestion.get("ats"), suggestion.get("slug")
    if ats not in {"greenhouse", "ashby", "lever"} or not isinstance(slug, str) or not SLUG.fullmatch(slug):
        raise ValueError("Verified slug repair requires a supported ATS and safe slug")
    if ats == "greenhouse":
        return (f"https://job-boards.greenhouse.io/{slug}",
                f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
    if ats == "ashby":
        return f"https://jobs.ashbyhq.com/{slug}", None
    return f"https://jobs.{'eu.' if suggestion.get('eu') else ''}lever.co/{slug}", None


def _quote(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _append_note(lines: list[str], index: int, indent: str, note: str) -> None:
    after = lines[index].split("notes:", 1)[1].strip()
    if BLOCK_SCALAR.fullmatch(after):
        content_indent = None
        insert_at = index + 1
        for offset in range(index + 1, len(lines)):
            line = lines[offset]
            if not line.strip():
                insert_at = offset + 1
                continue
            line_indent = re.match(r"^[ \t]*", line)[0]
            if len(line_indent) <= len(indent):
                break
            content_indent = line_indent
            insert_at = offset + 1
        lines.insert(insert_at, f"{content_indent or indent + '  '}{note}")
        return
    double = DOUBLE_QUOTED.fullmatch(after)
    single = None if double else SINGLE_QUOTED.fullmatch(after)
    if double:
        inner, comment = double[1], double[2] or ""
    elif single:
        inner, comment = _quote(single[1].replace("''", "'")), single[2] or ""
    else:
        hash_index = next((offset for offset, char in enumerate(after)
                           if char == "#" and (offset == 0 or after[offset - 1].isspace())), None)
        inner = _quote(after[:hash_index].rstrip() if hash_index is not None else after)
        comment = after[hash_index:] if hash_index is not None else ""
    lines[index] = f'{indent}notes: "{inner} {note}"' + (f" {comment}" if comment else "")


def _patch_block(lines: list[str], indent: str, suggestion: dict, old_ats: str,
                 day: str) -> tuple[list[str], str, str]:
    field_indent = indent + "  "
    careers_url, api = _urls(suggestion)
    careers_index = _field(lines, field_indent, "careers_url")
    previous = lines[careers_index].split(":", 1)[1].strip() if careers_index is not None else ""
    if careers_index is None:
        careers_index = 1
        lines.insert(careers_index, f"{field_indent}careers_url: {careers_url}")
    else:
        lines[careers_index] = f"{field_indent}careers_url: {careers_url}"
    insert_after = careers_index
    api_index = _field(lines, field_indent, "api")
    if api:
        if api_index is None:
            lines.insert(insert_after + 1, f"{field_indent}api: {api}")
            insert_after += 1
        else:
            lines[api_index] = f"{field_indent}api: {api}"
            insert_after = max(insert_after, api_index)
    elif api_index is not None:
        lines.pop(api_index)
        if api_index < insert_after:
            insert_after -= 1
    note = f"(slug migrated {old_ats}->{suggestion['ats']} {day}, verify-portals)"
    notes_index = _field(lines, field_indent, "notes")
    if notes_index is None:
        lines.insert(insert_after + 1, f'{field_indent}notes: "{note}"')
    else:
        _append_note(lines, notes_index, field_indent, note)
    return lines, previous, careers_url


def compute_fixes(raw_text: str, results: list[dict], *, day: str | None = None) -> dict:
    """Return exact text and ordered diff rows for verified missing-board suggestions."""
    day = day or date.today().isoformat()
    lines = raw_text.split("\n")
    blocks = _blocks(lines)
    pending = [(result, blocks[result["name"]]) for result in results
               if result.get("status") == "missing" and result.get("suggested")
               and result.get("name") in blocks]
    pending.sort(key=lambda item: item[1][0], reverse=True)
    by_name = {}
    for result, (start, end, indent) in pending:
        section, old, new = _patch_block(lines[start:end], indent, result["suggested"],
                                         result.get("ats") or "unknown", day)
        lines[start:end] = section
        by_name[result["name"]] = {"name": result["name"], "oldAts": result.get("ats") or "unknown",
                                   "newAts": result["suggested"]["ats"], "careersUrlOld": old,
                                   "careersUrlNew": new}
    return {"text": "\n".join(lines),
            "fixes": [by_name[result["name"]] for result in results if result.get("name") in by_name]}


def repair_file(path: Path, *, apply: bool = False, verify=verify_ats_company) -> list[dict]:
    """Probe tracked ATS boards and write only verified repairs on explicit request."""
    path = path.resolve()
    if not path.exists():
        return []
    original = path.read_text()
    config = yaml.safe_load(original)
    companies = config.get("tracked_companies", []) if isinstance(config, dict) else []
    if not isinstance(companies, list):
        raise ValueError("tracked_companies must be a list")
    results = [row for company in companies if isinstance(company, dict) and company.get("enabled") is not False
               if (row := verify(company)) is not None]
    changed = compute_fixes(original, results)
    if apply and changed["fixes"]:
        if path.read_text() != original:
            raise RuntimeError("portals file changed during verification; retry")
        temporary = path.with_name(path.name + f".tmp-{os.getpid()}")
        try:
            temporary.write_text(changed["text"])
            temporary.chmod(path.stat().st_mode & 0o777)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return changed["fixes"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify and repair tracked ATS board URLs")
    parser.add_argument("--file", default=os.environ.get("CAREER_OPS_PORTALS", "portals.yml"))
    parser.add_argument("--fix", "--apply", dest="apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    arguments = parser.parse_args(argv)
    if not arguments.file:
        parser.error("--file requires a value")
    file_path = Path(arguments.file)
    if not file_path.exists():
        print(f"No portals file at {file_path}; nothing to fix.")
        return 0
    if not file_path.is_file():
        parser.error("--file must name a regular file")
    fixes = repair_file(file_path, apply=arguments.apply and not arguments.dry_run)
    if not fixes:
        print("No resolvable slug fixes found — nothing to do.")
        return 0
    for fix in fixes:
        print(f"{fix['name']}: {fix['oldAts']} -> {fix['newAts']}\n"
              f"  - {fix['careersUrlOld']}\n  + {fix['careersUrlNew']}")
    if not arguments.apply or arguments.dry_run:
        print("Run with --fix to write these changes to the portals file.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
