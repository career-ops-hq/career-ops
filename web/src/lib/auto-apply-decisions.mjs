import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function parseDecisionStore(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.decisions) || !value.decisions.every((x) => x && typeof x === "object" && typeof x.url === "string" && ["approve", "skip"].includes(x.decision) && typeof x.ts === "string" && Number.isFinite(Date.parse(x.ts)))) throw new Error("Invalid auto-apply decisions store");
  return value.decisions;
}

export function validateDecisionRequest(body, queuedUrls) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Request body must be a JSON object");
  if (body.decision !== "approve" && body.decision !== "skip") throw new Error('Decision must be "approve" or "skip"');
  if (typeof body.url !== "string" || !queuedUrls.has(body.url)) throw new Error("URL is not in the current queue");
  return { url: body.url, decision: body.decision };
}

export function mergeDecision(decisions, entry) {
  return [...decisions.filter((item) => item.url !== entry.url), entry];
}

export function writeDecisionStore(dataRoot, decisions, { now = () => new Date().toISOString() } = {}) {
  const file = path.join(dataRoot, "output/auto-apply/decisions.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.decisions.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ decisions }, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* preserve original error */ }
    throw error;
  }
  return { url: decisions.at(-1).url, decision: decisions.at(-1).decision, ts: decisions.at(-1).ts };
}

export function loadDecisionStore(dataRoot) {
  const file = path.join(dataRoot, "output/auto-apply/decisions.json");
  try { return parseDecisionStore(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
}

export function saveDecision(dataRoot, entry, options) {
  const timestamped = { ...entry, ts: options?.now?.() ?? new Date().toISOString() };
  return writeDecisionStore(dataRoot, mergeDecision(loadDecisionStore(dataRoot), timestamped));
}
