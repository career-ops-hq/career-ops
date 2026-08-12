/**
 * export-store.mjs — persistence for CV exports (FAS 4)
 *
 * Follows the secure user-storage pattern (0600/0700 + symlink protection)
 * used by cv-tailoring-store and cv-version-store.
 *
 * Layout:
 *   data/cv-exports/index.json         — export metadata (summaries)
 *   data/cv-exports/{id}.{ext}         — exported file (binary, atomic write)
 */

import path from "node:path";
import crypto from "node:crypto";
import { lstat, open, rename, unlink, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import {
  ensurePrivateDirectory,
  secureAtomicWrite,
  secureReadText,
  resolvePrivatePath,
} from "./secure-user-storage.mjs";

const PRIVATE_FILE_MODE = 0o600;

function exportsDir(root) {
  return resolvePrivatePath(root, path.join("data", "cv-exports"));
}

function indexPath(root) {
  return path.join(exportsDir(root), "index.json");
}

function filePath(root, id, ext) {
  return path.join(exportsDir(root), `${id}.${String(ext).replace(/[^a-z0-9]/gi, "").toLowerCase()}`);
}

export function exportRecordId(jobId, stamp = Date.now()) {
  return crypto.createHash("sha1").update(`${jobId}-${stamp}-${Math.random()}`).digest("hex").slice(0, 16);
}

/** Atomisk binär skrivning med samma skydd som secureAtomicWrite (0600, symlink-block). */
export async function secureBinaryWrite(root, target, buffer) {
  const resolved = resolvePrivatePath(root, target);
  const directory = await ensurePrivateDirectory(root, path.dirname(resolved));
  try {
    const details = await lstat(resolved);
    if (details.isSymbolicLink()) {
      throw new Error("Symboliska länkar tillåts inte för privat karriärdata.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, resolved);
    await chmod(resolved, PRIVATE_FILE_MODE).catch((e) => {
      if (!["ENOTSUP", "EPERM", "EINVAL"].includes(e?.code)) throw e;
    });
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return resolved;
}

export async function listExportRecords(root) {
  const raw = await secureReadText(root, indexPath(root), "[]");
  let index = [];
  try {
    index = JSON.parse(raw);
  } catch {
    index = [];
  }
  if (!Array.isArray(index)) return [];
  return index.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function readExportRecord(root, id) {
  const raw = await secureReadText(root, path.join(exportsDir(root), `${id}.json`), "null");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Spara exportmetadata (FAS 4: CV-version, jobb, företag, mall, språk, format, tid, ATS, gate). */
export async function saveExportRecord(root, record) {
  const dir = exportsDir(root);
  await ensurePrivateDirectory(root, dir);
  const id = record.id || exportRecordId(record.jobId);
  const format = String(record.format || "pdf").toLowerCase();
  const createdAt = record.createdAt || new Date().toISOString();
  const storedFile = record.storedFile || `data/cv-exports/${id}.${format}`;
  const filePath = record.filePath || path.join(exportsDir(root), `${id}.${format}`);
  const full = { ...record, id, format, createdAt, storedFile, filePath };
  if (record.buffer) {
    await secureBinaryWrite(root, storedFile, record.buffer);
  }
  await secureAtomicWrite(root, path.join(dir, `${id}.json`), JSON.stringify(full, null, 2));
  // Index (summaries only — no binary/base64 blobs).
  let index = [];
  try {
    index = JSON.parse(await secureReadText(root, indexPath(root), "[]"));
  } catch {
    index = [];
  }
  if (!Array.isArray(index)) index = [];
  const summary = {
    id: full.id,
    fileName: full.fileName,
    format: full.format,
    templateId: full.templateId,
    versionId: full.versionId ?? null,
    jobId: full.jobId ?? null,
    jobTitle: full.jobTitle ?? "",
    company: full.company ?? "",
    language: full.language ?? "",
    createdAt: full.createdAt,
    qualityGatePassed: full.qualityGate?.passed ?? false,
    atsScore: full.ats?.scoreCard?.overall?.label ?? null,
    storedFile: full.storedFile ?? null,
  };
  index = index.filter((r) => r?.id !== id);
  index.push(summary);
  await secureAtomicWrite(root, indexPath(root), JSON.stringify(index, null, 2));
  return full;
}

/** Uppdaterar en exportpost med quality-gate-resultatet (körs efter gaten). */
export async function recordExportGateResult(root, id, gate) {
  const record = await readExportRecord(root, id);
  if (!record) return null;
  record.qualityGate = {
    passed: !!gate?.passed,
    checks: Array.isArray(gate?.checks) ? gate.checks : [],
    reason: gate?.reason ?? null,
    checkedAt: new Date().toISOString(),
  };
  await secureAtomicWrite(root, path.join(exportsDir(root), `${id}.json`), JSON.stringify(record, null, 2));
  let index = [];
  try {
    index = JSON.parse(await secureReadText(root, indexPath(root), "[]"));
  } catch {
    index = [];
  }
  if (Array.isArray(index)) {
    const summary = index.find((r) => r?.id === id);
    if (summary) summary.qualityGatePassed = record.qualityGate.passed;
    await secureAtomicWrite(root, indexPath(root), JSON.stringify(index, null, 2));
  }
  return record;
}
