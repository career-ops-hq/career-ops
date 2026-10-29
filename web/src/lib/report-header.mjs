const FIELD_KEYS = {
  date: "Date",
  fecha: "Date",
  url: "URL",
  archetype: "Archetype",
  arquetipo: "Archetype",
  score: "Score",
  legitimacy: "Legitimacy",
  legitimidad: "Legitimacy",
  pdf: "PDF",
  "evaluation scope": "Evaluation scope",
};

const DECISION_LABELS = {
  decision: "Decision",
  القرار: "Decision",
  beslutning: "Decision",
  entscheidung: "Decision",
  decisión: "Decision",
  décision: "Decision",
  निर्णय: "Decision",
  keputusan: "Decision",
  decisione: "Decision",
  決定: "Decision",
  결정: "Decision",
  beslissing: "Decision",
  decyzja: "Decision",
  decisão: "Decision",
  решение: "Decision",
  karar: "Decision",
  рішення: "Decision",
  "quyết định": "Decision",
  决定: "Decision",
};

function fieldName(raw) {
  const key = raw.trim().toLowerCase();
  if (Object.hasOwn(DECISION_LABELS, key)) return DECISION_LABELS[key];
  if (Object.hasOwn(FIELD_KEYS, key)) return FIELD_KEYS[key];
  return undefined;
}

export function readReport(md) {
  const lines = md.split("\n");
  let cut = lines.findIndex((l, i) => i > 0 && (/^\s*-{3,}\s*$/.test(l) || /^##\s/.test(l)));
  if (cut === -1) cut = Math.min(lines.length, 10);

  const headerLines = lines.slice(0, cut);
  let bodyStart = cut;
  if (/^\s*-{3,}\s*$/.test(lines[cut] ?? "")) bodyStart = cut + 1;
  const body = lines.slice(bodyStart).join("\n").trim();

  let title = null;
  let legitimacy = null;
  const fields = [];

  for (const l of headerLines) {
    const h = l.match(/^#\s+(.+)/);
    if (h) {
      title = h[1].replace(/^Evaluat?i[oó]n:?\s*/i, "").trim();
      continue;
    }
    const m = l.match(/^\s*\*\*(.+?):\*\*\s*(.*)$/);
    if (!m) continue;
    const label = fieldName(m[1]);
    const value = m[2].trim();
    if (!label || !value) continue;
    if (label === "Legitimacy") legitimacy = value;
    fields.push({ label, value });
  }

  return { title, fields, legitimacy, body: body || md };
}
