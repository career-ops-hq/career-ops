"""Present stored interview artifacts as readable Markdown without changing their facts."""

from __future__ import annotations


KIND_LABELS = {
    "prepare": "面试准备计划",
    "practice": "面试练习稿",
    "debrief": "面试复盘",
    "learn": "面试学习总结",
}
SECTION_ORDER = {
    "prepare": ("requirements", "story_matches", "timeline", "risk_questions"),
    "practice": ("questions", "answer_feedback", "learning"),
    "debrief": ("observations", "recruiting_risks", "learning"),
    "learn": ("themes", "actions", "sources"),
}
SECTION_LABELS = {
    "requirements": "岗位要求与应对",
    "story_matches": "故事与练习提示",
    "timeline": "准备时间线",
    "risk_questions": "待核实的招聘问题",
    "questions": "练习问题",
    "answer_feedback": "建议回答与反馈",
    "learning": "学习记录边界",
    "observations": "面试观察",
    "recruiting_risks": "招聘风险",
    "themes": "主题",
    "actions": "下一步行动",
    "sources": "来源",
}
FIELD_LABELS = {
    "question_zh": "中文问题",
    "question": "原问题",
    "evaluation_intent": "考察重点",
    "suggested_structure": "建议结构",
    "answer_status": "真实作答状态",
    "suggested_answer": "建议回答（非本人作答）",
    "key_points": "自查要点",
    "scoped_feedback": "反馈范围",
    "summary": "摘要",
    "unresolved_facts": "尚未核实",
    "working_notes": "后续练习备注",
}
FIELD_ORDER = tuple(FIELD_LABELS)
CLASSIFICATIONS = {
    "evidenced": "有直接证据",
    "adjacent": "相邻经验",
    "actual_gap": "实际缺口",
    "evidence_gap": "证据缺口",
    "unverified": "待核实",
}


def _content(value: object) -> list[str]:
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: FIELD_ORDER.index(key) if key in FIELD_ORDER else len(FIELD_ORDER))
        lines: list[str] = []
        for key in keys:
            lines.extend([f"**{FIELD_LABELS.get(key, key)}**", "", *_content(value[key]), ""])
        return lines
    if isinstance(value, list):
        lines = []
        for index, item in enumerate(value, 1):
            if isinstance(item, (dict, list)):
                lines.extend([f"{index}.", *_content(item), ""])
            else:
                lines.append(f"- {item}")
        return lines
    return [str(value)]


def render_markdown(view: dict, context: dict) -> str:
    """Render the exact stored draft for human review; never imply user confirmation."""
    opportunity = context.get("opportunity", {})
    entry = view.get("artifact") or {}
    artifact = entry.get("artifact", entry)
    kind = view["kind"]
    status = (
        "待本人审阅" if view["status"] == "waiting" and view.get("reason") == "user_review"
        else f"{view['status']} / {view.get('reason') or '—'}"
    )
    lines = [
        f"# {KIND_LABELS[kind]}", "",
        f"岗位：{opportunity.get('company', '未知')} · {opportunity.get('role', '未知')}", "",
        f"任务：`{view['task_id']}` · 状态：{status}"
        + (f" · 版本：v{entry['version']}" if "version" in entry else ""),
        "",
        "本文件是审阅稿；独立模型审查不等于本人确认，也不代表申请已投递。", "",
    ]
    if not isinstance(artifact, dict) or not isinstance(artifact.get("sections"), dict):
        return "\n".join(lines + ["当前没有可审阅的成果。", ""])
    if "approved" in entry:
        lines.extend([f"独立审查：{'通过' if entry['approved'] else '未通过'}", ""])
    for name in SECTION_ORDER[kind]:
        if name not in artifact["sections"]:
            continue
        value = artifact["sections"][name]
        lines.extend([f"## {SECTION_LABELS.get(name, name)}", ""])
        if name == "requirements" and isinstance(value, list):
            for index, item in enumerate(value, 1):
                lines.extend([
                    f"### {index}. {item['requirement']} · {CLASSIFICATIONS.get(item['classification'], item['classification'])}",
                    "", item["response"], "",
                ])
        else:
            lines.extend([*_content(value), ""])
    claims = artifact.get("claims", [])
    if claims:
        lines.extend([f"## 事实出处（{len(claims)} 条，供核对）", ""])
        for index, claim in enumerate(claims, 1):
            lines.extend([
                f"{index}. {claim['text']}  ",
                f"   来源：`{claim['source']}`；原文：“{claim['quote']}”", "",
            ])
    return "\n".join(lines).rstrip() + "\n"
