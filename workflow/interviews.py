"""Run source-grounded interview preparation, practice, debrief and learning as LangGraph tasks."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
from typing import TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from workflow.career_ops import digest as text_digest, score_inputs
from workflow.interview_context import INPUT_ROOT, load_context
from workflow.interview_evidence import match_stories
from workflow.interview_plan import build_preparation_plan
from workflow.interview_review import render_markdown
from workflow.interview_store import InterviewStore, REVIEW_CHECKS, digest, review_approved


ROOT = Path(__file__).resolve().parents[1]
MAX_CORRECTIONS = 2
MAX_MODEL_CALLS = 12
MAX_ELAPSED_SECONDS = 1800
SECTIONS = {
    "prepare": {"requirements", "story_matches", "timeline", "risk_questions"},
    "practice": {"questions", "answer_feedback", "learning"},
    "debrief": {"observations", "recruiting_risks", "learning"},
    "learn": {"themes", "actions", "sources"},
}


class InterviewState(TypedDict):
    task_id: str
    input_hash: str
    revision: int
    artifact: dict
    review: dict
    approved: bool
    validation_error: str | None
    waiting_reason: str | None


def current_context(directory: Path, opportunity_id: str) -> dict:
    """Ground interview work in the latest formal scan and current published score."""
    context = load_context(directory, opportunity_id, input_root=INPUT_ROOT)
    scan, score = (context["results"].get(name) for name in ("scan", "score"))
    if not scan or scan.get("outcome") != "jd_report":
        raise ValueError("A formal scan is required for interview work")
    if not score or score.get("outcome") != "score":
        raise ValueError("A formal score is required for interview work")
    report, opportunity = scan["artifact"], context["opportunity"]
    if (str(report.get("opportunity_id")) != str(opportunity["id"])
            or any(report.get(key) != opportunity[key] for key in ("url", "company", "role"))):
        raise ValueError("Interview scan does not match the canonical opportunity")
    if score.get("input_hash") != text_digest(score_inputs(scan["artifact"])):
        raise ValueError("Interview score is stale for current candidate or JD inputs")
    artifact = score["artifact"]
    if artifact.get("report_sha256") != text_digest(artifact.get("report", "")):
        raise ValueError("Interview score report is invalid")
    path = Path(artifact["path"])
    if not path.is_file() or path.read_text() != artifact["report"]:
        raise ValueError("Interview score report changed")
    return context


def validate_artifact(kind: str, artifact: dict, context: dict, plan: dict | None = None) -> None:
    """Exact source quotes are necessary; independent review checks substantive support."""
    if not isinstance(artifact, dict) or artifact.get("schema") != "career-ops/interview-artifact" or artifact.get("schema_version") != 1:
        raise ValueError("Interview artifact schema is invalid")
    sections, claims = artifact.get("sections"), artifact.get("claims")
    if isinstance(sections, dict) and "claims" in sections:
        raise ValueError("Interview claims must be top-level, not inside sections")
    if artifact.get("kind") != kind or not isinstance(sections, dict) or set(sections) != SECTIONS[kind]:
        raise ValueError("Interview artifact sections are incomplete")
    for name, value in sections.items():
        if not isinstance(value, (str, list, dict)) or not value or (isinstance(value, str) and not value.strip()):
            raise ValueError(f"Interview section {name} must contain substantive content")
    if kind == "prepare":
        narrative = json.dumps(sections, ensure_ascii=False)
        candidate_text = "\n".join(context["candidate_sources"].values())
        for match in re.finditer(r"\d+\.\d+\s*(?:年|years?)", narrative, re.IGNORECASE):
            if match.group() not in candidate_text:
                raise ValueError("Interview preparation presents a derived decimal tenure as a confirmed candidate fact")
        if plan is not None:
            requirements = sections["requirements"]
            expected = [item["requirement"] for item in plan["requirements"]]
            if (not isinstance(requirements, list) or len(requirements) != len(expected)
                    or any(not isinstance(item, dict) or not isinstance(item.get("requirement"), str)
                           or item.get("classification") not in {
                               "evidenced", "evidence_gap", "adjacent", "actual_gap", "unverified"
                           } or not isinstance(item.get("response"), str) or not item["response"].strip()
                           for item in requirements)
                    or {item["requirement"] for item in requirements} != set(expected)):
                raise ValueError("Interview preparation omits or duplicates a substantive frozen plan requirement")
        timeline = json.dumps(sections["timeline"], ensure_ascii=False)
        for match in re.finditer("已核实|已确认", timeline):
            clause = re.split(r'''[，。；;:"'\[\]{}]''', timeline[:match.start()])[-1][-40:]
            if (any(term in clause for term in (
                    "签证", "工作授权", "薪资", "薪酬", "工资", "雇主", "合同", "工作制", "工时", "加班", "年假", "ASMTP"))
                    and not any(marker in clause for marker in ("未", "不", "是否", "待"))):
                raise ValueError("Interview timeline presents an unresolved check as already confirmed")
    if not isinstance(claims, list):
        raise ValueError("Interview claims must be a list")
    candidate = context["candidate_sources"]
    name_match = re.search(r"^# [^\n|]+\|\s*([\u4e00-\u9fff]{2,4})\s*$", candidate.get("cv.md", ""), re.MULTILINE)
    candidate_name = name_match.group(1) if name_match else None
    jd = context["results"]["scan"]["artifact"]["jd"]
    for claim in claims:
        if not isinstance(claim, dict) or set(claim) != {"subject", "text", "source", "quote"}:
            raise ValueError("Interview claim is malformed")
        subject, source, quote = claim["subject"], claim["source"], claim["quote"]
        if not all(isinstance(claim[key], str) and claim[key].strip() for key in ("text", "source", "quote")):
            raise ValueError("Interview claim source and quote are required")
        if subject == "candidate":
            source_text = candidate.get(source)
            if candidate_name:
                named = re.search(
                    rf"(?:^|候选人[:：]?\s*)({re.escape(candidate_name[0])}[\u4e00-\u9fff]{{{len(candidate_name) - 1}}})",
                    claim["text"],
                )
                if named and named.group(1) != candidate_name:
                    raise ValueError("Interview claim changes the candidate's name")
        elif subject == "job" and source == "jd":
            source_text = jd
        else:
            raise ValueError(
                f"Interview claim has subject={subject!r}, source={source!r}; "
                "subject must be 'candidate' with a candidate source or 'job' with source 'jd'"
            )
        if not source_text or quote not in source_text:
            raise ValueError(f"Interview claim quote is absent from {source}: {quote!r}")
        if source == "interview-prep/story-bank.md":
            raise ValueError("Story-bank text cannot establish candidate facts")


def valid_review_shape(review: dict) -> bool:
    """Keep malformed model output out of the generation and publication paths."""
    checks = review.get("checks") if isinstance(review, dict) else None
    return (
        isinstance(review, dict) and review.get("verdict") in {"approve", "revise", "blocked"}
        and isinstance(checks, dict) and set(checks) == REVIEW_CHECKS
        and all(isinstance(item, dict) and item.get("status") in {"pass", "fail"}
                and isinstance(item.get("finding"), str) and item["finding"].strip()
                for item in checks.values())
        and all(isinstance(review.get(key), list) and all(isinstance(value, str) for value in review[key])
                for key in ("unsupported_claims", "required_changes"))
    )


def normalize_model_artifact(artifact: dict) -> dict:
    """Repair only unambiguous model field placement before strict validation."""
    sections = artifact.get("sections")
    if not isinstance(sections, dict):
        return artifact
    artifact = {**artifact, "sections": {**sections}}
    sections = artifact["sections"]
    if "claims" not in artifact and isinstance(sections.get("claims"), list):
        artifact["claims"] = sections.pop("claims")
    requirements = sections.get("requirements")
    if artifact.get("kind") == "prepare" and isinstance(requirements, list):
        sections["requirements"] = [
            {**{key: value for key, value in item.items() if key != "preparation_response"},
             "response": item["preparation_response"]}
            if isinstance(item, dict) and "response" not in item and "preparation_response" in item
            else item.copy() if isinstance(item, dict) else item for item in requirements
        ]
    return artifact


def restore_markdown_quotes(artifact: dict, context: dict) -> dict:
    """Restore a uniquely matched source quote when the model omitted Markdown emphasis."""
    sources = {**context["candidate_sources"], "jd": context["results"]["scan"]["artifact"]["jd"]}
    claims = artifact.get("claims")
    if not isinstance(claims, list):
        return artifact
    restored = []
    for claim in claims:
        if not isinstance(claim, dict) or not isinstance(claim.get("quote"), str):
            restored.append(claim)
            continue
        source, quote = sources.get(claim.get("source")), claim["quote"]
        if not source or quote in source or "*" in quote:
            restored.append(claim)
            continue
        plain = []
        positions = []
        for index, character in enumerate(source):
            if character != "*":
                plain.append(character)
                positions.append(index)
        plain_source = "".join(plain)
        if plain_source.count(quote) != 1:
            restored.append(claim)
            continue
        start = plain_source.index(quote)
        restored.append({**claim, "quote": source[positions[start]:positions[start + len(quote) - 1] + 1]})
    return {**artifact, "claims": restored}


def apply_review_patch(artifact: dict, patch: dict) -> dict:
    """Apply only explicit replacements to an already source-valid reviewed draft."""
    if not isinstance(patch, dict) or not patch or set(patch) - {"requirements", "sections", "claims"}:
        raise ValueError("Interview review patch has unsupported fields")
    updated = json.loads(json.dumps(artifact))
    sections = updated["sections"]
    if "requirements" in patch:
        replacements = patch["requirements"]
        if not isinstance(replacements, list) or not replacements:
            raise ValueError("Interview review patch requirements are invalid")
        labels = [item.get("requirement") for item in replacements if isinstance(item, dict)]
        existing = {item["requirement"] for item in sections.get("requirements", [])}
        if (len(labels) != len(replacements) or len(labels) != len(set(labels)) or not set(labels) <= existing
                or any(set(item) != {"requirement", "classification", "response"} for item in replacements)):
            raise ValueError("Interview review patch changes frozen requirement labels")
        by_label = {item["requirement"]: item for item in replacements}
        sections["requirements"] = [by_label.get(item["requirement"], item) for item in sections["requirements"]]
    if "sections" in patch:
        changed = patch["sections"]
        if not isinstance(changed, dict) or not changed or "requirements" in changed or not set(changed) <= set(sections):
            raise ValueError("Interview review patch sections are invalid")
        sections.update(changed)
    if "claims" in patch:
        if not isinstance(patch["claims"], list):
            raise ValueError("Interview review patch claims are invalid")
        updated["claims"] = patch["claims"]
    return updated


class Runtime:
    """Keep model calls isolated and business publication inside one explicit graph."""

    def __init__(self, store: InterviewStore, directory: Path):
        self.store = store
        self.directory = directory

    def call(self, phase: str, state: InterviewState) -> dict:
        task = self.store.task(state["task_id"])
        if task["model_calls"] >= MAX_MODEL_CALLS or task["elapsed_seconds"] >= MAX_ELAPSED_SECONDS:
            raise TimeoutError("interview_model_budget_exhausted")
        if os.environ.get("CAREER_OPS_INTERVIEW_MODEL_ENABLED") != "1":
            raise RuntimeError("Interview model use is disabled pending interview-data authorization")
        command = os.environ.get("CAREER_OPS_INTERVIEW_RUNNER")
        if not command:
            command = f"{sys.executable} -B -m workflow.interview_model"
        payload = {
            "phase": phase,
            "kind": task["kind"],
            "input": json.loads(task["input_payload"]),
            "feedback": self.store.feedback_history(state["task_id"]),
            "revision": state["revision"],
            "previous_artifact": (None if phase == "draft" and state.get("validation_error")
                                  else state.get("artifact") or self.store.draft(state["task_id"])),
            "previous_review": state.get("review"),
        }
        started = time.monotonic()
        try:
            try:
                result = subprocess.run(
                    shlex.split(command), input=json.dumps(payload, ensure_ascii=False), text=True,
                    capture_output=True, timeout=min(300, MAX_ELAPSED_SECONDS - task["elapsed_seconds"]),
                    cwd=ROOT, check=False,
                )
            except subprocess.TimeoutExpired as error:
                raise TimeoutError("Interview model call timed out") from error
        finally:
            self.store.add_usage(state["task_id"], time.monotonic() - started)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or f"Interview runner exited {result.returncode}")
        if not result.stdout.strip():
            raise RuntimeError(f"Interview runner returned no JSON: {result.stderr[-500:].strip() or 'empty stderr'}")
        value = json.loads(result.stdout)
        if not isinstance(value, dict):
            raise ValueError("Interview runner must return one JSON object")
        return value

    def generate(self, state: InterviewState) -> dict:
        task = self.store.task(state["task_id"])
        frozen = json.loads(task["input_payload"])
        revising = bool(state.get("artifact") and state.get("review", {}).get("verdict") == "revise"
                        and not state.get("validation_error"))
        output = self.call("revise" if revising else "draft", state)
        artifact = apply_review_patch(state["artifact"], output) if revising else normalize_model_artifact(output)
        artifact = restore_markdown_quotes(artifact, frozen["context"])
        try:
            validate_artifact(task["kind"], artifact, frozen["context"], frozen.get("preparation_plan"))
            validation_error = None
        except ValueError as error:
            validation_error = str(error)
        if state["revision"] and digest(artifact) == digest(state["artifact"]):
            raise ValueError("Interview revision repeated the rejected artifact unchanged")
        return {"artifact": artifact, "validation_error": validation_error}

    def review(self, state: InterviewState) -> dict:
        if state["validation_error"]:
            error = state["validation_error"]
            decision = {"verdict": "revise", "checks": {
                name: {"status": "fail", "finding": f"Not evaluated: {error}"}
                for name in ("source_grounding", "ownership", "session_scope", "recruiting_risk", "completeness")
            }, "unsupported_claims": [error], "required_changes": [error]}
            return {"review": decision, "approved": False, "revision": state["revision"] + 1}
        decision = self.call("review", state)
        if not valid_review_shape(decision):
            decision = self.call("review", {**state, "review": {
                "format_error": "Return exactly five checks with pass/fail status and nonempty finding, plus both arrays",
            }})
        if not valid_review_shape(decision):
            raise ValueError("Independent interview review is malformed")
        approved = review_approved(decision)
        return {"review": decision, "approved": approved, "revision": state["revision"] + (0 if approved else 1)}

    @staticmethod
    def route(state: InterviewState) -> str:
        if state["approved"] or state["revision"] > MAX_CORRECTIONS:
            return "stage"
        return "generate"

    def stage(self, state: InterviewState) -> dict:
        task = self.store.task(state["task_id"])
        original = json.loads(task["input_payload"])
        current = current_context(self.directory, task["opportunity_id"])
        if digest(current) != original["context_hash"]:
            return {"waiting_reason": "input_changed"}
        self.store.stage(state["task_id"], state["input_hash"], state["artifact"], state["review"])
        return {"waiting_reason": "user_review" if state["approved"] else "review_budget_exhausted"}

    def graph(self, saver: SqliteSaver, *, review_existing: bool = False):
        graph = StateGraph(InterviewState)
        graph.add_node("generate", self.generate)
        graph.add_node("review", self.review)
        graph.add_node("stage", self.stage)
        graph.add_edge(START, "review" if review_existing else "generate")
        graph.add_edge("generate", "review")
        graph.add_conditional_edges("review", self.route, {"generate": "generate", "stage": "stage"})
        graph.add_edge("stage", END)
        return graph.compile(checkpointer=saver)


def task_view(store: InterviewStore, task_id: str) -> dict:
    task = store.task(task_id)
    result = store.result(task_id)
    return {
        "task_id": task_id, "opportunity_id": task["opportunity_id"], "session_key": task["session_key"],
        "kind": task["kind"], "status": task["status"], "reason": task["waiting_reason"],
        "attempt": task["attempt"], "model_calls": task["model_calls"],
        "artifact": result if result is not None else store.draft(task_id),
    }


def run_task(directory: Path, task_id: str, *, resume_checkpoint: bool = False, review_existing: bool = False) -> dict:
    locks = directory / ".locks"
    locks.mkdir(parents=True, exist_ok=True)
    with (locks / f"interview-{task_id}.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError(f"Interview task is already executing: {task_id}") from error
        return _run_task(directory, task_id, resume_checkpoint=resume_checkpoint, review_existing=review_existing)


def _run_task(directory: Path, task_id: str, *, resume_checkpoint: bool = False, review_existing: bool = False) -> dict:
    store = InterviewStore(directory / "opportunities.db")
    try:
        task = store.task(task_id)
        if task["status"] != "running":
            return task_view(store, task_id)
        state: InterviewState = {
            "task_id": task_id, "input_hash": task["input_hash"], "revision": 0,
            "artifact": {}, "review": {}, "approved": False, "validation_error": None, "waiting_reason": None,
        }
        if review_existing:
            state["artifact"] = normalize_model_artifact(store.draft(task_id)["artifact"])
        with SqliteSaver.from_conn_string(str(directory / "workflow-checkpoints.db")) as saver:
            graph = Runtime(store, directory).graph(saver, review_existing=review_existing)
            config = {"configurable": {"thread_id": f"interview:{task_id}:{task['attempt']}"}}
            if resume_checkpoint and not saver.get_tuple(config):
                raise ValueError("Interview checkpoint is missing; cannot resume failed model call")
            value = graph.invoke(None if resume_checkpoint else state, config)
        if value.get("waiting_reason") and store.task(task_id)["status"] == "running":
            store.wait(task_id, value["waiting_reason"])
        return task_view(store, task_id)
    except Exception as error:
        if store.task(task_id)["status"] == "running":
            store.wait(task_id, f"failure:{type(error).__name__}")
        raise
    finally:
        store.close()


def start(directory: Path, opportunity_id: str, session_key: str, kind: str, request: dict) -> dict:
    if kind not in SECTIONS:
        raise ValueError("Unknown interview action")
    if kind == "debrief" and (not isinstance(request.get("transcript"), str) or not request["transcript"].strip()):
        raise ValueError("Debrief requires the user's interview transcript")
    context = current_context(directory, opportunity_id)
    context_hash = digest(context)
    store = InterviewStore(directory / "opportunities.db")
    try:
        session_history = store.history(opportunity_id, session_key)
        for prior in store.db.execute(
            "SELECT task_id,input_payload FROM interview_tasks WHERE opportunity_id=? AND session_key=? AND kind=? ORDER BY rowid DESC",
            (opportunity_id, session_key, kind),
        ):
            previous = json.loads(prior["input_payload"])
            history_unchanged = kind != "learn" or (
                [item for item in previous["history"] if item["kind"] != "learn"]
                == [item for item in session_history if item["kind"] != "learn"]
            )
            if previous["context_hash"] == context_hash and previous["request"] == request and history_unchanged:
                task = store.task(prior["task_id"])
                task_id, status = task["task_id"], task["status"]
                break
        else:
            if kind == "learn" and not session_history:
                raise ValueError("Learning summary requires confirmed session history")
            payload = {"context": context, "context_hash": context_hash, "request": request,
                       "history": session_history}
            if kind == "practice" and isinstance(request.get("question"), str) and request["question"].strip() and context.get("story_bank"):
                payload["story_matches"] = match_stories(
                    context["story_bank"], request["question"], context["results"]["scan"]["artifact"]["jd"], top=3,
                )
            if kind == "prepare":
                scan, score = (context["results"][name]["artifact"] for name in ("scan", "score"))
                candidate = context["candidate_sources"]
                payload["preparation_plan"] = build_preparation_plan(
                    company=context["opportunity"]["company"], role=context["opportunity"]["role"],
                    jd_text=scan["jd"], cv_text=candidate["cv.md"],
                    profile_text=candidate["config/profile.yml"], report_text=score["report"],
                    sources={"jd": "published-scan", "cv": "cv.md", "profile": "config/profile.yml", "report": "published-score"},
                )
            task = store.start(opportunity_id, session_key, kind, payload)
            task_id, status = task["task_id"], task["status"]
    finally:
        store.close()
    return run_task(directory, task_id) if status == "running" else show(directory, task_id)


def show(directory: Path, task_id: str) -> dict:
    store = InterviewStore(directory / "opportunities.db")
    try:
        return task_view(store, task_id)
    finally:
        store.close()


def show_markdown(directory: Path, task_id: str) -> str:
    """Read the persisted review version and present it without advancing the task."""
    store = InterviewStore(directory / "opportunities.db")
    try:
        task = store.task(task_id)
        context = json.loads(task["input_payload"])["context"]
        return render_markdown(task_view(store, task_id), context)
    finally:
        store.close()


def resume(directory: Path, task_id: str, *, feedback: str | None = None, recheck: bool = False) -> dict:
    store = InterviewStore(directory / "opportunities.db")
    try:
        task = store.task(task_id)
        if task["status"] != "waiting":
            raise ValueError("Only waiting interview tasks can resume")
        if recheck and (feedback is not None or task["waiting_reason"] != "review_budget_exhausted"):
            raise ValueError("Recheck requires one unapproved reviewed draft and no feedback")
        if task["waiting_reason"] == "input_changed":
            raise ValueError("Interview sources changed; start a new task with current sources")
        if feedback is None and not recheck and task["waiting_reason"] in {"user_review", "review_budget_exhausted"}:
            raise ValueError("Interview draft requires feedback or confirmation")
        context = current_context(directory, task["opportunity_id"])
        if digest(context) != json.loads(task["input_payload"])["context_hash"]:
            raise ValueError("Interview sources changed; start a new task with current sources")
        if recheck:
            draft = store.draft(task_id)
            if not draft or draft["approved"]:
                raise ValueError("Recheck requires an unapproved interview draft")
            if task["model_calls"] >= MAX_MODEL_CALLS or task["elapsed_seconds"] >= MAX_ELAPSED_SECONDS:
                raise ValueError("Interview model budget is exhausted")
            validate_artifact(task["kind"], normalize_model_artifact(draft["artifact"]), context,
                              json.loads(task["input_payload"]).get("preparation_plan"))
        resume_checkpoint = feedback is None and (task["waiting_reason"] or "").startswith("failure:")
        if feedback is not None:
            store.feedback(task_id, feedback)
        else:
            updated = store.db.execute(
                "UPDATE interview_tasks SET status='running',waiting_reason=NULL,attempt=attempt+? "
                "WHERE task_id=? AND status='waiting' AND waiting_reason IS ?",
                (0 if resume_checkpoint else 1, task_id, task["waiting_reason"]),
            )
            if updated.rowcount != 1:
                raise ValueError("Interview task already advanced; refresh before resuming")
    finally:
        store.close()
    return run_task(directory, task_id, resume_checkpoint=resume_checkpoint, review_existing=recheck)


def confirm(directory: Path, task_id: str) -> dict:
    store = InterviewStore(directory / "opportunities.db")
    try:
        task = store.task(task_id)
        if task["status"] == "completed":
            artifact = store.confirm(task_id, task["input_hash"])
            return {"task_id": task_id, "status": "completed", "artifact": artifact}
        original = json.loads(task["input_payload"])
        current = current_context(directory, task["opportunity_id"])
        if digest(current) != original["context_hash"]:
            raise ValueError("Interview sources changed; regenerate before confirmation")
        draft = store.draft(task_id)
        if draft and draft["approved"]:
            validate_artifact(task["kind"], draft["artifact"], current, original.get("preparation_plan"))
        artifact = store.confirm(task_id, task["input_hash"])
        return {"task_id": task_id, "status": "completed", "artifact": artifact}
    finally:
        store.close()


def history(directory: Path, opportunity_id: str, session_key: str) -> list[dict]:
    store = InterviewStore(directory / "opportunities.db")
    try:
        return store.history(opportunity_id, session_key)
    finally:
        store.close()


def main() -> None:
    cli = argparse.ArgumentParser()
    cli.add_argument("--directory", type=Path, default=ROOT / "data")
    commands = cli.add_subparsers(dest="command", required=True)
    begin = commands.add_parser("start")
    begin.add_argument("kind", choices=tuple(SECTIONS))
    begin.add_argument("opportunity_id")
    begin.add_argument("session_key")
    begin.add_argument("--request", default="{}", help="JSON object with timing, question or transcript")
    show_command = commands.add_parser("show")
    show_command.add_argument("task_id")
    show_command.add_argument("--format", choices=("json", "markdown"), default="json")
    resume_command = commands.add_parser("resume")
    resume_command.add_argument("task_id")
    resume_command.add_argument("--feedback")
    resume_command.add_argument("--recheck", action="store_true")
    confirm_command = commands.add_parser("confirm")
    confirm_command.add_argument("task_id")
    history_command = commands.add_parser("history")
    history_command.add_argument("opportunity_id")
    history_command.add_argument("session_key")
    args = cli.parse_args()
    try:
        if args.command == "start":
            request = json.loads(args.request)
            if not isinstance(request, dict):
                raise ValueError("Interview request must be a JSON object")
            value = start(args.directory, args.opportunity_id, args.session_key, args.kind, request)
        elif args.command == "show":
            value = show_markdown(args.directory, args.task_id) if args.format == "markdown" else show(args.directory, args.task_id)
        elif args.command == "resume":
            value = resume(args.directory, args.task_id, feedback=args.feedback, recheck=args.recheck)
        elif args.command == "history":
            value = history(args.directory, args.opportunity_id, args.session_key)
        else:
            value = confirm(args.directory, args.task_id)
        print(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))
    except (OSError, ValueError, RuntimeError, TimeoutError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
