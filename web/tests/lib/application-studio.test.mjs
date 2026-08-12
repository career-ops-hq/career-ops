import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_TYPES,
  LENGTHS,
  STYLES,
  LANGUAGES,
  resolveLanguage,
  generateMessage,
  generateMessages,
  verifyMessageFacts,
  createApplicationPackage,
  buildFactBase,
} from "../../src/lib/application-studio.mjs";
import { PIPELINE_STATUSES, transitionPipeline, nextPipelineStatuses, isPipelineStatus, toCoreStatus } from "../../src/lib/application-pipeline.mjs";

/* ── Shared fixtures ────────────────────────────────────────────────── */

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

const job = {
  id: "job-1",
  company: "Acme AB",
  role: "Frontend-utvecklare",
  location: "Stockholm",
  url: "https://acme.se/jobs/1",
  source: "linkedin",
};

const match = {
  score: 82,
  strengths: ["React", "TypeScript"],
  gaps: ["GraphQL"],
  matchedSkills: ["React", "TypeScript"],
};

const settingsSv = { length: "standard", style: "professional", language: "sv" };

/* ── Coverage: generation of all 10 types ───────────────────────────── */

test("MESSAGE_TYPES innehåller exakt de 10 FAS 5-typerna", () => {
  const ids = MESSAGE_TYPES.map((t) => t.id);
  for (const expected of [
    "cover-letter",
    "short-motivation",
    "why-good-fit",
    "recruiter-message",
    "linkedin-message",
    "email-application",
    "follow-up",
    "interview-confirmation",
    "thank-you",
    "faq-answers",
  ]) {
    assert.ok(ids.includes(expected), `saknas: ${expected}`);
  }
  assert.equal(ids.length, 10);
});

test("LENGTHS/STYLES/LANGUAGES innehåller alla val", () => {
  assert.deepEqual(LENGTHS, ["short", "standard", "detailed"]);
  assert.deepEqual(STYLES, ["professional", "human", "technical", "leadership", "sales"]);
  assert.deepEqual(LANGUAGES, ["sv", "en", "auto"]);
});

test("generateMessages producerar alla 10 typer med kropp, fakta och inga kvarvarande platshållare", () => {
  const { messages, settings, factBase, language } = generateMessages({
    profile,
    job,
    match,
    cvVersion: null,
    settings: settingsSv,
  });
  assert.equal(messages.length, 10);
  assert.equal(language, "sv");
  assert.equal(settings.length, "standard");
  for (const m of messages) {
    assert.ok(m.body.length > 40, `${m.type} saknar innehåll`);
    assert.ok(m.factsUsed.length > 0, `${m.type} saknar faktaredovisning`);
    assert.ok(!m.body.includes("{") || !/[{][a-zA-Z]+[}]/.test(m.body), `${m.type} har kvarvarande platshållare`);
    assert.equal(m.version, 1);
    assert.equal(m.draft, false);
  }
  assert.ok(factBase.facts.length >= 8, "factBase ska ha minst 8 verifierade fakta");
});

test("personligt brev innehåller verifierade fakta (namn, företag, roll, kompetenser)", () => {
  const { messages } = generateMessages({ profile, job, match, cvVersion: null, settings: settingsSv, types: ["cover-letter"] });
  const cl = messages[0];
  assert.ok(cl.body.includes("Anna Andersson"));
  assert.ok(cl.body.includes("Acme"));
  assert.ok(cl.body.includes("Frontend-utvecklare"));
  assert.ok(cl.body.includes("React"));
  assert.ok(cl.subject === "" || cl.subject.length >= 0);
});

test("faktaskydd: påhittade erfarenheter/kompetenser förekommer INTE i texterna", () => {
  const { messages } = generateMessages({ profile, job, match, cvVersion: null, settings: settingsSv });
  const all = messages.map((m) => m.body.toLowerCase()).join("\n");
  // GraphQL är ett gap — får inte framstå som en kompetens.
  assert.ok(!all.includes("graphql"));
  // Inga företag/roller utanför faktaunderlaget.
  assert.ok(!all.includes("acme ab är mitt tidigare företag"));
  // matchScore 82 är en verifierad siffra och får förekomma.
  assert.ok(all.includes("82"));
});

test("verifyMessageFacts: ok=true för ren fakta, blanks flaggas som saknad input, aldrig påhittat", () => {
  const { messages, factBase } = generateMessages({ profile, job, match, cvVersion: null, settings: settingsSv });
  for (const m of messages) {
    const check = verifyMessageFacts(m, factBase);
    // Alla icke-blank-meddelanden ska vara faktarena.
    if (m.missingFacts.length === 0) {
      assert.equal(check.ok, true, `${m.type}: ${check.unverified.join(", ")}`);
    } else {
      // missingFacts-mallar (intervju/tack/faq) har blanks — aldrig påhittade datum.
      assert.ok(check.blanks.length > 0);
      assert.ok(!m.body.match(/\d{4}-\d{2}-\d{2}/), `${m.type} får inte hitta på datum`);
    }
  }
});

test("intervjubekräftelse: [intervjudatum]-blanks kräver användarinput, inget påhittat", () => {
  const { messages } = generateMessages({ profile, job, match, cvVersion: null, settings: settingsSv, types: ["interview-confirmation"] });
  const m = messages[0];
  assert.ok(m.missingFacts.some((f) => f.toLowerCase().includes("intervjudatum") || f.toLowerCase().includes("interviewdate")));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(m.body));
});

test("språkval: sv vs en-mallar + auto efter jobbets språk", () => {
  const sv = generateMessages({ profile, job, match, cvVersion: null, settings: { length: "standard", style: "professional", language: "sv" }, types: ["cover-letter"] });
  assert.ok(sv.messages[0].body.includes("ansöka om tjänsten"), "svensk mall");
  const en = generateMessages({ profile, job, match, cvVersion: null, settings: { length: "standard", style: "professional", language: "en" }, types: ["cover-letter"] });
  assert.ok(en.messages[0].body.includes("apply for the"), "engelsk mall");
  assert.equal(en.language, "en");

  const enJob = { ...job, company: "Acme International", role: "Software Engineer" };
  const autoEn = generateMessages({ profile, job: enJob, match, cvVersion: null, settings: { length: "short", style: "professional", language: "auto" }, types: ["cover-letter"] });
  assert.equal(autoEn.language, "en", "auto med engelskt jobb → engelska");
  assert.ok(autoEn.messages[0].body.includes("apply for the"));
});

test("längd: kort < standard < utförlig i ordantal", () => {
  const countWords = (s) => s.split(/\s+/).filter(Boolean).length;
  const short = generateMessages({ profile, job, match, cvVersion: null, settings: { length: "short", style: "professional", language: "sv" }, types: ["cover-letter"] }).messages[0];
  const std = generateMessages({ profile, job, match, cvVersion: null, settings: { length: "standard", style: "professional", language: "sv" }, types: ["cover-letter"] }).messages[0];
  const detailed = generateMessages({ profile, job, match, cvVersion: null, settings: { length: "detailed", style: "professional", language: "sv" }, types: ["cover-letter"] }).messages[0];
  assert.ok(countWords(short.body) < countWords(std.body), `kort(${countWords(short.body)}) < standard(${countWords(std.body)})`);
  assert.ok(countWords(std.body) < countWords(detailed.body), `standard(${countWords(std.body)}) < utförlig(${countWords(detailed.body)})`);
});

test("stil: sales/professional/technical ger olika öppningar", () => {
  const sales = generateMessages({ profile, job, match, cvVersion: null, settings: { length: "short", style: "sales", language: "sv" }, types: ["cover-letter"] }).messages[0];
  const prof = generateMessages({ profile, job, match, cvVersion: null, settings: { length: "short", style: "professional", language: "sv" }, types: ["cover-letter"] }).messages[0];
  const tech = generateMessages({ profile, job, match, cvVersion: null, settings: { length: "short", style: "technical", language: "sv" }, types: ["cover-letter"] }).messages[0];
  assert.ok(sales.body.includes("starkt val"), "säljande öppning");
  assert.ok(prof.body.includes("ansöka om tjänsten"), "professionell öppning");
  assert.ok(tech.body.includes("bakgrund inom"), "teknisk öppning");
});

test("generateMessage kastar på okänd typ", () => {
  assert.throws(() => generateMessage({ type: "finns-inte", profile, job, match, settings: settingsSv }));
});

test("createApplicationPackage bygger paket med status Saved + skaparhistorik", () => {
  const pkg = createApplicationPackage({ job, profile, match, cvVersion: null, settings: settingsSv, now: "2026-08-07T10:00:00.000Z" });
  assert.equal(pkg.status, "Saved");
  assert.equal(pkg.history[0].event, "created");
  assert.equal(pkg.history[0].status, "Saved");
  assert.equal(pkg.messages.length, 10);
  assert.equal(pkg.job.company, "Acme AB");
});

/* ── Pipeline model ─────────────────────────────────────────────────── */

test("PIPELINE_STATUSES innehåller alla 10 FAS 5-statusar", () => {
  const ids = PIPELINE_STATUSES.map((s) => s.id);
  for (const expected of [
    "Saved",
    "Preparing",
    "Ready to Apply",
    "Applied",
    "Recruiter Contact",
    "Interview",
    "Assessment",
    "Offer",
    "Rejected",
    "Withdrawn",
  ]) {
    assert.ok(ids.includes(expected), `saknas: ${expected}`);
  }
  assert.equal(ids.length, 10);
});

test("isPipelineStatus + nextPipelineStatuses", () => {
  assert.ok(isPipelineStatus("Applied"));
  assert.ok(!isPipelineStatus("whatever"));
  assert.ok(nextPipelineStatuses("Saved").includes("Preparing"));
  assert.ok(nextPipelineStatuses("Saved").includes("Ready to Apply"));
  assert.ok(nextPipelineStatuses("Saved").includes("Withdrawn"));
});

test("transitionPipeline: giltig övergång → ny status + historik med tidsstämplar", () => {
  const pkg = createApplicationPackage({ job, profile, match, cvVersion: null, settings: settingsSv, now: "2026-08-07T10:00:00.000Z" });
  const next = transitionPipeline(pkg, "Ready to Apply", "2026-08-07T11:00:00.000Z");
  assert.equal(next.status, "Ready to Apply");
  const entry = next.history.find((h) => h.event === "status-change");
  assert.ok(entry, "historik saknas");
  assert.equal(entry.from, "Saved");
  assert.equal(entry.to, "Ready to Apply");
  assert.equal(entry.at, "2026-08-07T11:00:00.000Z");
});

test("transitionPipeline: otillåten övergång kastar (Saved → Offer)", () => {
  const pkg = createApplicationPackage({ job, profile, match, cvVersion: null, settings: settingsSv });
  assert.throws(() => transitionPipeline(pkg, "Offer"));
});

test("toCoreStatus mappar FAS 5-status till befintlig core-status", () => {
  assert.equal(toCoreStatus("Applied"), "applied");
  assert.equal(toCoreStatus("Rejected"), "rejected");
  assert.equal(toCoreStatus("Saved"), "saved");
});

/* ── buildFactBase coverage ─────────────────────────────────────────── */

test("buildFactBase täcker profil, jobb, matchning och CV-version", () => {
  const fb = buildFactBase({ profile, job, match, cvVersion: { id: "cv-7", title: "CV 2026" } });
  const labels = fb.facts.map((f) => f.label);
  for (const expected of ["Namn", "E-post", "Telefon", "Ort", "Rubrik", "Sammanfattning", "Kompetenser", "Målroller", "Företag", "Tjänst", "Matchning", "CV-version"]) {
    assert.ok(labels.includes(expected), `saknas: ${expected}`);
  }
  assert.equal(fb.map.fullName, "Anna Andersson");
  assert.equal(fb.map.company, "Acme AB");
  assert.equal(fb.map.matchScore, "82");
  assert.equal(fb.map.cvVersionId, "CV 2026");
});
