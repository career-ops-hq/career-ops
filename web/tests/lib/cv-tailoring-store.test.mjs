import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTailorSession,
  listTailorSessions,
  readTailorSession,
  saveTailorSession,
  deleteTailorSession,
} from "../../src/lib/cv-tailoring-store.mjs";

const ORIGINAL_CV = "Frontend Developer | Stockholm\nErfaren webbutvecklare med fokus på React.";

function makeSession(root, overrides = {}) {
  return createTailorSession({
    root,
    session: {
      jobId: "job-1",
      jobTitle: "Frontend Developer",
      company: "Acme Digital AB",
      level: "professional",
      model: "test-model",
      ...overrides,
    },
    sections: [
      {
        id: "profile",
        type: "profile",
        original: "Gammal profil",
        proposed: "Ny profil",
        changes: [{ id: "c1", type: "rephrased", original: "Gammal", proposed: "Ny", reason: "test", verified: true }],
      },
    ],
    originalCv: ORIGINAL_CV,
    proposedCv: "Frontend Developer | Stockholm\nNy profil",
  });
}

test("STORE: create → draft med id, listad med sammanfattning", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-verify-store-"));
  try {
    const session = await makeSession(root);
    assert.equal(session.status, "draft");
    assert.ok(session.id);
    const list = await listTailorSessions(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].jobTitle, "Frontend Developer");
    assert.equal(list[0].level, "professional");
    assert.equal(list[0].totalChanges, 1, "sammanfattning korrekt");
    const read = await readTailorSession(root, session.id);
    assert.ok(read, "läsbar");
    assert.equal(read.originalCv, ORIGINAL_CV, "original-CV lagrat oförändrat");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("STORE: status/version sparas och index uppdateras", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-verify-store-"));
  try {
    const session = await makeSession(root);
    const updated = { ...session, status: "applied", version: { id: "v1", label: "Anpassat CV", createdAt: "2026-01-01" }, appliedAt: "2026-01-01" };
    await saveTailorSession(root, updated);
    const read = await readTailorSession(root, session.id);
    assert.equal(read.status, "applied", "status uppdaterad");
    assert.equal(read.version.id, "v1", "version sparas");
    const list = await listTailorSessions(root);
    assert.equal(list[0].status, "applied", "index uppdaterat");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("STORE: filer 0600, symlink-blockerad skrivning kastar, offerfil oskadd", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-verify-store-"));
  try {
    const session = await makeSession(root);
    const file = path.join(root, "data", "cv-tailoring", `${session.id}.json`);
    const mode = fs.statSync(file).mode;
    assert.equal(mode & 0o777, 0o600, "0600-rättigheter");

    const target = path.join(root, "data", "cv-tailoring", "offer.json");
    fs.writeFileSync(target, "SECRET");
    const link = path.join(root, "data", "cv-tailoring", "attacker-link.json");
    fs.symlinkSync(target, link);
    let threw = false;
    try {
      await saveTailorSession(root, { ...session, id: "attacker-link", level: "light", jobId: "x", jobTitle: "x" });
    } catch {
      threw = true;
    }
    assert.ok(threw, "symlink-blockad skrivning kastar");
    assert.equal(fs.readFileSync(target, "utf8"), "SECRET", "offerfil oskadd");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("STORE: delete tar bort fil och indexpost", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-verify-store-"));
  try {
    const session = await makeSession(root);
    await deleteTailorSession(root, session.id);
    assert.equal(await readTailorSession(root, session.id), null, "borta");
    assert.equal((await listTailorSessions(root)).length, 0, "index tomt");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
