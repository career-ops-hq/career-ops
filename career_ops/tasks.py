"""Advance and recover long tasks without owning the CLI."""

from __future__ import annotations

import difflib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
import re
import shutil
import shlex
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from career_ops.discovery.configured import capture_jd
from career_ops.applications.resume_renderer import render_resume
from career_ops.context import ATTEMPT_CALLS, ATTEMPT_SECONDS, INPUT_ROOT, MODEL_RUNNER, ROOT, WORKFLOW_VERSION
from career_ops.input_contracts import apply_inputs, canonical_scan_input, canonical_score_input, digest, score_inputs, validate_resume_payload, verify_package_files
from career_ops.task_state import WorkflowState
from career_ops.db import BusinessStore


def task_view(store: BusinessStore, task: sqlite3.Row) -> dict:
    """Return the stable JSON shape shared by start, show, list, resume and cancel."""
    result = store.result(task["task_id"])
    draft = store.draft(task["task_id"]) if task["module"] == "apply" and not result else None
    reason = task["waiting_reason"]
    if task["module"] == "apply" and task["status"] == "waiting":
        actions = ["feedback", "confirm", "defer", "cancel"] if reason in ("user_review", "user_deferred", "input_changed") else ["feedback", "defer", "cancel"]
        if reason == "jd_changed":
            actions = ["accept-jd-change", "defer", "cancel"]
    else:
        actions = ["resume", "cancel"] if task["status"] == "waiting" else []
    return {
        "task_id": task["task_id"],
        "opportunity_id": task["opportunity_id"],
        "module": task["module"],
        "status": task["status"],
        "reason": reason,
        "artifact": result or draft,
        "attempt": task["attempt"],
        "allowed_actions": actions,
        **({"input_change": store.context(task["task_id"], "input_change")} if reason == "jd_changed" else {}),
    }


def view(directory: Path, identifier: str) -> dict:
    store = BusinessStore(directory / "opportunities.db")
    try:
        task = store.find_task(identifier)
        refresh_apply_validity(store, task)
        return task_view(store, store.task(task["task_id"]))
    finally:
        store.close()


def list_views(directory: Path) -> list[dict]:
    store = BusinessStore(directory / "opportunities.db")
    try:
        tasks = store.list_tasks()
        for task in tasks:
            refresh_apply_validity(store, task)
        return [task_view(store, store.task(task["task_id"])) for task in tasks]
    finally:
        store.close()


def cancel_task(directory: Path, task_id: str) -> dict:
    store = BusinessStore(directory / "opportunities.db")
    try:
        return task_view(store, store.cancel(task_id))
    finally:
        store.close()


def current_apply_input(store: BusinessStore, task: sqlite3.Row, jd_report: dict | None = None) -> str:
    inputs = json.loads(task["input_payload"])
    return apply_inputs(
        jd_report or inputs["jd_report"], inputs["score_result"], store.feedback(task["task_id"])
    )


def refresh_apply_validity(store: BusinessStore, task: sqlite3.Row) -> None:
    if task["module"] != "apply" or task["status"] not in ("running", "waiting"):
        return
    if store.context(task["task_id"], "input_change"):
        store.wait(task["task_id"], "jd_changed")
    elif digest(current_apply_input(store, task)) != task["input_hash"]:
        store.wait(task["task_id"], "input_changed")


class Runtime:
    """Build one explicit graph while keeping formal writes behind BusinessStore."""

    def __init__(self, store: BusinessStore, fault_dir: Path, crash_at: str | None = None):
        self.store = store
        self.fault_dir = fault_dir
        self.crash_at = crash_at
        self.started_at = time.monotonic()

    def crash_once(self, state: WorkflowState, stage: str) -> None:
        marker = self.fault_dir / f"{state['task_id']}-{stage}.faulted"
        if self.crash_at == stage and not marker.exists():
            marker.touch()
            os._exit(86)

    def run_model(self, phase: str, payload: dict, state: WorkflowState) -> dict:
        """Call one fresh model process while enforcing the module budget."""
        task = self.store.task(state["task_id"])
        calls_before = task["attempt_tool_calls"]
        if task["attempt_tool_calls"] >= ATTEMPT_CALLS:
            raise TimeoutError("tool_budget_exhausted")
        configured = os.environ.get("CAREER_OPS_MODEL_RUNNER")
        command = shlex.split(configured) if configured else [sys.executable, "-m", MODEL_RUNNER]
        try:
            remaining = ATTEMPT_SECONDS - task["attempt_elapsed_seconds"] - (time.monotonic() - self.started_at)
            if remaining <= 0:
                raise TimeoutError("time_budget_exhausted")
            with subprocess.Popen(
                [*command, phase], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, start_new_session=True, cwd=ROOT,
                env={**os.environ, "CAREER_OPS_DRAFT_ROOT": os.environ.get(
                    "CAREER_OPS_DRAFT_ROOT", str(self.store.path.parent / "workflow-drafts")
                ), "CAREER_OPS_USAGE_DB": str(self.store.path),
                    "CAREER_OPS_USAGE_TASK_ID": state["task_id"],
                    "CAREER_OPS_TOOL_LIMIT": str(ATTEMPT_CALLS)},
            ) as process:
                try:
                    stdout, stderr = process.communicate(json.dumps(payload, ensure_ascii=False), timeout=max(1, remaining))
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.communicate()
                    raise
                result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
        except subprocess.TimeoutExpired as error:
            self.store.add_usage(state["task_id"], time.monotonic() - self.started_at, 0)
            self.started_at = time.monotonic()
            raise TimeoutError("time_budget_exhausted") from error
        if result.returncode:
            task = self.store.add_usage(state["task_id"], time.monotonic() - self.started_at, 0)
            self.started_at = time.monotonic()
            if task["attempt_tool_calls"] >= ATTEMPT_CALLS:
                raise TimeoutError("tool_budget_exhausted")
            raise RuntimeError(result.stderr.strip() or f"model runner exited {result.returncode}")
        try:
            value = json.loads(result.stdout)
            if not isinstance(value, dict):
                raise ValueError("Model runner response must be an object")
            reported_calls = int(value.pop("tool_calls", 0))
        except (ValueError, TypeError, OverflowError):
            self.store.add_usage(state["task_id"], time.monotonic() - self.started_at, 0)
            self.started_at = time.monotonic()
            raise
        durable_calls = self.store.task(state["task_id"])["attempt_tool_calls"] - calls_before
        calls = reported_calls if configured and not durable_calls else 0
        task = self.store.add_usage(state["task_id"], time.monotonic() - self.started_at, calls)
        self.started_at = time.monotonic()
        if task["attempt_tool_calls"] >= ATTEMPT_CALLS:
            raise TimeoutError("tool_budget_exhausted")
        value["tool_calls"] = task["tool_calls"]
        return value

    def evaluate(self, state: WorkflowState) -> dict:
        task = self.store.task(state["task_id"])
        inputs = json.loads(task["input_payload"])
        if task["input_payload"].startswith("{"):
            if task["module"] == "apply":
                result = self.run_model(
                    "apply_evaluate",
                    {
                        "inputs": inputs,
                        "previous_artifact": json.loads(state["draft"]) if state.get("has_prior_package") else None,
                    },
                    state,
                )
                artifact = result["artifact"]
                return {
                    "outcome": "package", "draft": json.dumps(artifact, ensure_ascii=False, sort_keys=True),
                    "material_hash": digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True)),
                    "tool_calls": result["tool_calls"],
                }
            if task["module"] == "scan":
                if inputs["source"]["liveness"] == "uncertain":
                    return {"waiting_reason": "source_access_unknown"}
                result = self.run_model("scan_evaluate", {"inputs": inputs}, state)
                if result.get("waiting_reason"):
                    return {"waiting_reason": result["waiting_reason"], "tool_calls": result["tool_calls"]}
                artifact = result["artifact"]
                if result["outcome"] == "jd_report":
                    score_inputs(artifact)
                return {
                    "outcome": result["outcome"],
                    "draft": json.dumps(artifact, ensure_ascii=False, sort_keys=True),
                    "material_hash": digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True)),
                    "tool_calls": result["tool_calls"],
                }
            if inputs["jd_report"]["prescreen"]["status"] == "incomplete":
                return {"waiting_reason": "core_evidence_missing"}
            result = self.run_model(
                "evaluate",
                {"inputs": inputs},
                state,
            )
            artifact = result["artifact"]
            return {
                "outcome": result["outcome"],
                "draft": json.dumps(artifact, ensure_ascii=False, sort_keys=True),
                "material_hash": digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True)),
                "tool_calls": result["tool_calls"],
            }
        raise ValueError("Workflow input must be canonical JSON")

    @staticmethod
    def route_evaluate(state: WorkflowState) -> str:
        return "wait" if state.get("waiting_reason") else "stage" if state["module"] == "apply" else "publish"

    @staticmethod
    def wait(state: WorkflowState) -> dict:
        return {"waiting_reason": state["waiting_reason"]}

    def publish(self, state: WorkflowState) -> dict:
        existing = self.store.result(state["task_id"])
        if existing:
            payload = existing
        else:
            self.crash_once(state, "before_publish")
            artifact = json.loads(state["draft"]) if state["draft"].startswith("{") else None
            if artifact and artifact.get("report"):
                path = self.fault_dir / "artifacts" / state["task_id"] / state["input_hash"] / "report.md"
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(".tmp")
                temporary.write_text(artifact["report"])
                temporary.replace(path)
                artifact["path"] = str(path)
                state = {**state, "draft": json.dumps(artifact, ensure_ascii=False, sort_keys=True)}
            payload = self.store.publish(state)
        self.crash_once(state, "publish")
        return {"waiting_reason": None}

    def stage(self, state: WorkflowState) -> dict:
        package = json.loads(state["draft"])
        required = {
            "resume_payload", "changes", "cover_letter", "upskill",
            "interview_prep", "questions",
        }
        missing = sorted(required - package.keys())
        if missing or not package.get("resume_payload", {}).get("candidate", {}).get("name"):
            raise ValueError("Invalid application package: " + ", ".join(missing or ["resume candidate name"]))
        for key in required - {"resume_payload"}:
            if not isinstance(package[key], str) or not package[key].strip():
                raise ValueError(f"Invalid application package: {key} must be a nonempty Markdown string")
        validate_resume_payload(package["resume_payload"])
        current = self.store.draft(state["task_id"])
        if current and current["input_hash"] == state["input_hash"] and current["package"] == package:
            try:
                verify_package_files(current, require_pdf=True)
            except ValueError:
                pass
            else:
                return {"waiting_reason": "user_review"}
        version = (current["version"] if current else 0) + 1
        root = self.fault_dir / "artifacts" / state["task_id"] / state["input_hash"] / f"package-v{version:03d}"
        root.mkdir(parents=True, exist_ok=True)
        names = {
            "resume_payload": "resume.json", "changes": "changes.md", "cover_letter": "cover-letter.md",
            "upskill": "upskill.md", "interview_prep": "interview-prep.md", "questions": "questions.md",
        }
        files = {}
        for key, name in names.items():
            path = root / name
            value = package[key]
            path.write_text(
                json.dumps(value, ensure_ascii=False, indent=2) + "\n" if key == "resume_payload" else str(value)
            )
            files[key] = str(path)
        pdf_receipt = None
        remaining = ATTEMPT_SECONDS - self.store.task(state["task_id"])["attempt_elapsed_seconds"] - (time.monotonic() - self.started_at)
        if remaining <= 0:
            raise TimeoutError("time_budget_exhausted")
        pdf_path = root / "resume.pdf"
        metadata_path = root / "reactive-resume.json"
        previous_metadata = current.get("files", {}).get("resume_metadata") if current else None
        previous_metadata = previous_metadata or str(root.parents[1] / "reactive-resume.json")
        if not metadata_path.exists() and Path(previous_metadata).is_file():
            shutil.copyfile(previous_metadata, metadata_path)
        started = time.monotonic()
        try:
            inputs = json.loads(self.store.task(state["task_id"])["input_payload"])
            pdf_receipt = render_resume(
                state["task_id"], version, root.parents[1], Path(files["resume_payload"]),
                pdf_path, INPUT_ROOT / "config" / "profile.yml",
                package["resume_payload"]["candidate"]["name"],
                inputs["jd_report"]["company"], inputs["jd_report"]["role"],
                timeout_seconds=min(120, max(1, int(remaining))),
            )
        finally:
            self.store.add_usage(state["task_id"], time.monotonic() - started, 1)
        files["resume_pdf"] = str(pdf_path)
        files["resume_metadata"] = pdf_receipt["metadata_path"]
        artifact = {
            "files": files, "file_hashes": {
                name: hashlib.sha256(Path(path).read_bytes()).hexdigest()
                for name, path in files.items()
            }, "package": package, "pdf_receipt": pdf_receipt,
        }
        self.store.stage_draft(state, artifact)
        return {"waiting_reason": "user_review"}

    def graph(self, checkpointer: SqliteSaver):
        graph = StateGraph(WorkflowState)
        graph.add_node("evaluate", self.evaluate)
        graph.add_node("wait", self.wait)
        graph.add_node("publish", self.publish)
        graph.add_node("stage", self.stage)
        graph.add_edge(START, "evaluate")
        graph.add_conditional_edges("evaluate", self.route_evaluate, {"wait": "wait", "publish": "publish", "stage": "stage"})
        graph.add_edge("wait", END)
        graph.add_edge("publish", END)
        graph.add_edge("stage", END)
        return graph.compile(checkpointer=checkpointer)


def initial_state(task: sqlite3.Row) -> WorkflowState:
    return {
        "task_id": task["task_id"],
        "module": task["module"],
        "input_hash": task["input_hash"],
        "outcome": "score",
        "draft": "{}",
        "waiting_reason": None,
        "material_hash": "",
        "tool_calls": 0,
        "has_prior_package": False,
    }


def _run_task(
    directory: Path,
    task_id: str,
    *,
    start_state: WorkflowState | None = None,
    crash_at: str | None = None,
) -> dict:
    store = BusinessStore(directory / "opportunities.db")
    try:
        task = store.task(task_id)
        existing = store.result(task_id)
        if existing:
            return {"task_id": task_id, "status": "completed", "result": existing, "reconciled": True}
        if task["status"] == "cancelled":
            return {"task_id": task_id, "status": "cancelled", "reconciled": True}
        if task["status"] == "waiting" and not str(task["waiting_reason"] or "").startswith("failure:"):
            return {"task_id": task_id, "status": "waiting", "reason": task["waiting_reason"]}
        if task["workflow_version"] != WORKFLOW_VERSION:
            store.wait(task_id, "workflow_version_incompatible")
            return {"task_id": task_id, "status": "waiting", "reason": "workflow_version_incompatible"}
        runtime = Runtime(store, directory, crash_at)
        config = {"configurable": {"thread_id": f"{task_id}:{task['attempt']}"}}
        with SqliteSaver.from_conn_string(str(directory / "workflow-checkpoints.db")) as saver:
            graph = runtime.graph(saver)
            if start_state is None and task["status"] == "waiting" and (task["waiting_reason"] or "").startswith("failure:"):
                if graph.get_state(config).next:
                    store.resume_failed_checkpoint(task_id)
            if start_state is None and not graph.get_state(config).next:
                start_state = initial_state(task)
            value = graph.invoke(start_state, config)
        if value.get("waiting_reason"):
            store.wait(task_id, value["waiting_reason"])
            return {"task_id": task_id, "status": "waiting", "reason": value["waiting_reason"]}
        return {"task_id": task_id, "status": store.task(task_id)["status"], "result": store.result(task_id)}
    except TimeoutError as error:
        store.wait(task_id, str(error))
        return {"task_id": task_id, "status": "waiting", "reason": str(error)}
    except Exception as error:
        if store.task(task_id)["status"] == "running":
            store.wait(task_id, f"failure:{type(error).__name__}")
        raise
    finally:
        store.close()


def run_task(
    directory: Path,
    task_id: str,
    *,
    start_state: WorkflowState | None = None,
    crash_at: str | None = None,
) -> dict:
    """Run one task under a crash-safe process lock; business state remains authoritative."""
    lock_directory = directory / ".locks"
    lock_directory.mkdir(parents=True, exist_ok=True)
    with (lock_directory / f"{task_id}.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError(f"Task is already executing: {task_id}") from error
        return _run_task(directory, task_id, start_state=start_state, crash_at=crash_at)


def start_and_run(directory: Path, opportunity: str, module: str, input_text: str, crash_at: str | None, re_evaluate: bool = False) -> dict:
    if module == "scan":
        input_text = canonical_scan_input(input_text)
    store = BusinessStore(directory / "opportunities.db")
    if module == "score" and input_text.startswith("scan:"):
        scan = store.module_result(input_text.removeprefix("scan:"), "scan")
        if not scan or scan["outcome"] != "jd_report":
            store.close()
            raise ValueError("Missing completed scan result")
        input_text = score_inputs(scan["artifact"])
    elif module == "score":
        input_text = canonical_score_input(input_text)
    elif module == "apply" and input_text.startswith("score:"):
        upstream = input_text.removeprefix("score:")
        scan = store.module_result(upstream, "scan")
        score = store.module_result(upstream, "score")
        if not scan or scan["outcome"] != "jd_report" or not score or score["outcome"] != "score":
            store.close()
            raise ValueError("Missing current completed scan and score results")
        if score["input_hash"] != digest(score_inputs(scan["artifact"])):
            store.close()
            raise ValueError("Current score is stale for the scan or candidate inputs")
        input_text = apply_inputs(scan["artifact"], score, [])
    elif module == "apply":
        store.close()
        raise ValueError("apply requires score:<opportunity_id>")
    inputs = json.loads(input_text) if input_text.startswith("{") else None
    report = inputs["source"] if module == "scan" and inputs else inputs["jd_report"] if inputs else None
    if report and report["opportunity_id"] != opportunity:
        store.close()
        raise ValueError("CLI opportunity does not match the JD report")
    if module == "scan" and inputs:
        store.retain_source(opportunity, input_text)
    started = store.start(opportunity, module, input_text, re_evaluate=re_evaluate)
    task = store.task(started["task_id"])
    store.close()
    if started["status"] != "running":
        return started
    return run_task(directory, task["task_id"], start_state=initial_state(task), crash_at=crash_at)


def discovery_query(store: BusinessStore) -> tuple[str, str]:
    """Select the latest immutable capture and JD version for a discovered row."""
    has_source_evidence = bool(store.db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_evidence'"
    ).fetchone())
    has_page_versions = bool(store.db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_evidence_versions'"
    ).fetchone())
    capture_select = "(SELECT payload FROM source_evidence s WHERE s.opportunity_id=o.id ORDER BY s.id DESC LIMIT 1)" if has_source_evidence else "NULL"
    page_join = "LEFT JOIN page_evidence_versions p ON p.id=(SELECT id FROM page_evidence_versions v WHERE v.opportunity_id=o.id ORDER BY v.id DESC LIMIT 1)" if has_page_versions else "LEFT JOIN page_evidence p ON p.opportunity_id=o.id"
    return capture_select, page_join


def same_posting_url(requested: str, final: str) -> bool:
    """Accept IBM's locale redirect only when the public job ID is unchanged."""
    if requested == final:
        return True
    try:
        source, target = urlsplit(requested), urlsplit(final)
        source_query = parse_qs(source.query, keep_blank_values=True)
        target_query = parse_qs(target.query, keep_blank_values=True)
        return (source.scheme == target.scheme == "https"
                and source.netloc == target.netloc == "careers.ibm.com"
                and source.path == "/careers/JobDetail"
                and re.fullmatch(r"/[a-z]{2}_[A-Z]{2}/careers/JobDetail", target.path) is not None
                and not source.fragment and not target.fragment
                and len(source_query) == len(target_query) == 1
                and len(source_query.get("jobId", [])) == len(target_query.get("jobId", [])) == 1
                and re.fullmatch(r"\d+", source_query.get("jobId", [""])[0]) is not None
                and source_query == target_query)
    except (TypeError, ValueError):
        return False


def discovered_scan_source(opportunity: sqlite3.Row, refreshed: dict | None = None) -> dict:
    """Build one scan input only from a current, identity-bound source capture."""
    opportunity_id = str(opportunity["id"])
    capture = json.loads(opportunity["capture_payload"]) if opportunity["capture_payload"] else {}
    snapshot = (
        {"text": refreshed["text"], "retrieved_at": refreshed["retrieved_at"],
         "final_url": refreshed["url"], "content_hash": digest(refreshed["text"])}
        if refreshed and refreshed.get("status") == "captured"
        else capture.get("scan_jd") or {}
    )
    metadata = capture.get("_capture", {})
    jd = snapshot.get("text") or opportunity["content"] or ""
    captured_at = snapshot.get("retrieved_at") or metadata.get("retrieved_at", "")
    try:
        capture_age = (datetime.now(timezone.utc) - datetime.fromisoformat(captured_at.replace("Z", "+00:00"))).total_seconds()
    except (TypeError, ValueError):
        capture_age = float("inf")
    current_snapshot = (
        (refreshed is not None or (capture.get("url") or metadata.get("url")) == opportunity["url"])
        and same_posting_url(opportunity["url"], snapshot.get("final_url"))
        and isinstance(snapshot.get("text"), str)
        and snapshot.get("content_hash") == digest(snapshot["text"])
        and 0 <= capture_age < 86400
    )
    current_capture = current_snapshot or (
        metadata.get("method") in {"workday_cxs_api", "oraclecloud_detail_api", "smartrecruiters_detail_api", "successfactors_job_page", "phenom_job_page", "beesite_job_page", "ikea_job_page", "jibeapply_job_page", "avature_job_page", "eightfold_job_page", "mtr_taleo_job_page", "official_job_page", "browser_snapshot"}
        and metadata.get("status") == 200
        and metadata.get("url") == opportunity["url"]
        and metadata.get("content_hash") == digest(jd)
        and 0 <= capture_age < 86400
    )
    evidence = (
        {"method": "browser_snapshot", "status": "captured", "url": opportunity["url"],
         "final_url": snapshot.get("final_url"), "content_hash": snapshot.get("content_hash")}
        if current_snapshot else metadata if current_capture else {"reason": "No current verified source capture"}
    )
    return {
        "schema_version": "scan_input_v1", "opportunity_id": opportunity_id,
        "source_contract_version": 3,
        "url": opportunity["url"], "company": opportunity["company"], "role": opportunity["role"],
        "captured_at": captured_at or opportunity["captured_at"] or time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "capture_method": "browser_snapshot" if current_snapshot else metadata.get("method", "unknown"),
        "liveness": "active" if current_capture else "uncertain",
        "liveness_evidence": evidence,
        "location_evidence": capture.get("structured_posting", {}).get("jobLocation")
            or capture.get("jobPostingInfo", {}).get("location") or capture.get("location"),
        "employment_evidence": capture.get("structured_posting", {}).get("employmentType"),
        "jd": jd,
    }


def current_discovered_scan_source(opportunity: sqlite3.Row, directory: Path) -> dict:
    """Keep stale or missing evidence Unknown unless one guarded refresh succeeds."""
    source = discovered_scan_source(opportunity)
    if source["liveness"] == "active":
        return source
    refreshed = capture_jd(directory, opportunity["url"])
    return discovered_scan_source(opportunity, refreshed) if refreshed else source


def scan_discovered(directory: Path, opportunity_id: str, re_evaluate: bool = False) -> dict:
    """Start the scan graph from a retained provider capture by opportunity ID."""
    store = BusinessStore(directory / "opportunities.db")
    try:
        capture_select, page_join = discovery_query(store)
        row = store.db.execute(
            f"SELECT o.id,o.url,o.company,o.role,p.content,p.captured_at,{capture_select} AS capture_payload "
            f"FROM opportunities o {page_join} WHERE o.id=?", (opportunity_id,),
        ).fetchone()
        if not row:
            raise ValueError(f"Discovered opportunity not found: {opportunity_id}")
        if re_evaluate:
            refreshed = capture_jd(directory, row["url"], fresh=True)
            source = discovered_scan_source(row, refreshed)
            if not refreshed or source["liveness"] != "active" or source["captured_at"] != refreshed["retrieved_at"]:
                source = {**source, "liveness": "uncertain", "liveness_evidence": {"reason": "Fresh posting capture unavailable"}}
        else:
            source = current_discovered_scan_source(row, directory)
        waiting = store.db.execute(
            "SELECT task_id,input_hash FROM tasks WHERE opportunity_id=? AND module='scan' "
            "AND status='waiting' AND waiting_reason='source_access_unknown' ORDER BY rowid DESC LIMIT 1",
            (opportunity_id,),
        ).fetchone()
    finally:
        store.close()
    input_text = json.dumps(source, ensure_ascii=False)
    if waiting:
        if source["liveness"] == "active" and digest(canonical_scan_input(input_text)) != waiting["input_hash"]:
            return resume_task(directory, waiting["task_id"], input_text, None)
        return view(directory, waiting["task_id"])
    return start_and_run(directory, opportunity_id, "scan", input_text, None, re_evaluate)


def cron_score(directory: Path) -> dict:
    """Advance at most one discovered scanner record through scan and score."""
    store = BusinessStore(directory / "opportunities.db")
    stale_opportunity_id = None
    try:
        if not store.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='opportunities'").fetchone():
            return {"status": "idle", "reason": "scanner_store_not_initialized"}
        capture_select, page_join = discovery_query(store)
        opportunity = store.db.execute(
            f"""
            SELECT o.id,o.url,o.company,o.role,p.content,p.captured_at,{capture_select} AS capture_payload
            FROM opportunities o
            {page_join}
            WHERE NOT EXISTS (
              SELECT 1 FROM results r
              WHERE r.opportunity_id=CAST(o.id AS TEXT) AND r.module='score'
            )
            AND NOT EXISTS (
              SELECT 1 FROM results r
              WHERE r.rowid=(
                SELECT MAX(recent.rowid) FROM results recent
                WHERE recent.opportunity_id=CAST(o.id AS TEXT) AND recent.module='scan'
              ) AND json_extract(r.payload,'$.outcome')='exclude'
            )
            AND NOT EXISTS (
              SELECT 1 FROM tasks t
              WHERE t.opportunity_id=CAST(o.id AS TEXT) AND t.status='waiting'
                AND NOT (t.module='scan' AND t.waiting_reason='source_access_unknown')
                AND NOT (t.waiting_reason LIKE 'failure:%' AND t.attempt<2)
            )
            ORDER BY EXISTS(
              SELECT 1 FROM tasks t WHERE t.opportunity_id=CAST(o.id AS TEXT)
                AND t.status='waiting' AND t.waiting_reason LIKE 'failure:%'
            ), EXISTS(
              SELECT 1 FROM tasks t WHERE t.opportunity_id=CAST(o.id AS TEXT)
                AND t.status='waiting' AND t.module='scan'
            ), COALESCE((
              SELECT json_extract(c.payload,'$.at') FROM tasks t
              JOIN task_context c ON c.task_id=t.task_id AND c.key='source_probe'
              WHERE t.opportunity_id=CAST(o.id AS TEXT) AND t.status='waiting' AND t.module='scan'
            ), ''), o.id LIMIT 1
            """
        ).fetchone()
        if not opportunity:
            for item in store.score_views():
                if item["valid"] or item["stale_reason"] != "candidate_or_policy_inputs_changed":
                    continue
                candidate = item["opportunity_id"]
                scan = store.module_result(candidate, "scan")
                if not scan or scan["outcome"] != "jd_report" or store.db.execute(
                    "SELECT 1 FROM tasks WHERE opportunity_id=? AND status IN ('running','waiting')", (candidate,)
                ).fetchone():
                    continue
                stale_opportunity_id = candidate
                break
            if not stale_opportunity_id:
                return {"status": "idle", "reason": "no_unscored_opportunities"}
        else:
            opportunity_id = str(opportunity["id"])
            scan = store.module_result(opportunity_id, "scan")
            active = store.db.execute(
                "SELECT task_id,module,status,waiting_reason,input_hash FROM tasks WHERE opportunity_id=? AND status IN ('running','waiting')",
                (opportunity_id,),
            ).fetchone()
    finally:
        store.close()
    if stale_opportunity_id:
        refreshed = scan_discovered(directory, stale_opportunity_id, True)
        if refreshed["status"] != "completed" or refreshed["artifact"]["outcome"] != "jd_report":
            return {"status": refreshed["status"], "opportunity_id": stale_opportunity_id, "task": refreshed}
        result = start_and_run(directory, stale_opportunity_id, "score", f"scan:{stale_opportunity_id}", None, True)
        return {"status": "advanced", "opportunity_id": stale_opportunity_id, "task": result}
    if active:
        if active["status"] == "waiting" and active["waiting_reason"].startswith("failure:"):
            result = resume_task(directory, active["task_id"], None, None)
            return {"status": "advanced", "opportunity_id": opportunity_id, "task": result}
        if active["status"] == "waiting" and active["module"] == "scan" and active["waiting_reason"] == "source_access_unknown":
            source = current_discovered_scan_source(opportunity, directory)
            input_text = json.dumps(source, ensure_ascii=False)
            if source["liveness"] != "active" or digest(canonical_scan_input(input_text)) == active["input_hash"]:
                store = BusinessStore(directory / "opportunities.db")
                try:
                    store.set_context(active["task_id"], "source_probe", {"at": datetime.now(timezone.utc).isoformat()})
                finally:
                    store.close()
                return {"status": "waiting", "opportunity_id": opportunity_id, "reason": "source_access_unknown"}
            result = resume_task(directory, active["task_id"], input_text, None)
            return {"status": "advanced", "opportunity_id": opportunity_id, "task": result}
        result = run_task(directory, active["task_id"])
        return {"status": "advanced", "opportunity_id": opportunity_id, "task": result}
    if not scan:
        result = start_and_run(directory, opportunity_id, "scan", json.dumps(current_discovered_scan_source(opportunity, directory), ensure_ascii=False), None)
        return {"status": "advanced", "opportunity_id": opportunity_id, "task": result}
    if scan["outcome"] == "exclude":
        return {"status": "complete", "opportunity_id": opportunity_id, "outcome": "exclude"}
    result = start_and_run(directory, opportunity_id, "score", f"scan:{opportunity_id}", None)
    return {"status": "advanced", "opportunity_id": opportunity_id, "task": result}


def resume_task(
    directory: Path,
    task_id: str,
    input_text: str | None,
    crash_at: str | None,
    *,
    feedback: str | None = None,
    decision: str | None = None,
) -> dict:
    store = BusinessStore(directory / "opportunities.db")
    task = store.task(task_id)
    if task["module"] == "apply":
        if task["status"] == "completed" and decision == "confirm":
            store.confirm_apply(task_id, current_apply_input(store, task))
            store.close()
            return {"task_id": task_id, "status": "completed"}
        if task["status"] in ("completed", "cancelled"):
            store.close()
            raise ValueError(f"Terminal task cannot resume: {task['status']}")
        if input_text is not None:
            report_input = canonical_score_input(input_text)
            if not report_input.startswith("{"):
                store.close()
                raise ValueError("--input requires a jd_report_v1 JSON file")
            report = json.loads(report_input)["jd_report"]
            old = json.loads(task["input_payload"])["jd_report"]
            if report["opportunity_id"] != task["opportunity_id"]:
                store.close()
                raise ValueError("CLI opportunity does not match the JD report")
            difference = "\n".join(difflib.unified_diff(
                old["jd"].splitlines(), report["jd"].splitlines(), fromfile="current", tofile="new", lineterm=""
            ))
            store.set_context(task_id, "input_change", {"jd_report": report, "diff": difference})
            store.wait(task_id, "jd_changed")
            result = task_view(store, store.task(task_id))
            store.close()
            return result
        if decision == "defer":
            store.wait(task_id, "user_deferred")
            result = task_view(store, store.task(task_id))
            store.close()
            return result
        if decision == "confirm":
            current = current_apply_input(store, task)
            store.confirm_apply(task_id, current)
            store.close()
            return {"task_id": task_id, "status": "completed"}
        if decision == "accept-jd-change":
            store.db.execute("BEGIN IMMEDIATE")
            try:
                task = store.task(task_id)
                if task["status"] != "waiting":
                    raise ValueError("Apply task is no longer waiting")
                change = store.context(task_id, "input_change")
                if not change:
                    raise ValueError("No pending JD change")
                input_text = current_apply_input(store, task, change["jd_report"])
                store.clear_context(task_id, "input_change")
                task = store.reset_input(task_id, input_text)
                store.db.execute("COMMIT")
            except Exception:
                store.db.execute("ROLLBACK")
                store.close()
                raise
            store.close()
            return run_task(directory, task_id, start_state=initial_state(task), crash_at=crash_at)
        if feedback is not None:
            store.db.execute("BEGIN IMMEDIATE")
            try:
                task = store.task(task_id)
                if task["status"] != "waiting":
                    raise ValueError("Apply task is no longer waiting")
                if store.context(task_id, "input_change"):
                    raise ValueError("Resolve the pending JD change before feedback")
                previous = store.draft(task_id)
                store.add_feedback(task_id, feedback)
                input_text = current_apply_input(store, task)
                new_inputs = json.loads(input_text)
                feedbacks = new_inputs.get("feedback", [])
                reuse_previous = bool(previous and any(
                    digest(json.dumps({**new_inputs, "feedback": feedbacks[:index]}, ensure_ascii=False,
                                      sort_keys=True, separators=(",", ":"))) == previous["input_hash"]
                    for index in range(len(feedbacks))
                ))
                task = store.reset_input(task_id, input_text)
                store.db.execute("COMMIT")
            except Exception:
                store.db.execute("ROLLBACK")
                store.close()
                raise
            store.close()
            state = initial_state(task)
            if reuse_previous:
                state.update(
                    draft=json.dumps(previous["package"], ensure_ascii=False, sort_keys=True),
                    has_prior_package=True,
                )
            return run_task(directory, task_id, start_state=state, crash_at=crash_at)
        if task["status"] == "waiting" and str(task["waiting_reason"] or "").startswith("failure:"):
            store.resume_failed_checkpoint(task_id)
            store.close()
            return run_task(directory, task_id, crash_at=crash_at)
        store.close()
        raise ValueError("apply resume requires --feedback, --input, or --decision")
    if task["status"] in ("completed", "cancelled"):
        store.close()
        raise ValueError(f"Terminal task cannot resume: {task['status']}")
    if input_text is not None:
        input_text = canonical_scan_input(input_text) if task["module"] == "scan" else canonical_score_input(input_text)
        if task["module"] == "scan":
            store.retain_source(task["opportunity_id"], input_text)
    if input_text is not None:
        task = store.reset_input(task_id, input_text)
    elif task["status"] == "waiting":
        task = store.resume_current(task_id)
    store.close()
    return run_task(directory, task_id, start_state=initial_state(task), crash_at=crash_at)
