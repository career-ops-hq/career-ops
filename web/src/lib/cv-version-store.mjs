import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import {
  ensurePrivateDirectory,
  resolvePrivatePath,
  secureAtomicWrite,
  secureReadText,
} from "./secure-user-storage.mjs";

const MAX_CV_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMPORTS = new Map([
  [".md", "text"],
  [".txt", "text"],
  [".pdf", "document"],
  [".docx", "document"],
]);

function versionsDirectory(root) {
  return resolvePrivatePath(root, path.join("data", "cv-versions"));
}

function indexPath(root) {
  return path.join(versionsDirectory(root), "index.json");
}

function cvPath(root) {
  return resolvePrivatePath(root, "cv.md");
}

function safeLabel(value, fallback) {
  const cleaned = typeof value === "string" ? value.trim().slice(0, 160) : "";
  return cleaned || fallback;
}

async function readIndex(root) {
  const raw = await secureReadText(root, indexPath(root), "[]");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error("CV-versionernas index är skadat och kan inte läsas säkert.");
  }
}

async function writeIndex(root, entries) {
  await secureAtomicWrite(root, indexPath(root), `${JSON.stringify(entries, null, 2)}\n`);
}

export function validateCvImport(file) {
  const name = typeof file?.name === "string" ? file.name : "";
  const size = Number(file?.size);
  const extension = path.extname(name).toLowerCase();
  const kind = ALLOWED_IMPORTS.get(extension);
  if (!kind) throw new Error("Filformatet stöds inte. Använd PDF, DOCX, TXT eller MD.");
  if (!Number.isFinite(size) || size < 0) throw new Error("Ogiltig filstorlek.");
  if (size > MAX_CV_BYTES) throw new Error("CV-filen får vara högst 10 MB.");
  return { extension, kind };
}

export async function readActiveCv(root) {
  return secureReadText(root, cvPath(root), "");
}

export async function listCvVersions(root) {
  const entries = await readIndex(root);
  return entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function saveCvVersion(root, input) {
  const content = typeof input?.content === "string" ? input.content.trim() : "";
  if (!content) throw new Error("CV-innehållet får inte vara tomt.");
  if (Buffer.byteLength(content, "utf8") > MAX_CV_BYTES) throw new Error("CV-innehållet får vara högst 10 MB.");

  const directory = await ensurePrivateDirectory(root, versionsDirectory(root));
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/\D/g, "").slice(0, 17)}-${randomUUID()}`;
  const versionFile = path.join(directory, `${id}.md`);
  const entry = {
    id,
    createdAt,
    label: safeLabel(input?.label, "CV-version"),
    source: safeLabel(input?.source, "editor"),
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: createHash("sha256").update(content).digest("hex"),
    ...(input?.restoredFrom ? { restoredFrom: String(input.restoredFrom) } : {}),
  };

  await secureAtomicWrite(root, versionFile, `${content}\n`);
  const entries = await readIndex(root);
  await writeIndex(root, [...entries, entry]);
  await secureAtomicWrite(root, cvPath(root), `${content}\n`);
  return entry;
}

export async function restoreCvVersion(root, id) {
  if (typeof id !== "string" || !/^[0-9]{17}-[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("Ogiltigt CV-versions-ID.");
  }
  const entries = await readIndex(root);
  const selected = entries.find((entry) => entry.id === id);
  if (!selected) throw new Error("CV-versionen hittades inte.");
  const content = await secureReadText(root, path.join(versionsDirectory(root), `${id}.md`), "");
  if (!content.trim()) throw new Error("CV-versionens innehåll saknas.");
  return saveCvVersion(root, {
    content,
    label: `Återställd: ${selected.label}`,
    source: "restore",
    restoredFrom: id,
  });
}
