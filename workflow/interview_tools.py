"""Expose the retained read-only interview evidence tools through one Python CLI."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from workflow.interview_context import load_context
from workflow.interview_evidence import (
    classify_numeric_claims, format_ats, match_stories, provenance_diagnosis, stories,
)
from workflow.interview_plan import build_preparation_plan
from workflow.jd_skill_gap import classify_skill_gaps, diagnose_extraction, scan_jd


DIAGNOSES = {
    "empty-jd": "The JD file is empty, so nothing was checked.",
    "no-requirements-section": 'No requirements section was recognized in this JD, so no text was scanned for skills. This is not the same as "no gaps": the check did not run. Read the JD yourself before drafting.',
    "no-skill-candidates": 'A requirements section was found and scanned, but no skill candidates were extracted from it. This is not the same as "no gaps": nothing was classified. Read the JD yourself before drafting.',
    "no-stories-parsed": "story-bank.md exists but no `### ` story blocks were parsed from it.",
    "no-numeric-claims-found": 'Stories were parsed but no numeric claims matched the covered patterns. This is not the same as "no risk" — see the pattern-coverage note in this script\'s header for what is not scanned.',
}


def _diagnosis(reason: str | None, *, story_bank: Path | None = None, cv: Path | None = None) -> dict | None:
    if not reason:
        return None
    if reason == "no-story-bank":
        message = f"{story_bank} not found — nothing was checked."
    elif reason == "no-cv":
        message = f"{cv} not found — claims cannot be checked against a primary source."
    else:
        message = DIAGNOSES[reason]
    return {"reason": reason, "message": message}


def _json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _read(path: Path, *, required: bool = False) -> str:
    if required or path.is_file():
        return path.read_text()
    return ""


def context(args: argparse.Namespace) -> None:
    value = load_context(args.db.parent, args.opportunity_id, input_root=args.input_root,
                         db_path=args.db, sessions_dir=args.sessions, require_candidate_sources=False)
    opportunity = value["opportunity"]
    application = value["application"]
    _json({
        "opportunity": {
            key: opportunity.get(key) for key in ("id", "url", "company", "role", "source", "state")
        } | {
            "applicationState": opportunity.get("application_state"),
            "evidence": [{"source": item["source"], "payload": item["payload"]}
                         for item in opportunity["evidence"]],
        },
        "evaluation": value["evaluation"], "artifacts": value["artifacts"],
        "application": None if application is None else {
            "status": application["status"],
            "events": [{
                "fromStatus": event.get("from_status"), "toStatus": event.get("to_status"),
                "source": event.get("source"), "payload": event["payload"],
                "createdAt": event.get("created_at"),
            } for event in application.get("events", [])],
        },
        "candidateFacts": ["cv.md", "article-digest.md", "config/profile.yml", "modes/_profile.md"],
        "sessions": [Path(item["path"]).name for item in value["sessions"]],
    })


def match(args: argparse.Namespace) -> None:
    if not args.story_bank.is_file():
        raise ValueError(f"Story bank not found: {args.story_bank}")
    bank = args.story_bank.read_text()
    parsed = stories(bank)
    if not parsed:
        raise ValueError("No stories found in story bank")
    if args.list:
        print(f"\nStory Bank — {len(parsed)} stories\n{'─' * 40}")
        for number, story in enumerate(parsed, 1):
            print(f"{number}. {story['title']}{' [' + story['theme'] + ']' if story['theme'] else ''}")
            if story["tags"]:
                print(f"   Tags: {', '.join(story['tags'])}")
            if story["source"]:
                print(f"   {story['source']}")
            print()
        return
    question = " ".join(args.question).strip()
    if not question:
        raise ValueError("A behavioural question is required")
    jd = _read(args.jd, required=True) if args.jd else ""
    try:
        top = int(args.top)
    except ValueError:
        top = 1
    ranked = match_stories(bank, question, jd, top if top > 0 else 1)
    print(f"\nATS Behavioural Question Matcher\n{'─' * 40}\nQuestion: \"{question}\"")
    if args.jd:
        print(f"JD:       {args.jd}")
    print(f"Stories:  {len(parsed)} in bank\n")
    for number, item in enumerate(ranked, 1):
        print(f"{'─' * 40}\nMatch {number} of {len(ranked)} (score: {item['score']})\n")
        print(format_ats(item["story"]) + "\n")
    if ranked and ranked[0]["score"] == 0:
        print("⚠️  No strong match found. Consider adding a story to the story bank for this competency.")


def provenance(args: argparse.Namespace) -> None:
    bank, cv = _read(args.story_bank), _read(args.cv)
    buckets = classify_numeric_claims(bank, cv)
    claim_count = sum(map(len, buckets.values()))
    diagnosis = _diagnosis(provenance_diagnosis(
        args.story_bank.is_file(), args.cv.is_file(), len(stories(bank, require_action=False)), claim_count,
    ), story_bank=args.story_bank, cv=args.cv)
    if not args.summary:
        _json({**buckets, "lowConfidence": diagnosis})
        return
    print(f"\nStory Provenance Check\n{'─' * 40}\nStory bank: {args.story_bank}{'' if args.story_bank.is_file() else ' (not found)'}"
          f"\nCV:         {args.cv}{'' if args.cv.is_file() else ' (not found)'}\nClaims checked: {claim_count}\n")
    for key, label, symbol in (
        ("existing", "existing (traces to cv.md or an explicit marker)", "✅"),
        ("supportedByResume", "supportedByResume (cv.md supports the fact, not this precision)", "📝"),
        ("derivedUnverified", "derived-unverified (only in story-bank.md, unconfirmed)", "⚠️"),
        ("userCannotConfirm", "user-cannot-confirm (explicitly marked, durable)", "🔒"),
    ):
        print(f"  {symbol} {label} ({len(buckets[key])})")
        for item in buckets[key]:
            print(f"     - [{item['story']}] \"{item['claim']}\" ({item['pattern']})"
                  + (f" — {item['reason']}" if item.get("reason") else ""))
    if diagnosis:
        print(f"\n  🚨 LOW CONFIDENCE: this is not a clean result.\n     {diagnosis['message']}\n     (reason: {diagnosis['reason']})")


def plan(args: argparse.Namespace) -> None:
    result = build_preparation_plan(
        company=args.company, role=args.role, jd_text=_read(args.jd, required=True),
        cv_text=_read(args.cv), profile_text=_read(args.profile),
        report_text=_read(args.report, required=True) if args.report else "",
        sources={"jd": str(args.jd), "cv": str(args.cv), "profile": str(args.profile),
                 "report": str(args.report) if args.report else None},
    )
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    print(output, end="")


def jd_gap(args: argparse.Namespace) -> None:
    jd, cv = _read(args.jd, required=True), _read(args.cv, required=True)
    skills, _ = scan_jd(jd)
    buckets = classify_skill_gaps(skills, cv)
    diagnosis = _diagnosis(diagnose_extraction(jd, skills))
    if not args.summary:
        _json({**buckets, "lowConfidence": diagnosis})
        return
    print(f"\nJD Skill-Gap Check\n{'─' * 40}\nJD skills found: {len(skills)}")
    for key, label in (
        ("existing", "  ✅ Already in Skills section:   "),
        ("supportedByResume", "  📝 Mentioned in resume prose:   "),
        ("gap", "  ⚠️  Real gaps (not found anywhere): "),
    ):
        print(f"{label}{', '.join(buckets[key]) or '(none)'}")
    if diagnosis:
        print(f"\n  🚨 LOW CONFIDENCE: this is not a clean result.\n     {diagnosis['message']}\n     (reason: {diagnosis['reason']})")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    ctx = commands.add_parser("context")
    ctx.add_argument("opportunity_id")
    ctx.add_argument("--db", required=True, type=Path)
    ctx.add_argument("--input-root", type=Path, default=Path.cwd())
    ctx.add_argument("--sessions", type=Path)
    matcher = commands.add_parser("match-star")
    matcher.add_argument("question", nargs="*")
    matcher.add_argument("--story-bank", type=Path, default=Path("interview-prep/story-bank.md"))
    matcher.add_argument("--jd", type=Path)
    matcher.add_argument("--top", default="1")
    matcher.add_argument("--list", action="store_true")
    prov = commands.add_parser("story-provenance")
    prov.add_argument("--story-bank", type=Path, default=Path("interview-prep/story-bank.md"))
    prov.add_argument("--cv", type=Path, default=Path("cv.md"))
    prov.add_argument("--summary", action="store_true")
    prep = commands.add_parser("preparation-plan")
    prep.add_argument("--jd", type=Path, required=True)
    prep.add_argument("--company", required=True)
    prep.add_argument("--role", required=True)
    prep.add_argument("--cv", type=Path, default=Path("cv.md"))
    prep.add_argument("--profile", type=Path, default=Path("config/profile.yml"))
    prep.add_argument("--report", type=Path)
    prep.add_argument("--output", type=Path)
    gap = commands.add_parser("jd-skill-gap")
    gap.add_argument("jd", type=Path)
    gap.add_argument("--cv", type=Path, default=Path("cv.md"))
    gap.add_argument("--summary", action="store_true")
    args = parser.parse_args()
    try:
        {"context": context, "match-star": match, "story-provenance": provenance,
         "preparation-plan": plan, "jd-skill-gap": jd_gap}[args.command](args)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{args.command}: {error}\n")


if __name__ == "__main__":
    main()
