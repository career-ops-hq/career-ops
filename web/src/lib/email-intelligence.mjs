/**
 * email-intelligence.mjs — Email Job Intelligence (FAS 5)
 *
 * Classifies job-related email into categories, extracts entities
 * (company, role, recruiter, dates, deadlines, meeting times, next
 * action) and matches messages to existing pipeline jobs.
 *
 * Deterministic engine — no network calls, no AI fabrication.
 */

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

export const EMAIL_CLASSES = [
  { id: "job-alert", label: "Job Alert", description: "Ny jobbannons/bevakning" },
  { id: "recruiter-message", label: "Recruiter Message", description: "Meddelande från rekryterare" },
  { id: "application-confirmation", label: "Application Confirmation", description: "Bekräftelse av mottagen ansökan" },
  { id: "interview", label: "Interview", description: "Intervjubokning/inbjudan" },
  { id: "assessment-test", label: "Assessment/Test", description: "Test eller bedömning" },
  { id: "follow-up", label: "Follow-up", description: "Uppföljning/check-in" },
  { id: "rejection", label: "Rejection", description: "Nekande besked" },
  { id: "offer", label: "Offer", description: "Erbjudande" },
  { id: "other", label: "Other", description: "Övrigt" },
];

export const EMAIL_CLASS_IDS = EMAIL_CLASSES.map((c) => c.id);

/* Lexicon: keyword -> class. Each keyword lower-cased, matched with
   includes() against the combined subject+body text. */
const CLASS_KEYWORDS = [
  { cls: "interview", words: ["intervju", "intervjufrågor", "boka in", "boka intervju", "mötesinbjudan", "meeting invite", "interview", "teams-möte", "zoom", "boka en tid", "calendar invite"] },
  { cls: "rejection", words: ["tyvärr", "vi har valt att gå vidare med andra", "inte gå vidare", "dessvärre", "unfortunately", "we regret", "we have decided to move forward with other", "not moving forward", "tack för din ansökan men"] },
  { cls: "offer", words: ["erbjudande", "vi vill erbjuda dig", "anställningserbjudande", "job offer", "we would like to offer you", "offer letter", "kontrakt", "employment contract"] },
  { cls: "assessment-test", words: ["test", "assessment", "personlighetstest", "logiktest", "kodtest", "hemuppgift", "take-home", "coding challenge", "kandidattest"] },
  { cls: "follow-up", words: ["uppföljning", "check-in", "återkoppling", "statusfråga", "follow up", "follow-up", "nå ut", "hör av dig", "följa upp", "följer upp", "påminnelse", "påminner om"] },
  { cls: "application-confirmation", words: ["bekräftelse", "vi har mottagit din ansökan", "tack för din ansökan", "application received", "we have received your application", "bekräftar att"] },
  { cls: "job-alert", words: ["ny annons", "jobbannons", "nya jobb", "matchande jobb", "job alert", "new job", "job match", "rekommenderade jobb", "jobbportal", "lediga tjänster"] },
  { cls: "recruiter-message", words: ["rekryterare", "recruiter", "talent acquisition", "vi söker", "vi letar efter", "skulle vara intresserad", "passar din profil", "headhunter", "konsultchef"] },
];

const NEGATIVE_WORDS = ["skräppost", "spam", "nyhetsbrev", "newsletter", "erbjudande: 50%", "reklam"];

/**
 * Classify an email into one of EMAIL_CLASSES.
 * @param {object} email — { subject, body }
 * @returns {{ classId, label, confidence, matchedKeywords: string[] }}
 */
export function classifyEmail(email) {
  const subject = String(email?.subject || "").toLowerCase();
  const body = String(email?.body || "").toLowerCase();
  const text = `${subject} ${body}`;

  for (const neg of NEGATIVE_WORDS) {
    if (text.includes(neg)) {
      return { classId: "other", label: "Other", confidence: 0.9, matchedKeywords: [`neg:${neg}`] };
    }
  }

  let best = null;
  for (const { cls, words } of CLASS_KEYWORDS) {
    const hits = words.filter((w) => text.includes(w));
    if (hits.length === 0) continue;
    // Longer keyword matches are more specific.
    const score = hits.reduce((s, w) => s + w.length, 0) * (1 + 0.25 * (hits.length - 1));
    if (!best || score > best.score) {
      best = { cls, score, hits };
    }
  }

  if (!best) {
    return { classId: "other", label: "Other", confidence: 0.5, matchedKeywords: [] };
  }

  const confidence = Math.min(0.99, 0.55 + best.score / 200);
  return {
    classId: best.cls,
    label: EMAIL_CLASSES.find((c) => c.id === best.cls).label,
    confidence: Number(confidence.toFixed(2)),
    matchedKeywords: best.hits,
  };
}

/* ------------------------------------------------------------------ */
/* Entity extraction                                                   */
/* ------------------------------------------------------------------ */

const ROLE_HINTS = [
  "utvecklare", "developer", "engineer", "konsult", "designer", "projektledare",
  "product manager", "data", "analytiker", "analyst", "arkitekt", "architect",
  "testare", "tester", "chef", "manager", "specialist", "koordinator", "ledare",
];

const COMPANY_SUFFIXES = ["ab", "aktiebolag", "group", "gruppen", "consulting", "consult", "partner", "holding", "care", "tech", "digital", "systems"];

function findCompany(text) {
  // "X AB" / "X Group" patterns
  for (const suffix of COMPANY_SUFFIXES) {
    const re = new RegExp(`([A-ZÅÄÖ][A-ZÅÄÖa-zåäö0-9&._-]{1,40})\\s+(${suffix})\\b`, "i");
    const m = text.match(re);
    if (m) {
      const company = `${m[1].replace(/[.,]+$/, "")} ${m[2].replace(/[.,]+$/, "")}`;
      return { value: company, start: m.index, confidence: 0.9 };
    }
  }
  return null;
}

function findRole(text) {
  const sentences = text.split(/[.!?\n]/);
  for (const sentence of sentences) {
    for (const hint of ROLE_HINTS) {
      const idx = sentence.toLowerCase().indexOf(hint);
      if (idx === -1) continue;
      const segment = sentence.slice(Math.max(0, idx - 40), idx + hint.length + 20);
      const words = segment.match(/[A-ZÅÄÖa-zåäö-]{3,}/g) || [];
      if (words.length === 0) continue;
      return { value: words.join(" "), confidence: 0.7 };
    }
  }
  return null;
}

function findDate(text, label) {
  // Swedish + ISO dates: 2026-08-20, 20/8, 20 augusti, aug 20
  const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return { value: `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`, confidence: 0.95, match: iso[0] };
  const sv = text.match(/\b(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b/i);
  if (sv) return { value: `${sv[2].toLowerCase()} ${sv[1]}`, confidence: 0.85, match: sv[0] };
  const en = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if (en) return { value: `${en[2]} ${en[1]}`, confidence: 0.8, match: en[0] };
  return null;
}

function findTime(text) {
  const m = text.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (m) return { value: `${m[1]}:${m[2]}`, confidence: 0.9 };
  const m2 = text.match(/\b(kl\.?|at)\s+(\d{1,2})[:.](\d{2})\b/i);
  if (m2) return { value: `${m2[2]}:${m2[3]}`, confidence: 0.95 };
  return null;
}

function findRecruiter(text) {
  const m = text.match(/(?:hälsningar|med vänliga hälsningar|mvh|best regards|regards|from|hälsar)\s*,?\s*([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+){1,2})/);
  if (m) return { value: m[1].trim(), confidence: 0.8 };
  // "Sara Lind på Acme AB" / "Sara på Acme" — avsändarnamn följt av företag.
  const named = text.match(/([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)\s+på\s+[A-ZÅÄÖ][A-ZÅÄÖa-zåäö0-9&._-]*/);
  if (named) return { value: named[1].trim(), confidence: 0.7 };
  return null;
}

const NEXT_ACTION_WORDS = ["ansök", "boka", "bekräfta", "skicka", "hör av dig", "återkoppla", "genomför", "svara", "logga in"];

function findNextAction(text) {
  const sentences = text.split(/[.!?\n]/);
  for (const w of NEXT_ACTION_WORDS) {
    const sentence = sentences.find((s) => s.toLowerCase().includes(w));
    if (sentence && sentence.trim()) {
      return { value: sentence.trim(), confidence: 0.6 };
    }
  }
  return null;
}

/**
 * Extract structured entities from an email.
 * @param {object} email — { subject, body }
 * @returns {{ company, role, recruiter, date, deadline, meetingTime, nextAction }}
 */
export function extractEmailEntities(email) {
  const subject = String(email?.subject || "");
  const body = String(email?.body || "");
  const text = `${subject}\n${body}`;

  const company = findCompany(text);
  const role = findRole(text);
  const recruiter = findRecruiter(text);
  const date = findDate(text, "date");
  const meetingTime = findTime(text);
  const deadline = findDate(text, "deadline");
  const nextAction = findNextAction(text);

  return {
    company: company ? { ...company, match: company.match } : null,
    role,
    recruiter,
    date,
    deadline,
    meetingTime,
    nextAction,
  };
}

/* ------------------------------------------------------------------ */
/* Job / email matching                                                */
/* ------------------------------------------------------------------ */

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-zåäö0-9]/g, "");
}

/**
 * Match an email against existing pipeline jobs.
 * @param {object} email — { subject, body }
 * @param {Array} jobs — pipeline jobs with { id, company, role }
 * @returns {{ match: object|null, confidence: number, needsUserConfirmation: boolean, reasons: string[] }}
 */
export function matchEmailToJob(email, jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { match: null, confidence: 0, needsUserConfirmation: true, reasons: ["no-jobs-in-pipeline"] };
  }
  const subject = String(email?.subject || "");
  const body = String(email?.body || "");
  const text = `${subject} ${body}`;
  const entities = extractEmailEntities(email);

  const scored = jobs
    .map((job) => {
      const jobCompany = normalize(job?.company);
      const jobRole = normalize(job?.role);
      let score = 0;
      const reasons = [];

      if (entities.company && jobCompany && normalize(entities.company.value).includes(jobCompany)) {
        score += 0.55;
        reasons.push("company-match");
      } else if (entities.company && jobCompany && text.toLowerCase().includes(jobCompany)) {
        score += 0.45;
        reasons.push("company-mentioned");
      }

      if (entities.role && jobRole && normalize(entities.role.value).includes(jobRole.slice(0, 8))) {
        score += 0.35;
        reasons.push("role-match");
      } else if (jobRole && text.toLowerCase().includes(jobRole.toLowerCase())) {
        score += 0.3;
        reasons.push("role-mentioned");
      }

      // Subject often contains the company/role of the application.
      if (jobCompany && subject.toLowerCase().includes(jobCompany)) {
        score += 0.2;
        reasons.push("company-in-subject");
      }

      return { job, score: Number(score.toFixed(2)), reasons };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  if (!best || best.score < 0.3) {
    return { match: null, confidence: 0, needsUserConfirmation: true, reasons: ["low-confidence"] };
  }

  const ambiguous = second && second.score >= best.score * 0.7 && second.score > 0.3;
  const hasRole = best.reasons.some((r) => r === "role-match" || r === "role-mentioned");
  const confidence = Math.min(0.99, 0.5 + best.score);
  return {
    match: { jobId: best.job.id, company: best.job.company, role: best.job.role, score: best.score },
    confidence: Number(confidence.toFixed(2)),
    // Bara företagsträff (ingen roll nämnd) → be användaren bekräfta.
    needsUserConfirmation: Boolean(ambiguous) || !hasRole,
    reasons: best.reasons,
  };
}
