/**
 * application-studio-store.mjs — persistence for Application Studio
 * packages (FAS 5).
 *
 * Follows the secure user-storage pattern (0600/0700 + symlink protection)
 * used by cv-tailoring-store / cv-version-store.
 *
 * Layout:
 *   data/application-studio/index.json        — package summaries
 *   data/application-studio/{packageId}.json  — full package
 *
 * Nothing is ever deleted by the store (FAS 5 rule: delete nothing).
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

function studioDir(root) {
  return resolvePrivatePath(root, path.join("data", "application-studio"));
}

function indexPath(root) {
  return path.join(studioDir(root), "index.json");
}

function packagePath(root, id) {
  return path.join(studioDir(root), `${id}.json`);
}

function newId() {
  return crypto.randomUUID();
}

export function summarizePackage(pkg) {
  const latestMessage = (type) => {
    const list = (pkg.messages || []).filter((m) => m.type === type);
    return list.length ? list[list.length - 1] : null;
  };
  return {
    packageId: pkg.packageId,
    jobId: pkg.job?.id || null,
    company: pkg.job?.company || "",
    role: pkg.job?.role || "",
    cvVersionId: pkg.cvVersion?.id || null,
    status: pkg.status || "Saved",
    language: pkg.settings?.language || "auto",
    style: pkg.settings?.style || "professional",
    length: pkg.settings?.length || "standard",
    updatedAt: pkg.updatedAt || pkg.createdAt || null,
    messageCount: (pkg.messages || []).length,
    hasCoverLetter: Boolean(latestMessage("cover-letter")),
    hasDrafts: (pkg.messages || []).some((m) => m.draft),
  };
}

export async function listPackages(root) {
  await ensurePrivateDirectory(root, studioDir(root));
  const text = await secureReadText(root, indexPath(root), "[]");
  try {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeIndex(root, entries) {
  await secureAtomicWrite(
    root,
    indexPath(root),
    JSON.stringify(entries, null, 2),
  );
}

export async function getPackage(root, packageId) {
  const text = await secureReadText(
    root,
    packagePath(root, packageId),
    "",
  );
  if (!text) return null;
  return JSON.parse(text);
}

export async function savePackage(root, pkg) {
  if (!pkg || !pkg.packageId) {
    throw new Error("package requires packageId");
  }
  const id = pkg.packageId;
  await secureAtomicWrite(
    root,
    packagePath(root, id),
    JSON.stringify(pkg, null, 2),
  );
  const index = await listPackages(root);
  const summary = summarizePackage(pkg);
  const idx = index.findIndex((e) => e.packageId === id);
  if (idx === -1) {
    index.push(summary);
  } else {
    index[idx] = summary;
  }
  await writeIndex(root, index);
  return pkg;
}

export async function createPackage(root, data) {
  const packageId = newId();
  const now = new Date().toISOString();
  const pkg = {
    packageId,
    job: data.job || null,
    profileSnapshot: data.profileSnapshot || null,
    match: data.match || null,
    cvVersion: data.cvVersion || null,
    settings: data.settings || { length: "standard", style: "professional", language: "auto" },
    messages: data.messages || [],
    facts: data.facts || { facts: [], map: {}, missing: [] },
    status: "Saved",
    history: [{ at: now, event: "created", status: "Saved" }],
    createdAt: now,
    updatedAt: now,
  };
  await savePackage(root, pkg);
  return pkg;
}

export async function updatePackage(root, packageId, patchFn) {
  const pkg = await getPackage(root, packageId);
  if (!pkg) throw new Error(`package not found: ${packageId}`);
  const next = patchFn(pkg);
  next.updatedAt = new Date().toISOString();
  await savePackage(root, next);
  return next;
}

/**
 * Remove a package from the index (keeps the data file — delete nothing).
 */
export async function archivePackage(root, packageId) {
  const index = await listPackages(root);
  const filtered = index.filter((e) => e.packageId !== packageId);
  await writeIndex(root, filtered);
  return packageId;
}
