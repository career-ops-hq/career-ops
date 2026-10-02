"""Parse user commands and route them to business operations."""

from __future__ import annotations


import argparse
from importlib import import_module
import json
import os
import sqlite3
import sys
from pathlib import Path
from career_ops.discovery.board_resolution import VENDOR_ORDER, format_summary, resolve_boards
from career_ops.discovery.reverse_runner import discover_global
from career_ops.discovery.configured import discover
from career_ops.applications.application_lifecycle import ApplicationStore, mutate as mutate_application
from career_ops.applications.replies import import_reply, view_reply, confirm_reply, parse_pasted
from career_ops.insights.stats import stats_view
from career_ops.insights.reposts import repost_view
from career_ops.insights.company import company_view, company_signals
from career_ops.insights.salary import salary_view, stated_view
from career_ops.applications.salary_observations import record_salary
from career_ops.insights.upskill import upskill_view
from career_ops.context import INPUT_ROOT, ROOT
from career_ops.interviews.context import load_context
from career_ops.db import BusinessStore
from career_ops.tasks import cancel_task, cron_score, list_views, resume_task, run_task, scan_discovered, start_and_run, view


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(prog="career_ops", description="Discover, evaluate and manage job opportunities.")
    cli.add_argument("--directory", type=Path, default=ROOT / "data", help="business data directory")
    commands = cli.add_subparsers(dest="command", required=True)

    discover_command = commands.add_parser("discover", help="collect configured sources or a global ATS sweep")
    discover_command.set_defaults(operation="discover")
    discover_command.add_argument("--company")
    discover_command.add_argument("--since", type=float)
    discover_command.add_argument("--posted-after")
    discover_command.add_argument("--posted-before")
    discover_command.add_argument("--verify", action="store_true")
    discover_command.add_argument("--headed-fallback", action="store_true")
    discover_command.add_argument("--throttle", type=int, default=0, metavar="MS")
    discover_command.add_argument("--rediscover-404", action="store_true")
    discover_command.add_argument("--include-blacklisted", action="store_true")
    discover_command.add_argument("--dry-run", action="store_true")
    discover_command.add_argument("--resume", action="store_true")
    sources = discover_command.add_subparsers(dest="discovery_mode")
    global_command = sources.add_parser("global", help="sweep public ATS directories")
    global_command.set_defaults(operation="global")
    global_command.add_argument("--since", type=float, default=3)
    global_command.add_argument("--include-blacklisted", action="store_true")
    global_command.add_argument("--dry-run", action="store_true")
    global_command.add_argument("--resume", action="store_true")
    global_command.add_argument("--ats", help="global sweep: comma-separated ATS names")
    global_command.add_argument("--seeds", help="global sweep: comma-separated seed names")
    global_command.add_argument("--liveness", action="store_true")
    global_command.add_argument("--md-out")
    global_command.add_argument("--verbose", action="store_true")
    global_command.add_argument("--limit", type=int)
    global_command.add_argument("--include-undated", action="store_true")
    global_command.add_argument("--shuffle", action="store_true")

    evaluate = commands.add_parser("evaluate", help="scan and score a retained opportunity")
    evaluate.set_defaults(operation="evaluate")
    evaluate.add_argument("opportunity")
    evaluate.add_argument("--re-evaluate", action="store_true")
    show = commands.add_parser("show", help="show an opportunity and its retained results")
    show.set_defaults(operation="opportunity")
    show.add_argument("identifier")
    listing = commands.add_parser("list", help="list opportunities or a selected business view")
    listing.set_defaults(operation="listing")
    listing.add_argument("--view", choices=("opportunities", "scores", "decisions", "applications", "followups"), default="opportunities")
    listing.add_argument("--overdue-only", action="store_true")
    listing.add_argument("--applied-days", type=int)

    task = commands.add_parser("task", help="start, inspect or recover a workflow task")
    tasks = task.add_subparsers(dest="operation", required=True)
    start = tasks.add_parser("start", help="import an explicit scan or score input")
    start.add_argument("module", choices=("scan", "score", "apply"))
    start.add_argument("opportunity")
    start.add_argument("input")
    start.add_argument("--re-evaluate", action="store_true")
    run = tasks.add_parser("run", help="continue a running or failed checkpoint")
    run.add_argument("task_id")
    resume = tasks.add_parser("resume", help="resume with new input, feedback or a decision")
    resume.add_argument("task_id")
    resume.add_argument("--input")
    resume.add_argument("--feedback")
    resume.add_argument("--decision", choices=("confirm", "defer", "accept-jd-change"))
    task_show = tasks.add_parser("show")
    task_show.add_argument("identifier")
    tasks.add_parser("list")
    cancel = tasks.add_parser("cancel")
    cancel.add_argument("task_id")

    apply = commands.add_parser("apply", help="prepare materials and maintain application records")
    applications = apply.add_subparsers(dest="operation", required=True)
    prepare = applications.add_parser("prepare", help="prepare materials from the current score")
    prepare.add_argument("opportunity")
    prepare.add_argument("--re-evaluate", action="store_true")
    application = applications.add_parser("record", help="record a user-confirmed application event")
    application.set_defaults(operation="application")
    application.add_argument("action", choices=("submit", "transition", "activity", "outcome", "schedule", "retire", "reopen", "view", "followups"))
    application.add_argument("opportunity", nargs="?")
    application.add_argument("value", nargs="?")
    application.add_argument("--source")
    application.add_argument("--confirmed", action="store_true")
    application.add_argument("--payload", default="{}")
    application.add_argument("--idempotency-key")
    application.add_argument("--overdue-only", action="store_true")
    application.add_argument("--applied-days", type=int)
    reply = applications.add_parser("reply", help="import or confirm an employer reply")
    reply.add_argument("action", choices=("import", "paste", "view", "confirm"))
    reply.add_argument("value", nargs="?")
    reply.add_argument("--opportunity")
    reply.add_argument("--status", choices=("responded", "interview", "offer", "rejected"))
    reply.add_argument("--reason", default="")
    reply.add_argument("--confirmed", action="store_true")
    salary = applications.add_parser("salary", help="record confirmed salary evidence")
    salary.add_argument("observation", help="JSON object or path to JSON file")
    salary.add_argument("--idempotency-key", required=True)
    salary.add_argument("--confirmed", action="store_true")
    for name in ("communication", "prefill"):
        applications.add_parser(name, add_help=False).add_argument("arguments", nargs=argparse.REMAINDER)

    insights = commands.add_parser("insights", help="query aggregate retained evidence")
    insights.set_defaults(operation="insights")
    insights.add_argument("kind", choices=("stats", "reposts", "company", "company-signals", "salary", "stated", "upskill"))
    insights.add_argument("--company")
    insights.add_argument("--opportunity")
    insights.add_argument("--silence-days", type=int, default=28)
    insights.add_argument("--include-stale", action="store_true")
    insights.add_argument("--min-reports", type=int, default=5)
    for name in ("interview", "cv"):
        commands.add_parser(name, help="manage " + name + " preparation and confirmation", add_help=False).add_argument("arguments", nargs=argparse.REMAINDER)

    dashboard = commands.add_parser("dashboard", help="serve a read-only local dashboard of jobs, scores and applications")
    dashboard.set_defaults(operation="dashboard")
    dashboard.add_argument("--host", default="127.0.0.1")
    dashboard.add_argument("--port", type=int, default=8765)

    system = commands.add_parser("system", help="maintain sources, environment and scheduled operations")
    operations = system.add_subparsers(dest="operation", required=True)
    operations.add_parser("advance", help="advance one eligible scan/score task").set_defaults(operation="cron-score")
    resolve = operations.add_parser("resolve-company", help="find a company's ATS board")
    resolve.add_argument("names", nargs="*")
    resolve.add_argument("--in", dest="input_path", type=Path)
    resolve.add_argument("--vendors")
    mode = resolve.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="save verified entries to portals.yml")
    mode.add_argument("--dry-run", action="store_true", help="preview only (the default)")
    resolve.add_argument("--summary", action="store_true")
    for name in ("doctor", "notify", "portal", "liveness"):
        operations.add_parser(name, add_help=False).add_argument("arguments", nargs=argparse.REMAINDER)
    return cli


def forward_domain(argv: list[str]) -> bool:
    """Let domain-owned parsers handle their own help and arguments."""
    routing = argparse.ArgumentParser(add_help=False)
    routing.add_argument("--directory", type=Path, default=ROOT / "data")
    routing.add_argument("command", nargs="?")
    routing.add_argument("arguments", nargs=argparse.REMAINDER)
    route, _ = routing.parse_known_args(argv)
    rest = route.arguments
    domain = None
    if route.command == "interview":
        domain = "interviews.workflow" if rest[:1] and rest[0] in {"start", "show", "resume", "confirm", "history"} else "interviews.tools"
    elif route.command == "cv":
        domain = "candidate"
        if rest[:1] == ["check"]:
            rest.pop(0)
            domain = "candidate_facts"
    elif route.command == "apply" and rest[:1] and rest[0] in {"communication", "prefill"}:
        domain = {"communication": "applications.communications", "prefill": "applications.application_prefill"}[rest.pop(0)]
    elif route.command == "system" and rest[:1]:
        domain = {"doctor": "doctor", "notify": "notifications", "liveness": "discovery.liveness_check"}.get(rest[0])
        if domain:
            rest.pop(0)
        elif rest[0] == "portal":
            rest.pop(0)
            action = rest.pop(0) if rest else "validate"
            if action not in {"validate", "repair", "health"}:
                if action in {"-h", "--help"}:
                    print("usage: career_ops system portal {validate,repair,health} [options]")
                    return True
                routing.error("portal action must be validate, repair, or health")
            domain = {"validate": "discovery.portal_config", "repair": "discovery.portals_repair", "health": "discovery.portal_health"}[action]
    if domain is None:
        return False
    if domain == "interviews.tools":
        rest = ["--directory", str(route.directory), *rest]
    elif domain in {"interviews.workflow", "candidate", "applications.communications", "notifications", "discovery.liveness_check"}:
        rest = ["--directory", str(route.directory), *rest]
    sys.argv = [sys.argv[0], *rest]
    raise SystemExit(import_module("career_ops." + domain).main() or 0)


def main() -> None:
    cli = parser()
    argv = sys.argv[1:]
    if forward_domain(argv):
        return
    since_count = sum(arg == "--since" or arg.startswith("--since=") for arg in argv)
    if since_count > 1:
        cli.error(f"--since given {since_count} times; pass it once")
    args = cli.parse_args(argv)
    if args.operation == "global" and argv[argv.index("discover") + 1] != "global":
        cli.error("put global immediately after discover, then its options")
    if args.operation == "listing" and args.view != "followups" and (args.overdue_only or args.applied_days is not None):
        cli.error("--overdue-only and --applied-days require --view followups")
    if args.operation == "dashboard":
        from career_ops.dashboard.server import serve
        serve(args.directory, args.host, args.port)
        return
    try:
        if args.operation == "start":
            args.directory.mkdir(parents=True, exist_ok=True)
            started = start_and_run(args.directory, args.opportunity, args.module, args.input, None, args.re_evaluate)
            result = view(args.directory, started["task_id"])
        elif args.operation == "run":
            run_task(args.directory, args.task_id)
            result = view(args.directory, args.task_id)
        elif args.operation == "cron-score":
            result = cron_score(args.directory)
        elif args.operation == "discover":
            if args.company == "":
                raise ValueError("--company requires a value")
            result = discover(args.directory, Path(os.environ.get("CAREER_OPS_PORTALS") or INPUT_ROOT / "portals.yml"),
                              company_filter=args.company,
                              verify=args.verify, headed_fallback=args.headed_fallback,
                              throttle_ms=args.throttle,
                              rediscover_404=args.rediscover_404,
                              posted_after=args.posted_after, posted_before=args.posted_before,
                              since_days=args.since, include_blacklisted=args.include_blacklisted,
                              dry_run=args.dry_run, resume=args.resume, input_root=INPUT_ROOT,
                              profile_path=Path(os.environ.get("CAREER_OPS_PROFILE") or INPUT_ROOT / "profile.yml"))
            if result["status"] == "failed":
                raise RuntimeError(json.dumps(result, ensure_ascii=False, sort_keys=True))
        elif args.operation == "global":
            result = discover_global(args.directory, Path(os.environ.get("CAREER_OPS_PORTALS") or INPUT_ROOT / "portals.yml"),
                                     ats=[part.strip().lower() for part in args.ats.split(",") if part.strip()] if args.ats else None,
                                     seeds=[part.strip().lower() for part in args.seeds.split(",") if part.strip()] if args.seeds else None,
                                     liveness=args.liveness, md_out=Path(args.md_out) if args.md_out else None, verbose=args.verbose,
                                     since_days=args.since if args.since is not None else 3, limit=args.limit or None,
                                     include_undated=args.include_undated,
                                     include_blacklisted=args.include_blacklisted,
                                     shuffle=args.shuffle, resume=args.resume, dry_run=args.dry_run,
                                     input_root=INPUT_ROOT)
        elif args.operation == "resolve-company":
            requested = tuple(part.strip().lower() for part in args.vendors.split(",") if part.strip()) if args.vendors else (*VENDOR_ORDER, "workday")
            result = resolve_boards(Path(os.environ.get("CAREER_OPS_PORTALS") or INPUT_ROOT / "portals.yml"),
                                    input_path=args.input_path, names=args.names,
                                    vendors=tuple(vendor for vendor in requested if vendor != "workday"),
                                    include_workday="workday" in requested, write=args.write)
        elif args.operation == "evaluate":
            started = scan_discovered(args.directory, args.opportunity, args.re_evaluate)
            scanned = view(args.directory, started["task_id"])
            if scanned["status"] == "completed" and scanned["artifact"]["outcome"] == "jd_report":
                started = start_and_run(args.directory, args.opportunity, "score", f"scan:{args.opportunity}", None, args.re_evaluate)
            result = view(args.directory, started["task_id"])
        elif args.operation == "prepare":
            started = start_and_run(args.directory, args.opportunity, "apply", f"score:{args.opportunity}", None, args.re_evaluate)
            result = view(args.directory, started["task_id"])
        elif args.operation == "opportunity":
            context = load_context(args.directory, args.identifier, require_candidate_sources=False)
            result = {key: context[key] for key in ("opportunity", "results", "evaluation", "artifacts", "application")}
        elif args.operation == "listing":
            if args.view in {"scores", "decisions"}:
                store = BusinessStore(args.directory / "opportunities.db")
                try:
                    result = store.score_views() if args.view == "scores" else store.decision_views()
                finally:
                    store.close()
            elif args.view in {"applications", "followups"}:
                store = ApplicationStore(args.directory / "opportunities.db")
                try:
                    result = store.views() if args.view == "applications" else store.followups(overdue_only=args.overdue_only, applied_days=args.applied_days)
                finally:
                    store.close()
            else:
                with sqlite3.connect((args.directory / "opportunities.db").resolve().as_uri() + "?mode=ro", uri=True) as db:
                    db.row_factory = sqlite3.Row
                    result = [dict(row) for row in db.execute("SELECT id,url,company,role,state FROM opportunities ORDER BY id DESC")]
        elif args.operation == "resume":
            resume_task(
                args.directory, args.task_id, args.input, None,
                feedback=args.feedback, decision=args.decision,
            )
            result = view(args.directory, args.task_id)
        elif args.operation == "show":
            result = view(args.directory, args.identifier)
        elif args.operation == "list":
            result = list_views(args.directory)
        elif args.operation == "insights":
            database = (args.directory / "opportunities.db").resolve()
            with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as db:
                db.row_factory = sqlite3.Row
                portals = INPUT_ROOT / "portals.yml"
                if args.kind == "stats":
                    result = stats_view(db, portals, INPUT_ROOT / "profile.yml")
                elif args.kind == "reposts":
                    result = repost_view(db, portals)
                elif args.kind == "salary":
                    result = salary_view(db, INPUT_ROOT / "profile.yml")
                elif args.kind == "stated":
                    if not args.opportunity:
                        raise ValueError("insights stated requires --opportunity")
                    result = stated_view(db, args.opportunity)
                elif args.kind == "upskill":
                    result = upskill_view(db, INPUT_ROOT / "cv.md", min_reports=args.min_reports)
                else:
                    view_result = company_view(db, portals, silence_days=args.silence_days,
                                               include_stale=args.include_stale, company=args.company)
                    result = company_signals(view_result, INPUT_ROOT / "profile.yml",
                                             ROOT / "package.json", include_stale=args.include_stale) if args.kind == "company-signals" else view_result
        elif args.operation == "salary":
            if not args.confirmed:
                raise ValueError("salary record requires --confirmed")
            raw = args.observation if args.observation.lstrip().startswith("{") else Path(args.observation).read_text()
            result = record_salary(args.directory, json.loads(raw), args.idempotency_key)
        elif args.operation == "cancel":
            result = cancel_task(args.directory, args.task_id)
        elif args.operation == "reply":
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
        elif args.operation == "application":
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
        if args.operation == "resolve-company" and args.summary:
            print(format_summary(result))
        else:
            print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
