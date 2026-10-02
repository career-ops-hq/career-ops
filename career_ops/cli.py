"""Parse user commands and route them to business operations."""

from __future__ import annotations

import argparse
from importlib import import_module
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from career_ops.discovery.board_resolution import VENDOR_ORDER, format_summary, resolve_boards
from career_ops.discovery.reverse_runner import discover_global
from career_ops.discovery.configured import capture_jd, discover
from career_ops.applications.application_lifecycle import ApplicationStore, mutate as mutate_application
from career_ops.applications.replies import import_reply, view_reply, confirm_reply, parse_pasted
from career_ops.insights.stats import stats_view
from career_ops.insights.reposts import repost_view
from career_ops.insights.company import company_view, company_signals
from career_ops.insights.salary import salary_view, stated_view
from career_ops.applications.salary_observations import record_salary
from career_ops.insights.upskill import targeted_skill_gap, upskill_view
from career_ops.evaluation.preparation import build_preparation_plan
from career_ops.context import INPUT_ROOT, ROOT
from career_ops.db import BusinessStore
from career_ops.tasks import cancel_task, cron_score, list_views, resume_task, run_task, scan_discovered, start_and_run, view


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser()
    cli.add_argument("--directory", type=Path, default=ROOT / "data")
    commands = cli.add_subparsers(dest="command", required=True)
    start = commands.add_parser("start")
    start.add_argument("module", choices=("scan", "score", "apply"))
    start.add_argument("opportunity")
    start.add_argument("input")
    start.add_argument("--crash-at", choices=("before_publish", "publish"), help=argparse.SUPPRESS)
    start.add_argument("--re-evaluate", action="store_true")
    run = commands.add_parser("run")
    run.add_argument("task_id")
    run.add_argument("--state", help=argparse.SUPPRESS)
    run.add_argument("--crash-at", choices=("before_publish", "publish"), help=argparse.SUPPRESS)
    cron = commands.add_parser("cron-score")
    discover_command = commands.add_parser("discover")
    discover_command.add_argument("--company")
    discover_command.add_argument("--verify", action="store_true")
    discover_command.add_argument("--headed-fallback", action="store_true")
    discover_command.add_argument("--throttle", nargs="?", type=int, const=5000)
    discover_command.add_argument("--rediscover-404", action="store_true")
    discover_command.add_argument("--posted-after")
    discover_command.add_argument("--posted-before")
    discover_command.add_argument("--since", type=float)
    discover_command.add_argument("--include-blacklisted", action="store_true")
    discover_command.add_argument("--dry-run", action="store_true")
    discover_command.add_argument("--resume", action="store_true")
    global_command = commands.add_parser("global")
    global_command.add_argument("--ats")
    global_command.add_argument("--seeds")
    global_command.add_argument("--liveness", action="store_true")
    global_command.add_argument("--md-out")
    global_command.add_argument("--verbose", action="store_true")
    global_command.add_argument("--since", type=float, default=3)
    global_command.add_argument("--limit", type=int)
    global_command.add_argument("--include-undated", action="store_true")
    global_command.add_argument("--include-blacklisted", action="store_true")
    global_command.add_argument("--shuffle", action="store_true")
    global_command.add_argument("--resume", action="store_true")
    global_command.add_argument("--dry-run", action="store_true")
    global_command.add_argument("--json", action="store_true")
    resolve_command = commands.add_parser("resolve-company", aliases=["resolve"])
    resolve_command.add_argument("names", nargs="*")
    resolve_command.add_argument("--in", dest="input_path", type=Path)
    resolve_command.add_argument("--vendors")
    resolve_command.add_argument("--write", action="store_true")
    resolve_command.add_argument("--dry-run", action="store_true")
    resolve_command.add_argument("--summary", action="store_true")
    scan_discovered_command = commands.add_parser("scan-discovered")
    scan_discovered_command.add_argument("opportunity")
    scan_discovered_command.add_argument("--re-evaluate", action="store_true")
    resume = commands.add_parser("resume")
    resume.add_argument("task_id")
    resume.add_argument("--input")
    resume.add_argument("--feedback")
    resume.add_argument("--decision", choices=("confirm", "defer", "accept-jd-change"))
    resume.add_argument("--crash-at", choices=("before_publish", "publish"), help=argparse.SUPPRESS)
    show = commands.add_parser("show")
    show.add_argument("identifier")
    commands.add_parser("list")
    commands.add_parser("scores")
    commands.add_parser("decisions")
    cancel = commands.add_parser("cancel")
    cancel.add_argument("task_id")
    application = commands.add_parser("application")
    application.add_argument("action", choices=("submit", "transition", "activity", "outcome", "schedule", "retire", "reopen", "view", "followups"))
    application.add_argument("opportunity", nargs="?")
    application.add_argument("value", nargs="?")
    application.add_argument("--source")
    application.add_argument("--confirmed", action="store_true")
    application.add_argument("--payload", default="{}")
    application.add_argument("--idempotency-key")
    application.add_argument("--overdue-only", action="store_true")
    application.add_argument("--applied-days", type=int)
    reply = commands.add_parser("reply")
    reply.add_argument("action", choices=("import", "paste", "view", "confirm"))
    reply.add_argument("value", nargs="?")
    reply.add_argument("--opportunity")
    reply.add_argument("--status", choices=("responded", "interview", "offer", "rejected"))
    reply.add_argument("--reason", default="")
    reply.add_argument("--confirmed", action="store_true")
    insights = commands.add_parser("insights")
    insights.add_argument("kind", choices=("stats", "reposts", "company", "company-signals", "salary", "stated", "upskill", "jd-skill-gap", "preparation-plan"))
    insights.add_argument("--company")
    insights.add_argument("--silence-days", type=int, default=28)
    insights.add_argument("--include-stale", action="store_true")
    insights.add_argument("--min-reports", type=int, default=5)
    insights.add_argument("--jd", type=Path)
    insights.add_argument("--jd-url")
    insights.add_argument("--opportunity")
    insights.add_argument("--role")
    insights.add_argument("--report", type=Path)
    insights.add_argument("--output", type=Path)
    salary = commands.add_parser("salary")
    salary.add_argument("action", choices=("record",))
    salary.add_argument("observation", help="JSON object or path to JSON file")
    salary.add_argument("--idempotency-key", required=True)
    salary.add_argument("--confirmed", action="store_true")
    for name in ("interview", "cv", "communication", "notify", "liveness", "portal", "prefill", "doctor"):
        commands.add_parser(name, add_help=False).add_argument("arguments", nargs=argparse.REMAINDER)
    return cli


def main() -> None:
    cli = parser()
    argv = sys.argv[1:]
    routing = argparse.ArgumentParser(add_help=False)
    routing.add_argument("--directory", type=Path)
    routing.add_argument("command", nargs="?")
    routing.add_argument("arguments", nargs=argparse.REMAINDER)
    route, _ = routing.parse_known_args(argv)
    command = route.command
    rest = route.arguments
    domains = {
        "communication": "applications.communications", "notify": "notifications",
        "liveness": "discovery.liveness_check", "prefill": "applications.application_prefill",
        "doctor": "doctor", "cv": "candidate",
    }
    if command == "interview":
        action = rest[0] if rest else ""
        domains[command] = "interviews.workflow" if action in {"start", "show", "resume", "confirm", "history"} else "interviews.tools"
    if command == "portal":
        action = rest.pop(0) if rest else "validate"
        if action not in {"validate", "repair", "health"}:
            cli.error("portal action must be validate, repair, or health")
        domains[command] = {"validate": "discovery.portal_config", "repair": "discovery.portals_repair", "health": "discovery.portal_health"}[action]
    if command == "cv" and rest[:1] == ["check"]:
        rest.pop(0)
        domains[command] = "candidate_facts"
    if command in domains:
        if route.directory is not None:
            if domains[command] == "interviews.tools":
                if rest[:1] == ["context"]:
                    rest += ["--db", str(route.directory / "opportunities.db")]
            elif domains[command] in {"interviews.workflow", "candidate", "applications.communications", "notifications"}:
                rest = ["--directory", str(route.directory), *rest]
        sys.argv = [sys.argv[0], *rest]
        raise SystemExit(import_module("career_ops." + domains[command]).main() or 0)
    since_count = sum(arg == "--since" or arg.startswith("--since=") for arg in argv)
    if since_count > 1:
        cli.error(f"--since given {since_count} times; pass it once")
    args = cli.parse_args(argv)
    try:
        if args.command == "start":
            args.directory.mkdir(parents=True, exist_ok=True)
            started = start_and_run(args.directory, args.opportunity, args.module, args.input, args.crash_at, args.re_evaluate)
            result = view(args.directory, started["task_id"])
        elif args.command == "run":
            run_task(args.directory, args.task_id, start_state=json.loads(args.state) if args.state else None, crash_at=args.crash_at)
            result = view(args.directory, args.task_id)
        elif args.command == "cron-score":
            result = cron_score(args.directory)
        elif args.command == "discover":
            if args.company == "":
                raise ValueError("--company requires a value")
            result = discover(args.directory, Path(os.environ.get("CAREER_OPS_PORTALS") or INPUT_ROOT / "portals.yml"),
                              company_filter=args.company,
                              verify=args.verify, headed_fallback=args.headed_fallback,
                              throttle_ms=5000 if args.throttle == 0 else args.throttle or 0,
                              rediscover_404=args.rediscover_404,
                              posted_after=args.posted_after, posted_before=args.posted_before,
                              since_days=args.since, include_blacklisted=args.include_blacklisted,
                              dry_run=args.dry_run, resume=args.resume, input_root=INPUT_ROOT,
                              profile_path=Path(os.environ.get("CAREER_OPS_PROFILE") or INPUT_ROOT / "config" / "profile.yml"))
            if result["status"] == "failed":
                raise RuntimeError(json.dumps(result, ensure_ascii=False, sort_keys=True))
        elif args.command == "global":
            result = discover_global(args.directory, Path(os.environ.get("CAREER_OPS_PORTALS") or INPUT_ROOT / "portals.yml"),
                                     ats=[part.strip().lower() for part in args.ats.split(",") if part.strip()] if args.ats else None,
                                     seeds=[part.strip().lower() for part in args.seeds.split(",") if part.strip()] if args.seeds else None,
                                     liveness=args.liveness, md_out=Path(args.md_out) if args.md_out else None, verbose=args.verbose,
                                     since_days=args.since, limit=args.limit or None,
                                     include_undated=args.include_undated,
                                     include_blacklisted=args.include_blacklisted,
                                     shuffle=args.shuffle, resume=args.resume, dry_run=args.dry_run,
                                     input_root=INPUT_ROOT)
        elif args.command in {"resolve", "resolve-company"}:
            requested = tuple(part.strip().lower() for part in args.vendors.split(",") if part.strip()) if args.vendors else (*VENDOR_ORDER, "workday")
            result = resolve_boards(Path(os.environ.get("CAREER_OPS_PORTALS") or INPUT_ROOT / "portals.yml"),
                                    input_path=args.input_path, names=args.names,
                                    vendors=tuple(vendor for vendor in requested if vendor != "workday"),
                                    include_workday="workday" in requested, write=args.write)
        elif args.command == "scan-discovered":
            started = scan_discovered(args.directory, args.opportunity, args.re_evaluate)
            result = view(args.directory, started["task_id"])
        elif args.command == "resume":
            resume_task(
                args.directory, args.task_id, args.input, args.crash_at,
                feedback=args.feedback, decision=args.decision,
            )
            result = view(args.directory, args.task_id)
        elif args.command == "show":
            result = view(args.directory, args.identifier)
        elif args.command == "list":
            result = list_views(args.directory)
        elif args.command == "scores":
            store = BusinessStore(args.directory / "opportunities.db")
            try:
                result = store.score_views()
            finally:
                store.close()
        elif args.command == "decisions":
            store = BusinessStore(args.directory / "opportunities.db")
            try:
                result = store.decision_views()
            finally:
                store.close()
        elif args.command == "insights":
            if args.kind in {"jd-skill-gap", "preparation-plan"}:
                if bool(args.jd) == bool(args.jd_url):
                    raise ValueError("JD analysis requires exactly one of --jd or --jd-url")
                if args.jd:
                    jd = args.jd.read_text()
                else:
                    with tempfile.TemporaryDirectory(prefix="career-ops-jd-gap-") as temporary:
                        snapshot = capture_jd(Path(temporary), args.jd_url)
                    if not snapshot:
                        raise ValueError("JD URL capture failed or was blocked")
                    jd = snapshot["text"]
                if args.kind == "jd-skill-gap":
                    result = targeted_skill_gap(jd, (INPUT_ROOT / "cv.md").read_text())
                else:
                    if not args.company or not args.role:
                        raise ValueError("preparation-plan requires --company and --role")
                    result = build_preparation_plan(
                        args.company, args.role, jd, (INPUT_ROOT / "cv.md").read_text(),
                        (INPUT_ROOT / "config" / "profile.yml").read_text(),
                        args.report.read_text() if args.report else "",
                        sources={"jd": str(args.jd) if args.jd else args.jd_url,
                                 "report": str(args.report) if args.report else None})
                    if args.output:
                        args.output.parent.mkdir(parents=True, exist_ok=True)
                        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
            else:
                database = (args.directory / "opportunities.db").resolve()
                with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as db:
                    db.row_factory = sqlite3.Row
                    portals = INPUT_ROOT / "portals.yml"
                    if args.kind == "stats":
                        result = stats_view(db, portals, INPUT_ROOT / "config" / "profile.yml")
                    elif args.kind == "reposts":
                        result = repost_view(db, portals)
                    elif args.kind == "salary":
                        result = salary_view(db, INPUT_ROOT / "config" / "profile.yml")
                    elif args.kind == "stated":
                        if not args.opportunity:
                            raise ValueError("insights stated requires --opportunity")
                        result = stated_view(db, args.opportunity)
                    elif args.kind == "upskill":
                        result = upskill_view(db, INPUT_ROOT / "cv.md", min_reports=args.min_reports)
                    else:
                        view_result = company_view(db, portals, silence_days=args.silence_days,
                                                   include_stale=args.include_stale, company=args.company)
                        result = company_signals(view_result, INPUT_ROOT / "config" / "profile.yml",
                                                 ROOT / "package.json", include_stale=args.include_stale) if args.kind == "company-signals" else view_result
        elif args.command == "salary":
            if not args.confirmed:
                raise ValueError("salary record requires --confirmed")
            raw = args.observation if args.observation.lstrip().startswith("{") else Path(args.observation).read_text()
            result = record_salary(args.directory, json.loads(raw), args.idempotency_key)
        elif args.command == "cancel":
            result = cancel_task(args.directory, args.task_id)
        elif args.command == "reply":
            if args.action == "paste":
                if args.value:
                    raw = Path(args.value).read_text()
                else:
                    print("Subject: ", end="", file=sys.stderr, flush=True)
                    subject = sys.stdin.readline().rstrip("\n")
                    print("From: ", end="", file=sys.stderr, flush=True)
                    sender = sys.stdin.readline().rstrip("\n")
                    print("Body (finish with Ctrl-D):", file=sys.stderr)
                    raw = f"Subject: {subject}\nFrom: {sender}\n\n" + sys.stdin.read()
                result = import_reply(args.directory, parse_pasted(raw))
            elif args.action == "import":
                if not args.value:
                    raise ValueError("reply import requires a JSON object or file")
                if args.value.lstrip().startswith(("{", "[")):
                    message = json.loads(args.value)
                else:
                    raw = Path(args.value).read_text()
                    message = json.loads(raw) if raw.lstrip().startswith(("{", "[")) else parse_pasted(raw)
                result = [import_reply(args.directory, item) for item in message] if isinstance(message, list) else import_reply(args.directory, message)
            elif args.action == "view":
                if not args.value:
                    raise ValueError("reply view requires a message ID")
                result = view_reply(args.directory, args.value)
            else:
                if not args.value or not args.confirmed or not args.opportunity or not args.status:
                    raise ValueError("reply confirm requires --confirmed, --opportunity and --status")
                result = confirm_reply(args.directory, args.value, args.opportunity, args.status, reason=args.reason)
        elif args.command == "application":
            store = ApplicationStore(args.directory / "opportunities.db")
            try:
                if args.action == "view":
                    result = store.application(args.opportunity) if args.opportunity else store.views()
                elif args.action == "followups":
                    result = store.followups(overdue_only=args.overdue_only, applied_days=args.applied_days)
                else:
                    if not args.opportunity or (args.action in {"transition", "activity", "outcome", "schedule"} and not args.value):
                        raise ValueError("application mutation requires opportunity and value")
                    if not args.idempotency_key:
                        raise ValueError("application mutation requires --idempotency-key")
                    if args.action in {"submit", "transition", "activity", "outcome", "schedule", "retire", "reopen"} and not args.confirmed:
                        raise ValueError(f"application {args.action} requires --confirmed")
                    if args.action in {"transition", "outcome"} and not (args.source or "").strip():
                        raise ValueError(f"application {args.action} requires --source")
                    store.close()
                    store = None
                    result = mutate_application(
                        args.directory, args.opportunity, args.action, args.value or "",
                        source=args.source if args.source is not None else "candidate-confirmed",
                        payload=json.loads(args.payload), idempotency_key=args.idempotency_key,
                    )
            finally:
                if store:
                    store.close()
        if args.command in {"resolve", "resolve-company"} and args.summary:
            print(format_summary(result))
        else:
            print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
