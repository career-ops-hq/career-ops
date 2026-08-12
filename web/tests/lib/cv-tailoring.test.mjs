import test from "node:test";
import assert from "node:assert/strict";
import {
  generateTailorProposal,
  applyTailorChanges,
  assembleProposedCv,
  unverifiedTerms,
  buildVerifiedTerms,
  polishProposalWithLlm,
} from "../../src/lib/cv-tailoring.mjs";

const ORIGINAL_CV = `Frontend Developer | Stockholm
Erfaren webbutvecklare med fokus på React och TypeScript.

## Profil
Erfaren webbutvecklare med fokus på React och TypeScript.

## Erfarenhet
### Globex Corp — Webbutvecklare (2018–2021)
- Arbetsuppgifter: underhåll av interna verktyg med JavaScript.
- Support av befintliga system.

### Acme Digital AB — Frontendutvecklare (2021–nu)
- Utvecklade React-applikationer och API-integrationer.
- Ansvarig för prestandaoptimering av webbplatsen.

## Kompetenser
- Git
- REST APIer
- JavaScript
- React
- TypeScript

## Utbildning
Kandidat i datavetenskap, KTH (2018)`;

const PROFILE = {
  fullName: "Anna Andersson",
  headline: "Frontend Developer",
  summary: "Erfaren webbutvecklare med fokus på React och TypeScript.",
  location: "Stockholm",
  skills: ["React", "TypeScript", "JavaScript", "Git", "REST APIer"],
  targetRoles: ["Frontend Developer"],
  workModes: ["Hybrid"],
};

const ANALYSIS = {
  metadata: { jobTitle: "Frontend Developer", company: "Acme Digital AB" },
  keywords: ["React", "TypeScript", "Next.js", "GraphQL", "frontend"],
};

function allChanges(p) {
  return p.sections.flatMap((s) => s.changes || []);
}

test("original-CV ändras aldrig (oändlig string)", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "professional",
  });
  assert.equal(p.level, "professional");
  for (const s of p.sections) {
    assert.equal(typeof s.original, "string");
    assert.ok(s.original.length > 0);
  }
});

test("LIGHT: struktur bevaras och ändringar är verifierade", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "light",
  });
  assert.equal(p.level, "light");
  assert.ok(p.sections.length >= 5, "minst 5 sektioner");
  const changes = allChanges(p);
  assert.ok(changes.length > 0, "har ändringar");
  assert.ok(changes.every((c) => c.verified), "alla LIGHT-ändringar verified");
});

test("LIGHT: erfarenhet får aktiv verbfras (Arbetsuppgifter → Ansvarade för)", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "light",
  });
  const exp = p.sections.find((s) => s.id === "experience" || s.type === "experience");
  assert.ok(exp.proposed.includes("Ansvarade för"), "aktiv verbfras i förslag");
  assert.ok(exp.original.includes("Arbetsuppgifter"), "original behåller svag fras");
});

test("PROFESSIONAL: sammanfattning förbättras med rubrik kvar och jobbtitel", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "professional",
  });
  const prof = p.sections.find((s) => s.type === "profile");
  assert.notEqual(prof.proposed, prof.original, "sammanfattning förbättrad");
  assert.ok(prof.proposed.startsWith("## Profil"), "rubrikrad behålls");
  assert.ok(prof.proposed.includes("Frontend Developer"), "nämner jobbtitel");
  assert.ok(prof.changes.some((c) => c.type === "rephrased"), "rephrased-change finns");
});

test("PROFESSIONAL: kompetensordning flyttar relevanta först (React före JavaScript)", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "professional",
  });
  const skills = p.sections.find((s) => s.type === "skills");
  assert.ok(skills.changes.some((c) => c.type === "moved"), "moved-change finns");
  const pi = skills.proposed.indexOf("React");
  const ji = skills.proposed.indexOf("JavaScript");
  assert.ok(pi !== -1 && ji !== -1 && pi < ji, "React före JavaScript");
});

test("PROFESSIONAL: erfarenhetsordning bevaras (flyttar ej), allt verified", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "professional",
  });
  const exp = p.sections.find((s) => s.type === "experience");
  const gi = exp.proposed.indexOf("Globex");
  const ai = exp.proposed.indexOf("Acme");
  assert.ok(gi !== -1 && ai !== -1 && gi < ai, "Globex före Acme (professional flyttar ej)");
  assert.ok(allChanges(p).every((c) => c.verified), "allt verified");
});

test("TARGETED: fokusrad läggs till i header med titel + kompetens", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "targeted",
  });
  const header = p.sections.find((s) => s.type === "header");
  const added = header.changes.find((c) => c.type === "added");
  assert.ok(added, "fokusrad tillagd");
  assert.ok(added.proposed.includes("Frontend Developer"), "fokusrad = titel");
  assert.ok(added.proposed.includes("React"), "fokusrad = kompetens");
});

test("TARGETED: relevant erfarenhet prioriteras (Acme före Globex)", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "targeted",
  });
  const exp = p.sections.find((s) => s.type === "experience");
  assert.ok(exp.changes.some((c) => c.type === "moved"), "moved-change finns");
  const ai = exp.proposed.indexOf("Acme");
  const gi = exp.proposed.indexOf("Globex");
  assert.ok(ai !== -1 && gi !== -1 && ai < gi, "Acme före Globex");
  assert.ok(allChanges(p).every((c) => c.verified), "allt verified");
});

test("VERIF: hittar påhittad teknologi och prestationer, accepterar kända ord + jobbnyckelord", () => {
  const vt = buildVerifiedTerms(ORIGINAL_CV, PROFILE, ANALYSIS);
  const inv = unverifiedTerms("Jag är en Blockchain-expert med 10 års erfarenhet.", ORIGINAL_CV, vt);
  assert.ok(inv.some((w) => w.includes("blockchain")), "blockchain flaggas");
  const ok = unverifiedTerms("Erfaren React-utvecklare med TypeScript", ORIGINAL_CV, vt);
  assert.equal(ok.length, 0, "kända ord accepteras");
  const kw = unverifiedTerms("Behärskar Next.js, GraphQL och frontend", ORIGINAL_CV, vt);
  assert.equal(kw.length, 0, "jobbnyckelord accepteras");
  const num = unverifiedTerms("Skapade 3.2 miljoner i intäkter åt kunden.", ORIGINAL_CV, vt);
  assert.ok(num.some((w) => w.includes("miljoner")), "påhittad prestation flaggas");
});

test("APPLY: godkända ändringar bygger ny CV-text, original oförändrat, rubriker kvar", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "professional",
  });
  const approved = allChanges(p).filter((c) => c.verified).map((c) => c.id);
  const res = applyTailorChanges({ cvText: ORIGINAL_CV, sections: p.sections, approvedIds: approved });
  assert.notEqual(res.cvText, ORIGINAL_CV, "ny text skapad");
  for (const h of ["## Profil", "## Erfarenhet", "## Kompetenser", "## Utbildning"]) {
    assert.ok(res.cvText.includes(h), `rubrik ${h} behålls`);
  }
  assert.ok(res.cvText.includes("Globex Corp"), "originaltext kvar i oförändrad sektion");
  assert.ok(res.appliedCount > 0, "ändringar applicerade");
});

test("APPLY: inga godkända → byte-för-byte original", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "targeted",
  });
  const res = applyTailorChanges({ cvText: ORIGINAL_CV, sections: p.sections, approvedIds: [] });
  assert.equal(res.cvText, ORIGINAL_CV);
  assert.equal(res.appliedCount, 0);
});

test("APPLY: användarredigering av sektion", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "professional",
  });
  const skills = p.sections.find((s) => s.type === "skills");
  const res = applyTailorChanges({
    cvText: ORIGINAL_CV,
    sections: p.sections,
    approvedIds: [],
    edits: { [skills.id]: "## Kompetenser\n- React\n- TypeScript" },
  });
  assert.ok(res.cvText.includes("- React\n- TypeScript"), "redigering i text");
});

test("ASSEMBLE: alla rubriker + header + fokusrad i förslag", () => {
  const p = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "targeted",
  });
  const out = assembleProposedCv(ORIGINAL_CV, p.sections);
  for (const h of ["## Profil", "## Erfarenhet", "## Kompetenser", "## Utbildning"]) {
    assert.ok(out.includes(h), `rubrik ${h}`);
  }
  assert.ok(out.includes("Frontend Developer | Stockholm"), "header bevarad");
  assert.ok(out.includes("React · TypeScript"), "fokusrad med");
});

test("POLISH: ren LLM-omskrivning blir verified, påhitt blir needsVerification + återställs", async () => {
  const cleanStub = async () => ({
    ok: true,
    content: "Utvecklade React-applikationer och API-integrationer med fokus på prestandaoptimering.",
  });
  const p1 = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "professional",
  });
  const polished = await polishProposalWithLlm(
    p1,
    { analysis: ANALYSIS, profile: PROFILE },
    cleanStub,
    { model: "test-model" },
  );
  assert.ok(polished.aiPolished >= 1, "aiPolished ≥ 1");
  assert.ok(
    allChanges(polished).some((c) => c.type === "rephrased" && c.verified && c.reason.includes("AI-omskrivning")),
    "ren AI-change verified",
  );

  const dirtyStub = async () => ({
    ok: true,
    content: "Ledde ett team med Blockchain och ökade intäkter med 50%.",
  });
  const p2 = generateTailorProposal({
    cvText: ORIGINAL_CV, profile: PROFILE, analysis: ANALYSIS, report: null, level: "professional",
  });
  const dirty = await polishProposalWithLlm(
    p2,
    { analysis: ANALYSIS, profile: PROFILE },
    dirtyStub,
    { model: "test-model" },
  );
  assert.ok(
    allChanges(dirty).some((c) => c.type === "needsVerification"),
    "påhitt → needsVerification",
  );
  const exp = dirty.sections.find((s) => s.type === "experience");
  assert.ok(!exp.proposed.includes("Blockchain"), "sektionstext återställd (ingen påhittad fakta)");
});
