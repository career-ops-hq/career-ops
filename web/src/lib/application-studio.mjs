/**
 * application-studio.mjs — Application Studio engine (FAS 5)
 *
 * Deterministic, fact-safe generation of application messages from VERIFIED
 * sources only: the Career Master Profile, the selected job, the job match
 * report, and the tailored CV version.
 *
 * HARD RULES:
 *  - The AI never invents experience, results, certifications, competencies
 *    or numbers. Every sentence is assembled from the fact base.
 *  - Missing facts (e.g. interview date) are surfaced as `missingFacts` so the
 *    user fills them in — never guessed.
 *  - Every message carries `factsUsed` (labels + values + source) so the UI can
 *    show exactly which facts were used.
 *  - Pure module: no I/O, no network — fully unit-testable with node --test.
 */

/* ── Settings ───────────────────────────────────────────────────────── */

export const MESSAGE_TYPES = [
  { id: "cover-letter", label: "Personligt brev", category: "application", description: "Formellt personligt brev kopplat till tjänsten." },
  { id: "short-motivation", label: "Kort motivation", category: "application", description: "Kort varför-just-du-text för formulär." },
  { id: "why-good-fit", label: "Why are you a good fit?", category: "application", description: "Punktlista över varför du passar rollen." },
  { id: "recruiter-message", label: "Rekryterarmeddelande", category: "message", description: "Kort meddelande till rekryterare." },
  { id: "linkedin-message", label: "LinkedIn-meddelande", category: "message", description: "Meddelande för LinkedIn-kontakt." },
  { id: "email-application", label: "E-postansökan", category: "email", description: "Komplett e-postansökan med ämnesrad." },
  { id: "follow-up", label: "Uppföljningsmeddelande", category: "email", description: "Uppföljning efter inskickad ansökan." },
  { id: "interview-confirmation", label: "Intervjubekräftelse", category: "email", description: "Bekräftelse av intervjutid (fyll i detaljer)." },
  { id: "thank-you", label: "Tackmeddelande efter intervju", category: "email", description: "Tack för intervjun med återkoppling." },
  { id: "faq-answers", label: "Svar på vanliga ansökningsfrågor", category: "application", description: "Svar på vanliga frågor i ansökningsformulär." },
];

export const LENGTHS = ["short", "standard", "detailed"];
export const STYLES = ["professional", "human", "technical", "leadership", "sales"];
export const LANGUAGES = ["sv", "en", "auto"];

const STYLE_LABELS = {
  professional: { sv: "Professionell", en: "Professional" },
  human: { sv: "Mänsklig", en: "Human" },
  technical: { sv: "Teknisk", en: "Technical" },
  leadership: { sv: "Ledarskap", en: "Leadership" },
  sales: { sv: "Säljande", en: "Persuasive" },
};

export const SETTINGS_LABELS = Object.freeze({
  lengths: Object.freeze({ short: "Kort", standard: "Standard", detailed: "Utförlig" }),
  styles: Object.freeze(STYLE_LABELS),
  languages: Object.freeze({ sv: "Svenska", en: "Engelska", auto: "Automatiskt (efter jobb/land)" }),
});

/* ── Language resolution ────────────────────────────────────────────── */

const ENGLISH_JOB_HINTS = [
  "software engineer", "developer", "engineer", "manager", "product",
  "designer", "data scientist", "analyst", "consultant", "architect",
  "fullstack", "backend", "frontend", "devops", "platform", "cloud",
];

/** auto → "en" when the job looks English, otherwise "sv". */
export function resolveLanguage(language, job = {}, profile = {}) {
  if (language === "sv" || language === "en") return language;
  const haystack = [job.role, job.title, job.company, job.location, job.description, profile.location]
    .filter(Boolean).join(" ").toLowerCase();
  const hits = ENGLISH_JOB_HINTS.filter((h) => haystack.includes(h)).length;
  return hits >= 2 || /^[a-z0-9 ,.-]+$/i.test(job.role || "") ? "en" : "sv";
}

/* ── Fact base (verified facts only) ────────────────────────────────── */

function pickText(...values) {
  return values.map((v) => (typeof v === "string" ? v.trim() : "")).find((v) => v !== "") ?? "";
}

/**
 * Build the verified fact base. Every value is traced to a source label so the
 * UI can show "Fakta som användes" per message.
 * Returns { facts: [{ key, label, value, source }], map: {key: value}, missing: [key] }
 */
export function buildFactBase({ profile = {}, job = {}, match = {}, cvVersion = null } = {}) {
  const facts = [];
  const add = (key, label, value, source) => {
    const clean = typeof value === "string" ? value.trim() : Array.isArray(value) ? value.join(", ") : "";
    if (clean !== "") facts.push({ key, label, value: clean, source });
  };
  const profileSrc = "Career Master Profile";
  const jobSrc = "Valt jobb";
  const matchSrc = "Jobbmatchning";

  add("fullName", "Namn", profile.fullName, profileSrc);
  add("email", "E-post", profile.email, profileSrc);
  add("phone", "Telefon", profile.phone, profileSrc);
  add("location", "Ort", profile.location, profileSrc);
  add("linkedin", "LinkedIn", profile.linkedin, profileSrc);
  add("portfolio", "Portfolio", profile.portfolioUrl || profile.portfolio, profileSrc);
  add("headline", "Rubrik", profile.headline, profileSrc);
  add("summary", "Sammanfattning", profile.summary, profileSrc);
  add("skills", "Kompetenser", profile.skills, profileSrc);
  add("targetRoles", "Målroller", profile.targetRoles, profileSrc);
  add("workModes", "Arbetsformer", profile.workModes, profileSrc);

  add("company", "Företag", job.company, jobSrc);
  add("role", "Tjänst", job.role || job.title, jobSrc);
  add("jobLocation", "Plats", job.location, jobSrc);
  add("jobUrl", "Jobblänk", job.url, jobSrc);
  add("jobSource", "Källa", job.source, jobSrc);
  add("jobDescription", "Beskrivning", job.description, jobSrc);

  if (typeof match === "object" && match !== null) {
    add("matchScore", "Matchning", typeof match.score === "number" ? `${match.score}` : String(match.score ?? "").replace("%", ""), matchSrc);
    add("matchedSkills", "Matchade kompetenser", match.matchedSkills, matchSrc);
    add("strengths", "Styrkor", match.strengths, matchSrc);
    add("gaps", "Utvecklingsområden", match.gaps, matchSrc);
  }

  if (cvVersion && typeof cvVersion === "object") {
    add("cvVersionId", "CV-version", cvVersion.title || cvVersion.id, "CV-version");
    add("cvVersionTitle", "CV-titel", cvVersion.title, "CV-version");
    if (typeof cvVersion.text === "string" && cvVersion.text.trim() !== "") {
      add("cvSummary", "CV-sammanfattning", cvVersion.text.slice(0, 400), "CV-version");
    }
  }

  const map = {};
  for (const f of facts) map[f.key] = f.value;

  // Facts the user must supply themselves (never invented).
  const optional = ["interviewDate", "interviewTime", "interviewerName", "interviewFormat", "appliedDate", "followUpDays", "referenceName"];
  const missing = optional.filter((k) => pickText(job[k], profile[k], match[k]) === "" && !(k in map));
  for (const k of optional) {
    const v = pickText(job[k], profile[k], match[k]);
    if (v !== "") add(k, k.replace(/([A-Z])/g, " $1").toLowerCase(), v, "Användarens uppgifter");
  }
  return { facts, map, missing };
}

/* ── Template engine ────────────────────────────────────────────────── */

const SIGNATURE_SV = [
  "Med vänliga hälsningar,",
  "{fullName}",
  "{phone}",
  "{email}",
  "{location}",
  "{linkedin}",
  "{portfolio}",
].join("\n");

const SIGNATURE_EN = [
  "Kind regards,",
  "{fullName}",
  "{phone}",
  "{email}",
  "{location}",
  "{linkedin}",
  "{portfolio}",
].join("\n");

function svFlavor(style) {
  switch (style) {
    case "human": return { open: "Hej!", intro: "Jag vill gärna berätta varför jag tror att jag kan göra skillnad i den här rollen." };
    case "technical": return { open: "Hej {company}-teamet,", intro: "Med bakgrund inom {skills} vill jag ansöka om rollen som {role}." };
    case "leadership": return { open: "Hej,", intro: "Jag söker rollen som {role} och vill bidra med tydligt ansvar och resultat." };
    case "sales": return { open: "Hej {company},", intro: "Det här är varför jag är ett starkt val för {role} hos er." };
    default: return { open: "Hej {company},", intro: "Jag vill härmed ansöka om tjänsten som {role} hos {company}." };
  }
}

function enFlavor(style) {
  switch (style) {
    case "human": return { open: "Hi there!", intro: "I would love to tell you why I believe I can make a difference in this role." };
    case "technical": return { open: "Hi {company} team,", intro: "With a background in {skills}, I would like to apply for the {role} position." };
    case "leadership": return { open: "Hello,", intro: "I am applying for the {role} role and want to contribute with clear ownership and results." };
    case "sales": return { open: "Hi {company},", intro: "Here is why I am a strong fit for {role} at {company}." };
    default: return { open: "Hello {company},", intro: "I would like to apply for the {role} position at {company}." };
  }
}

function flavor(language, style) {
  return language === "en" ? enFlavor(style) : svFlavor(style);
}

/** Replace {key} placeholders; [brackets] stay visible as blanks the user fills. */
export function renderTemplate(template, map) {
  return template.replace(/\{([a-zA-Z0-9]+)\}/g, (_, key) => map[key] ?? "");
}

/** Find [bracket] blanks still present after render (missing user input). */
export function templateBlanks(text) {
  const out = [];
  const re = /\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return [...new Set(out)];
}

/* ── Message templates (fact-safe: placeholders only) ───────────────── */

function coverLetterTemplate(language, style, length) {
  const f = flavor(language, style);
  const short = `${f.open}
${f.intro}

Min bakgrund finns i mitt CV (version {cvVersionId}). Jag ser fram emot att höra från er.

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;

  const standard = `${f.open}
${f.intro}
{summary}

Jag har erfarenhet inom {skills} och matchar {matchScore} av jobbets krav ({matchedSkills}). Rollen som {role} hos {company} stämmer väl med mina målroller: {targetRoles}.

Min senaste CV-version ({cvVersionId}) bifogas. Kontakta mig gärna på {email} eller {phone}.

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;

  const detailed = `${f.open}
${f.intro}
{summary}

Jag söker tjänsten som {role} hos {company} ({jobLocation}) eftersom rollen ligger i linje med mina målroller ({targetRoles}) och min profil ({headline}). Min kompetens inom {skills} matchar jobbets krav väl — matchningen är {matchScore}, med särskilt starka områden: {strengths}.

Jag har bifogat min anpassade CV-version ({cvVersionId}) och svarar gärna på kompletterande frågor. Portfolio finns på {portfolio} och min profil på LinkedIn: {linkedin}.

Tack för att ni tar er tid att läsa min ansökan.

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
  return { short, standard, detailed }[length];
}

function shortMotivationTemplate(language, style, length) {
  const f = flavor(language, style);
  const base = `${f.open}
${f.intro} {summary} Jag matchar {matchScore} av kraven och har arbetat med {skills}.`;
  if (length === "short") return `${base}

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
  return `${base} Rollen som {role} hos {company} passar min profil ({headline}), och jag ser fram emot att bidra.

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
}

function whyGoodFitTemplate(language, style, length) {
  const heading = language === "en" ? "Why I am a good fit for {role} at {company}:" : "Varför jag passar för {role} hos {company}:";
  const bullets = (lang) => [
    lang === "en" ? "- My background: {summary}" : "- Min bakgrund: {summary}",
    lang === "en" ? "- Skills that match: {skills}" : "- Kompetenser som matchar: {skills}",
    lang === "en" ? `- Job match: {matchScore} — strengths: {strengths}` : `- Jobbmatchning: {matchScore} — styrkor: {strengths}`,
    lang === "en" ? "- Targeted CV version {cvVersionId} is attached." : "- Anpassad CV-version ({cvVersionId}) bifogas.",
  ];
  const list = bullets(language);
  const short = `${heading}
${list.slice(0, 2).join("\n")}`;
  const standard = `${heading}
${list.join("\n")}`;
  const detailed = `${heading}
${list.join("\n")}
${language === "en" ? "I am available to discuss the role in detail — please reach out." : "Jag finns tillgänglig för att diskutera rollen närmare — hör gärna av dig."}`;
  return { short, standard, detailed }[length];
}

function recruiterMessageTemplate(language, style, length) {
  const f = flavor(language, style);
  const short = `${f.open}
${f.intro} {summary} Jag matchar {matchScore} av kraven ({matchedSkills}).

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
  const standard = `${f.open}
${f.intro} {summary} Min profil ({headline}) och mina kompetenser ({skills}) passar väl mot rollen som {role} hos {company}. Jobbmatchningen är {matchScore}.

Min CV (version {cvVersionId}) är anpassad mot tjänsten och bifogas gärna.

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
  const detailed = `${f.open}
${f.intro} {summary} Jag söker {role} hos {company} ({jobLocation}) och min matchning mot kravprofilen är {matchScore}. Starkast områden: {strengths}. Jag har arbetat med {skills} och min anpassade CV-version ({cvVersionId}) är redo att skickas.

Vill du att jag skickar CV och personligt brev, eller föredrar du ett kortare samtal först?

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
  return { short, standard, detailed }[length];
}

function linkedinMessageTemplate(language, style, length) {
  const f = flavor(language, style);
  const short = `${f.open}
${f.intro} {summary} Jag matchar {matchScore} av kraven och skulle gärna prata mer om möjligheten.

${language === "en" ? "Best, {fullName}" : "Hälsningar, {fullName}"}`;
  const standard = `${f.open}
${f.intro} {summary} Rollen som {role} hos {company} passar min bakgrund ({headline}), och min matchning är {matchScore}. Min CV (version {cvVersionId}) finns tillgänglig.

Skulle du vara intresserad av att titta på min profil?

${language === "en" ? "Best, {fullName}" : "Hälsningar, {fullName}"}`;
  const detailed = `${f.open}
${f.intro} {summary} Jag har sett att {company} söker en {role} ({jobLocation}). Min kompetens inom {skills} matchar kraven väl ({matchScore}), med starkast områden: {strengths}. Min anpassade CV-version ({cvVersionId}) är klar.

Skicka gärna CV:et om det är av intresse — eller boka gärna in ett kort samtal.

${language === "en" ? "Best, {fullName}" : "Hälsningar, {fullName}"}`;
  return { short, standard, detailed }[length];
}

function emailApplicationTemplate(language, style, length) {
  const subject = language === "en" ? "Application: {role} at {company}" : "Ansökan: {role} hos {company}";
  const f = flavor(language, style);
  const body = (() => {
    if (length === "short") return `${f.open}
${f.intro} {summary} CV (version {cvVersionId}) bifogas.

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
    if (length === "standard") return `${f.open}
${f.intro} {summary} Jag matchar {matchScore} av kraven ({matchedSkills}) och min anpassade CV-version ({cvVersionId}) samt mitt personliga brev bifogas.

Kontakta mig gärna på {email} eller {phone}.

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
    return `${f.open}
${f.intro} {summary} Rollen som {role} hos {company} ({jobLocation}) ligger i linje med mina målroller ({targetRoles}) och min profil ({headline}). Min matchning mot kravprofilen är {matchScore}, med starkast områden: {strengths}. Portfolio: {portfolio}, LinkedIn: {linkedin}.

Bifogat: anpassat CV ({cvVersionId}) och personligt brev.

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
  })();
  return { subject, body };
}

function followUpTemplate(language, style, length) {
  const subject = language === "en" ? "Following up on my application for {role}" : "Uppföljning av min ansökan — {role}";
  const f = flavor(language, style);
  const body = `${f.open}
${f.intro} {summary} Jag ansökte om {role} hos {company} [appliedDate] och vill gärna följa upp min ansökan.

${language === "en" ? "I remain very interested in the role. Please let me know if you need anything more from me." : "Jag är fortsatt mycket intresserad av rollen. Hör gärna av dig om du behöver mer från mig."}

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
  return { subject, body };
}

function interviewConfirmationTemplate(language, style, length) {
  const subject = language === "en" ? "Interview confirmation — {role} at {company}" : "Intervjubekräftelse — {role} hos {company}";
  const f = flavor(language, style);
  const body = `${f.open}
${f.intro} Jag bekräftar härmed intervjun för {role} hos {company}.

[interviewDate] [interviewTime] ([interviewFormat]) med [interviewerName].

${language === "en" ? "Please let me know if you need anything in advance. I look forward to meeting you." : "Hör gärna av dig om du behöver något i förväg. Jag ser fram emot att träffas."}

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
  return { subject, body };
}

function thankYouTemplate(language, style, length) {
  const subject = language === "en" ? "Thank you — {role} interview" : "Tack — intervju {role}";
  const f = flavor(language, style);
  const body = `${f.open}
${f.intro} Tack för intervjun för {role} hos {company} [interviewDate].

${language === "en" ? "I really appreciated the conversation and I remain very interested in the role. My background ({skills}) maps well to the requirements, and I am happy to provide anything else you need." : "Jag uppskattade verkligen samtalet och är fortsatt mycket intresserad av rollen. Min bakgrund ({skills}) stämmer väl mot kraven, och jag hjälper gärna till med det ni behöver."}

${language === "en" ? SIGNATURE_EN : SIGNATURE_SV}`;
  return { subject, body };
}

function faqAnswersTemplate(language, style, length) {
  const f = flavor(language, style);
  const q1 = language === "en" ? "Why are you interested in this role?" : "Varför är du intresserad av rollen?";
  const a1 = `${f.intro} {summary} Rollen som {role} hos {company} passar mina målroller ({targetRoles}) och min profil ({headline}).`;
  const q2 = language === "en" ? "When can you start?" : "När kan du börja?";
  const a2 = language === "en" ? "I can discuss a start date with you — my notice period is [noticePeriod]." : "Jag kan diskutera startdatum med dig — min uppsägningstid är [noticePeriod].";
  const q3 = language === "en" ? "What are your salary expectations?" : "Vilka är dina löneförväntningar?";
  const a3 = language === "en" ? "I am happy to discuss salary based on the role and total package." : "Jag diskuterar gärna lön utifrån rollen och helhetspaketet.";
  const q4 = language === "en" ? "Why should we hire you?" : "Varför ska vi anställa dig?";
  const a4 = `${language === "en" ? "Job match: {matchScore} — strengths: {strengths}. Skills: {skills}." : "Jobbmatchning: {matchScore} — styrkor: {strengths}. Kompetenser: {skills}."}`;
  const body = `${q1}
${a1}

${q2}
${a2}

${q3}
${a3}

${q4}
${a4}`;
  return { subject: "", body };
}

const TEMPLATE_FNS = {
  "cover-letter": coverLetterTemplate,
  "short-motivation": shortMotivationTemplate,
  "why-good-fit": whyGoodFitTemplate,
  "recruiter-message": recruiterMessageTemplate,
  "linkedin-message": linkedinMessageTemplate,
  "email-application": emailApplicationTemplate,
  "follow-up": followUpTemplate,
  "interview-confirmation": interviewConfirmationTemplate,
  "thank-you": thankYouTemplate,
  "faq-answers": faqAnswersTemplate,
};

/* ── Fact verification ──────────────────────────────────────────────── */

/**
 * Verify that a rendered message only contains verified facts.
 * Returns { ok, unverified: [terms], blanks: [labels] }
 * - `blanks` are [bracket] fields the user must fill in (never invented).
 * - `unverified` are content terms not traceable to the fact base.
 */
export function verifyMessageFacts(message, factBase, verifiedTerms = []) {
  const text = `${message.subject ?? ""}\n${message.body}`;
  const blanks = templateBlanks(text);
  const known = new Set([...verifiedTerms]);
  for (const f of (factBase?.facts ?? [])) {
    for (const word of String(f.value).toLowerCase().split(/[\s,.;:()@\-–—/]+/)) {
      if (word.length >= 4) known.add(word);
    }
    if (f.label) {
      for (const word of String(f.label).toLowerCase().split(/[\s,.;:()@\-–—/]+/)) {
        if (word.length >= 4) known.add(word);
      }
    }
  }
  const stopwords = new Set([
    "och", "att", "det", "som", "med", "för", "har", "var", "vid", "inte", "den", "de", "ett", "en",
    "jag", "mig", "min", "mitt", "mina", "vill", "kan", "ska", "har", "blev", "finns", "gärna",
    "the", "and", "with", "for", "from", "that", "this", "you", "your", "our", "are", "will",
    "can", "have", "has", "been", "would", "should", "please", "role", "rollen", "tjänsten",
    "tjänst", "hos", "från", "till", "under", "över", "även", "samt", "men", "eller", "när",
    "vad", "hur", "vilka", "vem", "varför", "intervju", "intervjun", "ansökan", "ansöka",
    "ansöker", "erbjudande", "erbjuder", "erbjuda", "möjlighet", "möjligheten", "gärna",
    "tack", "kontakta", "kontakt", "hör", "skicka", "skickar", "skickat", "bifogas", "bifogat",
    "finns", "tillgänglig", "tillgängligt", "prata", "pratar", "samtal", "diskutera", "diskuterar",
    "intresserad", "intresse", "intressant", "roligt", "gärna", "snart", "fram", "emot", "ser",
    "hjälper", "behöver", "behövs", "något", "mer", "mera", "mycket", "också", "bara", "redan",
    "alla", "allt", "alltid", "aldrig", "så", "sådana", "sådan", "dessutom", "därför", "därmed",
    "bästa", "hälsningar", "vänliga", "regards", "kind", "best", "hi", "hello", "there", "here",
    "why", "what", "when", "which", "where", "how", "about", "into", "after", "before", "during",
    "between", "through", "within", "without", "because", "then", "than", "just", "also", "well",
    "again", "never", "always", "often", "sometimes", "very", "really", "great", "good", "best",
    "attached", "attaching", "version", "ready", "discuss", "discussing", "provide", "anything",
    "else", "remain", "remain", "interested", "looking", "forward", "meeting", "speaking",
    "appreciated", "appreciate", "conversation", "happy", "maps", "requirements", "notice",
    "period", "salary", "expectations", "based", "total", "package", "hire", "apply", "applying",
    "applied", "application", "follow", "follow-up", "uppföljning", "uppföljning", "formulär",
    "formuläret", "frågor", "frågorna", "fråga", "svar", "svarar", "stämmer", "stämma", "väl",
    "ligger", "linje", "krav", "kraven", "kravprofil", "kravprofilen", "områden", "område", "starkast",
    "härmed", "inom", "matchar", "matcha", "jobbets", "jobbet", "senaste", "tjänsten", "rollbeskrivning",
    "rollbeskrivningen", "sammanfattning", "sammanfattningen", "erfarenheter", "kunskaper", "kompetenser",
    "kvalifikationer", "utbildning", "utbildningen", "arbetslivserfarenhet", "arbetsuppgifter", "arbetsgivare",
    "arbetsgivaren", "rekryterare", "rekryteringen", "processen", "process", "ansökningsprocessen",
    "meddelande", "meddelandet", "brev", "brevet", "mail", "mailet", "epost", "e-post", "sista", "datum",
    "datumet", "vecka", "veckan", "tider", "tiderna", "samtalet", "samtal", "möte", "mötet", "bekräfta",
    "bekräftelse", "bekräftelsen", "återkoppling", "återkoppling", "återkommer", "återkomma", "bifogar",
    "bifogade", "bilaga", "bilagan", "länk", "länken", "ansökningsformulär", "ansökningsformuläret",
    "webbplats", "webbplatsen", "hemsida", "hemsidan", "sidan", "information", "informationen", "frågor",
    "funderingar", "tveka", "tvekar", "kontakta", "kontaktuppgifter", "önskemål", "önskemålen", "specifika",
    "specifik", "specifikt", "egna", "egna", "ord", "läsa", "läser", "granska", "granskning", "uppdatera",
    "uppdaterat", "välkomna", "välkommen", "välkomnar", "tid", "tidigt", "tidigare", "direkt", "gärna",
    "berätta", "berättar", "beskriva", "beskriver", "beskrivning", "passar", "passande", "passande",
    "relevant", "relevanta", "relevant", "erfarenhet", "kompetens", "kunskap", "kunskaper", "färdigheter",
    "färdighet", "resultat", "resultaten", "exempel", "exempelvis", "t.ex.", "med", "dina", "ditt", "din",
    "ert", "era", "er", "ni", "oss", "vår", "vårt", "våra", "dem", "dom", "sig", "sin", "sitt", "sina",
    "uppskattar", "uppskattas", "verkligen", "väldigt", "helt", "säkert", "säker", "eventuella", "eventuellt",
    "ytterligare", "utöver", "gärna", "omgående", "snarast", "snaraste", "skyndsamt", "gällande", "avseende",
    "angående", "beträffande", "exakt", "korrekt", "komplett", "komplettera", "komplettering", "saknas",
    "saknade", "obligatoriska", "obligatorisk", "vänligen", "meddela", "meddelar", "återkommer", "via",
    "genom", "mellan", "utan", "medans", "varje", "någon", "några", "något", "inga", "ingen", "inget",
    "sommar", "vinter", "höst", "vår", "perioden", "period", "omfattning", "omfattningen", "start",
    "startdatum", "startar", "börjar", "påbörja", "påbörjas", "heltid", "deltid", "deltid", "tillsvidare",
    "visstid", "tidsbegränsat", "kollektivavtal", "kollektivavtalet", "facklig", "fackliga", "löneanspråk",
    "löneanspråken", "löne", "lönen", "månadslön", "årslön", "timlön", "förmåner", "förmånerna",
    "balans", "work-life", "flexibelt", "flexibel", "flexibilitet", "sist", "inledning", "inledningsvis",
    "avslutningsvis", "sammanfattningsvis", "kort", "kortfattat", "utförligt", "professionellt",
    "professionell", "personligt", "personliga", "säljande", "säljande", "tekniskt", "tekniska",
    "tydlig", "tydligt", "konkret", "konkreta", "konkretisera", "faktabaserat", "faktabaserad",
    "faktabaserade", "verifierade", "verifierat", "verifierbar", "källhänvisning", "källhänvisningar",
    "arbetat", "arbeta", "arbete", "arbetar", "profil", "profilen", "bidra", "bidrar", "bidragit",
    "bidraget", "utveckling", "utveckla", "utvecklat", "drivit", "driver", "ansvar", "ansvarat",
    "levererat", "leverera", "byggt", "bygga", "bygger", "skapat", "skapa", "skapar", "genomfört",
    "genomföra", "hanterat", "hantera", "samarbetat", "samarbeta", "samarbete", "söker", "söka",
    "tjänst", "rollen", "roll", "företaget", "företag", "organisationen", "organisation", "team",
    "teamen", "projekt", "projekten", "webb", "app", "appar", "plattform", "plattformen",
    "bakgrund", "jobbmatchning", "jobbmatchningen", "anpassad", "anpassade", "anpassa", "matchningen", "matchning", "motiverad",
    "motivation", "motiverande", "inspirerad", "inspiration", "engagerad", "engagemang", "värderingar",
    "värderingarna", "kultur", "kulturen", "ambitioner", "ambition", "målsättningar", "drivkraft",
    "skulle", "vara", "titta", "tittar", "tittade", "höra", "hörs", "prata", "pratar", "diskutera",
    "diskuterar", "vore", "roligt", "nyfiken", "gärna", "gärna", "träffas", "stämma",
  ]);
  const unverified = [];
  const seen = new Set();
  const re = /[\p{L}\d]{4,}/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    const w = m[0].toLowerCase();
    if (stopwords.has(w) || known.has(w) || seen.has(w)) continue;
    seen.add(w);
    unverified.push(w);
  }
  return { ok: blanks.length === 0 && unverified.length === 0, unverified, blanks };
}

/* ── Message generation ─────────────────────────────────────────────── */

let messageSeq = 0;

function makeMessage(typeId, meta, rendered, factBase, settings, now) {
  messageSeq += 1;
  const id = `${typeId}-${now}-${messageSeq}`;
  const blanks = templateBlanks(`${rendered.subject ?? ""}\n${rendered.body}`);
  const factsUsed = (factBase.facts || []).map((f) => ({ ...f }));
  const message = {
    id,
    type: typeId,
    title: (MESSAGE_TYPES.find((t) => t.id === typeId) || {}).label || typeId,
    subject: rendered.subject ?? "",
    body: rendered.body,
    factsUsed,
    missingFacts: blanks,
    settings: { ...settings },
    version: 1,
    versions: [{ version: 1, body: rendered.body, createdAt: now, by: "engine" }],
    draft: false,
    createdAt: now,
    updatedAt: now,
  };
  return message;
}

/** Generate one message of `type`. Pure + deterministic. */
export function generateMessage({ type, profile, job, match, cvVersion, settings = {}, now = new Date().toISOString() }) {
  const fn = TEMPLATE_FNS[type];
  if (!fn) throw new Error(`Okänd meddelandetyp: ${type}`);
  const length = LENGTHS.includes(settings.length) ? settings.length : "standard";
  const style = STYLES.includes(settings.style) ? settings.style : "professional";
  const language = resolveLanguage(settings.language ?? "auto", job, profile);
  const factBase = buildFactBase({ profile, job, match, cvVersion });
  const template = fn(language, style, length);
  const rendered = {
    subject: typeof template === "object" ? renderTemplate(template.subject, factBase.map) : "",
    body: renderTemplate(typeof template === "object" ? template.body : template, factBase.map),
  };
  return makeMessage(type, null, rendered, factBase, { length, style, language }, now);
}

/**
 * Generate all requested message types for a package.
 * Returns { messages, settings, factBase, language }
 */
export function generateMessages({ profile, job, match, cvVersion, settings = {}, types, now = new Date().toISOString() }) {
  const length = LENGTHS.includes(settings.length) ? settings.length : "standard";
  const style = STYLES.includes(settings.style) ? settings.style : "professional";
  const language = resolveLanguage(settings.language ?? "auto", job, profile);
  const factBase = buildFactBase({ profile, job, match, cvVersion });
  const wanted = Array.isArray(types) && types.length > 0 ? types : MESSAGE_TYPES.map((t) => t.id);
  const messages = [];
  for (const type of wanted) {
    if (!TEMPLATE_FNS[type]) continue;
    const template = TEMPLATE_FNS[type](language, style, length);
    const rendered = {
      subject: typeof template === "object" ? renderTemplate(template.subject, factBase.map) : "",
      body: renderTemplate(typeof template === "object" ? template.body : template, factBase.map),
    };
    messages.push(makeMessage(type, null, rendered, factBase, { length, style, language }, now));
  }
  return { messages, settings: { length, style, language }, factBase, language };
}

/* ── Message review operations (pure) ───────────────────────────────── */

/**
 * Regenerate one message with new settings. Creates a new version.
 * Returns a NEW message object (immutable source message untouched).
 */
export function regenerateMessage(message, { profile, job, match, cvVersion, settings, now = new Date().toISOString() }) {
  const generated = generateMessage({ type: message.type, profile, job, match, cvVersion, settings, now });
  const version = message.version + 1;
  const next = {
    ...generated,
    id: message.id,
    draft: message.draft,
    version,
    versions: [...(message.versions || []), { version, body: generated.body, createdAt: now, by: "engine" }],
    history: [
      ...(message.history || []),
      { action: "regenerate", version, createdAt: now },
    ],
  };
  return next;
}

/** Apply a user edit. Creates a new version (source message untouched). */
export function editMessage(message, body, now = new Date().toISOString()) {
  const version = message.version + 1;
  return {
    ...message,
    body,
    subject: message.subject,
    version,
    versions: [...(message.versions || []), { version, body, createdAt: now, by: "user" }],
    edited: true,
    history: [...(message.history || []), { action: "edit", version, createdAt: now }],
    updatedAt: now,
  };
}

/** Restore a previous version's body as the current one. */
export function restoreMessageVersion(message, versionNumber, now = new Date().toISOString()) {
  const target = (message.versions || []).find((v) => v.version === versionNumber);
  if (!target) throw new Error(`Version ${versionNumber} finns inte.`);
  const version = message.version + 1;
  return {
    ...message,
    body: target.body,
    version,
    versions: [...(message.versions || []), { version, body: target.body, createdAt: now, by: "restore" }],
    history: [...(message.history || []), { action: "restore", fromVersion: versionNumber, version, createdAt: now }],
    updatedAt: now,
  };
}

export function setMessageDraft(message, draft, now = new Date().toISOString()) {
  return { ...message, draft: Boolean(draft), updatedAt: now };
}

/** Copy = return plain text (subject + body) for clipboard/export. */
export function copyMessage(message) {
  return [message.subject, message.body].filter(Boolean).join("\n\n");
}

/* ── Package helpers ────────────────────────────────────────────────── */

export function createApplicationPackage({ job, profile, match, cvVersion, settings = {}, types, now = new Date().toISOString() }) {
  const generated = generateMessages({ profile, job, match, cvVersion, settings, types, now });
  return {
    packageId: null, // assigned by store
    job,
    profileSnapshot: profile,
    match: match ?? null,
    cvVersion: cvVersion ?? null,
    settings: generated.settings,
    messages: generated.messages,
    factBase: generated.factBase,
    status: "Saved",
    history: [{ at: now, event: "created", status: "Saved" }],
    createdAt: now,
    updatedAt: now,
  };
}
