/**
 * cv-tailoring-store.mjs — persistence for CV tailoring sessions (FAS 3)
 *
 * Follows the secure user-storage pattern (0600/0700 + symlink protection)
 * used by job-intelligence-store and cv-version-store.
 *
 * Layout:
 *   data/cv-tailoring/index.json        — session summaries
 *   data/cv-tailoring/{sessionId}.json  — full session (proposal + decisions)
 */

import path from "node:path";
import crypto from "node:crypto";
import {
  ensurePrivateDirectory,
  secureAtomicWrite,
  secureDelete,
  secureReadText,
  resolvePrivatePath,
} from "./secure-user-storage.mjs";

function tailoringDir(root) {
  return resolvePrivatePath(root, path.join("data", "cv-tailoring"));
}

function indexPath(root) {
  return path.join(tailoringDir(root), "index.json");
}

function sessionPath(root, id) {
  return path.join(tailoringDir(root), `${id}.json`);
}

export function tailorSessionId(jobId, level, stamp = Date.now()) {
  const base = `${jobId}-${level}-${stamp}`;
  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 16);
}

function summarize(session) {
  return {
    id: session.id,
    jobId: session.jobId,
    jobTitle: session.jobTitle ?? "",
    company: session.company ?? "",
    level: session.level,
    model: session.model ?? "local-deterministic",
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    appliedAt: session.appliedAt ?? null,
    versionId: session.version?.id ?? null,
    totalChanges: session.sections?.reduce(
      (n, s) => n + (s.changes?.length ?? 0),
      0
    ) ?? 0,
    approvedCount: session.approvedIds?.length ?? 0,
    rejectedCount: session.rejectedIds?.length ?? 0,
  };
}

export async function listTailorSessions(root) {
  const raw = await secureReadText(root, indexPath(root), "[]");
  let index = [];
  try {
    index = JSON.parse(raw);
  } catch {
    index = [];
  }
  if (!Array.isArray(index)) return [];
  // Index already stores summarize() records — return them as-is.
  return index.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function readTailorSession(root, id) {
  const raw = await secureReadText(root, sessionPath(root, id), "null");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveTailorSession(root, session) {
  const dir = tailoringDir(root);
  await ensurePrivateDirectory(root, dir);
  const id = session.id;
  session.updatedAt = new Date().toISOString();
  await secureAtomicWrite(
    root,
    sessionPath(root, id),
    JSON.stringify(session, null, 2)
  );
  // Keep index in sync (insert or update).
  let index = [];
  try {
    index = JSON.parse(await secureReadText(root, indexPath(root), "[]"));
  } catch {
    index = [];
  }
  if (!Array.isArray(index)) index = [];
  index = index.filter((s) => s?.id !== id);
  index.push(summarize(session));
  await secureAtomicWrite(root, indexPath(root), JSON.stringify(index, null, 2));
  return session;
}

export async function deleteTailorSession(root, id) {
  await secureDelete(root, sessionPath(root, id));
  let index = [];
  try {
    index = JSON.parse(await secureReadText(root, indexPath(root), "[]"));
  } catch {
    index = [];
  }
  if (Array.isArray(index)) {
    index = index.filter((s) => s?.id !== id);
    await secureAtomicWrite(
      root,
      indexPath(root),
      JSON.stringify(index, null, 2)
    );
  }
}

/** One-shot: persist a newly generated proposal as a draft session. */
export async function createTailorSession({
  root,
  session,
  sections,
  originalCv,
  proposedCv,
}) {
  const now = new Date().toISOString();
  const record = {
    ...session,
    id: session.id || tailorSessionId(session.jobId, session.level),
    createdAt: now,
    updatedAt: now,
    status: "draft",
    sections,
    originalCv,
    proposedCv,
    approvedIds: [],
    rejectedIds: [],
    edits: {},
    version: null,
    appliedAt: null,
    changelog: [{ type: "created", at: now, detail: `Förslag skapat (${session.level})` }],
  };
  await saveTailorSession(root, record);
  return record;
}
