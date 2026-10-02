"""Expose the retained read-only interview evidence tools through one Python CLI."""

from __future__ import annotations

from career_ops.context import INPUT_ROOT, ROOT

import argparse
import json
from pathlib import Path
import sys
import tempfile

from career_ops.interviews.context import load_context
from career_ops.interviews.evidence import (
    classify_numeric_claims, format_ats, match_stories, provenance_diagnosis, stories,
)
from career_ops.evaluation.preparation import build_preparation_plan
from career_ops.evaluation.skill_gap import classify_skill_gaps, diagnose_extraction, scan_jd
from career_ops.discovery.configured import capture_jd


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


def role_inputs(args: argparse.Namespace) -> dict:
    """Use a retained JD by opportunity ID, or an explicitly supplied local JD."""
    if sum(bool(value) for value in (args.opportunity, args.jd, args.jd_url)) != 1:
        raise ValueError("Supply exactly one opportunity ID, --jd or --jd-url")
    if args.opportunity:
        context = load_context(args.directory, args.opportunity, require_candidate_sources=False)
        scan = context["results"].get("scan")
        if not scan or scan["outcome"] != "jd_report":
            raise ValueError("Opportunity has no retained JD report; evaluate it first")
        jd = scan["artifact"]
        score = context["results"].get("score") or {}
        return {"company": jd["company"], "role": jd["role"], "jd": jd["jd"],
                "report": score.get("artifact", {}).get("report", ""),
                "sources": {"opportunity": args.opportunity, "jd": jd["url"]}}
    if args.jd_url:
        with tempfile.TemporaryDirectory(prefix="career-ops-jd-") as temporary:
            capture = capture_jd(Path(temporary), args.jd_url)
        if not capture:
            raise ValueError("JD URL capture failed or was blocked")
        jd = capture["text"]
    else:
        jd = _read(args.jd, required=True)
    return {"company": getattr(args, "company", None), "role": getattr(args, "role", None),
            "jd": jd,
            "report": _read(args.report, required=True) if getattr(args, "report", None) else "",
            "sources": {"jd": args.jd_url or str(args.jd), "report": str(args.report) if getattr(args, "report", None) else None}}


def plan(args: argparse.Namespace) -> None:
    inputs = role_inputs(args)
    if args.opportunity and (args.company or args.role or args.report):
        raise ValueError("Company, role and report come from the selected opportunity")
    if not inputs["company"] or not inputs["role"]:
        raise ValueError("A supplied JD requires --company and --role")
    result = build_preparation_plan(
        company=inputs["company"], role=inputs["role"], jd=inputs["jd"],
        cv=_read(args.cv), profile=_read(args.profile),
        report=inputs["report"],
        sources={**inputs["sources"], "cv": str(args.cv), "profile": str(args.profile)},
    )
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    print(output, end="")


def jd_gap(args: argparse.Namespace) -> None:
    jd, cv = role_inputs(args)["jd"], _read(args.cv, required=True)
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
    parser = argparse.ArgumentParser(description="Interview evidence tools; start/show/resume/confirm/history manage durable sessions.")
    parser.add_argument("--directory", type=Path, default=ROOT / "data")
    commands = parser.add_subparsers(dest="command", required=True)
    ctx = commands.add_parser("context")
    ctx.add_argument("opportunity_id")
    ctx.add_argument("--db", type=Path)
    ctx.add_argument("--input-root", type=Path, default=INPUT_ROOT)
    ctx.add_argument("--sessions", type=Path)
    matcher = commands.add_parser("match-star")
    matcher.add_argument("question", nargs="*")
    matcher.add_argument("--story-bank", type=Path, default=INPUT_ROOT / "stories/story-bank.md")
    matcher.add_argument("--jd", type=Path)
    matcher.add_argument("--top", default="1")
    matcher.add_argument("--list", action="store_true")
    prov = commands.add_parser("story-provenance")
    prov.add_argument("--story-bank", type=Path, default=INPUT_ROOT / "stories/story-bank.md")
    prov.add_argument("--cv", type=Path, default=INPUT_ROOT / "cv.md")
    prov.add_argument("--summary", action="store_true")
    prep = commands.add_parser("preparation-plan")
    prep.add_argument("opportunity", nargs="?")
    prep.add_argument("--jd", type=Path)
    prep.add_argument("--jd-url")
    prep.add_argument("--company")
    prep.add_argument("--role")
    prep.add_argument("--cv", type=Path, default=INPUT_ROOT / "cv.md")
    prep.add_argument("--profile", type=Path, default=INPUT_ROOT / "profile.yml")
    prep.add_argument("--report", type=Path)
    prep.add_argument("--output", type=Path)
    gap = commands.add_parser("jd-skill-gap")
    gap.add_argument("opportunity", nargs="?")
    gap.add_argument("--jd", type=Path)
    gap.add_argument("--jd-url")
    gap.add_argument("--cv", type=Path, default=INPUT_ROOT / "cv.md")
    gap.add_argument("--summary", action="store_true")
    args = parser.parse_args()
    if args.command == "context" and args.db is None:
        args.db = args.directory / "opportunities.db"
    try:
        {"context": context, "match-star": match, "story-provenance": provenance,
         "preparation-plan": plan, "jd-skill-gap": jd_gap}[args.command](args)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{args.command}: {error}\n")
