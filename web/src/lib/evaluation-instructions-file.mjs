import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const YOUNG_MS = 30_000;

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function removeInstructionDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("[career-ops] Failed to remove evaluation instructions:", error);
    }
  }
}

function ownerRecord(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "owner.json"), "utf8"));
    const pid = parsed && Number.isSafeInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : null;
    const host = typeof parsed?.host === "string" && parsed.host ? parsed.host : null;
    return { pid, host };
  } catch {
    return { pid: null, host: null };
  }
}

/**
 * A directory with a dead owner is a crashed run. A directory with no owner
 * that is younger than 30s may still be between mkdtemp and owner.json.
 * @param {string} root
 * @param {number} [now]
 */
export function sweepEvaluationInstructions(root, now = Date.now()) {
  let names;
  try {
    names = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of names) {
    if (!entry.isDirectory() || !entry.name.startsWith(".evaluation-instructions-")) continue;
    const dir = path.join(root, entry.name);
    const { pid, host } = ownerRecord(dir);
    if (host && host !== os.hostname()) continue;
    if (pid !== null) {
      if (!processIsAlive(pid)) removeInstructionDir(dir);
      continue;
    }
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(dir).mtimeMs;
    } catch {
      continue;
    }
    if (now - mtimeMs >= YOUNG_MS) removeInstructionDir(dir);
  }
}

/**
 * Keep selected instructions off argv (#6583). Store them inside the worker's
 * data root so read-only sandboxes can read them without additional grants.
 * Each run owns its directory; remove it only after its worker closes.
 * @param {string} root
 * @param {string} instructions
 */
export function writeEvaluationInstructions(root, instructions) {
  sweepEvaluationInstructions(root);
  const dir = fs.mkdtempSync(path.join(root, ".evaluation-instructions-"));
  const file = path.join(dir, "instructions.md");
  const cleanup = () => removeInstructionDir(dir);

  const staging = path.join(dir, `.instructions.${process.pid}.tmp`);
  try {
    fs.writeFileSync(path.join(dir, "owner.json"), `${JSON.stringify({ pid: process.pid, host: os.hostname() })}\n`, { encoding: "utf8", mode: 0o600 });
    fs.writeFileSync(staging, instructions, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(staging, file);
  } catch (error) {
    try { fs.rmSync(staging, { force: true }); } catch { /* staging may be missing */ }
    cleanup();
    throw error;
  }

  return {
    file,
    reference: `Read the selected canonical evaluation instructions from ${JSON.stringify(file)} before evaluating. Follow only those selected instructions; do not load the full evaluation mode or omitted sections.`,
    cleanup,
  };
}
