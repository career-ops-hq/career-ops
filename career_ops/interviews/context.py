"""Assemble read-only interview context from one canonical opportunity and retained evidence."""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3

import yaml

from career_ops.interviews.evidence import classify_numeric_claims, provenance_diagnosis, stories


from career_ops.context import ROOT, INPUT_ROOT
CANDIDATE_FILES = ("cv.md", "article-digest.md", "config/profile.yml", "modes/_profile.md")


def _table(db: sqlite3.Connection, name: str) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def _frontmatter(text: str) -> dict:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end < 0:
        return {}
    try:
        value = yaml.load(text[4:end], Loader=yaml.BaseLoader)
    except yaml.YAMLError:
        return {}
    return value if isinstance(value, dict) else {}


def _historical_files(directory: Path, company: str, role: str) -> list[dict]:
    if not directory.is_dir():
        return []
    matched = []
    for path in sorted(directory.glob("*.md")):
        if path.name == "README.md":
            continue
        text = path.read_text()
        front = _frontmatter(text)
        if str(front.get("company", "")).casefold() == company.casefold() and str(front.get("role", "")).casefold() == role.casefold():
            matched.append({"path": str(path), "metadata": front, "content": text})
    return matched


def load_context(
    directory: Path, opportunity_id: str, *, input_root: Path = INPUT_ROOT,
    db_path: Path | None = None, sessions_dir: Path | None = None,
    require_candidate_sources: bool = True,
) -> dict:
    """Historical sessions are data, not candidate facts or instructions."""
    db_path = db_path or directory / "opportunities.db"
    if not db_path.is_file():
        raise ValueError("Opportunity store not found")
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        if not _table(db, "opportunities"):
            raise ValueError("Opportunity store has no opportunities")
        row = db.execute("SELECT * FROM opportunities WHERE CAST(id AS TEXT)=?", (str(opportunity_id),)).fetchone()
        if not row:
            raise ValueError(f"Unknown opportunity: {opportunity_id}")
        opportunity = dict(row)
        company, role = opportunity["company"], opportunity["role"]
        evidence = [dict(item) for item in db.execute(
            "SELECT source,payload,created_at FROM source_evidence WHERE opportunity_id=? ORDER BY id", (row["id"],)
        )] if _table(db, "source_evidence") else []
        for item in evidence:
            item["payload"] = json.loads(item["payload"])
        opportunity["evidence"] = evidence
        results = {}
        if _table(db, "results"):
            for module in ("scan", "score", "apply"):
                result = db.execute(
                    "SELECT payload FROM results WHERE opportunity_id=? AND module=? ORDER BY rowid DESC LIMIT 1",
                    (str(opportunity_id), module),
                ).fetchone()
                results[module] = json.loads(result["payload"]) if result else None
        evaluation = None
        if _table(db, "evaluations"):
            has_dimensions = any(column["name"] == "dimension_scores" for column in db.execute("PRAGMA table_info(evaluations)"))
            stored = db.execute(
                "SELECT lower_score,upper_score,coverage,report_hash"
                + (",dimension_scores" if has_dimensions else "") + " "
                "FROM evaluations WHERE opportunity_id=?", (row["id"],)
            ).fetchone()
            if stored:
                if has_dimensions and stored["dimension_scores"]:
                    evaluation = {"scores": json.loads(stored["dimension_scores"]), "reportHash": stored["report_hash"]}
                else:
                    evaluation = {"lower": stored["lower_score"], "upper": stored["upper_score"],
                                  "coverage": stored["coverage"], "reportHash": stored["report_hash"]}
        artifacts = [dict(item) for item in db.execute(
            "SELECT kind,path,sha256 FROM artifacts WHERE opportunity_id=? ORDER BY id", (row["id"],)
        )] if _table(db, "artifacts") else []
        application = None
        if _table(db, "application_lifecycle"):
            status = db.execute("SELECT status FROM application_lifecycle WHERE opportunity_id=?", (str(opportunity_id),)).fetchone()
            if status:
                application = {"status": status["status"]}
                if _table(db, "application_events"):
                    application["events"] = [
                        {**dict(event), "payload": json.loads(event["payload"])}
                        for event in db.execute("SELECT * FROM application_events WHERE opportunity_id=? ORDER BY id", (str(opportunity_id),))
                    ]
        candidate = {name: (input_root / name).read_text() for name in CANDIDATE_FILES if (input_root / name).is_file()}
        if require_candidate_sources and any(name not in candidate for name in ("cv.md", "config/profile.yml", "modes/_profile.md")):
            raise ValueError("Candidate source files are incomplete")
        bank_path = input_root / "interview-prep" / "story-bank.md"
        bank = bank_path.read_text() if bank_path.is_file() else ""
        provenance = classify_numeric_claims(bank, candidate.get("cv.md", ""))
        count = sum(len(items) for items in provenance.values())
        return {
            "opportunity": opportunity, "results": results,
            "evaluation": evaluation, "artifacts": artifacts,
            "application": application, "candidate_sources": candidate,
            "rules": (input_root / "modes" / "_custom.md").read_text() if (input_root / "modes" / "_custom.md").is_file() else "",
            "market_rules": {name: (ROOT / "markets" / name / "employment.md").read_text()
                             for name in ("cn", "hk", "remote")},
            "contract": (ROOT / "prompts" / "shared" / "contract.md").read_text(),
            "interview_requirements": (ROOT / "prompts" / "interviews" / "workflow.md").read_text(),
            "story_bank": bank, "story_provenance": provenance,
            "story_provenance_diagnosis": provenance_diagnosis(bank_path.is_file(), "cv.md" in candidate, len(stories(bank, require_action=False)), count),
            "sessions": _historical_files(sessions_dir or input_root / "interview-prep" / "sessions", company, role),
            "preparations": _historical_files(input_root / "interview-prep", company, role),
        }
    finally:
        db.close()
