import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ingestEmail,
  listMessages,
  getMessage,
  updateJobLink,
  recordAction,
  deleteMessage,
} from "../../src/lib/email-hub-store.mjs";

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), "career-ops-emailhub-"));
}

const JOBS = [
  { id: "app-1", company: "Acme AB", role: "Frontend-utvecklare" },
  { id: "app-2", company: "Beta AB", role: "Backend-utvecklare" },
];

test("ingestEmail klassificerar, extraherar och sparar säkert", async () => {
  const root = tmpRoot();
  try {
    const rec = await ingestEmail(
      root,
      {
        id: "m1",
        from: "sara@acme.se",
        fromName: "Sara Lind",
        subject: "Intervjubokning: Frontend-utvecklare hos Acme AB",
        body: "Hej Anna! Vi vill boka intervju den 15 september kl 10:00. Svara senast 2026-08-10.",
        date: "2026-08-07T09:00:00.000Z",
      },
      JOBS,
    );
    assert.equal(rec.id, "m1");
    assert.equal(rec.classification.classId, "interview");
    assert.ok(rec.entities.company.value.includes("Acme"));
    assert.equal(rec.jobLink.jobId, "app-1");
    assert.equal(rec.jobLink.needsUserConfirmation, false);
    assert.deepEqual(rec.actions, []);

    const list = await listMessages(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "m1");
    assert.equal(list[0].class, "interview");

    const reread = await getMessage(root, "m1");
    assert.equal(reread.subject, "Intervjubokning: Frontend-utvecklare hos Acme AB");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ingestEmail utan ämne kastar", async () => {
  const root = tmpRoot();
  try {
    await assert.rejects(ingestEmail(root, { from: "x@y.se", body: "Hej" }), /subject/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("osäker matchning → needsUserConfirmation=true med kandidater", async () => {
  const root = tmpRoot();
  try {
    const rec = await ingestEmail(
      root,
      { id: "m2", subject: "Hej från Acme AB", body: "Vi vill gärna prata med dig om en roll!" },
      JOBS,
    );
    assert.equal(rec.jobLink.needsUserConfirmation, true);
    assert.ok(Array.isArray(rec.jobLink.candidates));
    assert.ok(rec.jobLink.candidates.length >= 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateJobLink bekräftar koppling manuellt (user-confirmed)", async () => {
  const root = tmpRoot();
  try {
    await ingestEmail(root, { id: "m3", subject: "Allmänt mejl", body: "Hej." }, JOBS);
    const linked = await updateJobLink(root, "m3", "app-2", JOBS);
    assert.equal(linked.jobLink.jobId, "app-2");
    assert.equal(linked.jobLink.company, "Beta AB");
    assert.equal(linked.jobLink.needsUserConfirmation, false);
    assert.ok(linked.jobLink.reasons.includes("user-confirmed"));
    // Nollställning
    const cleared = await updateJobLink(root, "m3", "", JOBS);
    assert.equal(cleared.jobLink, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordAction loggar åtgärd med tidsstämpel", async () => {
  const root = tmpRoot();
  try {
    await ingestEmail(root, { id: "m4", subject: "Svarstest", body: "Hej." });
    const rec = await recordAction(root, "m4", { kind: "draft-saved" });
    assert.equal(rec.actions.length, 1);
    assert.equal(rec.actions[0].kind, "draft-saved");
    assert.ok(rec.actions[0].at);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleteMessage rensar kropp men raderar inte posten", async () => {
  const root = tmpRoot();
  try {
    await ingestEmail(root, { id: "m5", subject: "Raderingstest", body: "Känslig text" });
    const del = await deleteMessage(root, "m5");
    assert.equal(del.body, "[borttagen i UI]");
    const list = await listMessages(root);
    assert.equal(list.length, 1, "sammanfattning finns kvar i index");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
