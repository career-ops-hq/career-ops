const SECTION_PATTERNS = {
  summary: /^(#{1,3}\s*)?(summary|profile|profil|sammanfattning|professional summary)\b/im,
  experience: /^(#{1,3}\s*)?(experience|work experience|employment|erfarenhet|arbetslivserfarenhet)\b/im,
  skills: /^(#{1,3}\s*)?(skills|technical skills|kompetenser|färdigheter)\b/im,
  education: /^(#{1,3}\s*)?(education|utbildning)\b/im,
};

const STOP_WORDS = new Set([
  "and", "the", "with", "for", "from", "that", "this", "you", "your", "our", "are", "will",
  "och", "att", "som", "med", "för", "från", "det", "den", "ett", "en", "har", "ska",
  "engineer", "engineering", "role", "team", "work", "years", "experience", "senior", "staff",
]);

const ACTION_VERBS = /\b(achieved|built|created|delivered|designed|developed|drove|improved|increased|launched|led|optimized|reduced|scaled|skapade|byggde|ledde|ökade|minskade|förbättrade)\b/i;

function keywords(text) {
  return [...new Set(String(text || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]{2,}/gu) || [])]
    .map((word) => word.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function bounded(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function analyzeAtsReadiness(cvText, options = {}) {
  const cv = String(cvText || "");
  const sections = Object.fromEntries(
    Object.entries(SECTION_PATTERNS).map(([name, pattern]) => [name, pattern.test(cv)]),
  );
  const bullets = (cv.match(/^\s*[-*•]\s+.+$/gm) || []).length;
  const quantified = (cv.match(/\b\d+(?:[.,]\d+)?\s*(?:%|x|k|m|million|miljoner)?\b/gi) || []).length;
  const hasContact = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(cv) || /linkedin\.com\//i.test(cv);

  const requested = keywords(options.jobDescription || "");
  const available = new Set(keywords(cv));
  const matched = requested.filter((word) => available.has(word));
  const missing = requested.filter((word) => !available.has(word));
  const keywordScore = requested.length ? bounded((matched.length / requested.length) * 100) : 100;

  const structurePoints =
    (sections.summary ? 8 : 0) +
    (sections.experience ? 12 : 0) +
    (sections.skills ? 10 : 0) +
    (sections.education ? 5 : 0) +
    (hasContact ? 5 : 0);
  const impactPoints = (bullets >= 2 ? 8 : bullets * 4) + (quantified >= 1 ? 8 : 0) + (ACTION_VERBS.test(cv) ? 4 : 0);
  const readabilityPoints = cv.length >= 250 && cv.length <= 15_000 ? 10 : cv.length > 0 ? 5 : 0;
  const score = bounded(structurePoints + impactPoints + keywordScore * 0.3 + readabilityPoints);

  const recommendations = [];
  if (!sections.summary) recommendations.push("Lägg till en kort professionell sammanfattning.");
  if (!sections.experience) recommendations.push("Lägg till en tydlig erfarenhetssektion.");
  if (!sections.skills) recommendations.push("Lägg till en kompetenssektion med relevanta nyckelord.");
  if (bullets < 2) recommendations.push("Använd resultatinriktade punktlistor under erfarenhet.");
  if (!quantified) recommendations.push("Kvantifiera resultat med siffror, procent eller volymer.");
  if (missing.length) recommendations.push(`Överväg relevanta saknade nyckelord: ${missing.slice(0, 8).join(", ")}.`);

  return {
    score,
    sections,
    signals: { bullets, quantified, actionVerbs: ACTION_VERBS.test(cv), contact: hasContact },
    keywordMatch: { score: keywordScore, matched, missing },
    recommendations,
  };
}
