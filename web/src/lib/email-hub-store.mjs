/**
 * email-hub-store.mjs — persistence for the Email Hub (FAS 5).
 *
 * Stores classified email, extraction results and job links using the
 * secure user-storage pattern. No email is ever sent from this module.
 *
 * Layout:
 *   data/email-hub/index.json            — email summaries
 *   data/email-hub/messages/{id}.json    — full message + classification
 */

import path from "node:path";
import crypto from "node:crypto";
import {
  ensurePrivateDirectory,
  secureAtomicWrite,
  secureReadText,
  resolvePrivatePath,
} from "./secure-user-storage.mjs";

import { classifyEmail, extractEmailEntities, matchEmailToJob } from "./email-intelligence.mjs";

function hubDir(root) {
  return resolvePrivatePath(root, path.join("data", "email-hub"));
}

function messagesDir(root) {
  return path.join(hubDir(root), "messages");
}

function indexFile(root) {
  return path.join(hubDir(root), "index.json");
}

function messageFile(root, id) {
  return path.join(messagesDir(root), `${id}.json`);
}

function newId() {
  return crypto.randomUUID();
}

export function summarizeMessage(rec) {
  return {
    id: rec.id,
    from: rec.from,
    fromName: rec.fromName || "",
    subject: rec.subject,
    date: rec.date,
    class: rec.classification?.classId || "other",
    classId: rec.classification?.classId || "other",
    confidence: rec.classification?.confidence ?? null,
    jobId: rec.jobLink?.jobId || null,
    linked: Boolean(rec.jobLink?.jobId),
    needsUserConfirmation: Boolean(rec.jobLink?.needsUserConfirmation),
    createdAt: rec.createdAt,
  };
}

export async function listMessages(root) {
  await ensurePrivateDirectory(root, messagesDir(root));
  const text = await secureReadText(root, indexFile(root), "[]");
  try {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeIndex(root, entries) {
  await secureAtomicWrite(root, indexFile(root), JSON.stringify(entries, null, 2));
}

export async function getMessage(root, id) {
  const text = await secureReadText(root, messageFile(root, id), "");
  if (!text) return null;
  return JSON.parse(text);
}

/**
 * Ingest an email: classify, extract entities and match against jobs.
 * @param {string} root
 * @param {object} email — { id?, from, fromName?, to?, subject, body, date? }
 * @param {Array} jobs — pipeline jobs for matching
 * @param {object} opts — { connectorId?, linkJobId? } optional overrides
 */
export async function ingestEmail(root, email, jobs = [], opts = {}) {
  if (!email || !email.subject) {
    throw new Error("email requires a subject");
  }
  const id = email.id || newId();
  const classification = classifyEmail(email);
  const entities = extractEmailEntities(email);

  let jobLink = null;
  if (opts.linkJobId) {
    jobLink = { jobId: opts.linkJobId, confidence: 1, needsUserConfirmation: false, reasons: ["user-linked"] };
  } else {
    const matched = matchEmailToJob(email, jobs);
    if (!matched.needsUserConfirmation) {
      jobLink = matched.match
        ? { jobId: matched.match.jobId, confidence: matched.confidence, needsUserConfirmation: false, reasons: matched.reasons }
        : null;
    } else if (matched.match) {
      // Uncertain match — keep the candidate but ask the user.
      jobLink = {
        jobId: matched.match.jobId,
        confidence: matched.confidence,
        needsUserConfirmation: true,
        reasons: matched.reasons,
        candidates: jobs.map((j) => ({ jobId: j.id, company: j.company, role: j.role })),
      };
    }
  }

  const rec = {
    id,
    connectorId: opts.connectorId || "mock",
    from: email.from || "",
    fromName: email.fromName || "",
    to: email.to || "",
    subject: email.subject,
    body: email.body || "",
    date: email.date || new Date().toISOString(),
    classification,
    entities,
    jobLink,
    actions: opts.actions || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await secureAtomicWrite(
    root,
    resolvePrivatePath(root, path.join("data", "email-hub", "messages", `${id}.json`)),
    JSON.stringify(rec, null, 2),
  );

  const index = await listMessages(root);
  const summary = summarizeMessage(rec);
  const idx = index.findIndex((e) => e.id === id);
  if (idx === -1) index.push(summary);
  else index[idx] = summary;
  await writeIndex(root, index);

  return rec;
}

export async function updateJobLink(root, id, jobId, jobs) {
  const rec = await getMessage(root, id);
  if (!rec) throw new Error(`message not found: ${id}`);
  if (!jobId) {
    rec.jobLink = null;
  } else {
    const job = jobs.find((j) => j.id === jobId);
    rec.jobLink = {
      jobId,
      company: job?.company || null,
      role: job?.role || null,
      confidence: 1,
      needsUserConfirmation: false,
      reasons: ["user-confirmed"],
    };
  }
  rec.updatedAt = new Date().toISOString();
  await secureAtomicWrite(root, resolvePrivatePath(root, path.join("data", "email-hub", "messages", `${id}.json`)), JSON.stringify(rec, null, 2));
  const index = await listMessages(root);
  const summary = summarizeMessage(rec);
  const idx = index.findIndex((e) => e.id === id);
  if (idx === -1) index.push(summary);
  else index[idx] = summary;
  await writeIndex(root, index);
  return rec;
}

export async function recordAction(root, id, action) {
  const rec = await getMessage(root, id);
  if (!rec) throw new Error(`message not found: ${id}`);
  rec.actions = [...(rec.actions || []), { ...action, at: new Date().toISOString() }];
  rec.updatedAt = new Date().toISOString();
  await secureAtomicWrite(root, resolvePrivatePath(root, path.join("data", "email-hub", "messages", `${id}.json`)), JSON.stringify(rec, null, 2));
  return rec;
}

export async function deleteMessage(root, id) {
  // Keeps the summary in the index (delete nothing), only clears body.
  const rec = await getMessage(root, id);
  if (!rec) return null;
  rec.body = "[borttagen i UI]";
  rec.updatedAt = new Date().toISOString();
  await secureAtomicWrite(root, resolvePrivatePath(root, path.join("data", "email-hub", "messages", `${id}.json`)), JSON.stringify(rec, null, 2));
  return rec;
}
