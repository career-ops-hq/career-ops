const MOBILE_TERMS = [
  /\breact[\s-]?native\b/i, /\bexpo\b/i, /\bflutter\b/i,
  /\bandroid\b/i, /\bios\b/i, /\bswift\b/i, /\bkotlin\s+mobile\b/i,
  /\bmobile(?:\s+application|\s+app|\s+development|\s+engineer|\s+developer|\s+first)\b/i
];

const BACKEND_STACKS = [
  { id: "Java/Spring", patterns: [/\bjava\b(?!script)/i, /\bspring(?:\s+boot)?\b/i] },
  { id: "Kotlin", patterns: [/\bkotlin\b/i] },
  { id: ".NET/C#", patterns: [/\.net\b/i, /\bc#\b/i, /\basp\.net\b/i] },
  { id: "Python", patterns: [/\bpython\b/i, /\bdjango\b/i, /\bfastapi\b/i] },
  { id: "Go", patterns: [/\bgolang\b/i, /\bgo\s+(?:services?|microservices?|backend|developer|engineer)\b/i] },
  { id: "Ruby", patterns: [/\bruby\b/i, /\brails\b/i] },
  { id: "PHP", patterns: [/\bphp\b/i, /\blaravel\b/i, /\bsymfony\b/i] }
];

const OPTIONAL_CUE = /\b(optional|nice[ -]to[ -]have|preferred|bonus|advantage|(?:a|as a) plus|desirable|familiarity|exposure)\b/i;
const MANDATORY_CUE = /\b(must|required|requirements?|mandatory|essential|need(?:ed)?|at least|minimum|proficien(?:t|cy)|strong experience|expertise|commercial experience|you have|we expect)\b/i;
const RESPONSIBILITY_CUE = /\b(build|develop|design|own|ownership|architect|maintain|deliver|implement|responsib|services?|apis?|microservices?|backend|frontend|user interface|web application)\b/i;

function occurrences(text, patterns) {
  return patterns.reduce((sum, pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return sum + (text.match(new RegExp(pattern.source, flags)) || []).length;
  }, 0);
}

function matchingClauses(text, patterns) {
  return text
    .split(/\n|(?<=[.!?;])\s+/)
    .filter((clause) => patterns.some((pattern) => pattern.test(clause)));
}

function requirementSignal(title, description, patterns) {
  const titleHit = patterns.some((pattern) => pattern.test(title));
  const clauses = matchingClauses(description, patterns);
  const mandatory = titleHit || clauses.some((clause) => MANDATORY_CUE.test(clause) && !OPTIONAL_CUE.test(clause));
  const optionalOnly = !titleHit && clauses.length > 0 && clauses.every((clause) => OPTIONAL_CUE.test(clause));
  return { present: titleHit || clauses.length > 0, mandatory, optionalOnly, clauses };
}

function unique(values) {
  return [...new Set(values)];
}

/**
 * Explainable, deterministic first-pass ranking. Full JD text should be supplied
 * whenever available; title/location/extra remain a safe low-cost fallback.
 */
export function analyzeJobMatch(job, fullDescription = "") {
  const title = String(job?.title || "");
  const fallback = [job?.company, job?.location, job?.extra].filter(Boolean).join(". ");
  const description = String(fullDescription || fallback);
  const allText = `${title}\n${description}`;
  const titleLower = title.toLowerCase();

  const nativeSignal = requirementSignal(title, description, MOBILE_TERMS);
  const textWithoutNative = allText.replace(/react[\s-]?native/gi, " ");
  const webReactPatterns = [/\breact(?:\.js|js)?\b/i, /\breact\s+web\b/i];
  const nextPatterns = [/\bnext\.?(?:js)?\b/i];
  const tsPatterns = [/\btypescript\b/i];
  const webReactCount = occurrences(textWithoutNative, webReactPatterns);
  const nextCount = occurrences(allText, nextPatterns);
  const tsCount = occurrences(allText, tsPatterns);
  const frontendCount = occurrences(allText, [
    /\bfront[ -]?end\b/i, /\bweb application/i, /\buser interface/i, /\bui\b/i,
    /\bcomponent(?:s| library| system)?\b/i, /\bdesign system\b/i,
    /\baccessibilit/i, /\bcore web vitals\b/i, /\bseo\b/i,
    ...webReactPatterns, ...nextPatterns, ...tsPatterns
  ]);

  const backendSignals = BACKEND_STACKS.map((stack) => ({
    ...stack,
    ...requirementSignal(title, description, stack.patterns),
    count: occurrences(allText, stack.patterns)
  })).filter((stack) => stack.present);
  const mandatoryBackend = backendSignals.filter((stack) => stack.mandatory && !stack.optionalOnly);
  const backendCount = backendSignals.reduce((sum, stack) => sum + stack.count, 0)
    + occurrences(allText, [/\bback[ -]?end\b/i, /\bmicroservices?\b/i, /\bserver[ -]?side\b/i, /\bdistributed systems?\b/i]);

  const nodeCount = occurrences(allText, [/\bnode\.?(?:js)?\b/i, /\bnest\.?(?:js)?\b/i]);
  const ecommerce = unique([
    /\bmagento(?:\s*2)?\b/i.test(allText) || /adobe commerce/i.test(allText) ? "Magento 2" : "",
    /\bhyv[aä]\b/i.test(allText) ? "Hyvä" : "",
    /\bshopify(?:\s+plus)?\b/i.test(allText) ? "Shopify" : "",
    /\bliquid\b/i.test(allText) ? "Liquid" : ""
  ].filter(Boolean));
  const leadership = /\b(lead|technical lead|tech lead|team lead|staff|principal|architect)\b/i.test(title);
  const productEngineer = /\bproduct engineer/i.test(title);
  const frontendTitle = /\bfront[ -]?end|react|next\.?(?:js)?|web (?:developer|engineer)|ui (?:developer|engineer|architect)\b/i.test(title);
  const handsOnTechnicalTitle = /\b(developer|engineer|architect|programista|technical lead|tech lead|product engineer)\b/i.test(title);
  const nonEngineeringTitle = /\b(qa|quality assurance|tester|analyst|analityk|project manager|delivery manager|product owner|coo|director)\b/i.test(title);
  const alternateFrontendTitle = /\b(vue(?:\.js)?|angular|svelte)\b/i.test(title) && !/\breact|next\.?(?:js)?\b/i.test(title);
  const fullstack = /\bfull[ -]?stack\b/i.test(allText);
  const explicitFrontendHeavy = /\b(frontend[ -](?:heavy|focused)|front[ -]?end focus|primarily front[ -]?end|mostly front[ -]?end)\b/i.test(allText);
  const pureBackendTitle = /\bbackend|back-end\b/i.test(title) && !/\bfront[ -]?end|react|next|full[ -]?stack\b/i.test(title);
  const backendOwnership = matchingClauses(description, [/\bmicroservices?\b/i, /\bback[ -]?end\b/i])
    .some((clause) => RESPONSIBILITY_CUE.test(clause) && !OPTIONAL_CUE.test(clause));

  const mobileCount = occurrences(allText, MOBILE_TERMS);
  const frontendDominance = explicitFrontendHeavy || frontendCount >= Math.max(3, backendCount * 1.5);
  const backendDominance = pureBackendTitle || backendOwnership || backendCount >= Math.max(3, frontendCount * 1.25);
  const mobileDominance = nativeSignal.mandatory || /\bmobile\b/i.test(title) || mobileCount >= Math.max(2, webReactCount + nextCount);

  const languageSignals = [
    ["German", /\b(?:german|deutsch)\b/i], ["Finnish", /\bfinnish\b/i],
    ["Swedish", /\bswedish\b/i], ["French", /\bfrench\b/i], ["Dutch", /\bdutch\b/i]
  ].map(([name, pattern]) => ({ name, ...requirementSignal(title, description, [pattern]) }))
    .filter((signal) => signal.mandatory && !signal.optionalOnly);

  const strengths = [];
  const gaps = [];
  const missingMandatorySkills = [];
  if (webReactCount) strengths.push("React web");
  if (nextCount) strengths.push("Next.js");
  if (tsCount) strengths.push("TypeScript");
  if (frontendDominance) strengths.push("Frontend-dominant responsibilities");
  if (nodeCount) strengths.push("Node.js-compatible fullstack");
  if (ecommerce.length) strengths.push(`${ecommerce.join(" + ")} commercial specialization`);
  if (leadership) strengths.push("Hands-on technical leadership");

  if (mobileDominance) {
    gaps.push("React Native / mobile-first responsibilities");
    missingMandatorySkills.push("Native mobile development");
  }
  if (mandatoryBackend.length) {
    const names = mandatoryBackend.map((stack) => stack.id);
    gaps.push(`${names.join(" + ")} backend mandatory`);
    missingMandatorySkills.push(...names);
  }
  if (backendDominance) gaps.push("Backend ownership is the primary responsibility");
  if (languageSignals.length) {
    const names = languageSignals.map((signal) => signal.name);
    gaps.push(`${names.join(" / ")} mandatory`);
    missingMandatorySkills.push(...names.map((name) => `${name} language`));
  }

  let classification = "POSSIBLE MATCH";
  let tier = "B";
  let compatibilityPercent = 58;
  let recommendation = "REVIEW";
  let reason = "Relevant engineering overlap, but the primary stack needs review";

  if (mobileDominance) {
    classification = "SKIP";
    tier = "D";
    compatibilityPercent = nativeSignal.mandatory ? 12 : 20;
    recommendation = "SKIP";
    reason = "React Native / mobile-first";
  } else if (pureBackendTitle && webReactCount + nextCount === 0) {
    classification = "SKIP";
    tier = "D";
    compatibilityPercent = 15;
    recommendation = "SKIP";
    reason = "Pure backend role; frontend web is incidental or absent";
  } else if (mandatoryBackend.length) {
    classification = "LOW MATCH";
    tier = "C";
    compatibilityPercent = backendDominance ? 28 : 36;
    recommendation = "SKIP";
    reason = `${mandatoryBackend.map((stack) => stack.id).join(" + ")} backend mandatory | React secondary`;
  } else if (languageSignals.length) {
    classification = "LOW MATCH";
    tier = "C";
    compatibilityPercent = 30;
    recommendation = "SKIP";
    reason = `${languageSignals.map((signal) => signal.name).join(" / ")} language mandatory`;
  } else if (ecommerce.length && !backendDominance && !nonEngineeringTitle && (handsOnTechnicalTitle || frontendDominance)) {
    classification = "BEST MATCH";
    tier = "A";
    compatibilityPercent = Math.min(98, 90 + ecommerce.length * 2);
    recommendation = "APPLY";
    reason = `${ecommerce.join(" + ")} | direct commercial specialization`;
  } else if ((webReactCount || nextCount) && tsCount && !backendDominance && (!fullstack || frontendDominance || nodeCount)) {
    classification = frontendDominance || /\bfront[ -]?end\b/i.test(title) ? "BEST MATCH" : "STRONG MATCH";
    tier = "A";
    compatibilityPercent = classification === "BEST MATCH" ? 92 : 84;
    recommendation = "APPLY";
    reason = `${[webReactCount ? "React" : "", nextCount ? "Next.js" : "", tsCount ? "TypeScript" : ""].filter(Boolean).join(" + ")} | ${frontendDominance ? "frontend-dominant" : "web/fullstack aligned"}`;
  } else if (fullstack && (webReactCount || nextCount) && nodeCount && !backendDominance) {
    classification = explicitFrontendHeavy ? "BEST MATCH" : "STRONG MATCH";
    tier = "A";
    compatibilityPercent = explicitFrontendHeavy ? 90 : 82;
    recommendation = "APPLY";
    reason = `React${nextCount ? " + Next.js" : ""} + Node.js | ${explicitFrontendHeavy ? "frontend-dominant" : "compatible TypeScript fullstack"}`;
  } else if (alternateFrontendTitle) {
    classification = "LOW MATCH";
    tier = "C";
    compatibilityPercent = 38;
    recommendation = "REVIEW";
    reason = "Primary frontend framework is not React / Next.js";
  } else if ((frontendTitle || productEngineer || leadership) && (webReactCount || nextCount || tsCount) && !backendDominance) {
    classification = webReactCount + nextCount + tsCount >= 2 ? "STRONG MATCH" : "POSSIBLE MATCH";
    tier = classification === "STRONG MATCH" ? "A" : "B";
    compatibilityPercent = classification === "STRONG MATCH" ? 80 : 66;
    recommendation = classification === "STRONG MATCH" ? "APPLY" : "REVIEW";
    reason = `${leadership ? "Hands-on frontend leadership" : "Frontend/product engineering"} | core web overlap`;
  } else if (backendDominance) {
    classification = "LOW MATCH";
    tier = "C";
    compatibilityPercent = 32;
    recommendation = "SKIP";
    reason = "Backend-dominant responsibilities | frontend secondary";
  } else if (ecommerce.length || frontendTitle || productEngineer || (leadership && frontendDominance)) {
    classification = "POSSIBLE MATCH";
    tier = "B";
    compatibilityPercent = nonEngineeringTitle ? 55 : 68;
    recommendation = "REVIEW";
    reason = ecommerce.length
      ? `${ecommerce.join(" + ")} domain overlap | role is not clearly hands-on frontend engineering`
      : "Relevant frontend/product title | full stack evidence needs review";
  }

  const primaryStack = unique([
    ...ecommerce,
    webReactCount ? "React" : "",
    nextCount ? "Next.js" : "",
    tsCount ? "TypeScript" : "",
    nodeCount ? "Node.js" : "",
    ...backendSignals.map((stack) => stack.id),
    mobileDominance ? "Mobile" : ""
  ].filter(Boolean));
  const fitScore = Math.round((1 + compatibilityPercent / 25) * 10) / 10;

  return {
    fitScore: Math.min(5, fitScore),
    compatibilityPercent,
    matchClassification: classification,
    compatibilityTier: tier,
    recommendation,
    reason,
    strengths: unique(strengths),
    gaps: unique(gaps),
    missingMandatorySkills: unique(missingMandatorySkills),
    primaryStack,
    responsibilitySplit: {
      frontend: frontendDominance && backendDominance ? "mixed" : frontendDominance ? "dominant" : backendDominance ? "secondary" : "mixed/unknown",
      backend: frontendDominance && backendDominance ? "mixed" : backendDominance ? "dominant" : frontendDominance ? "secondary" : "mixed/unknown",
      platform: mobileDominance ? "mobile" : "web"
    },
    signals: {
      reactWebCount: webReactCount,
      reactNativeOrMobileCount: mobileCount,
      frontendCount,
      backendCount,
      mandatoryBackend: mandatoryBackend.map((stack) => stack.id),
      mandatoryLanguages: languageSignals.map((signal) => signal.name)
      ,requiredYears: unique([...allText.matchAll(/\b(\d{1,2})\+?\s+years?(?:\s+of)?\s+(?:commercial |professional |relevant )?experience\b/gi)].map((match) => Number(match[1]))).sort((a, b) => b - a)
    },
    evaluatedFrom: fullDescription ? "full-jd" : "pipeline-summary",
    evaluatedAt: new Date().toISOString()
  };
}
