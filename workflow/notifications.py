"""Deliver reviewed score reports to the user's Discord with at-most-once attempts."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from typing import Callable, TypedDict

import yaml
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from workflow.career_ops import BusinessStore, INPUT_ROOT, digest, score_inputs


class DeliveryState(TypedDict):
    opportunity_id: str
    report_hash: str
    status: str


def eligible_report(store: BusinessStore, opportunity_id: str) -> dict | None:
    """Read the current formal result, not a draft, historical score or shortlist row."""
    row = store.db.execute(
        "SELECT r.input_hash,r.payload,t.input_payload,e.report_hash,l.status AS eligibility "
        "FROM results r "
        "JOIN tasks t ON t.task_id=r.task_id "
        "JOIN evaluations e ON e.opportunity_id=CAST(r.opportunity_id AS INTEGER) "
        "JOIN eligibility l ON l.opportunity_id=e.opportunity_id "
        "WHERE r.opportunity_id=? AND r.module='score' ORDER BY r.rowid DESC LIMIT 1",
        (opportunity_id,),
    ).fetchone()
    scan = store.module_result(opportunity_id, "scan")
    if not row or not scan or scan.get("outcome") != "jd_report":
        return None
    try:
        result = json.loads(row["payload"])
        artifact = result.get("artifact", {})
        if result.get("outcome") != "score" or row["eligibility"] == "fail":
            return None
        current = score_inputs(scan["artifact"])
        if digest(current) != row["input_hash"] or digest(row["input_payload"]) != row["input_hash"]:
            return None
        score = artifact["score"]
        report = artifact["report"]
        if artifact["type"] != "score" or artifact["report_sha256"] != digest(report):
            return None
        if row["report_hash"] != artifact["report_sha256"]:
            return None
        report_path = Path(artifact["path"])
        if not report_path.is_file() or report_path.read_text() != report:
            return None
        lower, upper, coverage = (score[key] for key in ("lower", "upper", "coverage"))
        if any(isinstance(value, bool) or not isinstance(value, (float, int)) for value in (lower, upper, coverage)):
            return None
        if not (1 <= lower <= upper <= 5 and 0 <= coverage <= 1):
            return None
        profile = yaml.safe_load((INPUT_ROOT / "config" / "profile.yml").read_text())
        alert_line = profile["attractiveness"]["alert_line"]
        if isinstance(alert_line, bool) or not isinstance(alert_line, (float, int)) or not 1 <= alert_line <= 5:
            return None
        if lower + (upper - lower) * coverage < alert_line:
            return None
        posting = scan["artifact"]
        suffix = f" · 吸引力 {lower:g}–{upper:g}/5（覆盖率{coverage * 100:g}%）"
        company = " ".join(posting["company"].split())[:35]
        prefix = f"[{opportunity_id}:{artifact['report_sha256'][:12]}] 高分岗位 · {company} · "
        role = " ".join(posting["role"].split())
        return {
            "opportunity_id": opportunity_id,
            "report_hash": artifact["report_sha256"],
            "title": prefix + role[:max(0, 100 - len(prefix) - len(suffix))] + suffix,
            "report": report,
            "path": str(report_path),
            "lower": lower,
            "upper": upper,
            "coverage": coverage,
        }
    except (AttributeError, KeyError, TypeError, ValueError, OSError, yaml.YAMLError):
        return None


def init_delivery_table(db: sqlite3.Connection) -> None:
    db.execute(
        "CREATE TABLE IF NOT EXISTS notification_deliveries ("
        "opportunity_id TEXT NOT NULL,report_hash TEXT NOT NULL,"
        "status TEXT NOT NULL CHECK(status IN ('queued','sending','delivered','uncertain','withheld')),"
        "detail TEXT NOT NULL DEFAULT '',PRIMARY KEY(opportunity_id,report_hash))"
    )


def discord_sender(payload: dict) -> None:
    """Use the existing delivery helper; a timeout is always an uncertain result."""
    channel = os.environ.get("CAREER_OPS_DISCORD_CHANNEL_ID", "1519136110515585184")
    script = Path(__file__).resolve().parents[1] / "scripts" / "discord-idempotent-post.py"
    proxy_env = {key: value for key, value in os.environ.items()
                 if key.lower() not in ("http_proxy", "https_proxy", "all_proxy", "no_proxy")}
    proxy_env.update({"HTTPS_PROXY": "http://127.0.0.1:7890", "HTTP_PROXY": "http://127.0.0.1:7890",
                      "ALL_PROXY": "http://127.0.0.1:7890", "NO_PROXY": "localhost,127.0.0.1"})
    subprocess.run(
        [sys.executable, str(script), "--channel", channel, "--title", payload["title"],
         "--file", payload["path"]],
        check=True, capture_output=True, text=True, timeout=40, env=proxy_env,
    )


def deliver(directory: Path, opportunity_id: str, sender: Callable[[dict], None]) -> dict:
    """The business row is authoritative; graph replay never repeats a send attempt."""
    store = BusinessStore(directory / "opportunities.db")
    try:
        init_delivery_table(store.db)
        payload = eligible_report(store, opportunity_id)
        if not payload:
            return {"status": "ineligible", "opportunity_id": opportunity_id}
        report_hash = payload["report_hash"]

        def claim(state: DeliveryState) -> dict:
            store.db.execute(
                "INSERT OR IGNORE INTO notification_deliveries(opportunity_id,report_hash,status) "
                "VALUES(?,?,'queued')", (opportunity_id, report_hash),
            )
            return {"status": "queued"}

        def send(state: DeliveryState) -> dict:
            current = eligible_report(store, opportunity_id)
            if not current or current["report_hash"] != report_hash:
                store.db.execute(
                    "UPDATE notification_deliveries SET status='withheld',detail='inputs changed' "
                    "WHERE opportunity_id=? AND report_hash=? AND status='queued'",
                    (opportunity_id, report_hash),
                )
                return {"status": "withheld"}
            claimed = store.db.execute(
                "UPDATE notification_deliveries SET status='sending' "
                "WHERE opportunity_id=? AND report_hash=? AND status='queued'",
                (opportunity_id, report_hash),
            ).rowcount
            if not claimed:
                status = store.db.execute(
                    "SELECT status FROM notification_deliveries WHERE opportunity_id=? AND report_hash=?",
                    (opportunity_id, report_hash),
                ).fetchone()[0]
                return {"status": "uncertain" if status == "sending" else status}
            try:
                sender(payload)
            except Exception as error:
                store.db.execute(
                    "UPDATE notification_deliveries SET status='uncertain',detail=? "
                    "WHERE opportunity_id=? AND report_hash=?",
                    (str(error)[:500], opportunity_id, report_hash),
                )
                return {"status": "uncertain"}
            store.db.execute(
                "UPDATE notification_deliveries SET status='delivered' WHERE opportunity_id=? AND report_hash=?",
                (opportunity_id, report_hash),
            )
            return {"status": "delivered"}

        graph = StateGraph(DeliveryState)
        graph.add_node("claim", claim)
        graph.add_node("send", send)
        graph.add_edge(START, "claim")
        graph.add_edge("claim", "send")
        graph.add_edge("send", END)
        with SqliteSaver.from_conn_string(str(directory / "workflow-checkpoints.db")) as saver:
            result = graph.compile(checkpointer=saver).invoke(
                {"opportunity_id": opportunity_id, "report_hash": report_hash, "status": "queued"},
                {"configurable": {"thread_id": f"notification:{opportunity_id}:{report_hash}"}},
            )
        return {"opportunity_id": opportunity_id, "report_hash": report_hash, "status": result["status"]}
    finally:
        store.close()


def deliver_next(directory: Path, sender: Callable[[dict], None]) -> dict:
    """Advance at most one eligible, never-attempted report per scheduled run."""
    store = BusinessStore(directory / "opportunities.db")
    try:
        init_delivery_table(store.db)
        ids = [row[0] for row in store.db.execute(
            "SELECT opportunity_id FROM results WHERE module='score' GROUP BY opportunity_id ORDER BY MAX(rowid)"
        )]
        pending = None
        for opportunity_id in ids:
            payload = eligible_report(store, opportunity_id)
            if payload and not store.db.execute(
                "SELECT 1 FROM notification_deliveries WHERE opportunity_id=? AND report_hash=?",
                (opportunity_id, payload["report_hash"]),
            ).fetchone():
                pending = opportunity_id
                break
    finally:
        store.close()
    return deliver(directory, pending, sender) if pending else {"status": "idle"}


def main() -> None:
    cli = argparse.ArgumentParser()
    cli.add_argument("action", choices=("preview", "send", "cron"))
    cli.add_argument("opportunity_id", nargs="?")
    cli.add_argument("--directory", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    args = cli.parse_args()
    if args.action == "preview":
        if not args.opportunity_id:
            cli.error("preview requires opportunity_id")
        store = BusinessStore(args.directory / "opportunities.db")
        try:
            payload = eligible_report(store, args.opportunity_id)
            print(json.dumps(payload or {"status": "ineligible"}, ensure_ascii=False))
        finally:
            store.close()
    else:
        if os.environ.get("CAREER_OPS_NOTIFICATIONS_ENABLED") != "1":
            raise SystemExit("Notifications disabled during migration acceptance")
        if args.action == "send" and not args.opportunity_id:
            cli.error("send requires opportunity_id")
        result = (deliver(args.directory, args.opportunity_id, discord_sender)
                  if args.action == "send" else deliver_next(args.directory, discord_sender))
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
