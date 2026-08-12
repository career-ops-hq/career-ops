import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateMessages,
  editMessage,
  regenerateMessage,
  restoreMessageVersion,
  setMessageDraft,
  copyMessage,
} from "../../src/lib/application-studio.mjs";

const profile = {
  fullName: "Anna Andersson",
  email: "anna@exempel.se",
  phone: "070-123 45 67",
  location: "Stockholm",
  linkedin: "linkedin.com/in/anna-andersson",
  portfolio: "",
  headline: "Frontend-utvecklare med fokus på tillgänglighet",
  summary: "Erfaren frontend-utvecklare med 8 års erfarenhet av React och TypeScript.",
  targetRoles: ["Frontend-utvecklare"],
  skills: ["React", "TypeScript", "Tillgänglighet"],
  workModes: ["hybrid"],
};
const job = { id: "job-1", company: "Acme AB", role: "Frontend-utvecklare", location: "Stockholm", url: "https://acme.se/jobs/1", source: "linkedin" };
const match = { score: 82, strengths: ["React", "TypeScript"], gaps: ["GraphQL"], matchedSkills: ["React", "TypeScript"] };
const settings = { length: "standard", style: "professional", language: "sv" };
const NOW = "2026-08-07T10:00:00.000Z";

function oneCoverLetter() {
  return generateMessages({ profile, job, match, cvVersion: null, settings, types: ["cover-letter"], now: NOW }).messages[0];
}

test("redigera: skapar ny version med by=user, behåller id", () => {
  const m = oneCoverLetter();
  const edited = editMessage(m, "Redigerad text", "2026-08-07T11:00:00.000Z");
  assert.equal(edited.id, m.id);
  assert.equal(edited.version, 2);
  assert.equal(edited.body, "Redigerad text");
  assert.equal(edited.edited, true);
  const v2 = edited.versions.find((v) => v.version === 2);
  assert.equal(v2.by, "user");
  assert.equal(edited.versions.length, 2);
  // Originalet är oförändrat (immutability).
  assert.equal(m.body.includes("Redigerad text"), false);
});

test("regenerera: ny version, behåller id/draft, by=engine", () => {
  const m = oneCoverLetter();
  const regen = regenerateMessage(m, { profile, job, match, cvVersion: null, settings, now: "2026-08-07T11:30:00.000Z" });
  assert.equal(regen.id, m.id);
  assert.equal(regen.version, 2);
  assert.equal(regen.versions.length, 2);
  assert.ok(regen.history.some((h) => h.action === "regenerate"));
});

test("återställ: body återgår till tidigare version som ny version", () => {
  const m = oneCoverLetter();
  const edited = editMessage(m, "NY TEXT", "2026-08-07T11:00:00.000Z");
  const restored = restoreMessageVersion(edited, 1, "2026-08-07T12:00:00.000Z");
  assert.equal(restored.body, m.body);
  assert.equal(restored.version, 3);
  assert.ok(restored.history.some((h) => h.action === "restore" && h.fromVersion === 1));
  // Version 3 är en kopia av v1 — historiken finns kvar.
  assert.equal(restored.versions.length, 3);
});

test("återställ: okänd version kastar", () => {
  const m = oneCoverLetter();
  assert.throws(() => restoreMessageVersion(m, 99));
});

test("utkast: setMessageDraft sätter/återställer draft-flaggan", () => {
  const m = oneCoverLetter();
  const d = setMessageDraft(m, true, "2026-08-07T11:00:00.000Z");
  assert.equal(d.draft, true);
  const back = setMessageDraft(d, false, "2026-08-07T12:00:00.000Z");
  assert.equal(back.draft, false);
});

test("kopiera: returnerar ren text (subject + body) för urklipp", () => {
  const m = oneCoverLetter();
  const text = copyMessage(m);
  assert.equal(typeof text, "string");
  assert.ok(text.includes(m.body));
  assert.ok(text.length > 100);
});

test("versionshistorik bevaras genom hela kedjan redigera → regenerera → återställ", () => {
  const m = oneCoverLetter();
  const v1 = m.body;
  const e = editMessage(m, "v2", "2026-08-07T11:00:00.000Z");
  const r = regenerateMessage(e, { profile, job, match, cvVersion: null, settings, now: "2026-08-07T11:30:00.000Z" });
  const restored = restoreMessageVersion(r, 1, "2026-08-07T12:00:00.000Z");
  assert.equal(restored.versions.length, 4);
  assert.deepEqual(restored.versions.map((v) => v.version), [1, 2, 3, 4]);
  assert.equal(restored.body, v1);
});
