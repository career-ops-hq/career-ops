// job-intelligence-store.mjs — Persistence for Job Intelligence analyses.
//
// Stores one JSON record per analyzed job under USER-LAYER
// `data/jobs-intelligence/{id}.json` plus an index at
// `data/jobs-intelligence/index.json`. All files are created with the same
// secure 0600/0700 semantics as the rest of the user layer.

import { createHash } from "node:crypto";
import path from "node:path";

import {
  ensurePrivateDirectory,
  resolvePrivatePath,
  secureAtomicWrite,
  secureDelete,
  secureReadText,
} from "./secure-user-storage.mjs";

function intelligenceDir(root) {
  return resolvePrivatePath(root, path.join("data", "jobs-intelligence"));
}

function indexPath(root) {
  return path.join(intelligenceDir(root), "index.json");
}

function analysisPath(root, id) {
  return path.join(intelligenceDir(root), `${id}.json`);
}

/** Deterministic id: re-importing the same job updates the same record. */
export function jobIntelligenceId(title, url, text) {
  const base = `${url ?? ""}|${title ?? ""}|${(text ?? "").slice(0, 400)}`;
  return "ji-" + createHash("sha1").update(base).digest("hex").slice(0, 12);
}

export async function listJobAnalyses(root) {
  const raw = await secureReadText(root, indexPath(root), "[]");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function readJobAnalysis(root, id) {
  const raw = await secureReadText(root, analysisPath(root, id), "null");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveJobAnalysis(root, record) {
  const id = record.id;
  if (!id || !record.analysis) throw new Error("Ogiltigt analys-poster: id och analysis krävs.");
  const dir = intelligenceDir(root);
  await ensurePrivateDirectory(root, dir);

  const summary = record.summary || { id, jobTitle: "Namnlös annons" };
  await secureAtomicWrite(root, analysisPath(root, id), JSON.stringify(record, null, 2));

  const index = await listJobAnalyses(root);
  const existing = index.findIndex((entry) => entry.id === id);
  if (existing >= 0) index[existing] = summary;
  else index.unshift(summary);
  await secureAtomicWrite(root, indexPath(root), JSON.stringify(index, null, 2));
  return record;
}

export async function deleteJobAnalysis(root, id) {
  if (!id) throw new Error("Id krävs.");
  await secureDelete(root, analysisPath(root, id));
  const index = (await listJobAnalyses(root)).filter((entry) => entry.id !== id);
  await secureAtomicWrite(root, indexPath(root), JSON.stringify(index, null, 2));
  return { ok: true };
}
