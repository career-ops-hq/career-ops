"""Validate sourced CV proposals, persist their preview, and apply only the confirmed revision."""

from __future__ import annotations

from career_ops.context import ROOT, INPUT_ROOT, source_path

import argparse
import difflib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from typing import TypedDict
import unicodedata
import uuid

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph


SOURCES = {"user-stated", "local-document", "external-discovery"}
CLAIMS = {
    "number": re.compile(r"\d"),
    "scope": re.compile(r"\b(led|managed|owned|headed|drove|delivered)\b", re.I),
    "authorship": re.compile(r"\b(authored|built|created|founded|invented|developed)\b", re.I),
}
PRIMARY_REFS = {"cv.md", "config/profile.yml", "article-digest.md"}


def digest(value: str | None) -> str | None:
    return hashlib.sha256(value.encode()).hexdigest() if value is not None else None


def normalize_key(value: str) -> str:
    return "".join(character for character in unicodedata.normalize("NFKC", value).casefold() if character.isalnum())


def locate_section(markdown: str, section: str) -> tuple[int, int] | None:
    lines = markdown.splitlines()
    target = normalize_key(section)
    for index, line in enumerate(lines):
        match = re.fullmatch(r"##\s+(.*\S)\s*", line)
        if match and normalize_key(match.group(1)) == target:
            end = index + 1
            while end < len(lines) and not lines[end].startswith("## "):
                end += 1
            return index, end
    return None


def cv_has_entry(markdown: str, section: str, dedup_key: str) -> bool:
    located = locate_section(markdown, section)
    if not located:
        return False
    start, end = located
    body = "\n".join(markdown.splitlines()[start + 1:end])
    identifiers = re.findall(r"\*\*([^*]+)\*\*", body)
    identifiers += re.findall(r"^#{3,}\s+(.*\S)\s*$", body, re.M)
    return any(normalize_key(identifier) == normalize_key(dedup_key) for identifier in identifiers)


def insert_cv(markdown: str, section: str, entry: str) -> str:
    block = entry.rstrip()
    located = locate_section(markdown, section)
    if not located:
        return f"{markdown.rstrip()}\n\n## {section}\n\n{block}\n"
    lines = markdown.splitlines()
    start, end = located
    body = "\n".join(lines[start + 1:end]).rstrip()
    replacement = [lines[start], "", *(body.splitlines() if body else []), block, ""]
    result = "\n".join([*lines[:start], *replacement, *lines[end:]])
    return re.sub(r"\n{3,}", "\n\n", result).rstrip() + "\n"


def article_has_entry(markdown: str, dedup_key: str) -> bool:
    key = normalize_key(dedup_key)
    for heading in re.findall(r"^##\s+(.*\S)\s*$", markdown, re.M):
        name = re.split(r"\s+[—–-]{1,2}\s+", heading, maxsplit=1)[0]
        if normalize_key(name) == key:
            return True
    return False


def validate_proposals(raw: object, root: Path) -> list[dict]:
    values = raw if isinstance(raw, list) else raw.get("proposals", [raw]) if isinstance(raw, dict) else None
    if not isinstance(values, list) or not values:
        raise ValueError("Proposal list must not be empty")
    validated = []
    seen = set()
    required = ("source", "sourceRef", "exactEvidence", "targetSection", "proposedWording", "dedupKey", "provenance", "provenanceRef")
    for item in values:
        if not isinstance(item, dict):
            raise ValueError("Proposal must be an object")
        for key in required:
            if not str(item.get(key, "")).strip():
                raise ValueError(f"Proposal requires {key}")
            if not isinstance(item[key], str):
                raise ValueError(f"Proposal {key} must be text")
        if item.get("articleDigest") is not None and not isinstance(item["articleDigest"], str):
            raise ValueError("articleDigest must be text")
        if item["source"] not in SOURCES:
            raise ValueError("source must be user-stated, local-document, or external-discovery")
        if item["provenance"] not in {"verified", "unverified"}:
            raise ValueError("provenance must be verified or unverified")
        kinds = item.get("claimKinds")
        if not isinstance(kinds, list) or any(kind not in CLAIMS for kind in kinds):
            raise ValueError("claimKinds must contain only number, scope, or authorship")
        inferred = {kind for kind, pattern in CLAIMS.items() if pattern.search(item["proposedWording"])}
        if not inferred.issubset(kinds):
            raise ValueError("claimKinds must declare claims present in proposedWording")
        reference = item["provenanceRef"]
        is_user_statement = bool(re.fullmatch(r"user-stated:\d{4}-\d{2}-\d{2}", reference))
        if item["provenance"] == "verified" and reference not in PRIMARY_REFS and not is_user_statement:
            raise ValueError("Verified proposals require a primary provenanceRef")
        if is_user_statement and item["source"] != "user-stated":
            raise ValueError("user-stated provenance requires a user-stated source")
        if item["provenance"] == "verified" and not is_user_statement:
            source = source_path(root, reference)
            if not source.is_file() or item["exactEvidence"] not in source.read_text():
                raise ValueError("Verified exactEvidence must appear in provenanceRef")
        if item["provenance"] == "unverified" and kinds:
            raise ValueError("Unverified numbers, scope, and authorship claims cannot be promoted")
        key = normalize_key(item["dedupKey"])
        if not key:
            raise ValueError("dedupKey must not be empty")
        if key in seen:
            raise ValueError(f"Duplicate proposal dedupKey: {item['dedupKey']}")
        seen.add(key)
        validated.append(item)
    return validated


def render_preview(proposals: list[dict], cv: str, article: str | None) -> dict:
    current_cv, current_article = cv, article
    rows = []
    for item in proposals:
        cv_status = "duplicate" if cv_has_entry(current_cv, item["targetSection"], item["dedupKey"]) else "added"
        if cv_status == "added":
            current_cv = insert_cv(current_cv, item["targetSection"], item["proposedWording"])
        result = {"cv": {"status": cv_status, "section": item["targetSection"]}}
        if item.get("articleDigest"):
            base = current_article or "# Article Digest -- Proof Points\n\nCompact proof points from portfolio projects. Read by career-ops at evaluation time.\n"
            article_status = "duplicate" if article_has_entry(base, item["dedupKey"]) else "created" if current_article is None else "added"
            if article_status != "duplicate":
                current_article = f"{base.rstrip()}\n\n---\n\n{item['articleDigest'].rstrip()}\n"
            result["articleDigest"] = {"status": article_status}
        rows.append({"proposal": item, "result": result})
    return {
        "proposals": rows,
        "before": {"cv_sha256": digest(cv), "article_sha256": digest(article)},
        "after": {"cv_sha256": digest(current_cv), "article_sha256": digest(current_article)},
        "diff": {
            "cv": "".join(difflib.unified_diff(cv.splitlines(True), current_cv.splitlines(True), "cv.md", "cv.md (proposed)")),
            "article": "" if current_article == article else "".join(difflib.unified_diff((article or "").splitlines(True), (current_article or "").splitlines(True), "article-digest.md", "article-digest.md (proposed)")),
        },
        "next": {"cv": current_cv, "article": current_article},
        "can_apply": all(item["provenance"] == "verified" for item in proposals),
    }


class CVState(TypedDict):
    task_id: str
    root: str
    proposals: list[dict]
    preview: dict


class Store:
    def __init__(self, path: Path):
        self.db = sqlite3.connect(path, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS cv_tasks (
          task_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('running','waiting','completed','cancelled')),
          input_hash TEXT NOT NULL, root TEXT NOT NULL, proposals TEXT NOT NULL, preview TEXT, waiting_reason TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS cv_confirmations (
          task_id TEXT PRIMARY KEY REFERENCES cv_tasks(task_id), confirmation TEXT NOT NULL,
          preview_hash TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """)

    def close(self) -> None:
        self.db.close()

    def create(self, proposals: list[dict], root: Path) -> sqlite3.Row:
        encoded = json.dumps(proposals, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        task_id = str(uuid.uuid4())
        self.db.execute("INSERT INTO cv_tasks(task_id,status,input_hash,root,proposals) VALUES(?,'running',?,?,?)", (task_id, digest(encoded), str(root), encoded))
        return self.task(task_id)

    def task(self, task_id: str) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM cv_tasks WHERE task_id=?", (task_id,)).fetchone()
        if not row:
            raise ValueError(f"Unknown CV task: {task_id}")
        return row

    def save_preview(self, task_id: str, preview: dict) -> None:
        encoded = json.dumps(preview, ensure_ascii=False, sort_keys=True)
        self.db.execute("UPDATE cv_tasks SET status='waiting',waiting_reason='confirmation_required',preview=? WHERE task_id=? AND status='running'", (encoded, task_id))

    def complete(self, task_id: str, preview_hash: str) -> None:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("INSERT INTO cv_confirmations(task_id,confirmation,preview_hash) VALUES(?,'approved',?)", (task_id, preview_hash))
            self.db.execute("UPDATE cv_tasks SET status='completed',waiting_reason=NULL WHERE task_id=?", (task_id,))
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise


class Runtime:
    def __init__(self, store: Store):
        self.store = store

    @staticmethod
    def validate(state: CVState) -> dict:
        return {"proposals": validate_proposals(state["proposals"], Path(state["root"]))}

    def preview(self, state: CVState) -> dict:
        root = Path(state["root"])
        cv_path, article_path = root / "cv.md", root / "article-digest.md"
        if not cv_path.is_file():
            raise ValueError("cv.md not found")
        preview = render_preview(state["proposals"], cv_path.read_text(), article_path.read_text() if article_path.is_file() else None)
        return {"preview": preview}

    def persist(self, state: CVState) -> dict:
        if os.environ.get("CAREER_OPS_CV_CRASH_AT_PERSIST") == "1":
            os._exit(86)
        self.store.save_preview(state["task_id"], state["preview"])
        return {}

    def graph(self, saver: SqliteSaver):
        graph = StateGraph(CVState)
        graph.add_node("validate", self.validate)
        graph.add_node("preview", self.preview)
        graph.add_node("persist", self.persist)
        graph.add_edge(START, "validate")
        graph.add_edge("validate", "preview")
        graph.add_edge("preview", "persist")
        graph.add_edge("persist", END)
        return graph.compile(checkpointer=saver)


def public_task(row: sqlite3.Row) -> dict:
    result = {"task_id": row["task_id"], "status": row["status"], "waiting_reason": row["waiting_reason"]}
    if row["preview"]:
        preview = json.loads(row["preview"])
        result["preview"] = {key: value for key, value in preview.items() if key != "next"}
    return result


def preview(directory: Path, root: Path, proposal_path: Path) -> dict:
    raw = json.loads(proposal_path.read_text())
    store = Store(directory / "opportunities.db")
    try:
        task = store.create(validate_proposals(raw, root), root)
    finally:
        store.close()
    return resume_preview(directory, task["task_id"])


def resume_preview(directory: Path, task_id: str) -> dict:
    store = Store(directory / "opportunities.db")
    try:
        task = store.task(task_id)
        if task["status"] != "running":
            return public_task(task)
        state: CVState = {"task_id": task_id, "root": task["root"], "proposals": json.loads(task["proposals"]), "preview": {}}
        config = {"configurable": {"thread_id": task_id}}
        with SqliteSaver.from_conn_string(str(directory / "cv-checkpoints.db")) as saver:
            graph = Runtime(store).graph(saver)
            snapshot = graph.get_state(config)
            graph.invoke(None if snapshot.values else state, config)
        return public_task(store.task(task_id))
    finally:
        store.close()


def replace_files(root: Path, before: dict, next_values: dict) -> None:
    targets = [(root / "cv.md", next_values["cv"]), (root / "article-digest.md", next_values["article"])]
    originals = {path: path.read_text() if path.is_file() else None for path, _ in targets}
    if {"cv_sha256": digest(originals[targets[0][0]]), "article_sha256": digest(originals[targets[1][0]])} != before:
        raise ValueError("Candidate facts changed after preview; create a new preview")
    staged = []
    try:
        for path, value in targets:
            if value is None or value == originals[path]:
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            handle = tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False)
            with handle:
                handle.write(value)
            staged.append((path, Path(handle.name)))
        for index, (path, temporary) in enumerate(staged):
            temporary.replace(path)
            if index == 0 and os.environ.get("CAREER_OPS_CV_CRASH_AFTER_FIRST_WRITE") == "1":
                raise OSError("injected write failure")
    except Exception:
        for path, original in originals.items():
            if original is None:
                path.unlink(missing_ok=True)
            else:
                handle = tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False)
                with handle:
                    handle.write(original)
                Path(handle.name).replace(path)
        raise
    finally:
        for _, temporary in staged:
            temporary.unlink(missing_ok=True)


def restore_files(values: dict[Path, str | None]) -> None:
    for path, value in values.items():
        if value is None:
            path.unlink(missing_ok=True)
            continue
        handle = tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False)
        with handle:
            handle.write(value)
        Path(handle.name).replace(path)


def apply(directory: Path, root: Path, task_id: str, confirmation: str) -> dict:
    if confirmation != "approved":
        raise ValueError("Apply requires --confirm approved")
    lock_dir = directory / ".locks"
    lock_dir.mkdir(parents=True, exist_ok=True)
    with (lock_dir / f"cv-{task_id}.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        store = Store(directory / "opportunities.db")
        try:
            task = store.task(task_id)
            if task["status"] == "completed":
                return public_task(task)
            if task["status"] != "waiting" or not task["preview"]:
                raise ValueError("CV task is not waiting for confirmation")
            task_root = Path(task["root"]).resolve()
            if root.resolve() != task_root:
                raise ValueError("Apply root must match the confirmed preview root")
            root = task_root
            preview_value = json.loads(task["preview"])
            if not preview_value["can_apply"]:
                raise ValueError("Unverified proposals are preview-only; resubmit confirmed facts as user-stated")
            originals = {
                path: path.read_text() if path.is_file() else None
                for path in (root / "cv.md", root / "article-digest.md")
            }
            current_hashes = {
                "cv_sha256": digest(originals[root / "cv.md"]),
                "article_sha256": digest(originals[root / "article-digest.md"]),
            }
            if current_hashes == preview_value["before"]:
                replace_files(root, preview_value["before"], preview_value["next"])
            elif current_hashes != preview_value["after"]:
                raise ValueError("Candidate facts changed after preview; create a new preview")
            if os.environ.get("CAREER_OPS_CV_CRASH_AFTER_WRITE") == "1":
                os._exit(86)
            try:
                store.complete(task_id, digest(task["preview"]))
            except Exception:
                restore_files(originals)
                raise
            return public_task(store.task(task_id))
        finally:
            store.close()


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--directory", type=Path, default=ROOT / "data")
    command.add_argument("--root", type=Path, default=INPUT_ROOT)
    subcommands = command.add_subparsers(dest="command", required=True)
    create = subcommands.add_parser("preview")
    create.add_argument("proposal", type=Path)
    confirm = subcommands.add_parser("apply")
    confirm.add_argument("task_id")
    confirm.add_argument("--confirm", required=True)
    show = subcommands.add_parser("show")
    show.add_argument("task_id")
    resume = subcommands.add_parser("resume")
    resume.add_argument("task_id")
    return command


def main() -> None:
    args = parser().parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    try:
        if args.command == "preview":
            result = preview(args.directory, args.root, args.proposal)
        elif args.command == "apply":
            result = apply(args.directory, args.root, args.task_id, args.confirm)
        elif args.command == "resume":
            result = resume_preview(args.directory, args.task_id)
        else:
            store = Store(args.directory / "opportunities.db")
            try:
                result = public_task(store.task(args.task_id))
            finally:
                store.close()
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser().error(str(error))
