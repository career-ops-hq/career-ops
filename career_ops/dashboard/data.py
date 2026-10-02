"""Derive dashboard rows from retained business facts without writing the store."""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3

from career_ops.evaluation.decisions import classify, valid_scores


MATERIAL_LABELS = {
    "changes": "简历改动 / Resume changes",
    "cover_letter": "Cover letter",
    "upskill": "Upskill 计划",
    "interview_prep": "面试准备 / Interview prep",
    "questions": "反问问题 / Questions",
    "resume_payload": "简历 JSON",
    "resume_pdf": "简历 PDF",
    "resume_metadata": "Reactive Resume 元数据",
}
TEXT_SUFFIXES = {".md", ".json", ".txt"}


def connect(database: Path) -> sqlite3.Connection:
    """Open the store read-only so the dashboard can never change business state."""
    db = sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True, check_same_thread=False)
    db.row_factory = sqlite3.Row
    return db


def _has_table(db: sqlite3.Connection, name: str) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def _latest_results(db: sqlite3.Connection, module: str) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    for row in db.execute("SELECT opportunity_id,payload FROM results WHERE module=? ORDER BY rowid DESC", (module,)):
        latest.setdefault(str(row["opportunity_id"]), json.loads(row["payload"]))
    return latest


def _lifecycle(db: sqlite3.Connection) -> dict[str, dict]:
    if not _has_table(db, "application_lifecycle"):
        return {}
    return {str(row["opportunity_id"]): dict(row) for row in db.execute("SELECT * FROM application_lifecycle")}


def _summary_score(score: dict | None) -> float | None:
    known = [value for value in (score or {}).values() if isinstance(value, int)]
    return round(sum(known) / len(known), 2) if known else None


def _action(score: dict | None, scan: dict | None) -> str | None:
    prescreen = (scan or {}).get("artifact", {}).get("prescreen")
    if not valid_scores(score):
        return None
    try:
        return classify(score, prescreen)
    except ValueError:
        return None


def _stage(row: sqlite3.Row, lifecycle: dict | None, score: dict | None) -> str:
    if lifecycle or row["application_state"] == "submitted":
        return "applied"
    return "scored" if score is not None else "scanned"


def list_jobs(db: sqlite3.Connection) -> list[dict]:
    """One row per opportunity with its current stage, score and application status."""
    scans, scores = _latest_results(db, "scan"), _latest_results(db, "score")
    lifecycle = _lifecycle(db)
    eligibility = {str(row["opportunity_id"]): row["status"] for row in db.execute("SELECT opportunity_id,status FROM eligibility")}
    evaluations = {str(row["opportunity_id"]): dict(row) for row in db.execute("SELECT * FROM evaluations")}
    materials = _material_counts(db)
    jobs = []
    for row in db.execute("SELECT * FROM opportunities ORDER BY id DESC"):
        key = str(row["id"])
        scan, score_result = scans.get(key), scores.get(key)
        scan_artifact = (scan or {}).get("artifact", {})
        score = (score_result or {}).get("artifact", {}).get("score")
        evaluation = evaluations.get(key, {})
        application = lifecycle.get(key)
        jobs.append({
            "id": row["id"], "url": row["url"], "company": row["company"], "role": row["role"],
            "source": row["source"], "state": row["state"], "created_at": row["created_at"],
            "stage": _stage(row, application, score_result),
            "scan_outcome": (scan or {}).get("outcome"),
            "location": scan_artifact.get("location_evidence"),
            "liveness": scan_artifact.get("liveness"),
            "captured_at": scan_artifact.get("captured_at"),
            "prescreen": (scan_artifact.get("prescreen") or {}).get("status"),
            "eligibility": eligibility.get(key),
            "scores": score if isinstance(score, dict) else None,
            "score": _summary_score(score) if valid_scores(score) else evaluation.get("upper_score"),
            "action": _action(score, scan),
            "scored_at": evaluation.get("created_at"),
            "application_status": application["status"] if application else None,
            "application_updated_at": application["updated_at"] if application else None,
            "has_report": bool((score_result or {}).get("artifact", {}).get("report")),
            "material_count": materials.get(key, 0),
        })
    return jobs


def _apply_packages(db: sqlite3.Connection, opportunity_id: str) -> list[dict]:
    """Confirmed packages first, then the newest staged draft of each apply task."""
    packages = []
    for row in db.execute(
        "SELECT task_id,payload FROM results WHERE opportunity_id=? AND module='apply' ORDER BY rowid DESC", (opportunity_id,)
    ):
        artifact = json.loads(row["payload"]).get("artifact", {})
        packages.append({"source": "confirmed", "task_id": row["task_id"], "version": artifact.get("version"),
                         "files": artifact.get("files", {})})
    for row in db.execute(
        "SELECT d.task_id,d.version,d.payload FROM drafts d JOIN tasks t ON t.task_id=d.task_id "
        "WHERE t.opportunity_id=? AND d.version=(SELECT MAX(version) FROM drafts WHERE task_id=d.task_id) "
        "ORDER BY d.rowid DESC", (opportunity_id,)
    ):
        if any(package["task_id"] == row["task_id"] for package in packages):
            continue
        packages.append({"source": "draft", "task_id": row["task_id"], "version": row["version"],
                         "files": json.loads(row["payload"]).get("files", {})})
    return packages


def _material_counts(db: sqlite3.Connection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in db.execute("SELECT opportunity_id,task_id FROM results WHERE module='apply' UNION "
                          "SELECT t.opportunity_id,d.task_id FROM drafts d JOIN tasks t ON t.task_id=d.task_id"):
        counts[str(row[0])] = counts.get(str(row[0]), 0) + 1
    if _has_table(db, "interview_results"):
        for row in db.execute("SELECT t.opportunity_id FROM interview_results r JOIN interview_tasks t ON t.task_id=r.task_id"):
            counts[str(row[0])] = counts.get(str(row[0]), 0) + 1
    return counts


def material_files(db: sqlite3.Connection, opportunity_id: str) -> list[dict]:
    """Every file the store references for this opportunity; the only paths the server may read."""
    files = []
    for package in _apply_packages(db, opportunity_id):
        for key, path in sorted(package["files"].items()):
            files.append({"id": f"{package['task_id']}:{package['version']}:{key}", "key": key,
                          "label": MATERIAL_LABELS.get(key, key), "path": path,
                          "package": f"{package['source']} v{package['version']}"})
    for row in db.execute("SELECT id,kind,path FROM artifacts WHERE opportunity_id=? AND kind!='report'", (opportunity_id,)):
        files.append({"id": f"artifact:{row['id']}", "key": row["kind"], "label": MATERIAL_LABELS.get(row["kind"], row["kind"]),
                      "path": row["path"], "package": "artifact"})
    return files


def _interview_materials(db: sqlite3.Connection, opportunity_id: str) -> list[dict]:
    if not _has_table(db, "interview_results"):
        return []
    return [
        {"task_id": row["task_id"], "kind": row["kind"], "session": row["session_key"],
         "confirmed_at": row["confirmed_at"], "artifact": json.loads(row["artifact"])}
        for row in db.execute(
            "SELECT t.task_id,t.kind,t.session_key,r.confirmed_at,r.artifact FROM interview_results r "
            "JOIN interview_tasks t ON t.task_id=r.task_id WHERE t.opportunity_id=? ORDER BY r.confirmed_at DESC",
            (opportunity_id,),
        )
    ]


def read_text(path: str) -> str | None:
    file = Path(path)
    if file.suffix.lower() not in TEXT_SUFFIXES or not file.is_file():
        return None
    return file.read_text(errors="replace")


def _report(score_result: dict | None, db: sqlite3.Connection, opportunity_id: str) -> str | None:
    report = (score_result or {}).get("artifact", {}).get("report")
    if report:
        return report
    row = db.execute("SELECT path FROM artifacts WHERE opportunity_id=? AND kind='report' ORDER BY id DESC LIMIT 1",
                     (opportunity_id,)).fetchone()
    return read_text(row["path"]) if row else None


def _rows(db: sqlite3.Connection, table: str, opportunity_id: str) -> list[dict]:
    if not _has_table(db, table):
        return []
    return [{**dict(row), "payload": json.loads(row["payload"])}
            for row in db.execute(f"SELECT * FROM {table} WHERE opportunity_id=? ORDER BY id", (opportunity_id,))]


def job_detail(db: sqlite3.Connection, opportunity_id: int) -> dict | None:
    """The full retained record of one opportunity for the detail panel."""
    job = next((item for item in list_jobs(db) if item["id"] == opportunity_id), None)
    if job is None:
        return None
    key = str(opportunity_id)
    scan = _latest_results(db, "scan").get(key)
    score_result = _latest_results(db, "score").get(key)
    scan_artifact = (scan or {}).get("artifact", {})
    eligibility = db.execute("SELECT status,evidence,created_at FROM eligibility WHERE opportunity_id=?", (key,)).fetchone()
    materials = [
        {**{k: v for k, v in item.items() if k != "path"}, "name": Path(item["path"]).name,
         "content": read_text(item["path"]), "exists": Path(item["path"]).is_file()}
        for item in material_files(db, key)
    ]
    return {
        **job,
        "jd": scan_artifact.get("jd"),
        "scan_artifact": {k: v for k, v in scan_artifact.items() if k != "jd"},
        "report": _report(score_result, db, key),
        "eligibility_detail": {**dict(eligibility), "evidence": json.loads(eligibility["evidence"])} if eligibility else None,
        "application_events": _rows(db, "application_events", key),
        "application_activity": _rows(db, "application_activity", key),
        "followups": _rows(db, "application_followup_directives", key),
        "materials": materials,
        "interviews": _interview_materials(db, key),
    }
