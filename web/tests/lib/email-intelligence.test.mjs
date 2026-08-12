import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_CLASSES,
  EMAIL_CLASS_IDS,
  classifyEmail,
  extractEmailEntities,
  matchEmailToJob,
} from "../../src/lib/email-intelligence.mjs";

test("EMAIL_CLASS_IDS innehåller alla 9 FAS 5-klasser", () => {
  for (const expected of [
    "job-alert",
    "recruiter-message",
    "application-confirmation",
    "interview",
    "assessment-test",
    "follow-up",
    "rejection",
    "offer",
    "other",
  ]) {
    assert.ok(EMAIL_CLASS_IDS.includes(expected), `saknas: ${expected}`);
  }
  assert.equal(EMAIL_CLASS_IDS.length, 9);
  assert.equal(EMAIL_CLASSES.length, 9);
});

test("klassificering: job-alert", () => {
  const c = classifyEmail({
    subject: "Nya jobb: Frontend-utvecklare hos Acme AB — 12 nya annonser",
    body: "Vi har hittat 12 nya jobb som matchar din profil.",
  });
  assert.equal(c.classId, "job-alert");
});

test("klassificering: recruiter-message", () => {
  const c = classifyEmail({
    subject: "Hej Anna! Roll hos Acme",
    body: "Hej Anna, jag heter Sara och arbetar som rekryterare på Acme AB. Vi söker en Frontend-utvecklare och vill gärna höra av dig.",
  });
  assert.equal(c.classId, "recruiter-message");
});

test("klassificering: application-confirmation", () => {
  const c = classifyEmail({
    subject: "Bekräftelse: Din ansökan till Acme AB",
    body: "Tack för din ansökan! Vi har mottagit den och återkommer inom två veckor.",
  });
  assert.equal(c.classId, "application-confirmation");
});

test("klassificering: interview", () => {
  const c = classifyEmail({
    subject: "Intervjubokning — Frontend-utvecklare",
    body: "Vi vill gärna boka en intervju med dig den 15 september kl 10:00.",
  });
  assert.equal(c.classId, "interview");
});

test("klassificering: assessment-test", () => {
  const c = classifyEmail({
    subject: "Tekniskt test inför din ansökan",
    body: "Vänligen genomför kodtestet via länken inom 7 dagar.",
  });
  assert.equal(c.classId, "assessment-test");
});

test("klassificering: follow-up", () => {
  const c = classifyEmail({
    subject: "Påminnelse om din ansökan",
    body: "Vi vill gärna följa upp kring din ansökan hos oss.",
  });
  assert.equal(c.classId, "follow-up");
});

test("klassificering: rejection", () => {
  const c = classifyEmail({
    subject: "Angående din ansökan hos Acme",
    body: "Tyvärr har vi valt att gå vidare med andra kandidater.",
  });
  assert.equal(c.classId, "rejection");
});

test("klassificering: offer", () => {
  const c = classifyEmail({
    subject: "Erbjudande: Frontend-utvecklare hos Acme",
    body: "Vi är glada att erbjuda dig tjänsten! Lön 50 000 kr/mån.",
  });
  assert.equal(c.classId, "offer");
});

test("klassificering: other för icke-jobbrelaterat", () => {
  const c = classifyEmail({
    subject: "Månadsfaktura från elbolaget",
    body: "Din faktura för augusti är nu tillgänglig.",
  });
  assert.equal(c.classId, "other");
});

test("extraktion: företag, tjänst, rekryterare, datum, deadline, mötestid, nästa åtgärd", () => {
  const e = extractEmailEntities({
    subject: "Intervjubokning: Frontend-utvecklare hos Acme AB",
    body: "Hej Anna! Sara Lind på Acme AB bokar in dig till intervju den 15 september kl 10:00. Svara senast 2026-08-10.",
  });
  assert.ok(e.company?.value.includes("Acme"), `företag: ${JSON.stringify(e.company)}`);
  assert.ok(e.role?.value.includes("Frontend"), `tjänst: ${JSON.stringify(e.role)}`);
  assert.ok(e.recruiter?.value.includes("Sara"), `rekryterare: ${JSON.stringify(e.recruiter)}`);
  assert.ok(e.meetingTime, `mötestid saknas: ${JSON.stringify(e)}`);
  assert.ok(e.deadline || e.nextAction, `deadline/nästa åtgärd saknas: ${JSON.stringify(e)}`);
});

test("matchning: säker koppling till jobb via företag + tjänst", () => {
  const jobs = [
    { id: "app-1", company: "Acme AB", role: "Frontend-utvecklare" },
    { id: "app-2", company: "Beta AB", role: "Backend-utvecklare" },
  ];
  const r = matchEmailToJob(
    { subject: "Intervjubokning — Acme AB", body: "Frontend-utvecklare hos Acme AB, vi ses snart!" },
    jobs,
  );
  assert.equal(r.match?.jobId, "app-1");
  assert.equal(r.needsUserConfirmation, false);
  assert.ok(r.confidence >= 0.5);
});

test("matchning: osäker matchning → needsUserConfirmation=true med kandidater", () => {
  const jobs = [
    { id: "app-1", company: "Acme AB", role: "Frontend-utvecklare" },
    { id: "app-2", company: "Acme AB", role: "Produktdesigner" },
  ];
  const r = matchEmailToJob({ subject: "Hej från Acme AB", body: "Vi vill gärna prata med dig!" }, jobs);
  assert.equal(r.needsUserConfirmation, true);
  assert.ok(r.match, "en kandidat ska finnas kvar som förslag");
});

test("matchning: ingen pipeline → needsUserConfirmation=true", () => {
  const r = matchEmailToJob({ subject: "Hej", body: "Vi söker utvecklare" }, []);
  assert.equal(r.needsUserConfirmation, true);
  assert.equal(r.match, null);
});

test("matchning: låg konfidens → ingen koppling", () => {
  const jobs = [{ id: "app-1", company: "Odefinierat AB", role: "Väldigt ovanlig roll" }];
  const r = matchEmailToJob({ subject: "Recept från ICA", body: "Veckans middagstips!" }, jobs);
  assert.equal(r.match, null);
  assert.equal(r.needsUserConfirmation, true);
});
