import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeJobText,
  classifyRequirementText,
  extractKeywords,
  buildProfileEvidence,
  matchAnalysis,
  matchRequirement,
  summarizeAnalysis,
} from "../../src/lib/job-intelligence.mjs";

const SWEDISH_AD = `# Senior Backend Developer
Acme AB
Stockholm, Sverige (hybrid)

## Ansvarsområden
- Bygga och driva skalabara mikrotjänster
- Samarbeta med produktteam

## Krav
- Minst 5 år erfarenhet av backendutveckling
- Erfarenhet av Kubernetes och AWS
- Goda kunskaper i svenska och engelska
- Körkort B krävs

## Meriterande
- Erfarenhet av ledarskap är meriterande
- Kunskaper i React är ett plus

## Lön
55 000 - 65 000 kr/mån`;

const ENGLISH_AD = `# Staff Software Engineer
CloudWorks Inc.
London, United Kingdom (remote)

## What you'll do
- Drive the architecture of our platform
- Mentor other engineers

## Requirements
- 8+ years of professional experience
- Deep knowledge of TypeScript and AWS
- Experience leading engineering teams

## Nice to have
- Experience with Kubernetes
- Knowledge of Python`;

const PROFILE = {
  fullName: "Ada Lovelace",
  headline: "Staff Software Engineer",
  location: "Stockholm",
  workModes: ["hybrid", "remote"],
  skills: ["AWS", "Kubernetes", "React", "TypeScript"],
  targetRoles: ["Staff AI Engineer"],
};

const CV = `# Ada Lovelace

## Erfarenhet
Staff Software Engineer, 2020–nu. Byggt mikrotjänster i TypeScript och Go på AWS.
Kubernetes och Amazon Web Services i drift sedan 2019.

## Ledarskap
Lett team om 5 utvecklare.

## Språk
Svenska, engelska.`;

// ---------------------------------------------------------------------------
// Analysis: metadata
// ---------------------------------------------------------------------------

test("analyzeJobText: extracts metadata from Swedish ad", () => {
  const a = analyzeJobText(SWEDISH_AD);
  assert.equal(a.metadata.jobTitle, "Senior Backend Developer");
  assert.equal(a.metadata.company, "Acme AB");
  assert.equal(a.metadata.location, "Stockholm, Sverige (hybrid)");
  assert.equal(a.metadata.country, "Sverige");
  assert.equal(a.metadata.workMode, "hybrid");
  assert.equal(a.metadata.employmentType, null);
  assert.equal(a.metadata.seniority.level, "senior");
});

test("analyzeJobText: extracts metadata from English ad", () => {
  const a = analyzeJobText(ENGLISH_AD);
  assert.equal(a.metadata.jobTitle, "Staff Software Engineer");
  assert.equal(a.metadata.company, "CloudWorks Inc.");
  assert.equal(a.metadata.country, "Storbritannien");
  assert.equal(a.metadata.workMode, "remote");
});

// ---------------------------------------------------------------------------
// Analysis: requirements + classification
// ---------------------------------------------------------------------------

test("analyzeJobText: separates responsibilities from requirements", () => {
  const a = analyzeJobText(SWEDISH_AD);
  assert.ok(a.responsibilities.length >= 2, "responsibilities extracted");
  assert.ok(a.responsibilities.every((r) => r.category === "responsibilities"));
  assert.ok(a.requirements.every((r) => r.category !== "responsibilities"));
});

test("analyzeJobText: classifies requirements Required/Preferred", () => {
  const a = analyzeJobText(SWEDISH_AD);
  const byText = Object.fromEntries(a.requirements.map((r) => [r.text, r.classification]));
  assert.equal(byText["Minst 5 år erfarenhet av backendutveckling"], "Required");
  assert.equal(byText["Erfarenhet av Kubernetes och AWS"], "Required");
  assert.equal(byText["Goda kunskaper i svenska och engelska"], "Required");
  assert.equal(byText["Körkort B krävs"], "Required");
  assert.equal(byText["Erfarenhet av ledarskap är meriterande"], "Preferred");
  assert.equal(byText["Kunskaper i React är ett plus"], "Preferred", "plus-guard on kunskaper cue");
});

test("analyzeJobText: English ad classification + categories", () => {
  const a = analyzeJobText(ENGLISH_AD);
  const byText = Object.fromEntries(a.requirements.map((r) => [r.text, r]));
  assert.equal(byText["8+ years of professional experience"].classification, "Required");
  assert.equal(byText["Experience leading engineering teams"].classification, "Required");
  assert.equal(byText["Experience with Kubernetes"].classification, "Preferred");
  assert.equal(byText["Experience with Kubernetes"].category, "technicalSkills");
  assert.equal(byText["Knowledge of Python"].classification, "Preferred");
});

test("classifyRequirementText: all four classes", () => {
  assert.equal(classifyRequirementText("X krävs").classification, "Required");
  assert.equal(classifyRequirementText("Y är meriterande").classification, "Preferred");
  assert.equal(classifyRequirementText("Z är valfritt").classification, "Optional");
  assert.equal(classifyRequirementText("Något helt otydligt här").classification, "Unclear");
  assert.equal(classifyRequirementText("Experience with Go is a plus").classification, "Preferred");
});

// ---------------------------------------------------------------------------
// Analysis: salary, keywords, guards
// ---------------------------------------------------------------------------

test("analyzeJobText: extracts salary range", () => {
  const a = analyzeJobText(SWEDISH_AD);
  assert.ok(a.salary, "salary present");
  assert.equal(a.salary.min, 55000);
  assert.equal(a.salary.max, 65000);
  assert.equal(a.salary.currency, "SEK");
  assert.equal(a.salary.period, "månad");
});

test("extractKeywords: word-boundary aware, no noise", () => {
  const kw = extractKeywords("Goda kunskaper i React och AWS", { requirements: [] });
  assert.ok(kw.includes("react") && kw.includes("aws"), kw.join(","));
  assert.ok(!kw.includes("go"), "bare 'go' must not match inside 'goda'");
});

test("analyzeJobText: rejects too-short text", () => {
  assert.throws(() => analyzeJobText("Kort."), /ofullständig/i);
});

// ---------------------------------------------------------------------------
// Match engine
// ---------------------------------------------------------------------------

function evidence(over = {}, answers = {}) {
  return buildProfileEvidence({ ...PROFILE, ...over }, CV, answers);
}

test("matchAnalysis: verified evidence comes only from CV/profile (no invention)", () => {
  const rep = matchAnalysis(analyzeJobText(SWEDISH_AD), evidence());
  const byText = Object.fromEntries(rep.requirementMatches.map((m) => [m.text, m]));
  assert.equal(byText["Erfarenhet av Kubernetes och AWS"].status, "verified");
  assert.equal(byText["Goda kunskaper i svenska och engelska"].status, "verified");
  // Not in CV or profile -> never verified
  assert.equal(byText["Körkort B krävs"].status, "missing-evidence");
});

test("matchRequirement: profile-declared skill is potential, not verified", () => {
  const m = matchRequirement(
    { id: "x", text: "Kunskaper i React", category: "technicalSkills", classification: "Preferred", reason: "test" },
    evidence(),
  );
  assert.equal(m.status, "potential");
  assert.ok(m.evidence.some((e) => e.source === "profile"));
});

test("matchAnalysis: no-invention guard — empty profile/CV verifies nothing", () => {
  const rep = matchAnalysis(analyzeJobText(SWEDISH_AD), buildProfileEvidence({}, ""));
  assert.ok(rep.requirementMatches.every((m) => m.status !== "verified"), "nothing can be verified without evidence");
});

test("matchAnalysis: transferable via synonym (amazon web services vs aws)", () => {
  const m = matchRequirement(
    { id: "x", text: "Erfarenhet av Amazon Web Services", category: "technicalSkills", classification: "Required", reason: "test" },
    evidence(),
  );
  assert.equal(m.status, "verified", "AWS in CV via synonym");
});

test("matchAnalysis: every requirement gets an explanation", () => {
  const rep = matchAnalysis(analyzeJobText(SWEDISH_AD), evidence());
  for (const m of rep.requirementMatches) {
    assert.ok(m.explanation && m.explanation.length > 10, `explanation for: ${m.text}`);
  }
});

test("matchAnalysis: verdict labels and risk factors", () => {
  const rep = matchAnalysis(analyzeJobText(SWEDISH_AD), evidence());
  assert.ok(["Excellent Match", "Strong Match", "Partial Match", "Weak Match"].includes(rep.verdict.label));
  assert.ok(rep.verdict.score >= 0 && rep.verdict.score <= 100);
  assert.ok(Array.isArray(rep.verdict.riskFactors));
});

test("matchAnalysis: seniority above job level is not a risk", () => {
  const rep = matchAnalysis(analyzeJobText(ENGLISH_AD), evidence()); // Staff vs Staff
  assert.ok(rep.verdict.seniority.score >= 0.75, JSON.stringify(rep.verdict.seniority));
  const juniorAd = analyzeJobText("# Junior Developer\nAcme AB\nStockholm (hybrid)\n\n## Krav\n- Erfarenhet av Python");
  const rep2 = matchAnalysis(juniorAd, evidence());
  assert.ok(!rep2.verdict.riskFactors.some((r) => r.includes("Nivåskillnad") && r.includes("lägre")), JSON.stringify(rep2.verdict.riskFactors));
});

test("matchAnalysis: location/work mode scores are explainable", () => {
  const rep = matchAnalysis(analyzeJobText(SWEDISH_AD), evidence());
  assert.ok(rep.verdict.location.reason.length > 5);
  assert.ok(rep.verdict.workMode.reason.length > 5);
});

// ---------------------------------------------------------------------------
// Gap analysis
// ---------------------------------------------------------------------------

test("gapAnalysis: verified / transferable / missingEvidence / gaps / questions", () => {
  const rep = matchAnalysis(analyzeJobText(SWEDISH_AD), evidence());
  const g = rep.gaps;
  assert.ok(g.verified.length >= 2, "verified list");
  assert.ok(Array.isArray(g.transferable));
  assert.ok(g.missingEvidence.length >= 1, "missing evidence");
  assert.ok(g.gaps.length >= 1, "gaps = Required without evidence");
  assert.ok(g.questions.length >= 1, "questions for the user");
  for (const q of g.questions) {
    assert.ok(q.question && q.question.length > 10);
    assert.ok(q.reason && q.reason.length > 5);
  }
  for (const item of g.gaps) {
    assert.equal(item.classification, "Required");
    assert.ok(item.recommendedAction);
  }
});

test("gapAnalysis: user answers become potential evidence (no invention)", () => {
  const rep = matchAnalysis(analyzeJobText(SWEDISH_AD), evidence({}, { q1: "Körkort B — har körkort sedan 2015." }));
  const m = rep.requirementMatches.find((x) => x.text === "Körkort B krävs");
  assert.equal(m.status, "potential", "user-attested answers count as potential evidence");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

test("summarizeAnalysis: compact index record", () => {
  const a = analyzeJobText(SWEDISH_AD);
  const rep = matchAnalysis(a, evidence());
  const s = summarizeAnalysis(a, rep, "ji-abc");
  assert.equal(s.id, "ji-abc");
  assert.equal(s.jobTitle, "Senior Backend Developer");
  assert.equal(s.verdict, rep.verdict.label);
  assert.ok(s.salary.includes("55 000"));
});

// ---------------------------------------------------------------------------
// FAS 2 quality fixes (regression): company+location on one line,
// benefit/offer lines are not requirements, q-workmode wording
// ---------------------------------------------------------------------------

test("metadata: company and location split on one line (\"Acme Digital AB, Stockholm, Sweden\")", () => {
  const a = analyzeJobText(`# Senior Frontend Developer
Acme Digital AB, Stockholm, Sweden (hybrid)

## Krav
- Erfarenhet av React`);
  assert.equal(a.metadata.company, "Acme Digital AB");
  assert.equal(a.metadata.location, "Stockholm, Sweden (hybrid)");
});

test("requirements: benefit/offer lines (\"Vi erbjuder konkurrenskraftig lön…\") are not requirements", () => {
  const ad = `# Frontend Developer
Acme AB
Stockholm, Sverige

## Krav
- Erfarenhet av React

Vi erbjuder konkurrenskraftig lön, friskvårdsbidrag och möjlighet till distansarbete.`;
  const a = analyzeJobText(ad);
  assert.ok(!a.requirements.some((r) => /erbjuder/.test(r.text)), "offer line must not become a requirement");
  assert.ok(a.requirements.some((r) => r.text.includes("React")), "real requirements are still extracted");
});

test("gapAnalysis: q-workmode question is grammatically sound", () => {
  const ad = `# Frontend Developer
Acme AB
Stockholm, Sverige (hybrid)

## Krav
- Erfarenhet av React`;
  const rep = matchAnalysis(analyzeJobText(ad), buildProfileEvidence({ summary: "Utvecklare", skills: ["React"] }, ""));
  const q = rep.gaps.questions.find((x) => x.id === "q-workmode");
  assert.ok(q, "workmode question exists when profile lacks work modes");
  assert.ok(!/Jobbet kräver Profilen|:\s*$/.test(q.question), "no raw reason leaking into the question");
  assert.ok(q.question.includes("arbetssättet"), `question names the work mode: ${q.question}`);
  assert.ok(/hybrid/i.test(q.question), `question contains the actual mode: ${q.question}`);
});
