/**
 * FAS 4 — ATS Analyzer + CV Scorecard + säkra förbättringar.
 *
 * Deterministisk, transparent ATS-analys. Ingen LLM krävs för analysen:
 * varje kontroll är en regel som returnerar PASS / WARNING / CRITICAL och
 * en rekommenderad åtgärd. CareerPilot AI kan ALDRIG garantera ett
 * ATS-resultat — systemet visar kompatibilitetsrisker och rekommendationer
 * baserat på dokumentstruktur och relevans.
 *
 * Faktasäkerhet: `improveSafePoints` ändrar ENDAST format/språk/struktur.
 * Arbetsgivare, datum, roller, certifieringar, utbildningar, tekniska
 * färdigheter, ansvar, resultat och siffror rörs aldrig automatiskt.
 */
import { parseCvSections, tokenizeTerms } from "./cv-tailoring.mjs";
import { analyzeAtsReadiness } from "./ats-foundation.mjs";

export const SEVERITY = Object.freeze({
  PASS: "PASS",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
});

export const BANDS = Object.freeze([
  "Excellent", // 81–100
  "Strong", // 61–80
  "Good", // 41–60
  "Needs Improvement", // 21–40
  "Critical", // 0–20
]);

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const LINKEDIN_RE = /linkedin\.com\/(?:in|company)\/[\w-]+/i;
const PHONE_RE = /(?:\+?\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{2,4}[ .-]?\d{3,4}[ .-]?\d{2,4}/;
const YEAR_RE = /\b(19|20)\d{2}\b/;
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;
const FORM_FEED_RE = /\f/g;

/** Ord som ofta förekommer i jobbannonser men inte är tekniska nyckelord. */
const ANNONS_STOPORD = new Set([
  "söker", "söka", "vi", "dig", "dina", "ditt", "din", "gärna", "bra", "god", "minst",
  "årig", "åriga", "arbetsuppgifter", "krav", "kvalifikationer", "ansvar", "roll",
  "tjänst", "tjänsten", "företag", "oss", "team", "agila", "arbetar", "arbeta",
  "fokuserar", "moderna", "meriterande", "utveckling", "utveckla", "utvecklas",
  "bygga", "bygger", "erbjuder", "plats", "distans", "hybrid", "omfattning",
  "tillträde", "ansök", "ansökan", "sista", "datum", "erfarenhet", "erfarenheter",
  "kompetens", "kompetenser", "kunskaper", "färdigheter", "förmåga", "förmågor",
  "engagerad", "drivna", "driven", "självständig", "samarbete", "samarbetsförmåga",
  "kommunikation", "kommunikativ", "strukturerad", "ansvarstagande", "positiv",
  "flexibel", "ambitiös", "resultatinriktad", "analytisk", "problemlösning",
  "problemlösare", "intresserad", "relevant", "exempel", "vanliga", "vanlig",
  "övrigt", "övriga", "samt", "samtliga", "mellan", "efter", "innan", "under",
  "över", "genom", "utan", "även", "dock", "också", "där", "detta", "dessa",
  "denna", "deras", "vår", "våra", "vara", "varit", "finns", "finnas", "kan",
  "kunna", "bör", "måste", "ska", "kommer", "blir", "göra", "gör", "skicka",
  "mejla", "kontakta", "kontaktperson", "rekryterande", "rekrytering", "ledarskap",
  "erfarna", "arbetsgivare", "ansvarig", "arbetslivserfarenhet",
  "lämpliga", "lämplig", "uppdrag", "uppdraget", "kund", "kunder", "projekt",
  "värderingar", "kultur", "möjlighet", "möjligheter", "utmaningar", "uppgifter",
  "tillsammans", "gemensamt", "gemensamma", "kontinuerligt", "löpande",
]);

/** Vanliga svenska/engelska ord för språkdetektion (dominans, ej exakt). */
const SWE_WORDS = new Set(
  "och att det som med för har var vid inte alla även men till från kan ska när vad hur den de ett en min mitt mina jag mig oss vår vårt våra mer mest finns fanns andra olika flera många inom över under utan sedan genom mellan efter innan samt eller både så också bara redan aldrig alltid ofta sällan gärna väldigt mycket arbetade arbetat arbetar arbete ansvar erfarenhet utveckling kompetens utbildning projekt företag roll".split(
    " ",
  ),
);

const ENG_WORDS = new Set(
  "and the with for from have has had was were are can will would should could this that these those who what when where which your our their his her its you they them there more most other also only just very much many about between through during after before within without because then than into onto again never always often working worked work experience skills education company role project team senior".split(
    " ",
  ),
);

function bounded(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function bandFor(score) {
  if (score >= 81) return BANDS[0];
  if (score >= 61) return BANDS[1];
  if (score >= 41) return BANDS[2];
  if (score >= 21) return BANDS[3];
  return BANDS[4];
}

/** Samla datum-tokens och klassificera format för konsistenskontroll. */
function dateFormatClasses(text) {
  const classes = new Set();
  for (const m of text.matchAll(
    /\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}[\/.-]\d{4}|\d{4}-\d{1,2}|\d{4}\/\d{1,2}|[A-ZÅÄÖa-zåäö]{3,9}\.?\s+(?:19|20)\d{2}|(?:19|20)\d{2})\b/g,
  )) {
    const token = m[0];
    if (/^\d{4}$/.test(token)) classes.add("year");
    else if (/^\d{4}[\/-]\d{1,2}$/.test(token)) classes.add("ym");
    else if (/^\d{1,2}[\/.-]\d{4}$/.test(token)) classes.add("my");
    else if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(token)) classes.add("dmy");
    else if (/[A-ZÅÄÖa-zåäö]{3,}/.test(token)) classes.add("month-name");
    else classes.add("other");
  }
  return classes;
}

/** Kvantifierade resultat: siffror med % / enheter / valuta etc. */
function quantifiedResults(text) {
  const re = /\b\d+(?:[.,]\d+)?\s*(?:%|procent|kr|sek|k|m|miljoner|million|users|kunder|kund|medarbetare|anställda|projekt|produkter|leveranser)\b/gi;
  return [...text.matchAll(re)].map((m) => m[0]);
}

function actionVerbs(text) {
  const re =
    /\b(achieved|built|created|delivered|designed|developed|drove|improved|increased|launched|led|optimized|reduced|scaled|implemented|managed|skapade|byggde|ledde|ökade|minskade|förbättrade|implementerade|utvecklade|levererade|utvecklar|driver|ansvarade)\b/gi;
  return [...text.matchAll(re)].map((m) => m[0].toLowerCase());
}

/** Konservativ stavfixlista — endast uppenbara stavfel, aldrig fakta. */
const TYPO_FIXES = [
  ["utveclare", "utvecklare"],
  ["utveclat", "utvecklat"],
  ["utveclar", "utvecklar"],
  ["ansvarig för för", "ansvarig för"],
  ["erfarenhet av av", "erfarenhet av"],
  ["arbetade med med", "arbetade med"],
  ["kompetenser inom inom", "kompetenser inom"],
];

/* ══════════════════════════════════════════════════════════════════════
   1. KONTROLLER (PASS / WARNING / CRITICAL + rekommenderad åtgärd)
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Kör hela ATS-kontrollen på en CV-text.
 * options: { jobText?, profile?, fileName?, sourceKind? ("markdown"|"pdf") }
 * Returnerar { checkedAt, sections, checks, summary, signals, keywords,
 *              language, length, scorecard, environments }
 */
export function analyzeCvForAts(cvText, options = {}) {
  const cv = String(cvText || "");
  const sections = parseCvSections(cv);
  const lines = cv.split("\n");
  const words = cv.match(/\S+/g) || [];
  const chars = cv.length;

  const header = sections.find((s) => s.type === "header");
  const body = sections.filter((s) => s.type !== "header");
  const types = body.map((s) => s.type);
  const experience = body.find((s) => s.type === "experience");
  const skills = body.find((s) => s.type === "skills");
  const education = body.find((s) => s.type === "education");
  const summary = body.find((s) => s.type === "profile"); // "Profil"/"Sammanfattning" → profile

  const jobText = String(options.jobText || "");
  const jobTerms = jobText
    ? [...new Set(tokenizeTerms(jobText).filter((t) => !ANNONS_STOPORD.has(t)))]
    : [];
  const cvTerms = new Set(tokenizeTerms(cv));
  const matchedKeywords = jobTerms.filter((t) => cvTerms.has(t));
  const missingKeywords = jobTerms.filter((t) => !cvTerms.has(t));
  const keywordCoverage = jobTerms.length
    ? bounded((matchedKeywords.length / jobTerms.length) * 100)
    : null;

  const skillsTerms =
    skills && skills.original
      ? [...new Set(tokenizeTerms(skills.original))]
      : [];
  const skillCoverage = jobTerms.length
    ? bounded(
        (jobTerms.filter((t) => skillsTerms.includes(t)).length / jobTerms.length) * 100,
      )
    : null;

  const hasEmail = EMAIL_RE.test(cv);
  const hasLinkedIn = LINKEDIN_RE.test(cv);
  const hasPhone = PHONE_RE.test(cv);
  const contactCount = [hasEmail, hasLinkedIn, hasPhone].filter(Boolean).length;
  const contactInHeader = header
    ? EMAIL_RE.test(header.original) ||
      LINKEDIN_RE.test(header.original) ||
      PHONE_RE.test(header.original)
    : false;

  const yearCount = (cv.match(YEAR_RE) || []).length;
  const dateClasses = dateFormatClasses(cv);
  const hasFormFeed = FORM_FEED_RE.test(cv);
  const pageFooterArtifacts = /(?:sida|page)\s+\d+\s+(?:av|of)\s+\d+/i.test(cv);

  const tableRows = lines.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
  const hasInlineHtmlTable = /<(?:table|tr|td)\b/i.test(cv);
  const imageCount = (cv.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
  const emojiCount = (cv.match(EMOJI_RE) || []).length;

  // Språkdominans (groft: räkna stopord)
  const tokens = (cv.toLowerCase().match(/[a-zåäö]{2,}/g) || []).filter(
    (t) => t.length >= 3,
  );
  let swe = 0;
  let eng = 0;
  for (const t of tokens) {
    if (SWE_WORDS.has(t)) swe++;
    else if (ENG_WORDS.has(t)) eng++;
  }
  const language =
    swe === 0 && eng === 0
      ? { detected: "okänd", mixed: false }
      : { detected: swe >= eng ? "svenska" : "engelska", mixed: swe > 0 && eng > 0 && Math.min(swe, eng) / Math.max(swe, eng) > 0.35 };

  const checks = [];
  const add = (id, label, severity, message, fix, detail) =>
    checks.push({ id, label, severity, message, fix, detail });

  // 1. Text finns
  if (chars === 0) {
    add("text-present", "Textläsbarhet", SEVERITY.CRITICAL, "CV-texten är tom.", "Klistra in eller ladda upp din CV-text.");
  } else if (chars < 200) {
    add("text-present", "Textläsbarhet", SEVERITY.CRITICAL, "CV-texten är mycket kort — ATS har för lite material att tolka.", "Fyll på CV:t med erfarenhet, kompetenser och utbildning.");
  } else {
    add("text-present", "Textläsbarhet", SEVERITY.PASS, `CV-texten är läsbar (${chars} tecken).`, "Ingen åtgärd.");
  }

  // 2. Längd
  const wc = words.length;
  if (chars === 0) {
    // redan kritisk ovan
  } else if (wc < 250) {
    add("readable-length", "Längd", SEVERITY.WARNING, `CV:t är kort (${wc} ord) — risk att det uppfattas som ofullständigt.`, "Utöka med relevanta arbetsuppgifter och resultat.");
  } else if (wc <= 1200) {
    add("readable-length", "Längd", SEVERITY.PASS, `CV:t är inom ett vanligt ATS-intervall (${wc} ord, ca ${Math.max(1, Math.round(wc / 500))}–${Math.max(2, Math.ceil(wc / 400))} sidor).`, "Ingen åtgärd.");
  } else if (wc <= 2000) {
    add("readable-length", "Längd", SEVERITY.WARNING, `CV:t är långt (${wc} ord) — vissa ATS:er trunkerar eller viktar tidiga sidor högre.`, "Prioritera de viktigaste uppgifterna; överväg 1–2 sidor.");
  } else {
    add("readable-length", "Längd", SEVERITY.WARNING, `CV:t är mycket långt (${wc} ord) — risk att viktig information hamnar bortom ATS:ens läsgräns.`, "Korta ned till 1–2 sidor med tydlig prioritering.");
  }

  // 3. Rubrikstruktur
  const headingCount = body.length;
  if (headingCount >= 3) {
    add("heading-structure", "Rubrikstruktur", SEVERITY.PASS, `${headingCount} tydliga sektionsrubriker hittades.`, "Ingen åtgärd.");
  } else if (headingCount >= 1) {
    add("heading-structure", "Rubrikstruktur", SEVERITY.WARNING, `Endast ${headingCount} sektionsrubrik(er) — ATS kan ha svårt att avgränsa avsnitt.`, "Använd tydliga rubriker (t.ex. ## Erfarenhet) för varje avsnitt.");
  } else {
    add("heading-structure", "Rubrikstruktur", SEVERITY.CRITICAL, "Inga sektionsrubriker hittades — ATS kan inte avgränsa avsnitt.", "Lägg till rubriker: Profil, Erfarenhet, Kompetenser, Utbildning.");
  }

  // 4. Kontaktinformation
  if (contactCount >= 2) {
    add("contact-information", "Kontaktinformation", SEVERITY.PASS, `${contactCount} kontaktkanaler hittades (e-post/LinkedIn/telefon).`, "Ingen åtgärd.");
  } else if (contactCount === 1) {
    add("contact-information", "Kontaktinformation", SEVERITY.WARNING, "Endast en kontaktkanal hittades.", "Lägg till e-post och LinkedIn-profil så rekryteraren kan nå dig på flera sätt.");
  } else {
    add("contact-information", "Kontaktinformation", SEVERITY.CRITICAL, "Ingen e-post, LinkedIn eller telefon hittades — ATS kan inte koppla CV:t till dig.", "Lägg till namn, e-post, telefon och LinkedIn högst upp.");
  }

  // 5. Kontaktens placering
  if (contactCount === 0) {
    // hanteras ovan
  } else if (contactInHeader) {
    add("contact-location", "Kontaktens placering", SEVERITY.PASS, "Kontaktuppgifterna ligger i toppblocket där ATS förväntar sig dem.", "Ingen åtgärd.");
  } else {
    add("contact-location", "Kontaktens placering", SEVERITY.WARNING, "Kontaktuppgifterna ligger utanför toppblocket — risk att ATS missar dem.", "Flytta e-post/telefon/LinkedIn till direkt under namnet.");
  }

  // 6. Obligatoriska sektioner
  if (!experience) {
    add("required-sections", "Sektioner", SEVERITY.CRITICAL, "Erfarenhetssektion saknas — den viktigaste sektionen för ATS.", "Lägg till ## Erfarenhet med roller, arbetsgivare och datum.");
  }
  if (!skills) {
    add("skills-section", "Kompetenssektion", SEVERITY.CRITICAL, "Kompetenssektion saknas — nyckelordsmatchning har inget att träffa.", "Lägg till ## Kompetenser med dina tekniska färdigheter.");
  }
  if (!summary) {
    add("summary-section", "Sammanfattning", SEVERITY.WARNING, "Professionell sammanfattning saknas.", "Lägg till 2–3 rader som sammanfattar din profil och inriktning.");
  }
  if (!education) {
    add("education-section", "Utbildning", SEVERITY.WARNING, "Utbildningssektion saknas.", "Lägg till ## Utbildning med examen, skola och år.");
  }

  // 7. Sektionsordning
  const expIdx = types.indexOf("experience");
  const eduIdx = types.indexOf("education");
  if (expIdx === -1) {
    // hanteras ovan
  } else if (eduIdx !== -1 && eduIdx < expIdx) {
    add("section-order", "Sektionsordning", SEVERITY.WARNING, "Utbildning placeras före erfarenhet — ATS kan tolka dig som nyutexaminerad.", "Flytta Erfarenhet före Utbildning.");
  } else {
    add("section-order", "Sektionsordning", SEVERITY.PASS, "Erfarenhet placeras före utbildning.", "Ingen åtgärd.");
  }

  // 8. Datum finns
  if (yearCount === 0) {
    add("dates-present", "Datumformat", SEVERITY.WARNING, "Inga årtal hittades — ATS kan inte bedöma anställningstid.", "Lägg till år för roller och utbildningar (t.ex. 2020–2024).");
  } else {
    add("dates-present", "Datumformat", SEVERITY.PASS, `${yearCount} årtal hittades.`, "Ingen åtgärd.");
  }

  // 9. Datumkonsistens
  if (dateClasses.size > 1 && yearCount > 0) {
    add(
      "dates-consistent",
      "Datumkonsistens",
      SEVERITY.WARNING,
      `Blandade datumformat (${[...dateClasses].join(", ")}) — ATS kan misstolka dem.`,
      "Använd ett konsekvent format, t.ex. 2020-06 eller juni 2020.",
    );
  } else {
    add("dates-consistent", "Datumkonsistens", SEVERITY.PASS, "Datumformaten är konsekventa.", "Ingen åtgärd.");
  }

  // 10. Jobbtitlar under erfarenhet
  if (experience) {
    const expLines = experience.original.split("\n").slice(1); // rubriken exkluderas
    const nonBullet = expLines.filter(
      (l) => l.trim() !== "" && !/^\s*[-*•]\s+/.test(l) && !/^\s*##(?!#)/.test(l),
    );
    if (nonBullet.length >= 1) {
      add("job-titles", "Jobbtitlar", SEVERITY.PASS, "Titel-/arbetsgivarrader hittades under erfarenhet.", "Ingen åtgärd.");
    } else {
      add("job-titles", "Jobbtitlar", SEVERITY.WARNING, "Inga tydliga titel-/arbetsgivarrader under erfarenhet — endast punktlistor.", "Skriv rolltitel och arbetsgivare på egna rader ovanför punktlistan.");
    }
  }

  // 11. Arbetsgivare/datum under erfarenhet
  if (experience) {
    if (YEAR_RE.test(experience.original)) {
      add("employers-dates", "Arbetsgivare & datum", SEVERITY.PASS, "Erfarenhetssektionen innehåller årtal (titel + arbetsgivare + datum).", "Ingen åtgärd.");
    } else {
      add("employers-dates", "Arbetsgivare & datum", SEVERITY.WARNING, "Erfarenhetssektionen saknar årtal — ATS kan inte datera rollerna.", "Lägg till start- och slutår per roll.");
    }
  }

  // 12. Certifieringar
  if (types.includes("certifications")) {
    add("certifications-section", "Certifieringar", SEVERITY.PASS, "Certifieringssektion finns.", "Ingen åtgärd.");
  } else if (/certifiering|certif|certified/i.test(cv)) {
    add("certifications-section", "Certifieringar", SEVERITY.WARNING, "Certifieringar nämns i texten men utan egen sektion — risk att de missas.", "Samla certifieringar i en egen rubrik: ## Certifieringar.");
  }

  // 13. Språk
  if (types.includes("languages")) {
    add("languages-section", "Språk", SEVERITY.PASS, "Språksektion finns.", "Ingen åtgärd.");
  } else if (/\b(svenska|engelska|english|swedish|finska|tyska|franska|spanska|norska|danska)\b/i.test(cv)) {
    add("languages-section", "Språk", SEVERITY.WARNING, "Språk nämns i texten utan egen sektion.", "Samla språk i en egen rubrik: ## Språk.");
  }

  // 14. Nyckelord från jobbannonsen
  if (jobTerms.length === 0) {
    add("job-keywords", "Nyckelord från jobbannons", SEVERITY.PASS, "Ingen jobbannons angiven — kontroll hoppas över.", "Ange jobbannonsen för nyckelordsanalys.");
  } else if (keywordCoverage >= 60) {
    add("job-keywords", "Nyckelord från jobbannons", SEVERITY.PASS, `${matchedKeywords.length}/${jobTerms.length} jobbnyckelord finns i CV:t (${keywordCoverage}%).`, "Ingen åtgärd.");
  } else if (keywordCoverage >= 40) {
    add("job-keywords", "Nyckelord från jobbannons", SEVERITY.WARNING, `Endast ${matchedKeywords.length}/${jobTerms.length} jobbnyckelord finns i CV:t (${keywordCoverage}%).`, `Överväg att väva in saknade nyckelord: ${missingKeywords.slice(0, 8).join(", ")}.`);
  } else {
    add("job-keywords", "Nyckelord från jobbannons", SEVERITY.CRITICAL, `Låg nyckelordsmatchning: ${matchedKeywords.length}/${jobTerms.length} (${keywordCoverage}%).`, `Anpassa CV:t mot annonsen; saknade nyckelord: ${missingKeywords.slice(0, 8).join(", ")}.`);
  }

  // 15. Relevanta kompetenser
  if (jobTerms.length > 0 && skills) {
    if (skillCoverage >= 50) {
      add("relevant-skills", "Relevanta kompetenser", SEVERITY.PASS, `${skillCoverage}% av jobbannonsens nyckelord finns i kompetenssektionen.`, "Ingen åtgärd.");
    } else if (skillCoverage >= 30) {
      add("relevant-skills", "Relevanta kompetenser", SEVERITY.WARNING, `${skillCoverage}% av jobbannonsens nyckelord finns i kompetenssektionen.`, "Stärk kompetenssektionen med de saknade nyckelorden.");
    } else {
      add("relevant-skills", "Relevanta kompetenser", SEVERITY.WARNING, `Låg överlappning (${skillCoverage}%) mellan kompetenssektionen och jobbannonsen.`, "Uppdatera kompetenssektionen mot annonsens krav.");
    }
  } else if (skills) {
    add("relevant-skills", "Relevanta kompetenser", SEVERITY.PASS, "Kompetenssektion finns (ingen jobbannons att jämföra mot).", "Ange jobbannonsen för relevansanalys.");
  }

  // 16. Tabeller
  if (tableRows >= 2 || hasInlineHtmlTable) {
    add("tables", "Tabeller", SEVERITY.CRITICAL, "Tabeller upptäckta — ATS kan läsa celler i fel ordning eller tappa innehåll.", "Ersätt tabellen med vanliga rader eller punktlistor.");
  } else {
    add("tables", "Tabeller", SEVERITY.PASS, "Inga tabeller hittades.", "Ingen åtgärd.");
  }

  // 17. Kolumner
  if (hasInlineHtmlTable || /^\s*[^\s|]+\s{2,}[^\s|]+(\s{2,}[^\s|]+)*\s*$/m.test(cv)) {
    add("columns", "Kolumner", SEVERITY.WARNING, "Rad med flera breda kolumnliknande fält upptäckt — ATS kan misstolka layouten.", "Använd en kolumn; lägg varje uppgift på egen rad.");
  } else {
    add("columns", "Kolumner", SEVERITY.PASS, "Enkel kolumnlayout.", "Ingen åtgärd.");
  }

  // 18. Bilder
  if (imageCount > 0) {
    add("images", "Bilder", SEVERITY.CRITICAL, `${imageCount} bild(er) upptäckta — text i bilder tappas av de flesta ATS.`, "Ta bort bilder eller skriv ut informationen som text.");
  } else {
    add("images", "Bilder", SEVERITY.PASS, "Inga bilder hittades.", "Ingen åtgärd.");
  }

  // 19. Ikoner/emoji
  if (emojiCount > 0) {
    add("icons-emoji", "Ikoner & emoji", SEVERITY.WARNING, `${emojiCount} emoji-/ikon-tecken upptäckta — äldre ATS:er tappar dem.`, "Ersätt emoji med text (t.ex. '●' → inget, skriv ut informationen).");
  } else {
    add("icons-emoji", "Ikoner & emoji", SEVERITY.PASS, "Inga emoji/ikoner hittades.", "Ingen åtgärd.");
  }

  // 20. Sidhuvud/sidfot
  if (hasFormFeed || pageFooterArtifacts) {
    add("header-footer", "Sidhuvud/sidfot", SEVERITY.WARNING, "Sidbrytnings- eller sidfotsartefakter upptäckta — kritisk info i sidhuvud/sidfot kan missas av ATS.", "Undvik kritiska uppgifter i sidhuvud/sidfot; lägg kontakt i brödtexten.");
  } else {
    add("header-footer", "Sidhuvud/sidfot", SEVERITY.PASS, "Inga sidhuvuds-/sidfotsartefakter.", "Ingen åtgärd.");
  }

  // 21. PDF-textlager
  const sourceKind = options.sourceKind === "pdf" ? "pdf" : "markdown";
  if (sourceKind === "pdf") {
    if (chars >= 50) {
      add("pdf-text-layer", "PDF-textlager", SEVERITY.PASS, "Extraherad text finns i PDF:en (markerbar).", "Ingen åtgärd.");
    } else {
      add("pdf-text-layer", "PDF-textlager", SEVERITY.CRITICAL, "PDF:en saknar läsbart textlager — ATS kan inte läsa den.", "Exportera om PDF:en med textlager (CareerPilot AI-export har alltid textlager).");
    }
  } else {
    add("pdf-text-layer", "PDF-textlager", SEVERITY.PASS, "Ej tillämpligt — källan är markdown/text.", "Vid PDF-export kontrolleras textlagret automatiskt.");
  }

  // 22. Filnamn
  const fileName = String(options.fileName || "");
  if (fileName) {
    if (/^[A-Za-zÅÄÖåäö0-9]+(?:_[A-Za-zÅÄÖåäö0-9]+)+\.(pdf|docx|txt|md)$/i.test(fileName)) {
      add("file-name", "Filnamn", SEVERITY.PASS, `Filnamnet "${fileName}" är ATS-vänligt.`, "Ingen åtgärd.");
    } else {
      add("file-name", "Filnamn", SEVERITY.WARNING, `Filnamnet "${fileName}" innehåller tecken som kan störa ATS.`, "Använd Förnamn_Efternamn_Roll_Företag_CV.pdf (inga mellanslag/specialtecken).");
    }
  }

  // 23. Dokumentstruktur
  if (body.length >= 4) {
    add("document-structure", "Dokumentstruktur", SEVERITY.PASS, `${body.length} logiska sektioner i tydlig struktur.`, "Ingen åtgärd.");
  } else if (body.length >= 2) {
    add("document-structure", "Dokumentstruktur", SEVERITY.WARNING, `Endast ${body.length} sektioner — CV:t är tunt strukturerat.`, "Lägg till de sektioner som saknas (Erfarenhet, Kompetenser, Utbildning).");
  } else {
    add("document-structure", "Dokumentstruktur", SEVERITY.WARNING, "CV:t har få eller inga avgränsade sektioner.", "Strukturera CV:t med tydliga rubriker.");
  }

  // 24. Språkblandning
  if (language.mixed) {
    add("language-mix", "Språk", SEVERITY.WARNING, "CV:t blandar svenska och engelska i ungefär lika delar — ATS och rekryterare kan uppfatta det som otydligt.", "Välj ett huvudspråk; håll rollnamn/teknik på engelska om branschen kräver det.");
  } else {
    add("language-mix", "Språk", SEVERITY.PASS, `Dominerande språk: ${language.detected === "okänd" ? "ej detekterbart" : language.detected}.`, "Ingen åtgärd.");
  }

  const countBySeverity = (s) => checks.filter((c) => c.severity === s).length;
  const summaryStats = {
    pass: countBySeverity(SEVERITY.PASS),
    warning: countBySeverity(SEVERITY.WARNING),
    critical: countBySeverity(SEVERITY.CRITICAL),
    worst: countBySeverity(SEVERITY.CRITICAL) > 0 ? SEVERITY.CRITICAL : countBySeverity(SEVERITY.WARNING) > 0 ? SEVERITY.WARNING : SEVERITY.PASS,
  };

  const scorecard = scoreCv({ cvText: cv, sections, checks, options: { jobText, analysis: options.analysis } });

  return {
    checkedAt: new Date().toISOString(),
    sections,
    checks,
    summary: summaryStats,
    signals: {
      contactCount,
      yearCount,
      tableRows,
      imageCount,
      emojiCount,
      keywordCoverage,
      skillCoverage,
      quantified: quantifiedResults(cv).length,
      actionVerbs: actionVerbs(cv).length,
      language,
    },
    keywords: { matched: matchedKeywords, missing: missingKeywords, coverage: keywordCoverage },
    length: { chars, words: wc, lines: lines.length },
    scorecard,
    environments: analyzeEnvironments(checks, jobText),
  };
}

/* ══════════════════════════════════════════════════════════════════════
   2. ATS-MILJÖER (12 vanliga system — kompatibilitetsrisker, inga garantier)
   ══════════════════════════════════════════════════════════════════════ */

export const ATS_ENVIRONMENTS = Object.freeze([
  {
    id: "workday",
    name: "Workday",
    parseStyle: "html",
    knownRisks: ["Parsar ofta HTML-konvertering där tabeller/kolumner kan läsas i fel ordning.", "Kräver maskinläsbara datum och tydlig fältstruktur."],
    guidance: ["En kolumn, standardrubriker, datum i ÅÅÅÅ-MM.", "Undvik tabeller helt."],
  },
  {
    id: "greenhouse",
    name: "Greenhouse",
    parseStyle: "structured",
    knownRisks: ["Viktar nyckelord i kompetens- och erfarenhetssektionerna högt.", "Saknade standardrubriker ger sämre fältmappning."],
    guidance: ["Använd standardrubriker (Profil, Erfarenhet, Kompetenser, Utbildning).", "Skriv ut jobbtitlar och arbetsgivare på egna rader."],
  },
  {
    id: "lever",
    name: "Lever",
    parseStyle: "structured",
    knownRisks: ["Föredrar PDF med textlager.", "Kolumnlayouter kan slås ihop till ologisk text."],
    guidance: ["Exportera PDF med textlager (CareerPilot AI gör detta automatiskt).", "En kolumn."],
  },
  {
    id: "teamtailor",
    name: "Teamtailor",
    parseStyle: "cloud",
    knownRisks: ["Vanligt i Norden; parsar uppladdade dokument med varierande kvalitet.", "Bilder och ikoner tappas."],
    guidance: ["Ren text med tydliga rubriker ger bästa parsning.", "Ha kontaktuppgifter i brödtexten."],
  },
  {
    id: "smartrecruiters",
    name: "SmartRecruiters",
    parseStyle: "structured",
    knownRisks: ["Nyckelordstung matchning mot kravprofil.", "Ovanliga rubriknamn kan missas."],
    guidance: ["Använd exakt de nyckelord som finns i annonsen.", "Standardrubriker."],
  },
  {
    id: "sap-successfactors",
    name: "SAP SuccessFactors",
    parseStyle: "html",
    knownRisks: ["Strikt fältmappning — tabeller och flerkolumnslayout kan läsas fel.", "Sidhuvud/sidfot inkluderas ibland inte i parsningen."],
    guidance: ["Kritisk information (namn/kontakt) i brödtext, inte i sidhuvud.", "Undvik tabeller."],
  },
  {
    id: "oracle-recruiting",
    name: "Oracle Recruiting",
    parseStyle: "html",
    knownRisks: ["Fältbaserad parsning; kontakt i sidhuvud kan missas.", "Långa CV:n kan trunkeras."],
    guidance: ["Kontakt högst upp i brödtexten.", "Håll CV:t på 1–2 sidor."],
  },
  {
    id: "icims",
    name: "iCIMS",
    parseStyle: "structured",
    knownRisks: ["Tappar bilder, ikoner och grafik.", "Strikta datumformat kan ge missförstånd."],
    guidance: ["Ingen grafik; konsekventa datum (ÅÅÅÅ-MM).", "Textlager i PDF."],
  },
  {
    id: "workable",
    name: "Workable",
    parseStyle: "structured",
    knownRisks: ["Enkel textparsning — ovanliga rubriker kan missas."],
    guidance: ["Standardrubriker och punktlistor.", "Skriv ut kompetenser som text."],
  },
  {
    id: "personio",
    name: "Personio",
    parseStyle: "cloud",
    knownRisks: ["Vanligt i Europa; parsa kvalitet varierar med filformat.", "Saknade sektioner ger svagare profilmatchning."],
    guidance: ["PDF med textlager eller ren markdown/text.", "Komplett sektionsstruktur."],
  },
  {
    id: "recruitee",
    name: "Recruitee",
    parseStyle: "structured",
    knownRisks: ["Kolumnlayout kan slås ihop.", "Header/footer-info kan missas."],
    guidance: ["En kolumn, kontakt i brödtexten.", "Standardrubriker."],
  },
  {
    id: "ashby",
    name: "Ashby",
    parseStyle: "structured",
    knownRisks: ["Nyckelordsmatchning mot annonsen; otydliga rubriker ger sämre träff.", "Bilder tappas."],
    guidance: ["Matcha annonsens nyckelord i kompetenssektionen.", "PDF med textlager."],
  },
]);

const ENV_RISK_RULES = {
  // checkId -> vikt per miljö-parseStyle
  tables: { html: "high", structured: "medium", cloud: "high" },
  images: { html: "high", structured: "high", cloud: "high" },
  columns: { html: "high", structured: "medium", cloud: "medium" },
  "contact-location": { html: "high", structured: "medium", cloud: "medium" },
  "header-footer": { html: "high", structured: "medium", cloud: "low" },
  "pdf-text-layer": { html: "high", structured: "high", cloud: "high" },
  "skills-section": { html: "high", structured: "high", cloud: "high" },
  "heading-structure": { html: "medium", structured: "high", cloud: "medium" },
  "job-keywords": { html: "low", structured: "medium", cloud: "medium" },
};

/**
 * Beräknar per-miljö kompatibilitetsrisker från kontrollerna.
 * Returnerar [{ id, name, parseStyle, riskLevel, issues, guidance }].
 * riskLevel: "låg" | "medel" | "hög".
 */
export function analyzeEnvironments(checks, jobText = "") {
  const byId = new Map(checks.map((c) => [c.id, c]));
  return ATS_ENVIRONMENTS.map((env) => {
    const issues = [];
    for (const [checkId, weights] of Object.entries(ENV_RISK_RULES)) {
      const check = byId.get(checkId);
      if (!check || check.severity === SEVERITY.PASS) continue;
      const weight = weights[env.parseStyle] || "medium";
      if (weight === "none") continue;
      issues.push({
        checkId,
        label: check.label,
        severity: check.severity,
        riskNote:
          weight === "high"
            ? "Hög risk i denna miljö."
            : weight === "medium"
              ? "Medelhög risk i denna miljö."
              : "Låg påverkan i denna miljö.",
      });
    }
    // Nyckelordsgapet är miljöövergripande men väger tungt i nyckelordsstyrda system
    if (jobText && byId.get("job-keywords")?.severity === SEVERITY.CRITICAL) {
      issues.push({
        checkId: "job-keywords",
        label: "Nyckelord från jobbannons",
        severity: SEVERITY.CRITICAL,
        riskNote: "Låg nyckelordsmatchning minskar träffsannolikheten i de flesta system.",
      });
    }
    const critical = issues.filter((i) => i.severity === SEVERITY.CRITICAL).length;
    const warning = issues.filter((i) => i.severity === SEVERITY.WARNING).length;
    const riskLevel =
      critical >= 2 ? "hög" : critical === 1 || warning >= 3 ? "medel" : warning >= 1 ? "låg" : "låg";
    return {
      id: env.id,
      name: env.name,
      parseStyle: env.parseStyle,
      riskLevel,
      issues,
      guidance: env.guidance,
      knownRisks: env.knownRisks,
      disclaimer:
        "CareerPilot AI kan inte garantera ett ATS-resultat — detta är en kompatibilitetsriskbedömning baserad på dokumentstruktur.",
    };
  });
}

/* ══════════════════════════════════════════════════════════════════════
   3. CV SCORECARD (13 kategorier, band, förklaring, problem, åtgärd)
   ══════════════════════════════════════════════════════════════════════ */

const CATEGORY_META = {
  jobMatch: { label: "Job Match", description: "Hur väl CV:t matchar jobbannonsen" },
  atsReadability: { label: "ATS Readability", description: "Hur väl ATS kan läsa och tolka dokumentet" },
  relevantExperience: { label: "Relevant Experience", description: "Erfarenhetens relevans och tydlighet" },
  skillsCoverage: { label: "Skills Coverage", description: "Kompetenssektionens bredd" },
  keywordCoverage: { label: "Keyword Coverage", description: "Nyckelordsmatchning mot annonsen" },
  evidenceStrength: { label: "Evidence Strength", description: "Kvantifierade resultat och bevis" },
  clarity: { label: "Clarity", description: "Tydlighet i språk och struktur" },
  impact: { label: "Impact", description: "Resultatinriktat språk" },
  languageQuality: { label: "Language Quality", description: "Språklig kvalitet och konsistens" },
  formatting: { label: "Formatting", description: "Konsekvent och ATS-säker formatering" },
  length: { label: "Length", description: "Lämplig längd" },
  contactInfo: { label: "Contact Information", description: "Kompletta kontaktuppgifter" },
  overallReadiness: { label: "Overall Readiness", description: "Sammantagen beredskap" },
};

/**
 * Beräknar scorecard (0–100 per kategori + band). Poängen är en vägledande
 * deterministisk bedömning, inte ett exakt mätvärde ("undvik falsk exakthet"):
 * bandet och förklaringen är det viktiga.
 */
export function scoreCv({ cvText = "", sections, checks = [], options = {} } = {}) {
  const cv = String(cvText);
  const sec = sections ?? parseCvSections(cv);
  const body = sec.filter((s) => s.type !== "header");
  const types = body.map((s) => s.type);
  const checkById = new Map(checks.map((c) => [c.id, c]));
  const worstOf = (ids) => {
    for (const id of ids) {
      const c = checkById.get(id);
      if (c?.severity === SEVERITY.CRITICAL) return SEVERITY.CRITICAL;
    }
    for (const id of ids) {
      const c = checkById.get(id);
      if (c?.severity === SEVERITY.WARNING) return SEVERITY.WARNING;
    }
    return SEVERITY.PASS;
  };

  const jobText = String(options.jobText || "");
  const atsFoundation = analyzeAtsReadiness(cv, { jobDescription: jobText });
  const words = cv.match(/\S+/g) || [];
  const wordCount = words.length;
  const bullets = (cv.match(/^\s*[-*•]\s+.+$/gm) || []).length;
  const hasEmail = EMAIL_RE.test(cv);
  const hasLinkedIn = LINKEDIN_RE.test(cv);
  const hasPhone = PHONE_RE.test(cv);
  const quantified = quantifiedResults(cv).length;
  const verbs = actionVerbs(cv).length;
  const hasSkills = types.includes("skills");
  const hasExperience = types.includes("experience");
  const hasEducation = types.includes("education");
  const hasSummary = types.includes("summary");
  const years = (cv.match(YEAR_RE) || []).length;
  const hasImages = /!\[[^\]]*\]\([^)]*\)/.test(cv);
  const hasTables = /^\s*\|.*\|\s*$/m.test(cv);
  const hasEmoji = EMOJI_RE.test(cv);
  const dateClasses = dateFormatClasses(cv);
  const contactCount = [hasEmail, hasLinkedIn, hasPhone].filter(Boolean).length;

  // Nyckelordsdata från kontroller (om tillgängliga), annars beräkna direkt
  const kwCheck = checkById.get("job-keywords");
  const kwCoverage = kwCheck
    ? { matched: 0, missing: [], coverage: null } // utfylls nedan via signals om tillgängligt
    : null;

  const categories = {};
  const score = (key, rawScore, problems = [], fix = "", explanation = "") => {
    const s = bounded(rawScore);
    categories[key] = {
      key,
      label: CATEGORY_META[key]?.label || key,
      description: CATEGORY_META[key]?.description || "",
      score: s,
      band: bandFor(s),
      explanation: explanation || CATEGORY_META[key].description,
      problems,
      fix,
    };
  };

  // 1. Job Match — från Fas 2-analys om tillgänglig, annars nyckelordstäckning
  const verdict = options.analysis?.report?.verdict;
  let jobMatchScore;
  if (typeof verdict?.score === "number") {
    jobMatchScore = verdict.score;
  } else {
    jobMatchScore = jobText ? (atsFoundation.keywordMatch.score * 0.6 + atsFoundation.keywordMatch.score) / 2 : 50;
  }
  const jobProblems = [];
  if (jobText && atsFoundation.keywordMatch.missing.length) {
    jobProblems.push(`Saknade nyckelord: ${atsFoundation.keywordMatch.missing.slice(0, 6).join(", ")}.`);
  }
  if (!jobText) jobProblems.push("Ingen jobbannons angiven — matchning kan inte bedömas mot annons.");
  score("jobMatch", jobMatchScore, jobProblems, jobText ? "Väva in saknade nyckelord i profil, erfarenhet och kompetenser." : "Koppla jobbannonsen för job-matchanalys.", jobText ? "Baserad på nyckelordsmatchning och Fas 2-jobbanalys." : "Baserad på allmän relevans — ingen annons jämförd.");

  // 2. ATS Readability
  const atsProblems = [];
  for (const id of ["tables", "images", "columns", "heading-structure", "pdf-text-layer", "icons-emoji", "header-footer"]) {
    const c = checkById.get(id);
    if (c && c.severity !== SEVERITY.PASS) atsProblems.push(c.message);
  }
  let atsScore = atsFoundation.score;
  const crCount = checks.filter((c) => c.severity === SEVERITY.CRITICAL).length;
  atsScore -= crCount * 12;
  score("atsReadability", atsScore, atsProblems, "Åtgärda CRITICAL-kontrollerna (tabeller, bilder, rubriker, kontakt).", "Baserad på dokumentstruktur och ATS-readiness-modellen.");

  // 3. Relevant Experience
  const expProblems = [];
  let expScore = 30;
  if (hasExperience) {
    expScore += 30;
    if (years > 0) expScore += 20;
    if (bullets >= 3) expScore += 20;
    if (worstOf(["job-titles", "employers-dates"]) !== SEVERITY.PASS) {
      expScore -= 15;
      expProblems.push(checkById.get("job-titles")?.message || checkById.get("employers-dates")?.message);
    }
  } else {
    expProblems.push("Erfarenhetssektion saknas.");
  }
  score("relevantExperience", expScore, expProblems, "Tydliga roller med arbetsgivare, datum och resultatinriktade punkter.", "Baserad på erfarenhetssektionens struktur.");

  // 4. Skills Coverage
  const skillsProblems = [];
  let skillsScore = hasSkills ? 55 : 15;
  if (hasSkills) {
    const skillLines = body.find((s) => s.type === "skills")?.original?.split("\n") || [];
    const skillCount = skillLines.filter((l) => /^\s*[-*•,;|]\s*|^[^#\n]+,\s*\S+/.test(l.trim()) && l.trim() !== "").length;
    skillsScore += skillCount >= 5 ? 30 : skillCount >= 2 ? 20 : 10;
    if (jobText && atsFoundation.keywordMatch.missing.length > 4) {
      skillsProblems.push("Kompetenssektionen täcker inte alla annonsens nyckelord.");
      skillsScore -= 10;
    }
  } else {
    skillsProblems.push("Kompetenssektion saknas — kritisk för nyckelordsmatchning.");
  }
  score("skillsCoverage", skillsScore, skillsProblems, "Samla tekniska färdigheter i en kompetenssektion med annonsens nyckelord.", "Baserad på kompetenssektionens närvaro och bredd.");

  // 5. Keyword Coverage
  const kwProblems = [];
  let kwScore = 50;
  if (jobText) {
    kwScore = atsFoundation.keywordMatch.score;
    if (atsFoundation.keywordMatch.missing.length) {
      kwProblems.push(`Saknade nyckelord: ${atsFoundation.keywordMatch.missing.slice(0, 6).join(", ")}.`);
    }
  } else {
    kwProblems.push("Ingen jobbannons angiven.");
  }
  score("keywordCoverage", kwScore, kwProblems, "Använd annonsens exakta nyckelord på naturliga ställen.", "Baserad på nyckelordsmatchning mot annonsen.");

  // 6. Evidence Strength
  const evProblems = [];
  let evScore = 30;
  if (quantified >= 3) evScore += 45;
  else if (quantified >= 1) evScore += 30;
  else evProblems.push("Inga kvantifierade resultat hittades.");
  if (verbs >= 3) evScore += 25;
  else if (verbs >= 1) evScore += 12;
  else evProblems.push("Få resultatinriktade aktionsverb.");
  score("evidenceStrength", evScore, evProblems, "Kvantifiera resultat (%, volymer, tidsbesparing) och använd aktionsverb.", "Baserad på kvantifierade resultat och aktionsverb.");

  // 7. Clarity
  const clarProblems = [];
  let clarScore = 50;
  if (bullets >= 3) clarScore += 25;
  else clarProblems.push("Få punktlistor — långa stycken är svårare för ATS att dissekera.");
  if (body.length >= 3) clarScore += 25;
  else clarProblems.push("Otydlig sektionsstruktur.");
  score("clarity", clarScore, clarProblems, "Korta meningar, punktlistor och tydliga sektioner.", "Baserad på punktlistor och sektionsstruktur.");

  // 8. Impact
  const impProblems = [];
  let impScore = 40;
  if (quantified >= 1) impScore += 30;
  else impProblems.push("Inga siffror som visar effekt.");
  if (verbs >= 2) impScore += 30;
  else impProblems.push("Få starka aktionsverb (ledde, utvecklade, ökade…).");
  score("impact", impScore, impProblems, "Börja punkter med aktionsverb och avsluta med mätbar effekt.", "Baserad på aktionsverb och kvantifiering.");

  // 9. Language Quality
  const langProblems = [];
  let langScore = 70;
  for (const [bad] of TYPO_FIXES) {
    if (cv.includes(bad)) {
      langScore -= 15;
      langProblems.push(`Stavfel hittades: "${bad}".`);
      break;
    }
  }
  if (dateClasses.size > 1) {
    langScore -= 10;
    langProblems.push("Blandade datumformat.");
  }
  if (/!\[[^\]]*\]/.test(cv)) langScore -= 0; // bilder hanteras i formatting
  score("languageQuality", langScore, langProblems, "Rätta stavfel och håll konsekventa datumformat.", "Baserad på stavfel och formatkonsistens.");

  // 10. Formatting
  const fmtProblems = [];
  let fmtScore = 70;
  if (hasTables) { fmtScore -= 25; fmtProblems.push("Tabell hittades — ATS-risk."); }
  if (hasImages) { fmtScore -= 20; fmtProblems.push("Bild hittades — innehåll kan tappas."); }
  if (hasEmoji) { fmtScore -= 10; fmtProblems.push("Emoji/ikoner — äldre ATS tappar dem."); }
  if (dateClasses.size > 1) { fmtScore -= 10; fmtProblems.push("Inkonsekventa datumformat."); }
  if (fmtScore === 70) fmtProblems.push("Formateringen är ren och konsekvent.");
  score("formatting", fmtScore, fmtProblems, "En kolumn, inga tabeller/bilder, konsekventa datum.", "Baserad på tabeller, bilder, emoji och datumkonsistens.");

  // 11. Length
  const lenProblems = [];
  let lenScore = 50;
  if (wordCount >= 250 && wordCount <= 1200) lenScore = 90;
  else if (wordCount > 1200 && wordCount <= 2000) { lenScore = 65; lenProblems.push("Något långt CV."); }
  else if (wordCount > 2000) { lenScore = 40; lenProblems.push("För långt för de flesta ATS:er."); }
  else if (wordCount < 250 && wordCount > 0) { lenScore = 40; lenProblems.push("För kort för att visa erfarenhet."); }
  score("length", lenScore, lenProblems, "1–2 sidor (250–1200 ord).", "Baserad på ordantal.");

  // 12. Contact Information
  const contProblems = [];
  let contScore = 0;
  if (hasEmail) contScore += 40;
  if (hasLinkedIn) contScore += 35;
  if (hasPhone) contScore += 25;
  if (contactCount === 0) contProblems.push("Ingen kontaktinformation hittades.");
  else if (contactCount === 1) contProblems.push("Endast en kontaktkanal.");
  const contactLoc = checkById.get("contact-location");
  if (contactLoc?.severity === SEVERITY.WARNING) {
    contScore -= 15;
    contProblems.push("Kontakten ligger utanför toppblocket.");
  }
  score("contactInfo", contScore, contProblems, "E-post, telefon och LinkedIn direkt under namnet.", "Baserad på kontaktkanaler och placering.");

  // 13. Overall Readiness (viktat snitt; CRITICAL-kontroller takar på 40)
  const weights = {
    jobMatch: 0.16, atsReadability: 0.14, relevantExperience: 0.12, skillsCoverage: 0.1,
    keywordCoverage: 0.1, evidenceStrength: 0.08, clarity: 0.07, impact: 0.06,
    languageQuality: 0.05, formatting: 0.05, length: 0.04, contactInfo: 0.03,
  };
  let overall = 0;
  let wSum = 0;
  for (const [key, w] of Object.entries(weights)) {
    overall += (categories[key]?.score ?? 50) * w;
    wSum += w;
  }
  overall = bounded(overall / (wSum || 1));
  if (crCount > 0) overall = Math.min(overall, 40);
  const overallProblems = checks
    .filter((c) => c.severity === SEVERITY.CRITICAL)
    .map((c) => c.message);
  score("overallReadiness", overall, overallProblems, overallProblems.length ? "Åtgärda CRITICAL-kontrollerna först." : "Fortsätt förbättra svaga kategorier.", "Viktat snitt av samtliga kategorier.");

  return { categories, overallReadiness: categories.overallReadiness };
}

/* ══════════════════════════════════════════════════════════════════════
   4. SÄKER AUTO-FIX ("Förbättra alla säkra punkter")
   Ändrar ENDAST språk/stavning/tydlighet/struktur/formatering/ATS-format.
   Arbetsgivare, datum, roller, certifieringar, utbildningar, tekniska
   färdigheter, ansvar, resultat och siffror rörs ALDRIG.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Föreslår säkra förbättringar. Returnerar { correctedText, changes } där
 * varje change = { id, kind, description, before, after, safe: true }.
 * Alla ändringar är format-/språkfixar — inga faktauppgifter.
 */
export function improveSafePoints(cvText) {
  const cv = String(cvText || "");
  if (!cv.trim()) return { correctedText: cv, changes: [] };

  const changes = [];
  let text = cv;
  let seq = 0;
  const note = (kind, description, before, after) =>
    changes.push({ id: `fix-${++seq}`, kind, description, before, after, safe: true });

  // 1. Bilder tas bort (bildinnehåll kan inte läsas av ATS; texten försvinner inte — bildreferensen gör)
  const imgRe = /!\[[^\]]*\]\([^)]*\)/g;
  let m;
  while ((m = imgRe.exec(text)) !== null) {
    note("images-removed", "Bildreferens borttagen — ATS kan inte läsa bildinnehåll.", m[0], "");
  }
  text = text.replace(imgRe, "");

  // 2. Emoji/ikoner ersätts med ingenting (förloras i äldre ATS)
  const emojiMatches = text.match(EMOJI_RE) || [];
  if (emojiMatches.length) {
    const sample = emojiMatches.slice(0, 3).join(" ");
    note("emoji-removed", `${emojiMatches.length} emoji-/ikon-tecken borttagna (ATS-tapprisk).`, sample, "");
    text = text.replace(EMOJI_RE, "");
  }

  // 3. HTML-taggar tas bort (renderas ändå inte av ATS)
  if (/<[a-z][^>]*>/i.test(text)) {
    note("html-stripped", "HTML-taggar borttagna — ATS läser dem inte.", "<b>…</b>", "");
    text = text.replace(/<[^>]+>/g, "");
  }

  // 4. Markdown-tabeller konverteras till läsbara rader (innehållet bevaras)
  const tableLines = text.split("\n");
  let tableChanged = false;
  const converted = tableLines
    .map((line) => {
      if (!/^\s*\|.*\|\s*$/.test(line)) return line;
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        tableChanged = true; // separatorrad — tas bort
        return null;
      }
      tableChanged = true;
      return cells.join(" — ");
    })
    .filter((l) => l !== null);
  if (tableChanged) {
    note("tables-to-lines", "Markdown-tabell konverterad till läsbara rader — innehållet bevaras, ATS-risken försvinner.", "| A | B |", "A — B");
    text = converted.join("\n");
  }

  // 5. Konsekventa bullets (normalisera • ◦ ▪ ‣ ⁃ till "-")
  if (/^\s*[•◦▪‣⁃]\s+/m.test(text)) {
    note("bullets-normalized", "Bullet-tecken normaliserade till '-' (konsekvent format).", "•", "-");
    text = text.replace(/^(\s*)[•◦▪‣⁃](\s+)/gm, "$1-$2");
  }

  // 6. Datumformat: "MM/ÅÅÅÅ" → "ÅÅÅÅ-MM" (samma värde, maskinläsbart format)
  const dateRe = /\b(\d{1,2})\/(\d{4})\b/g;
  const beforeDates = text;
  text = text.replace(dateRe, (full, month, year) => {
    const mm = month.padStart(2, "0");
    return `${year}-${mm}`;
  });
  if (text !== beforeDates) {
    note("dates-normalized", "Datumformat normaliserat till ÅÅÅÅ-MM (maskinläsbart, samma värde).", "06/2019", "2019-06");
  }

  // 7. Konservativa stavfixar (endast uppenbara stavfel, aldrig fakta)
  for (const [bad, good] of TYPO_FIXES) {
    if (text.includes(bad)) {
      const re = new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      text = text.replace(re, good);
      note("typo-fixed", `Stavfel rättat: "${bad}" → "${good}".`, bad, good);
    }
  }

  // 8. Rubriknivå: kända sektioner på "###" → "##" (konsekvent struktur)
  const headingRe = /^###\s+(Profil|Summary|Erfarenhet|Experience|Arbetslivserfarenhet|Kompetenser|Skills|Färdigheter|Utbildning|Education|Certifieringar|Certifications|Språk|Languages|Projekt|Projects)\s*$/gim;
  if (headingRe.test(text)) {
    text = text.replace(
      /^###\s+(Profil|Summary|Erfarenhet|Experience|Arbetslivserfarenhet|Kompetenser|Skills|Färdigheter|Utbildning|Education|Certifieringar|Certifications|Språk|Languages|Projekt|Projects)\s*$/gim,
      "## $1",
    );
    note("heading-level-fixed", "Sektionsrubriker normaliserade till nivå 2 (##).", "### Erfarenhet", "## Erfarenhet");
  }

  // 9. LinkedIn-URL utan mellanslag (format, inte innehåll)
  const liRe = /linkedin\.com\/in\/\s+([\w-]+)/gi;
  if (liRe.test(text)) {
    text = text.replace(/linkedin\.com\/in\/\s+([\w-]+)/gi, "linkedin.com/in/$1");
    note("linkedin-normalized", "Mellanslag i LinkedIn-URL borttaget.", "linkedin.com/in/ namn", "linkedin.com/in/namn");
  }

  // 10. Kollapsa ≥3 tomma rader till 1 (ren struktur)
  if (/\n{4,}/.test(text)) {
    note("blank-lines-collapsed", "Extra tomma rader borttagna (renare struktur).", "\n\n\n\n", "\n\n");
    text = text.replace(/\n{4,}/g, "\n\n");
  }

  // 11. Efterföljande mellanslag (trailing whitespace)
  if (/[ \t]+$/m.test(text)) {
    note("trailing-whitespace", "Efterföljande mellanslag borttagna.", "rad  ", "rad");
    text = text.replace(/[ \t]+$/gm, "");
  }

  return { correctedText: text, changes };
}

/* ══════════════════════════════════════════════════════════════════════
   5. FILNAMN
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Bygger professionellt filnamn: FirstName_LastName_Role_Company_CV.ext
 * Hanterar saknad data med fallbacks; sanerar till [A-Za-z0-9ÅÄÖåäö_-].
 */
export function buildExportFileName({ firstName, lastName, role, company, kind = "CV", ext = "pdf" }) {
  const sanitize = (value, fallback) => {
    const clean = String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9ÅÄÖåäö_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_");
    return clean || fallback;
  };
  const parts = [
    sanitize(firstName, "Fornamn"),
    sanitize(lastName, "Efternamn"),
    sanitize(role, "Roll"),
    sanitize(company, "Foretag"),
    sanitize(kind, "CV"),
  ].filter(Boolean);
  const base = parts.join("_");
  return `${base}.${String(ext).replace(/[^a-z0-9]/gi, "").toLowerCase() || "pdf"}`;
}

/** Validerar att ett filnamn följer mönstret First_Last_Role_Company_CV.ext. */
export function validateExportFileName(fileName) {
  const name = String(fileName || "");
  if (!name) return { valid: false, reason: "Filnamn saknas." };
  const ext = name.split(".").pop()?.toLowerCase();
  if (!["pdf", "docx", "txt", "md"].includes(ext)) {
    return { valid: false, reason: `Ogiltigt format "${ext}".` };
  }
  const base = name.slice(0, -(ext.length + 1));
  if (!/^[A-Za-zÅÄÖåäö0-9]+(_[A-Za-zÅÄÖåäö0-9]+)+$/.test(base)) {
    return { valid: false, reason: "Filenamnet måste vara Förnamn_Efternamn_Roll_Företag_CV (endast bokstäver, siffror, understreck)." };
  }
  return { valid: true, ext, base };
}
