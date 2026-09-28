"""Import untrusted employer replies and persist reviewable application suggestions."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path
from typing import TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

try:
    from workflow.application_lifecycle import ApplicationStore, mutate
    from workflow.company_keys import normalize_company
except ModuleNotFoundError:
    from application_lifecycle import ApplicationStore, mutate
    from company_keys import normalize_company


KEYWORDS = {
    "noise": ("邀请投递", "抢面试先机", "近期热招", "立即投递", "热招职位", "订阅职位", "职位推荐", "推荐职位", "job alert", "invitation to apply", "recommended jobs", "newsletter", "marketing digest", "job recommendation", "suggested jobs"),
    "rejected": ("很遗憾", "暂不匹配", "不合适", "未能进入下一轮", "感谢您的时间", "未通过", "不再考虑", "决定不推进", "unfortunately", "not a match", "not matching", "decided not to proceed", "will not be moving forward", "position has been filled", "role has been closed", "unable to offer"),
    "offer": ("录取通知书", "录用信", "录用通知", "录用", "薪资确认", "入职协议", "意向书", "offer letter", "employment agreement", "job offer", "congratulations on the offer", "compensation details", "pleased to offer"),
    "auto": ("自动回复", "收到您的申请", "申请已收到", "投递成功", "确认收到", "thank you for applying", "application received", "received your application", "auto-confirmation", "confirmation of application", "automatic reply"),
    "action": ("补充信息", "提供信息", "完成测评", "在线测评", "笔试题", "做个测试", "截止日期前", "截止时间", "complete a form", "provide information", "finish an assessment", "coding challenge", "online test", "respond by a deadline", "pick a time", "schedule a time", "book a time", "complete assessment", "take a test", "assessment", "coding test", "deadline", "fill out", "complete the form", "provide details", "submit info"),
    "interview": ("邀您面试", "邀约面试", "微信小程序面试", "AI微信小程序", "面试形式", "面试时间", "面试时长", "安排面试", "预约面试", "首轮面试", "视频面试", "电话面试", "现场面试", "面试邀请", "面试流程", "简历通过", "interview invitation", "schedule an interview", "scheduling link", "ai interview", "video interview", "phone screen", "onsite interview", "final round", "invite you to interview", "interview request", "interview schedule"),
    "responded": ("联系您", "回复您", "想沟通", "想聊聊", "进一步沟通", "would like to chat", "reach out", "connect with you", "hiring manager responded"),
}
SCHEDULING = ("schedule", "pick a time", "book a time", "book a slot", "choose a time", "select a time", "appointment", "预约", "选择时间", "选择面试", "安排时间")
GENERIC_ROLE_WORDS = {"talent", "acquisition", "specialist", "coordinator", "operations", "recruiter", "recruiting", "human", "resources", "people"}
SHARED_DOMAINS = ("linkedin.com", "applytojob.com", "greenhouse.io", "lever.co", "icims.com", "myworkday.com", "ashbyhq.com", "smartrecruiters.com", "taleo.net", "successfactors.com", "gmail.com", "outlook.com", "yahoo.com", "hotmail.com")
FILE_EXTENSIONS = {"pdf", "md", "doc", "docx", "txt", "html", "htm", "png", "jpg", "jpeg", "csv", "tsv", "json", "yaml", "yml", "mjs"}
POST_APPLICATION = ("interview", "offer", "rejection", "邀您面试", "简历通过", "next steps", "update on your application")
STRONG_REJECTION = ("not been selected to advance", "not selected for this position", "not selected for this role", "not moving forward with your application", "decided not to move forward", "decided to move forward with other candidates", "pursue other candidates", "pursuing other candidates", "other candidates whose qualifications", "not able to offer you a position")
WEAK_REJECTION = ("unfortunately", "not been selected", "will not be moving forward", "not successful", "regret to inform", "will not be proceeding", "unable to offer you")
INVITE_PHRASES = ("schedule your phone screen", "schedule your interview", "phone screen", "interviewing with", "interview with", "would like to invite you", "invite you to interview", "next steps in the interview process", "move you forward to the next round", "like to set up a time", "like to set up a call", "book a time")


def classify(message: dict) -> dict:
    """Preserve Node's ordered deterministic decision policy."""
    content = " ".join(str(message.get(key) or "") for key in ("from", "subject", "body_snippet"))
    lower = content.lower()
    signal = message.get("signal")
    for kind, status, explicit in (
        ("noise", None, None), ("rejected", "rejected", "rejection"),
        ("offer", "offer", "offer"), ("auto", None, None),
        ("action", None, None), ("interview", "interview", "interview_invite"),
        ("responded", "responded", "update"),
    ):
        evidence = [word for word in KEYWORDS[kind] if word.lower() in lower]
        if kind == "noise" and evidence:
            return {"type": "Noise", "suggested": None, "evidence": evidence}
        if kind != "noise" and (evidence or signal == explicit and explicit is not None):
            if signal == explicit and explicit not in evidence:
                evidence.append(explicit)
            if kind == "action":
                status = "interview" if any(word.lower() in lower for word in SCHEDULING) else "responded"
            return {"type": {"rejected": "Rejected", "offer": "Offer", "auto": "Auto-confirmation", "action": "Need Action", "interview": "Interview", "responded": "Responded"}[kind], "suggested": status, "evidence": evidence}
    return {"type": "Unknown", "suggested": None, "evidence": []}


def invite_signals(message: dict) -> dict:
    """Extract only unambiguous date, requisition and call-medium hints."""
    text = "\n".join(str(message.get(key) or "") for key in ("subject", "body_snippet"))
    lower = text.lower()
    strong = [phrase for phrase in STRONG_REJECTION if phrase in lower]
    weak = [phrase for phrase in WEAK_REJECTION if phrase in lower]
    invites = [phrase for phrase in INVITE_PHRASES if phrase in lower]
    kind = "rejection" if strong or len(weak) >= 2 else "invite" if invites else "unknown"
    iso = re.search(r"\b\d{4}-\d{2}-\d{2}\b", text)
    date_value = iso.group() if iso else None
    if not date_value:
        named = re.search(r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b", text, re.I)
        if named:
            from datetime import datetime
            month = datetime.strptime(named.group(1), "%B").month
            date_value = f"{named.group(3)}-{month:02d}-{int(named.group(2)):02d}"
    company = None
    for pattern in (r"(?:^|\n)\s*company\s*[:\-]\s*(.+)",
                    r"interview(?:ing)?\s+(?:with|at)\s+([A-Z][\w.,&' -]{1,60}?)(?:[.,\n]|\s+for\s|\s+regarding\s|$)",
                    r"(?:phone screen|screening|interview)\s*[-–—:]\s*([A-Z][\w.,&' -]{1,60}?)(?:\s+opportunity)?(?:[.,\n]|$)",
                    r"schedule your (?:phone screen|interview)\s*(?:[-–—:]\s*)?([A-Z][\w.,&' -]{1,60}?)\s*opportunity"):
        found = re.search(pattern, text, re.I)
        if found and 2 <= len(found.group(1).strip(" .,;:")) <= 60:
            company = found.group(1).strip(" .,;:")
            break
    req = re.search(r"\b(?:req(?:uisition)?\.?\s*(?:id)?[:\s#]*|job\s*id[:\s#]*)([A-Z]{0,3}\d{3,10})\b|\b([A-Z]{1,3}\d{5,10})\b", text, re.I)
    platform = None
    for name, host in (("Zoom", "zoom.us"), ("Microsoft Teams", "teams.microsoft.com"), ("Microsoft Teams", "teams.live.com"), ("Google Meet", "meet.google.com"), ("Alex", "alex.com"), ("HireVue", "hirevue.com")):
        if any(url.hostname == host or (url.hostname or "").endswith("." + host) for url in _urls(text)):
            platform = name
            break
    if not platform and re.search(r"(?:\+?\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b", text):
        platform = "Phone"
    return {"classification": kind, "matched_phrases": strong + weak if kind == "rejection" else invites if kind == "invite" else [],
            "phrase_strength": "strong" if strong else "weak" if kind == "rejection" else None,
            "company": company, "date": date_value, "req_id": (req.group(1) or req.group(2)) if req else None,
            "platform": platform, "is_ai_interviewer": platform == "Alex"}


def _urls(text: str):
    from urllib.parse import urlsplit
    for candidate in re.findall(r"https?://[^\s<>]+|(?<![\w@./?=&#-])(?:[\w-]+\.)?(?:zoom\.us|teams\.(?:microsoft|live)\.com|meet\.google\.com|alex\.com|hirevue\.com)(?::\d{1,5})?(?:/[^\s<>]*)?", text, re.I):
        candidate = candidate.rstrip(".,;:)")
        yield urlsplit(candidate if candidate.startswith(("http://", "https://")) else "https://" + candidate)


def parse_pasted(raw: str) -> dict:
    """Read the existing Subject/From/body paste format with stable deduplication."""
    lines = raw.replace("\r\n", "\n").split("\n")
    subject = sender = ""
    index = 0
    while index < len(lines):
        found = re.fullmatch(r"(Subject|From):\s*(.*)", lines[index], re.I)
        if not found:
            break
        if found.group(1).lower() == "subject":
            subject = found.group(2).strip()
        else:
            sender = found.group(2).strip()
        index += 1
    if index < len(lines) and not lines[index]:
        index += 1
    body = "\n".join(lines[index:]).strip()
    return {"message_id": "pasted-" + hashlib.sha256(raw.encode()).hexdigest()[:24],
            "from": sender, "subject": subject, "body_snippet": body, "signal": None}


def _compact(value: str) -> str:
    return "".join(value.lower().split())


def _company_match(text: str, company: str) -> bool:
    if not company or not any(char.isalnum() for char in company):
        return False
    short = sum(char.isalnum() for char in company) <= 3
    unseparated = any("CJK" in unicodedata.name(char, "") or "HIRAGANA" in unicodedata.name(char, "") or "KATAKANA" in unicodedata.name(char, "") for char in company)
    if short and not unseparated:
        return re.search(r"(?<!\w)" + re.escape(company) + r"(?!\w)", text, re.I) is not None
    if company.casefold() in text.casefold() or len(_compact(company)) > 2 and _compact(company) in _compact(text):
        return True
    chinese = company.replace("有限公司", "").replace("公司", "").replace("股份", "").replace("集团", "").strip()
    return len(chinese) >= 2 and chinese in text


def _role_match(text: str, role: str) -> tuple[bool, bool]:
    parts = [part for part in re.split(r"[\s_\\/()-]+", role) if part]
    exact = len(parts) != 1 or bool(re.search(r"[一-鿿㐀-䶿]", role))
    exact = exact and bool(_compact(role)) and _compact(role) in _compact(text)
    partial = any(len(part) > 3 and part.lower() not in GENERIC_ROLE_WORDS and _compact(part) in _compact(text) for part in parts)
    return exact, partial


def _domain(sender: str) -> str | None:
    found = re.search(r"@([\w.-]+)", sender)
    return found.group(1).lower() if found else None


def _usable_domain(domain: str) -> bool:
    return (bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}", domain))
            and domain.rsplit(".", 1)[-1] not in FILE_EXTENSIONS
            and not any(domain == shared or domain.endswith("." + shared) for shared in SHARED_DOMAINS))


def _application_domains(company: str, notes: str) -> set[str]:
    domains = {_domain(email) for email in re.findall(r"[\w.-]+@[\w.-]+\.\w+", notes)}
    domains.update(word.strip(".,:;()[]<>").lower() for word in notes.split() if "." in word and "@" not in word)
    name = _compact(company)
    if name and name != "?":
        domains.update(name + suffix for suffix in (".com", ".co", ".io"))
    return {domain for domain in domains if domain and _usable_domain(domain)}


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0
    if left == right:
        return 1
    a, b = left.split(), right.split()
    if len(a) > len(b):
        a, b = b, a
    overlap = sum(token in set(b) for token in a)
    return 2 * overlap / (len(a) + len(b)) if overlap else 0


def invite_candidates(signals: dict, applications: list[dict]) -> list[dict]:
    """Rank plausible same-company applications, retaining every candidate."""
    target = normalize_company(signals.get("company") or "")
    if not target:
        return []
    priority = {"interview": 0, "responded": 1, "applied": 2, "offer": 4, "rejected": 5, "discarded": 6}
    candidates = []
    for app in applications:
        name_score = _similarity(target, normalize_company(app["company"]))
        if name_score <= 0:
            continue
        req = signals.get("req_id")
        req_match = bool(req and req.lower() in app.get("notes", "").lower())
        rank = priority.get(app.get("status"), 8)
        candidates.append({"opportunity_id": app["id"], "company": app["company"], "role": app["role"],
                           "status": app.get("status"), "name_score": name_score, "req_id_match": req_match,
                           "match_confidence": round(name_score + 0.5 * req_match + (7 - min(rank, 7)) * 0.01, 3)})
    return sorted(candidates, key=lambda item: (-item["match_confidence"], item["opportunity_id"]))


def match(message: dict, applications: list[dict]) -> dict:
    """Use corroborated role evidence and refuse tied or weak attribution."""
    text = " ".join(str(message.get(key) or "") for key in ("from", "subject", "body_snippet"))
    sender_domain = _domain(str(message.get("from") or ""))
    ranked = []
    for app in applications:
        company = _company_match(text, app["company"])
        domain = sender_domain is not None and any(sender_domain == d or sender_domain.endswith("." + d) for d in _application_domains(app["company"], app.get("notes", "")))
        exact, partial = _role_match(text, app["role"])
        role = exact or partial and (company or domain)
        score = 2 * company + 2 * domain + 1.5 * role
        if score == 0:
            continue
        post = message.get("signal") in {"interview_invite", "offer", "rejection"} or any(word in text.lower() for word in POST_APPLICATION)
        confidence = "high" if (company or domain) and (role or post) else "medium" if company or domain else "low"
        signals = [name for present, name in ((company, "company-name"), (domain, "sender-domain"), (role, "role-title"), (post and (company or domain), "post-application-keyword")) if present]
        ranked.append((score, {"opportunity_id": app["id"], "confidence": confidence, "signals": signals}))
    if not ranked:
        return {"opportunity_id": None, "confidence": "low", "signals": ["no-match"]}
    best = max(item[0] for item in ranked)
    winners = [item[1] for item in ranked if item[0] == best]
    if len(winners) != 1:
        return {"opportunity_id": None, "confidence": "low", "signals": ["ambiguous-match"], "candidates": [item["opportunity_id"] for item in winners]}
    return winners[0]


class ReplyState(TypedDict):
    message: dict
    applications: list[dict]
    classification: dict
    invite: dict
    match: dict
    invite_candidates: list[dict]


def _classify(state: ReplyState) -> dict:
    result = classify(state["message"])
    invite = invite_signals(state["message"])
    if result["type"] == "Unknown" and invite["classification"] in {"rejection", "invite"}:
        result = {"type": "Rejected" if invite["classification"] == "rejection" else "Interview",
                  "suggested": "rejected" if invite["classification"] == "rejection" else "interview",
                  "evidence": invite["matched_phrases"]}
    return {"classification": result, "invite": invite}


def _match(state: ReplyState) -> dict:
    return {"match": match(state["message"], state["applications"]),
            "invite_candidates": invite_candidates(state["invite"], state["applications"])}


def _graph(saver: SqliteSaver):
    graph = StateGraph(ReplyState)
    graph.add_node("classify", _classify)
    graph.add_node("match", _match)
    graph.add_edge(START, "classify")
    graph.add_edge("classify", "match")
    graph.add_edge("match", END)
    return graph.compile(checkpointer=saver)


def import_reply(directory: Path, message: dict) -> dict:
    """Save original evidence and one suggestion without changing lifecycle status."""
    if not isinstance(message, dict) or not isinstance(message.get("message_id"), str) or not message["message_id"].strip():
        raise ValueError("message_id is required")
    if not all(isinstance(message.get(key, ""), str) for key in ("from", "subject", "body_snippet")):
        raise ValueError("Reply fields must be strings")
    if message.get("signal") is not None and not isinstance(message["signal"], str):
        raise ValueError("Reply signal must be a string")
    if not (message.get("subject") or message.get("body_snippet")):
        raise ValueError("Reply subject or body is required")
    directory.mkdir(parents=True, exist_ok=True)
    ApplicationStore(directory / "opportunities.db").close()
    db = sqlite3.connect(directory / "opportunities.db", timeout=5, isolation_level=None)
    db.row_factory = sqlite3.Row
    try:
        db.execute("""CREATE TABLE IF NOT EXISTS inbound_replies (
            message_id TEXT PRIMARY KEY, source TEXT NOT NULL, raw TEXT NOT NULL,
            classification TEXT NOT NULL, invite TEXT NOT NULL, match TEXT NOT NULL,
            invite_candidates TEXT NOT NULL, suggested_status TEXT,
            confirmed_opportunity_id TEXT, confirmed_status TEXT, confirmation_reason TEXT,
            confirmed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
        raw = json.dumps(message, ensure_ascii=False, sort_keys=True)
        prior = db.execute("SELECT * FROM inbound_replies WHERE message_id=?", (message["message_id"],)).fetchone()
        if prior:
            if prior["raw"] != raw:
                raise ValueError("message_id conflicts with different reply evidence")
            result = _view(prior, reused=True)
            _record_suggestion(directory, result)
            return result
        applications = []
        has_opportunities = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='opportunities'").fetchone()
        for row in db.execute("""SELECT o.id,o.company,o.role,e.payload FROM application_lifecycle l
                JOIN opportunities o ON o.id=l.opportunity_id
                JOIN application_events e ON e.id=(SELECT id FROM application_events WHERE opportunity_id=o.id AND to_status='applied' ORDER BY id LIMIT 1)""") if has_opportunities else []:
            payload = json.loads(row["payload"])
            followups = [json.loads(item["payload"]) for item in db.execute(
                "SELECT payload FROM application_activity WHERE opportunity_id=? AND type='followup_sent'",
                (str(row["id"]),)
            )]
            notes = [payload.get("notes")]
            notes.extend(item.get("notes") for item in followups)
            applications.append({"id": str(row["id"]), "company": row["company"], "role": row["role"],
                                 "status": db.execute("SELECT status FROM application_lifecycle WHERE opportunity_id=?", (str(row["id"]),)).fetchone()[0],
                                 "notes": "\n".join(item for item in notes if isinstance(item, str))})
        with SqliteSaver.from_conn_string(str(directory / "workflow-checkpoints.db")) as saver:
            state = _graph(saver).invoke({"message": message, "applications": applications, "classification": {}, "invite": {}, "match": {}, "invite_candidates": []},
                                         {"configurable": {"thread_id": "reply:" + hashlib.sha256(message["message_id"].encode()).hexdigest()}})
        found = state["match"]
        suggestion = state["classification"]["suggested"] if found.get("confidence") in {"high", "medium"} else None
        db.execute("BEGIN IMMEDIATE")
        try:
            concurrent = db.execute("SELECT * FROM inbound_replies WHERE message_id=?", (message["message_id"],)).fetchone()
            if concurrent:
                if concurrent["raw"] != raw:
                    raise ValueError("message_id conflicts with different reply evidence")
                result = _view(concurrent, reused=True)
            else:
                db.execute("INSERT INTO inbound_replies(message_id,source,raw,classification,invite,match,invite_candidates,suggested_status) VALUES(?,?,?,?,?,?,?,?)",
                           (message["message_id"], "user-provided", raw, json.dumps(state["classification"], ensure_ascii=False), json.dumps(state["invite"], ensure_ascii=False), json.dumps(found, ensure_ascii=False), json.dumps(state["invite_candidates"], ensure_ascii=False), suggestion))
                result = _view(db.execute("SELECT * FROM inbound_replies WHERE message_id=?", (message["message_id"],)).fetchone())
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
        _record_suggestion(directory, result)
        return result
    finally:
        db.close()


def _view(row: sqlite3.Row, *, reused: bool = False) -> dict:
    return {"message_id": row["message_id"], "source": row["source"], "message": json.loads(row["raw"]),
            "classification": json.loads(row["classification"]), "invite": json.loads(row["invite"]), "match": json.loads(row["match"]),
            "invite_candidates": json.loads(row["invite_candidates"]),
            "suggested_status": row["suggested_status"], "confirmed_opportunity_id": row["confirmed_opportunity_id"],
            "confirmed_status": row["confirmed_status"], "confirmation_reason": row["confirmation_reason"],
            "confirmed_at": row["confirmed_at"], "reused": reused}


def _record_suggestion(directory: Path, reply: dict) -> None:
    if reply["suggested_status"] and reply["match"].get("opportunity_id"):
        mutate(directory, reply["match"]["opportunity_id"], "activity", "reply_suggested",
               source="reply-import", payload={"message_id": reply["message_id"],
                                               "to_status": reply["suggested_status"],
                                               "evidence": reply["classification"]["evidence"],
                                               "match_signals": reply["match"]["signals"]},
               idempotency_key="reply-suggested:" + reply["message_id"])


def view_reply(directory: Path, message_id: str) -> dict | None:
    db = sqlite3.connect(directory / "opportunities.db")
    db.row_factory = sqlite3.Row
    try:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inbound_replies'").fetchone():
            return None
        row = db.execute("SELECT * FROM inbound_replies WHERE message_id=?", (message_id,)).fetchone()
        return _view(row) if row else None
    finally:
        db.close()


def confirm_reply(directory: Path, message_id: str, opportunity_id: str, status: str, *, reason: str = "") -> dict:
    """Record a user's selected transition through the lifecycle graph."""
    reply = view_reply(directory, message_id)
    if not reply:
        raise ValueError("Unknown reply")
    if status not in {"responded", "interview", "offer", "rejected"}:
        raise ValueError("Invalid reply status")
    if reply["confirmed_at"]:
        if reply["confirmed_opportunity_id"] == opportunity_id and reply["confirmed_status"] == status and reply["confirmation_reason"] == reason:
            return {"message_id": message_id, "opportunity_id": opportunity_id, "status": status, "reused": True}
        raise ValueError("Reply was already confirmed differently")
    db = sqlite3.connect(directory / "opportunities.db")
    try:
        valid = db.execute("SELECT 1 FROM application_lifecycle WHERE opportunity_id=?", (opportunity_id,)).fetchone()
    finally:
        db.close()
    if not valid:
        raise ValueError("Reply confirmation requires an existing submitted application")
    differs = reply["match"].get("opportunity_id") != opportunity_id or reply["suggested_status"] != status
    if differs and not reason.strip():
        raise ValueError("Confirming an unmatched application or different status requires --reason")
    mutate(directory, opportunity_id, "transition", status, source="reply-confirmed",
           payload={"message_id": message_id, "evidence": reply["classification"]["evidence"], "reason": reason}, idempotency_key="reply:" + message_id)
    db = sqlite3.connect(directory / "opportunities.db")
    try:
        db.execute("""UPDATE inbound_replies SET confirmed_opportunity_id=?,confirmed_status=?,
                   confirmation_reason=?,confirmed_at=CURRENT_TIMESTAMP WHERE message_id=?""",
                   (opportunity_id, status, reason, message_id))
        db.commit()
    finally:
        db.close()
    return {"message_id": message_id, "opportunity_id": opportunity_id, "status": status, "reused": False}
