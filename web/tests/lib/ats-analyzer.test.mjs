import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCvForAts,
  scoreCv,
  improveSafePoints,
  buildExportFileName,
  validateExportFileName,
  ATS_ENVIRONMENTS,
} from "../../src/lib/ats-analyzer.mjs";

const CV = `Anna Andersson
Stockholm | anna@exempel.se | 070-123 45 67

## Profil
Erfaren webbutvecklare med fokus på React och TypeScript.

## Arbetslivserfarenhet
### Acme Digital AB — Senior Frontend Developer (2021–nu)
- Utvecklade React-applikationer och API-integrationer.
- Ansvarig för prestandaoptimering av webbplatsen.

### Globex Corp — Webbutvecklare (2018–2021)
- Arbetsuppgifter: underhåll av interna verktyg med JavaScript.

## Kompetenser
- React, TypeScript, JavaScript, Node.js, CSS

## Utbildning
- Kandidat i datavetenskap, KTH (2014–2018)

## Certifieringar
- AWS Certified Developer

## Språk
Svenska (modersmål), Engelska (flytande)
`;

const JOB = `Vi söker en Senior Frontend Developer med erfarenhet av React, TypeScript och Node.js.
Du ansvarar för prestandaoptimering och API-integrationer.`;

/* ── ATS Analyzer ───────────────────────────────────────────────────── */

test("ATS: analys kör alla kontroller och sammanfattar PASS/WARNING/CRITICAL", () => {
  const report = analyzeCvForAts(CV);
  assert.ok(Array.isArray(report.checks));
  assert.ok(report.checks.length >= 15, `förväntade ≥15 kontroller, fick ${report.checks.length}`);
  assert.ok(report.checks.every((c) => ["PASS", "WARNING", "CRITICAL"].includes(c.severity)));
  assert.ok(report.summary.pass >= 0);
  assert.ok(report.summary.warning >= 0);
  assert.ok(report.summary.critical >= 0);
  assert.equal(report.summary.pass + report.summary.warning + report.summary.critical, report.checks.length);
  assert.ok(report.length.words > 0);
  assert.ok(report.signals.language?.detected);
});

test("ATS: kontaktinformation hittas i header", () => {
  const report = analyzeCvForAts(CV);
  const contact = report.checks.find((c) => c.id.includes("contact"));
  assert.ok(contact, "kontroll för kontaktinformation saknas");
  assert.equal(contact.severity, "PASS");
});

test("ATS: jobbannons ger nyckelordstäckning", () => {
  const report = analyzeCvForAts(CV, { jobText: JOB });
  assert.ok(report.keywords, "keywords saknas");
  assert.ok(report.keywords.coverage >= 0 && report.keywords.coverage <= 100);
  assert.ok(Array.isArray(report.keywords.matched));
  assert.ok(report.keywords.matched.includes("react"), `react borde matcha: ${report.keywords.matched.join(", ")}`);
});

test("ATS: 12 miljöprofiler finns (Workday…Ashby)", () => {
  const report = analyzeCvForAts(CV);
  assert.ok(Array.isArray(report.environments));
  assert.ok(report.environments.length >= 12, `förväntade 12 miljöer, fick ${report.environments.length}`);
  const names = report.environments.map((e) => e.name);
  for (const expected of ["Workday", "Greenhouse", "Lever", "Teamtailor", "SmartRecruiters", "SAP SuccessFactors", "Oracle Recruiting", "iCIMS", "Workable", "Personio", "Recruitee", "Ashby"]) {
    assert.ok(names.includes(expected), `saknar miljö: ${expected}`);
  }
  assert.ok(report.environments.every((e) => ["låg", "medel", "hög"].includes(e.riskLevel)));
});

test("ATS: emoji/symboler flaggas som risk", () => {
  const bad = `${CV}\n\n## Kompetenser\n- ✅ React, ⚡ TypeScript, 🚀 Node.js\n`;
  const report = analyzeCvForAts(bad);
  const icon = report.checks.find((c) => c.id.includes("icon") || c.id.includes("emoji"));
  assert.ok(icon, "ikon/emoji-kontroll saknas");
  assert.equal(icon.severity, "WARNING");
});

test("ATS: avsaknad av sektioner ger WARNING", () => {
  const minimal = "Anna Andersson\n\n## Profil\nTest.\n";
  const report = analyzeCvForAts(minimal);
  assert.ok(report.checks.some((c) => c.severity === "WARNING" || c.severity === "CRITICAL"));
});

test("ATS: ingen garanti — environments innehåller riskspråk", () => {
  const report = analyzeCvForAts(CV);
  for (const env of report.environments) {
    assert.ok(Array.isArray(env.knownRisks));
    assert.ok(Array.isArray(env.guidance));
  }
});

/* ── Scorecard ──────────────────────────────────────────────────────── */

test("SCORE: 13 kategorier + overallReadiness", () => {
  const score = scoreCv({ cvText: CV, options: { jobText: JOB } });
  assert.ok(score.categories, "categories saknas");
  const keys = Object.keys(score.categories);
  assert.equal(keys.length, 13, `förväntade 13 kategorier, fick ${keys.length}`);
  assert.ok(score.overallReadiness, "overallReadiness saknas");
  assert.ok(["Excellent", "Strong", "Good", "Needs Improvement", "Critical"].includes(score.overallReadiness.band));
});

test("SCORE: varje kategori har status, förklaring, problem och åtgärd", () => {
  const score = scoreCv({ cvText: CV, options: { jobText: JOB } });
  for (const [key, band] of Object.entries(score.categories)) {
    assert.ok(band.label, `${key}: label saknas`);
    assert.ok(band.band, `${key}: band saknas`);
    assert.ok(typeof band.explanation === "string" && band.explanation.length > 0, `${key}: förklaring saknas`);
    assert.ok(Array.isArray(band.problems), `${key}: problems saknas`);
    assert.ok(typeof band.fix === "string" && band.fix.length > 0, `${key}: åtgärd saknas`);
  }
});

test("SCORE: undviker falsk exakthet — band är etiketter, inte falskt precisa siffror", () => {
  const score = scoreCv({ cvText: CV });
  for (const band of Object.values(score.categories)) {
    assert.ok(["Excellent", "Strong", "Good", "Needs Improvement", "Critical"].includes(band.band));
    if (typeof band.score === "number") {
      assert.ok(band.score >= 0 && band.score <= 100);
    }
  }
});

/* ── Säker auto-fix ─────────────────────────────────────────────────── */

test("FIX: korrigerar emoji och bevarar fakta", () => {
  const dirty = `Anna Andersson

## Profil
Erfaren utvecklare ✅ med fokus på React.

## Arbetslivserfarenhet
### Acme AB — Utvecklare (2015–2020)
- Ledde 12 personer och ökade omsättningen med 34 %.

## Utbildning
- Kandidat, KTH (2012–2015)
`;
  const result = improveSafePoints(dirty);
  assert.ok(result.correctedText);
  assert.ok(!result.correctedText.includes("✅"), "emoji borde tas bort");
  assert.ok(result.correctedText.includes("Acme AB"), "arbetsgivare får inte ändras");
  assert.ok(result.correctedText.includes("2015–2020"), "datum får inte ändras");
  assert.ok(result.correctedText.includes("12"), "siffror får inte ändras");
  assert.ok(result.correctedText.includes("34"), "procentsiffra får inte ändras");
  assert.ok(result.correctedText.includes("KTH"), "utbildning får inte ändras");
  assert.ok(Array.isArray(result.changes));
  assert.ok(result.changes.every((c) => c.safe === true), "alla ändringar ska vara säkra");
});

test("FIX: inga ändringar när CV:t redan är rent", () => {
  const result = improveSafePoints(CV);
  assert.ok(result.correctedText);
  assert.equal(result.changes.length, 0, "rent CV ska inte ändras");
});

/* ── Filnamn ────────────────────────────────────────────────────────── */

test("FILNAMN: FirstName_LastName_Role_Company_CV.pdf", () => {
  const name = buildExportFileName({ firstName: "Anna", lastName: "Andersson", role: "Frontend Developer", company: "Acme", kind: "CV", ext: "pdf" });
  assert.equal(name, "Anna_Andersson_Frontend_Developer_Acme_CV.pdf");
});

test("FILNAMN: sanerar specialtecken och fallback vid saknad data", () => {
  const name = buildExportFileName({ firstName: "Åsa", lastName: "Öberg", role: "UX/UI-designer!", company: "Mega Corp AB", kind: "CoverLetter", ext: "pdf" });
  assert.ok(name.startsWith("Asa_Oberg_"));
  assert.ok(!name.includes("!"), "specialtecken ska saneras");
  assert.ok(name.includes("CoverLetter"));
  const fallback = buildExportFileName({});
  assert.equal(fallback, "Fornamn_Efternamn_Roll_Foretag_CV.pdf");
});

test("FILNAMN: validering godkänner/avvisar", () => {
  assert.equal(validateExportFileName("Anna_Andersson_Roll_Foretag_CV.pdf").valid, true);
  assert.equal(validateExportFileName("min cv!.pdf").valid, false);
  assert.equal(validateExportFileName("Anna.pdf").valid, false);
  assert.equal(validateExportFileName("Anna_Andersson_Roll_Foretag_CV.exe").valid, false);
});
