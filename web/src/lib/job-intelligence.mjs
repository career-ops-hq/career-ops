// job-intelligence.mjs — Job Intelligence engine (FAS 2).
//
// Deterministic, evidence-grounded analysis of job ads against the user's
// Career Master Profile. HARD RULE: nothing is ever invented. Every match
// status is derived only from the supplied evidence (CV text, master profile,
// user answers). Anything the engine cannot evidence is reported as
// "missing-evidence" or "unclear" — never as fact.
//
// The engine is pure (no I/O, no AI calls) so it is fully unit-testable with
// `node --test` and safe to run server-side.

// ---------------------------------------------------------------------------
// Lexicons (Swedish + English)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "and", "the", "with", "for", "from", "that", "this", "you", "your", "our",
  "are", "will", "can", "have", "has", "been", "were", "was", "who", "what",
  "which", "where", "when", "why", "into", "over", "under", "across", "through",
  "about", "between", "after", "before", "during", "should", "would", "could",
  "must", "may", "might", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "only", "own", "same", "so", "than", "too", "very",
  "just", "also", "within", "including", "included", "plus", "well",
  "och", "att", "som", "med", "för", "från", "det", "den", "ett", "en", "har",
  "ska", "kan", "var", "vår", "vårt", "våra", "dig", "du", "ni", "oss", "inte",
  "även", "samt", "men", "eller", "till", "av", "på", "i", "om", "vid", "över",
  "under", "efter", "före", "mellan", "genom", "mot", "utan", "med", "inom",
  "inklusive", "minst", "gärna", "erfarenhet", "erfarenheter", "krav", "kravet",
  "arbete", "arbeta", "arbetat", "jobb", "roll", "rollen", "team", "lag",
  "företag", "företaget", "tjänst", "tjänsten", "ansvar", "ansvarsområden",
  "god", "goda", "bra", "stor", "stor", "utveckla", "utveckling", "utvecklare",
  "engineering", "engineer", "role", "work", "years", "year", "experience",
  "experience", "senior", "staff", "candidate", "candidates", "applicant",
]);

const TECH_TERMS = new Set([
  "python", "typescript", "javascript", "react", "react.js", "reactjs", "node",
  "node.js", "nodejs", "next.js", "nextjs", "aws", "amazon web services",
  "azure", "gcp", "google cloud", "google cloud platform", "docker", "kubernetes",
  "k8s", "terraform", "sql", "postgres", "postgresql", "mysql", "mariadb",
  "mongodb", "redis", "graphql", "rest", "rest api", "api", "apis", "git",
  "github", "gitlab", "ci/cd", "cicd", "linux", "java", "golang", "rust",
  "c++", "c#", ".net", "php", "ruby", "swift", "kotlin", "scala", "django",
  "flask", "fastapi", "spring", "spring boot", "angular", "vue", "vue.js",
  "svelte", "tailwind", "tailwind css", "html", "css", "sass", "webpack",
  "vite", "jest", "playwright", "cypress", "pytest", "datadog", "prometheus",
  "grafana", "elasticsearch", "kibana", "kafka", "rabbitmq", "spark", "airflow",
  "pandas", "numpy", "tensorflow", "pytorch", "scikit-learn", "ml", "machine learning",
  "llm", "llms", "nlp", "data engineering", "etl", "snowflake", "bigquery",
  "redshift", "dbt", "figma", "jira", "confluence", "agile", "scrum", "kanban",
  "saas", "microservices", "microservice", "serverless", "oauth", "jwt",
  "oidc", "tls", "bash", "powershell", "ansible", "puppet", "cloudformation",
  "opentelemetry", "sentry", "clickhouse", "vitest", "nestjs", "express",
  "prisma", "supabase", "firebase", "vercel", "netlify", "tailscale",
  "cassandra", "dynamodb", "elasticsearch", "tableau", "power bi", "looker",
  "docker-compose", "helm", "argocd", "istio", "grpc", "websocket",
  "cobol", "delphi", "vb.net", "matlab", "sas", "spss", "excel", "vba",
  "sharepoint", "salesforce", "hubspot", "zapier", "n8n", "mcp", "rag",
  "embeddings", "vector database", "langchain", "openai", "claude", "copilot",
]);

const LANG_TERMS = new Set([
  "svenska", "engelska", "norska", "danska", "tyska", "franska", "spanska",
  "italienska", "portugisiska", "finska", "polska", "holländska", "nederländska",
  "japanska", "kinesiska", "arabiska", "ryska", "swedish", "english",
  "norwegian", "danish", "german", "french", "spanish", "italian",
  "portuguese", "finnish", "polish", "dutch", "japanese", "chinese",
  "arabic", "russian",
]);

const EDUCATION_TERMS = new Set([
  "utbildning", "civilingenjör", "högskoleingenjör", "kandidat", "master",
  "magister", "doktor", "doktorsexamen", "ph.d.", "phd", "degree", "bachelor",
  "b.sc.", "m.sc.", "master's", "bachelor's", "university", "högskola",
  "gymnasium", "datavetenskap", "computer science", "mba", "yrkeshögskola",
  "civilingenjörsexamen", "teknologie kandidat", "teknologie master",
  "examen", "studier", "universitetsstudier",
]);

const CERT_TERMS = new Set([
  "certifiering", "certifierad", "certifikat", "aws certified", "azure certified",
  "gcp certified", "google cloud certified", "pmp", "scrum master", "psm",
  "csm", "cissp", "security+", "comptia", "istqb", "cka", "cks", "ckad",
  "terraform associate", "certification", "certificate", "certified",
  "professional certification", "licensed", "license",
]);

const LEADERSHIP_TERMS = new Set([
  "ledarskap", "ledarerfarenhet", "team lead", "teamlead", "tech lead",
  "personalledning", "personalansvar", "chef", "manager", "managing",
  "leadership", "leading teams", "leading a team", "mentoring", "coaching",
  "mentored", "coached", "leda", "lett", "ledde", "management experience",
  "people management", "team management",
]);

const SOFT_SKILL_TERMS = new Set([
  "samarbete", "samarbetsförmåga", "samarbetsvillig", "kommunikation",
  "kommunikativ", "problemlösning", "lösningsorienterad", "analytisk",
  "strukturerad", "självgående", "initiativtagande", "ansvarstagande",
  "flexibel", "noggrann", "engagerad", "nyfiken", "nyfikenhet", "lärande",
  "team player", "collaboration", "communication", "problem-solving",
  "problem solving", "analytical", "self-driven", "self-starter", "proactive",
  "structured", "detail-oriented", "ownership", "stakeholder", "stakeholders",
  "stakeholder management", "agile mindset", "curiosity", "empathy",
  "adaptable", "resilient", "autonomous", "collaborative", "communicative",
]);

const INDUSTRY_TERMS = new Set([
  "bank", "finans", "försäkring", "hälsa", "vård", "sjukvård", "telekom",
  "retail", "handel", "e-handel", "gaming", "media", "transport", "logistik",
  "energi", "tillverkning", "automotive", "fintech", "offentlig sektor",
  "myndighet", "banking", "finance", "insurance", "healthcare", "telecom",
  "e-commerce", "ecommerce", "logistics", "energy", "manufacturing",
  "public sector", "government", "gaming", "retail",
]);

const TRAVEL_TERMS = new Set([
  "resor", "travel", "tjänsteresor", "resande", "willing to travel",
  "resvana", "frequent travel", "resa",
]);

const DRIVER_TERMS = new Set([
  "körkort", "driving licence", "driver's license", "drivers license",
  "bilkörkort", "b-körkort", "körkort (b)", "driver's licence",
]);

const REQUIREMENT_HEADING_TERMS = new Set([
  "krav", "requirements", "qualifications", "erfarenhet", "skills", "meriterande",
  "vem du är", "who you are", "du har", "you have", "vi söker", "we are looking",
]);

const RESPONSIBILITY_HEADING_TERMS = new Set([
  "ansvar", "ansvarsområden", "responsibilities", "what you'll do",
  "what you will do", "vad du kommer", "rollen innebär", "du kommer att",
  "du kommer", "your role", "the role", "dina arbetsuppgifter", "key responsibilities",
]);

const SENIORITY_PATTERNS = [
  { level: "junior", label: "Junior", re: /\b(junior|juniortjänst|entry[- ]level|nyexaminerad|trainee)\b/i },
  { level: "mid", label: "Medior/Mid-level", re: /\b(medior|mid[- ]level|middle)\b/i },
  { level: "senior", label: "Senior", re: /\b(senior|sr\.?)\b/i },
  { level: "lead", label: "Lead", re: /\b(team[- ]?lead|tech[- ]?lead|lead developer|ledande)\b/i },
  { level: "staff", label: "Staff/Principal", re: /\b(staff|principal|distinguished)\b/i },
  { level: "manager", label: "Chef/Manager", re: /\b(engineering manager|manager|chef|avdelningschef|enhetschef)\b/i },
  { level: "architect", label: "Arkitekt", re: /\b(architect|arkitekt|lösningsarkitekt)\b/i },
];

const WORK_MODE_PATTERNS = [
  { mode: "remote", label: "Remote", re: /\b(remote|100% remote|fully remote|distans)\b/i },
  { mode: "hybrid", label: "Hybrid", re: /\b(hybrid|hybridarbete|2 dagar på kontoret|3 dagar på kontoret)\b/i },
  { mode: "on-site", label: "På plats", re: /\b(on[- ]site|on site|på plats|kontoret|office[- ]based|i stockholm|i göteborg)\b/i },
];

const EMPLOYMENT_TYPE_PATTERNS = [
  { type: "Heltid", re: /\b(heltid|full[- ]time|full time)\b/i },
  { type: "Deltid", re: /\b(deltid|part[- ]time|part time)\b/i },
  { type: "Tillsvidare", re: /\b(tillsvidare|permanent employment|fast anställning)\b/i },
  { type: "Visstid", re: /\b(visstid|temporary|vikariat)\b/i },
  { type: "Konsult", re: /\b(konsult|consultant|contractor|contract role)\b/i },
];

const REQUIREMENT_CUES = {
  required: [
    /\b(required|must|essential|mandatory|prerequisite)\b/i,
    /\b(krävs|krav|obligatorisk|obligatoriskt|nödvändig)\b/i,
    /vi söker dig som har/i,
    /we are looking for someone who has/i,
    /you (must|need to) have/i,
    /du (måste|behöver) ha/i,
    /minst \d+\s*års?\b/i,
    /\bminimum of \d+\s*years?\b/i,
    /\b\d+\s*\+?\s*years? of (experience|professional experience)\b/i,
    /\berfarenhet (av|från)(?![^\n]{0,50}(meriterande|önskvärt|preferred|nice to have))/i,
    /\b(kunskaper|färdigheter) (i|inom|in)\b(?!.{0,35}(plus|meriterande|önskvärt|preferred|nice to have))/i,
  ],
  preferred: [
    /\b(preferred|nice to have|desired|advantageous|bonus|plus)\b/i,
    /\b(meriterande|önskvärt|önskvärd|fördelaktig|gärna)\b/i,
    /\b(det är meriterande|it is a plus|we value)\b/i,
  ],
  optional: [
    /\b(optional|frivilligt|valfritt|valfri)\b/i,
    /\b(ej obligatorisk|not required|not mandatory)\b/i,
  ],
};

const SALARY_PATTERNS = [
  // 45 000 - 55 000 kr/mån, 60.000-70.000 SEK, 80k-95k, 55-65 kkr, €70.000
  /(\d[\d\s.,]{2,})\s*(?:-|–|till|to)\s*(\d[\d\s.,]{2,})\s*(k\s*kr|tkr|kkr|kr|sek|usd|eur|€)?\s*(\/|\s)?(mån|month|år|year|annum|per year|per annum|\/yr)?/i,
  /(\d[\d\s.,]{2,})\s*(k|t)\s*kr\s*\/\s*mån/i,
  /lön[:\s]*(\d[\d\s.,]{2,})/i,
  /salary[:\s]*(\d[\d\s.,]{2,})/i,
];

const COUNTRY_MAP = [
  { re: /\b(sverige|sweden|stockholm|göteborg|gothenburg|malmö|uppsala|lund|västerås|örebro|linköping|helsingborg|jönköping|umeå|sundsvall|borås|eskilstuna|gävle|halmstad)\b/i, country: "Sverige", code: "SE" },
  { re: /\b(norge|norway|oslo|bergen|trondheim|stavanger)\b/i, country: "Norge", code: "NO" },
  { re: /\b(danmark|denmark|copenhagen|københavn|aarhus)\b/i, country: "Danmark", code: "DK" },
  { re: /\b(finland|helsinki|helsingfors)\b/i, country: "Finland", code: "FI" },
  { re: /\b(uk|united kingdom|england|london|manchester|birmingham|edinburgh|glasgow)\b/i, country: "Storbritannien", code: "GB" },
  { re: /\b(usa|united states|america|new york|san francisco|seattle|austin|boston|chicago|los angeles|denver|new jersey)\b/i, country: "USA", code: "US" },
  { re: /\b(germany|tyskland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln)\b/i, country: "Tyskland", code: "DE" },
  { re: /\b(netherlands|holland|amsterdam|rotterdam|utrecht|the hague)\b/i, country: "Nederländerna", code: "NL" },
  { re: /\b(france|frankrike|paris|london)\b/i, country: "Frankrike", code: "FR" },
  { re: /\b(spain|spanien|madrid|barcelona)\b/i, country: "Spanien", code: "ES" },
  { re: /\b(italy|italien|milan|milano|rome|rom)\b/i, country: "Italien", code: "IT" },
  { re: /\b(poland|polen|warsaw|warszawa|krakow)\b/i, country: "Polen", code: "PL" },
  { re: /\b(ireland|irland|dublin)\b/i, country: "Irland", code: "IE" },
  { re: /\b(japan|tokyo)\b/i, country: "Japan", code: "JP" },
  { re: /\b(india|bengaluru|bangalore|mumbai)\b/i, country: "Indien", code: "IN" },
  { re: /\b(dubai|uae|förenade arabemiraten)\b/i, country: "Förenade Arabemiraten", code: "AE" },
];

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyRequirementText(text, heading = "") {
  const source = typeof text === "string" ? text : "";
  const h = (heading || "").toLowerCase();

  // Explicit overrides from heading context
  if (h.includes("meriterande") || h.includes("preferred") || h.includes("nice to have") || h.includes("plus")) {
    return { classification: "Preferred", reason: "Rubrik anger att detta är meriterande (preferred/nice to have)." };
  }

  if (REQUIREMENT_CUES.required.some((re) => re.test(source))) {
    return { classification: "Required", reason: "Annonsen markerar detta som ett krav (required/must/krävs)." };
  }
  if (REQUIREMENT_CUES.preferred.some((re) => re.test(source))) {
    return { classification: "Preferred", reason: "Annonsen markerar detta som meriterande (preferred/nice to have)." };
  }
  if (REQUIREMENT_CUES.optional.some((re) => re.test(source))) {
    return { classification: "Optional", reason: "Annonsen markerar detta som frivilligt (optional)." };
  }
  // Heading context as tiebreaker: bullets under a krav-rubrik are demands.
  if (h.includes("krav") || h.includes("requirements") || h.includes("qualifications") || h.includes("vem vi söker") || h.includes("what we're looking for")) {
    return { classification: "Required", reason: "Rubrik anger att detta är ett krav." };
  }
  return { classification: "Unclear", reason: "Annonsen anger inte tydligt om detta är ett krav, meriterande eller frivilligt." };
}

export const REQUIREMENT_CATEGORIES = new Set([
  "responsibilities", "technicalSkills", "softSkills", "languages", "education",
  "certifications", "leadership", "industryExperience", "travel", "driversLicense",
  "salary", "general",
]);

function categoryForLine(text, headingContext) {
  const source = text.toLowerCase();
  const heading = headingContext.toLowerCase();

  if (/ansvar|responsibilit|what you'|what you will|vad du kommer|rollen innebär|arbetsuppgifter/.test(heading)) {
    return "responsibilities";
  }
  if (LANG_TERMS.has(source) || [...LANG_TERMS].some((t) => source.includes(t))) return "languages";
  if (CERT_TERMS_SOME(source)) return "certifications";
  if (EDUCATION_SOME(source)) return "education";
  if (LEADERSHIP_SOME(source)) return "leadership";
  if (INDUSTRY_SOME(source)) return "industryExperience";
  if (TRAVEL_SOME(source)) return "travel";
  if (DRIVER_SOME(source)) return "driversLicense";
  if (SALARY_SOME(source)) return "salary";
  if (SOFT_SKILL_SOME(source)) return "softSkills";
  if (TECH_SOME(source)) return "technicalSkills";
  return "general";
}

// helper predicates (Set .has is O(1); substring checks for multiword terms)
const TECH_LIST = [...TECH_TERMS];
const LANG_LIST = [...LANG_TERMS];
const EDU_LIST = [...EDUCATION_TERMS];
const CERT_LIST = [...CERT_TERMS];
const LEAD_LIST = [...LEADERSHIP_TERMS];
const SOFT_LIST = [...SOFT_SKILL_TERMS];
const IND_LIST = [...INDUSTRY_TERMS];
const TRAVEL_LIST = [...TRAVEL_TERMS];
const DRIVER_LIST = [...DRIVER_TERMS];

function someContains(list, source) {
  return list.some((t) => t.length > 2 && source.includes(t));
}
const TECH_SOME = (s) => someContains(TECH_LIST, s);
const LANG_SOME = (s) => someContains(LANG_LIST, s);
const EDUCATION_SOME = (s) => someContains(EDU_LIST, s);
const CERT_TERMS_SOME = (s) => someContains(CERT_LIST, s);
const LEADERSHIP_SOME = (s) => someContains(LEAD_LIST, s);
const SOFT_SKILL_SOME = (s) => someContains(SOFT_LIST, s);
const INDUSTRY_SOME = (s) => someContains(IND_LIST, s);
const TRAVEL_SOME = (s) => someContains(TRAVEL_LIST, s);
const DRIVER_SOME = (s) => someContains(DRIVER_LIST, s);
const SALARY_SOME = (s) => /lön|salary|kr|sek|usd|eur|€|tkr|kkr/.test(s);

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

const CITY_OR_WORKMODE_RE =
  /\b(stockholm|göteborg|gothenburg|malmö|uppsala|lund|helsingborg|västerås|örebro|linköping|jönköping|norrköping|umeå|sundsvall|gävle|borås|eskilstuna|kalmar|halmstad|skövde|karlstad|växjö|london|berlin|munich|hamburg|amsterdam|rotterdam|paris|oslo|bergen|köpenhamn|copenhagen|helsinki|new york|san francisco|seattle|austin|boston|toronto|vancouver|sydney|melbourne|singapore|zürich|zurich|warsaw|dublin|barcelona|madrid|milan|stockholm)\b/i;

const COMPANY_SUFFIX_RE = /\b(ab|aktiebolag|inc\.?|corp\.?|gmbh|ltd\.?|group|oy|as|sa|company|organisat[io]n)\b/i;

function detectByLabel(text, labels) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(new RegExp(`(${labels.join("|")})\\s*[:|]\\s*(.+)`, "i"));
    if (m && m[2].trim()) return m[2].trim().slice(0, 120);
  }
  return null;
}

function detectHeadingValue(text, labels, max = 40) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (new RegExp(`^#{1,3}\\s*(${labels.join("|")})\\s*$`, "i").test(lines[i].trim())) {
      const next = lines[i + 1].trim();
      if (next && !next.startsWith("#") && !/^[-*•]/.test(next)) return next.slice(0, max);
    }
  }
  return null;
}

export function extractMetadata(text) {
  const source = typeof text === "string" ? text : "";
  const lines = source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const firstLines = lines.slice(0, 12);

  let jobTitle = detectByLabel(source, ["titel", "job title", "roll", "position", "tjänst", "jobbtitel", "befattning"])
    || detectHeadingValue(source, ["titel", "job title", "roll", "position"]);
  if (!jobTitle) {
    // First line usually holds the title (company often on line 2 or after "|").
    const candidate = (firstLines[0] || "").replace(/^#+\s*/, "").replace(/^\*\s*/, "").trim();
    if (candidate.length <= 90 && !/https?:\/\//.test(candidate) && !/^\d/.test(candidate)) {
      jobTitle = candidate;
    }
  }

  let company = detectByLabel(source, ["företag", "company", "arbetsgivare", "organisation"]);
  if (!company) {
    const withPipe = firstLines.find((l) => /\|/.test(l) && /(ab|aktiebolag|inc|corp|gmbh|ltd|group|sweden|stockholm|hiring)/i.test(l));
    if (withPipe) company = withPipe.split("|")[0].trim().slice(0, 120);
  }

  let location =
    detectByLabel(source, ["plats", "ort", "location", "stad", "arbetsplats"])
    || detectHeadingValue(source, ["plats", "ort", "location", "stad"]);

  // Line-based fallbacks right below the title (e.g. "Acme AB" / "Stockholm, Sverige (hybrid)").
  const isHeadingOrBullet = (l) => /^(#|>|\s*[-*•]|\s*\d+[.)])/.test(l);
  if (!company || !location) {
    for (const line of lines.slice(1, 8)) {
      if (line.length > 90 || isHeadingOrBullet(line) || /https?:\/\//.test(line)) continue;
      // "Acme Digital AB, Stockholm, Sweden" → company + location on the same line.
      if (!company && !location && /,/.test(line)) {
        const parts = line.split(",");
        const suffixIdx = parts.findIndex((p) => COMPANY_SUFFIX_RE.test(p));
        if (suffixIdx >= 0) {
          const comp = parts.slice(0, suffixIdx + 1).join(",").trim();
          const loc = parts.slice(suffixIdx + 1).join(",").trim();
          if (comp.length >= 2 && comp.length <= 90 && loc) {
            company = comp.slice(0, 120);
            location = loc.slice(0, 90);
            continue;
          }
        }
      }
      if (!location && (COUNTRY_MAP.some((e) => e.re.test(line)) || CITY_OR_WORKMODE_RE.test(line))) {
        location = line.slice(0, 90);
        continue;
      }
      if (!company && COMPANY_SUFFIX_RE.test(line) && !(COUNTRY_MAP.some((e) => e.re.test(line)) || CITY_OR_WORKMODE_RE.test(line))) {
        company = line.slice(0, 120);
        continue;
      }
      if (!company && /\|/.test(line)) {
        company = line.split("|")[0].trim().slice(0, 120);
      }
    }
  }

  let country = null;
  if (location) {
    for (const entry of COUNTRY_MAP) {
      if (entry.re.test(location)) {
        country = entry.country;
        break;
      }
    }
  }
  if (!country) {
    for (const entry of COUNTRY_MAP) {
      if (entry.re.test(source)) {
        country = entry.country;
        break;
      }
    }
  }

  let workMode = "okänd";
  for (const entry of WORK_MODE_PATTERNS) {
    if (entry.re.test(source)) {
      workMode = entry.mode;
      break;
    }
  }

  let employmentType = null;
  for (const entry of EMPLOYMENT_TYPE_PATTERNS) {
    if (entry.re.test(source)) {
      employmentType = entry.type;
      break;
    }
  }

  let seniority = null;
  for (const entry of SENIORITY_PATTERNS) {
    if (entry.re.test(source)) {
      seniority = { level: entry.level, label: entry.label };
      break;
    }
  }

  return { jobTitle, company, location, country, workMode, employmentType, seniority };
}

export function extractSalary(text) {
  const source = typeof text === "string" ? text : "";
  if (!/lön|salary|kr|sek|usd|eur|€|tkr|kkr|compensation/i.test(source)) return null;
  for (const re of SALARY_PATTERNS) {
    const m = source.match(re);
    if (m) {
      const clean = (v) => (v || "").replace(/[^\d.]/g, "");
      const min = clean(m[1]);
      const max = clean(m[2]) || min;
      const unitRaw = (m[3] || m[4] || "").toLowerCase();
      let currency = "SEK";
      if (/\$|usd/.test(m[0])) currency = "USD";
      else if (/€|eur/.test(m[0])) currency = "EUR";
      else if (/sek|kr/.test(m[0]) || unitRaw.includes("kr")) currency = "SEK";
      let period = /mån|month/.test(m[0]) ? "månad" : /år|year|annum|yr/.test(m[0]) ? "år" : null;
      if (!period && unitRaw.includes("kr") && /\d{2}\s*k\s*kr/.test(m[0])) period = "månad";
      if (!period) period = "ospecificerad";
      return { currency, min: Number(min), max: Number(max), period, raw: m[0].replace(/\s+/g, " ").trim().slice(0, 120) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Requirement extraction
// ---------------------------------------------------------------------------

function isBullet(line) {
  return /^[-*•·▪◦]|\d+[.)]|^[A-ZÅÄÖ0-9]{1,3}[.)]\s/.test(line.trim());
}

function stripBullet(line) {
  return line.trim().replace(/^[-*•·▪◦]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
}

// Benefit/offer intro phrases — such lines are perks, not job requirements.
const BENEFIT_INTRO_RE =
  /^(vi (kan |kommer att |vill )?erbjud(er|a)|vi tillhandahåller|vi står för|what we offer|we (can )?offer|we provide|we are proud to offer|you('ll| will) get|you will receive|du får|du kommer att få|förmåner|benefits|perks)/i;

export function extractRequirements(text) {
  const source = typeof text === "string" ? text : "";
  const lines = source.split(/\r?\n/);
  const requirements = [];
  let heading = "";

  const push = (raw, category) => {
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (cleaned.length < 3) return;
    if (cleaned.length > 400) return;
    // Benefit/offer lines ("Vi erbjuder konkurrenskraftig lön…") are not requirements.
    if (BENEFIT_INTRO_RE.test(cleaned)) return;
    const { classification, reason } = classifyRequirementText(cleaned, heading);
    const cat = category || categoryForLine(cleaned, heading);
    const finalCat = cat === "responsibilities" ? "responsibilities" : cat;
    requirements.push({
      id: `r${requirements.length + 1}`,
      text: cleaned,
      category: finalCat,
      classification: finalCat === "responsibilities" ? "Required" : classification,
      reason,
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Heading detection
    if (/^#{1,3}\s+/.test(line) || /^[A-ZÅÄÖ][A-ZÅÄÖ\s]{3,}:?$/.test(line) || /^(ansvar|krav|meriterande|om dig|vem du är|requirements|responsibilities|qualifications|about you|what you'll do)[\s:]*$/i.test(line)) {
      heading = line.replace(/^#+\s*/, "").replace(/:$/, "").trim();
      continue;
    }

    if (isBullet(line)) {
      const content = stripBullet(line);
      const isReqHeading = REQUIREMENT_HEADING_TERMS_SOME(heading);
      const isRespHeading = RESPONSIBILITY_HEADING_TERMS_SOME(heading);
      if (isRespHeading) push(content, "responsibilities");
      else if (isReqHeading) push(content, null);
      else if (isRespHeading === false && isReqHeading) push(content, null);
      else if (content.length <= 160) push(content, null);
      continue;
    }

    // Non-bullet lines under requirement headings
    if (REQUIREMENT_HEADING_TERMS_SOME(heading) || RESPONSIBILITY_HEADING_TERMS_SOME(heading)) {
      if (line.length > 6 && line.length <= 260) push(line, RESPONSIBILITY_HEADING_TERMS_SOME(heading) ? "responsibilities" : null);
    }
  }

  return requirements.slice(0, 80);
}

const REQ_HEAD_LIST = [...REQUIREMENT_HEADING_TERMS];
const RESP_HEAD_LIST = [...RESPONSIBILITY_HEADING_TERMS];
const REQUIREMENT_HEADING_TERMS_SOME = (h) => REQ_HEAD_LIST.some((t) => h.toLowerCase().includes(t));
const RESPONSIBILITY_HEADING_TERMS_SOME = (h) => RESP_HEAD_LIST.some((t) => h.toLowerCase().includes(t));

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary-aware presence check: "aws" must not match inside "flaws",
// "go" must not match inside "goda", etc.
function termPresent(lower, term) {
  const t = String(term).toLowerCase();
  if (!t) return false;
  const re = new RegExp(`(^|[^a-z0-9åäö])${escapeRe(t)}([^a-z0-9åäö]|$)`, "i");
  return re.test(lower);
}

export function extractKeywords(text, analysis) {
  const source = typeof text === "string" ? text : "";
  const lower = source.toLowerCase();
  const keywords = new Set();

  for (const term of TECH_LIST) {
    if (termPresent(lower, term)) keywords.add(term);
  }
  for (const term of LANG_LIST) {
    if (termPresent(lower, term)) keywords.add(term);
  }
  if (analysis) {
    for (const req of analysis.requirements || []) {
      const tokens = req.text.toLowerCase().split(/[^a-zåäö0-9+#.]+/i).filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
      for (const token of tokens) {
        if (keywords.size < 40) keywords.add(token);
      }
    }
  }
  return [...keywords].slice(0, 40);
}

// ---------------------------------------------------------------------------
// Profile evidence
// ---------------------------------------------------------------------------

export function buildProfileEvidence(profile, cvText, answers = {}) {
  const cv = typeof cvText === "string" ? cvText : "";
  const cvLower = cv.toLowerCase();
  const profileText = [
    profile.fullName, profile.headline, profile.summary, profile.location,
    ...(profile.targetRoles || []), ...(profile.skills || []), ...(profile.workModes || []),
  ].filter(Boolean).join("\n").toLowerCase();

  const answerText = Object.values(answers || {}).filter(Boolean).join("\n").toLowerCase();

  return {
    profile,
    cv,
    cvLower,
    profileText,
    answerText,
    location: profile.location || "",
    workModes: profile.workModes || [],
    skills: (profile.skills || []).map((s) => s.toLowerCase().trim()).filter(Boolean),
    targetRoles: profile.targetRoles || [],
    headline: profile.headline || "",
    summary: profile.summary || "",
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const SYNONYMS = [
  ["k8s", "kubernetes"],
  ["reactjs", "react"],
  ["nodejs", "node"],
  ["ts", "typescript"],
  ["js", "javascript"],
  ["ml", "machine learning"],
  ["gcp", "google cloud"],
  ["aws", "amazon web services"],
  ["cicd", "ci/cd"],
  ["postgres", "postgresql"],
  ["vuejs", "vue"],
  ["nextjs", "next.js"],
  ["etl", "data engineering"],
  ["llms", "llm"],
  ["pbi", "power bi"],
];

const TERM_BLOCKLIST = new Set([
  "experience", "erfarenhet", "role", "roll", "work", "years", "year", "team",
  "english", "svenska", "swedish", "engelska", "ability", "förmåga", "skills",
  "skill", "knowledge", "kunskaper", "good", "strong", "excellent", "solid",
  "relevant", "previous", "documented", "proven", "minst", "minimum",
  "required", "preferred", "meriterande", "plus", "including", "such", "etc",
]);

function keyTerms(text) {
  const lower = text.toLowerCase();
  const terms = new Set();
  for (const [alias, canonical] of SYNONYMS) {
    const re = new RegExp(`\\b${alias.replace(/[.+]/g, "\\$&")}\\b`, "i");
    if (re.test(lower)) terms.add(canonical);
  }
  for (const list of [TECH_LIST, LANG_LIST, EDU_LIST, CERT_LIST, LEAD_LIST, SOFT_LIST, IND_LIST, TRAVEL_LIST, DRIVER_LIST]) {
    for (const term of list) {
      if (termPresent(lower, term)) terms.add(term);
    }
  }
  const tokens = lower.split(/[^a-zåäö0-9+#./-]+/).filter((t) => t.length >= 4 && !STOP_WORDS.has(t) && !TERM_BLOCKLIST.has(t));
  for (const token of tokens.slice(0, 12)) terms.add(token);
  return [...terms];
}

function findEvidence(term, evidence) {
  const t = term.toLowerCase();
  // 1) explicit CV evidence
  if (evidence.cvLower.includes(t)) {
    const idx = evidence.cvLower.indexOf(t);
    const snippet = evidence.cv.slice(Math.max(0, idx - 60), idx + t.length + 60).replace(/\s+/g, " ").trim();
    return { status: "verified", source: "cv", snippet };
  }
  // 2) user-answered evidence (attested by the user, not yet in CV)
  if (evidence.answerText.includes(t)) {
    return { status: "potential", source: "answer", snippet: `Bekräftat av dig som svar: “…${t}…”` };
  }
  // 3) profile-attested (master profile declares it)
  if (evidence.profileText.includes(t)) {
    return { status: "potential", source: "profile", snippet: `Nämns i masterprofilen (${t}) men saknar bevis i CV:t.` };
  }
  // 4) fuzzy/transferable via known aliases
  for (const [alias, canonical] of SYNONYMS) {
    if (term === canonical || t === canonical) {
      if (evidence.cvLower.includes(alias)) {
        const idx = evidence.cvLower.indexOf(alias);
        const snippet = evidence.cv.slice(Math.max(0, idx - 60), idx + alias.length + 60).replace(/\s+/g, " ").trim();
        return { status: "transferable", source: "cv", matchedTerm: alias, snippet };
      }
    }
  }
  // stem-prefix transferable (e.g. req "kubernetes" vs cv "kubernetes administration")
  if (t.length >= 6 && evidence.cvLower.includes(t)) {
    // already covered by (1)
  }
  return null;
}

export function matchRequirement(requirement, evidence) {
  const terms = keyTerms(requirement.text);
  const results = [];
  for (const term of terms) {
    const found = findEvidence(term, evidence);
    if (found) results.push({ term, ...found });
  }

  const verified = results.filter((r) => r.status === "verified");
  const potential = results.filter((r) => r.status === "potential");
  const transferable = results.filter((r) => r.status === "transferable");

  let status;
  if (verified.length > 0) status = "verified";
  else if (potential.length > 0) status = "potential";
  else if (transferable.length > 0) status = "transferable";
  else status = requirement.classification === "Required" ? "missing-evidence" : "missing-evidence";

  const evidenceTerms = [...verified, ...potential, ...transferable];
  const explanation = buildExplanation(requirement, status, evidenceTerms);

  return {
    id: requirement.id,
    text: requirement.text,
    category: requirement.category,
    classification: requirement.classification,
    status,
    confidence: confidenceFor(status, evidenceTerms),
    explanation,
    evidence: evidenceTerms.slice(0, 6),
    terms,
  };
}

function confidenceFor(status, evidenceTerms) {
  if (status === "verified") return evidenceTerms.length >= 2 ? "high" : "medium";
  if (status === "potential") return "medium";
  if (status === "transferable") return "low";
  return "low";
}

function buildExplanation(requirement, status, evidenceTerms) {
  const label = requirement.text.length > 90 ? requirement.text.slice(0, 90) + "…" : requirement.text;
  switch (status) {
    case "verified": {
      const bits = evidenceTerms.slice(0, 3).map((e) => `“${e.term}” (i CV${e.source === "answer" ? " / svar" : ""})`);
      return `Verifierat: ${bits.join(", ")} matchar direkt i ditt CV.`;
    }
    case "potential": {
      const e = evidenceTerms[0];
      if (e?.source === "answer") return `Bekräftat av dig: “${e.term}” (ditt svar). Lägg gärna in det i CV:t med konkreta exempel.`;
      return `Potentiell match: “${evidenceTerms[0]?.term}” finns i din masterprofil men saknar bevis i CV:t.`;
    }
    case "transferable":
      return `Överförbar: “${evidenceTerms[0]?.term}” matchar “${evidenceTerms[0]?.matchedTerm}” i CV:t — närliggande men inte exakt samma term.`;
    default:
      return `Inga bevis hittade för “${label}”. AI:n hittar inte på erfarenhet — bevis saknas i CV och profil.`;
  }
}

// ---------------------------------------------------------------------------
// Overall match
// ---------------------------------------------------------------------------

function seniorityScore(job, evidence) {
  if (!job || !job.seniority) return { score: 0.5, reason: "Annonsens senioritetsnivå är otydlig." };
  const text = `${evidence.headline} ${evidence.targetRoles.join(" ")} ${evidence.cvLower}`.toLowerCase();
  const levels = ["junior", "mid", "senior", "lead", "staff", "manager", "architect"];
  const jobIdx = levels.indexOf(job.seniority.level);
  let found = -1;
  for (let i = levels.length - 1; i >= 0; i--) {
    if (text.includes(levels[i])) { found = i; break; }
  }
  if (found < 0) return { score: 0.5, reason: "Profilens senioritetsnivå går inte att fastställa från CV/profil." };
  const diff = Math.abs(found - jobIdx);
  if (diff === 0) return { score: 1, reason: `Nivån matchar: ${job.seniority.label}.` };
  if (found > jobIdx) return { score: 0.9, reason: `Din profil ligger över annonsens nivå (${job.seniority.label}) — en tillgång, men kontrollera att rollen inte är för snäv.` };
  if (diff === 1) return { score: 0.75, reason: `Nivån ligger nära: ${job.seniority.label}.` };
  return { score: 0.3, reason: `Nivåskillnad: annonsen söker ${job.seniority.label} och profilen ligger lägre.` };
}

function locationScore(job, evidence) {
  if (!evidence.location && !evidence.profile.location) return { score: 0.5, reason: "Profilens ort är inte angiven." };
  const profileLoc = evidence.location.toLowerCase();
  const jobLoc = (job.location || "").toLowerCase();
  const jobCountry = (job.country || "").toLowerCase();
  if (job.workMode === "remote") return { score: 1, reason: "Jobbet är 100 % remote — ort spelar ingen roll." };
  if (jobLoc && profileLoc && (profileLoc.includes(jobLoc) || jobLoc.includes(profileLoc))) {
    return { score: 1, reason: `Ort matchar: ${job.location}.` };
  }
  const modes = (evidence.workModes || []).join(" ").toLowerCase();
  if (job.workMode === "hybrid" && /hybrid|remote|distans/.test(modes)) {
    return { score: 0.75, reason: "Hybrid-jobb och profilen tillåter flexibelt arbete." };
  }
  if (job.workMode === "on-site" && /on-site|på plats/.test(modes)) {
    return { score: 0.9, reason: "Jobbet kräver närvaro och profilen tillåter det." };
  }
  if (jobCountry && profileLoc.includes(jobCountry)) return { score: 0.9, reason: `Samma land: ${job.country}.` };
  if (jobLoc && !jobCountry) return { score: 0.4, reason: `Ort okänd i relation till profilen: ${job.location}.` };
  return { score: 0.4, reason: `Ort/arbetssätt kräver bedömning: ${job.location || "ej angiven"} vs ${evidence.location || "ej angiven"}.` };
}

function workModeScore(job, evidence) {
  const modes = (evidence.workModes || []).join(" ").toLowerCase();
  if (!job || !job.workMode || job.workMode === "okänd") return { score: 0.5, reason: "Annonsens arbetssätt är otydligt." };
  const map = { remote: /remote|distans/, hybrid: /hybrid|remote|distans/, "on-site": /on-site|på plats|kontor/ };
  const re = map[job.workMode];
  if (re && re.test(modes)) return { score: 1, reason: `Arbetssätt matchar: ${job.workMode}.` };
  if (re && !re.test(modes)) return { score: 0.25, reason: `Profilen anger inget som bekräftar ${job.workMode}-arbete.` };
  return { score: 0.5, reason: "Arbetssätt ej jämförbart." };
}

export function overallVerdict(requirementMatches, job, evidence) {
  const reqs = requirementMatches.filter((m) => m.classification !== "responsibilities" || m.status !== "missing-evidence");
  const weighted = requirementMatches
    .filter((m) => m.category !== "responsibilities")
    .map((m) => {
      const w = m.classification === "Required" ? 1 : m.classification === "Preferred" ? 0.6 : m.classification === "Optional" ? 0.3 : 0.5;
      const s = m.status === "verified" ? 1 : m.status === "potential" ? 0.6 : m.status === "transferable" ? 0.35 : 0;
      return { m, w, s };
    });

  const totalWeight = weighted.reduce((acc, x) => acc + x.w, 0) || 1;
  const coverage = weighted.reduce((acc, x) => acc + x.w * x.s, 0) / totalWeight;

  const seniority = seniorityScore(job, evidence);
  const location = locationScore(job, evidence);
  const workMode = workModeScore(job, evidence);

  let score = coverage * 0.7 + seniority.score * 0.12 + location.score * 0.1 + workMode.score * 0.08;

  const riskFactors = [];
  const requiredGaps = requirementMatches.filter((m) => m.classification === "Required" && (m.status === "missing-evidence" || m.status === "transferable"));
  for (const gap of requiredGaps.slice(0, 5)) {
    riskFactors.push(`Krav utan bevis: “${gap.text.length > 60 ? gap.text.slice(0, 60) + "…" : gap.text}”`);
  }
  if (seniority.score <= 0.3) riskFactors.push(seniority.reason);
  if (location.score <= 0.4) riskFactors.push(location.reason);
  if (workMode.score <= 0.25) riskFactors.push(workMode.reason);
  if (requiredGaps.length >= 4) score = Math.max(0, score - 0.1);

  let label;
  if (score >= 0.8) label = "Excellent Match";
  else if (score >= 0.6) label = "Strong Match";
  else if (score >= 0.4) label = "Partial Match";
  else label = "Weak Match";

  return {
    label,
    score: Math.round(score * 100),
    coverage: Math.round(coverage * 100),
    seniority,
    location,
    workMode,
    riskFactors: [...new Set(riskFactors)].slice(0, 8),
    reasons: [
      `${Math.round(coverage * 100)} % av vägda krav täcks av bevis (CV + profil).`,
      seniority.reason,
      location.reason,
      workMode.reason,
    ],
  };
}

// ---------------------------------------------------------------------------
// Gap analysis + questions
// ---------------------------------------------------------------------------

export function buildGapAnalysis(requirementMatches, verdict) {
  const verified = requirementMatches.filter((m) => m.status === "verified");
  const potential = requirementMatches.filter((m) => m.status === "potential");
  const transferable = requirementMatches.filter((m) => m.status === "transferable");
  const missingEvidence = requirementMatches.filter((m) => m.status === "missing-evidence");
  const gaps = requirementMatches
    .filter((m) => m.classification === "Required" && (m.status === "missing-evidence" || m.status === "transferable"))
    .map((m) => ({
      ...m,
      recommendedAction:
        m.status === "transferable"
          ? `Omformulera “${m.text.length > 70 ? m.text.slice(0, 70) + "…" : m.text}” med annonsens exakta term för tydligare match.`
          : `Lägg till bevis i CV:t för: “${m.text.length > 70 ? m.text.slice(0, 70) + "…" : m.text}” (krav utan verifierat bevis).`,
    }));

  const questions = [];
  for (const req of missingEvidence.slice(0, 12)) {
    questions.push({
      id: `q-${req.id}`,
      requirementId: req.id,
      question: `Har du erfarenhet av “${req.text.length > 80 ? req.text.slice(0, 80) + "…" : req.text}”? Om ja — var i CV:t står det, eller vill du lägga till det?`,
      reason: `Annonsen kräver/nämner detta men varken CV:t eller masterprofilen innehåller bevis.`,
    });
  }
  if (verdict.location && verdict.location.score <= 0.4) {
    questions.push({
      id: "q-location",
      requirementId: null,
      question: `Jobbet ligger på “${verdict.location.reason.split(":")[1] || "en ort"}” — är du beredd att arbeta där eller flytta?`,
      reason: "Ort/arbetssätt kan inte bekräftas mot profilen.",
    });
  }
  if (verdict.workMode && verdict.workMode.score <= 0.25) {
    const wmMode = (verdict.workMode.reason.match(/bekräftar\s+([a-zåäö-]+)-arbete/) || [])[1];
    questions.push({
      id: "q-workmode",
      requirementId: null,
      question: `Jobbet anger arbetssättet “${wmMode || "som anges i annonsen"}” — stämmer det med hur du vill arbeta?`,
      reason: "Profilen anger inget bekräftat arbetssätt.",
    });
  }
  if (verdict.seniority && verdict.seniority.score <= 0.3) {
    questions.push({
      id: "q-seniority",
      requirementId: null,
      question: verdict.seniority.reason,
      reason: "Senioritetsnivån kan inte bekräftas från CV/profil.",
    });
  }

  return {
    verified,
    potential,
    transferable,
    missingEvidence,
    gaps,
    questions,
  };
}

export function recommendedActions(gapAnalysis, verdict) {
  const actions = [];
  for (const g of gapAnalysis.gaps.slice(0, 6)) {
    actions.push(`Lägg till bevis i CV:t för: “${g.text.length > 70 ? g.text.slice(0, 70) + "…" : g.text}” (krav utan verifierat bevis).`);
  }
  for (const m of gapAnalysis.potential.slice(0, 4)) {
    actions.push(`Flytta “${m.text.length > 60 ? m.text.slice(0, 60) + "…" : m.text}” från profil till CV:t med konkreta exempel.`);
  }
  for (const t of gapAnalysis.transferable.slice(0, 4)) {
    actions.push(`Omformulera “${t.text.length > 60 ? t.text.slice(0, 60) + "…" : t.text}” med annonsens exakta term för tydligare match.`);
  }
  if (gapAnalysis.questions.length > 0) {
    actions.push(`Besvara ${gapAnalysis.questions.length} fråg${gapAnalysis.questions.length > 1 ? "or" : "a"} som CareerPilot AI behöver svar på (se fliken Gap-analys).`);
  }
  if (verdict.riskFactors.length > 0) {
    actions.push("Granska riskfaktorerna innan du bestämmer dig för att söka tjänsten.");
  }
  return actions.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Top-level analysis
// ---------------------------------------------------------------------------

export function analyzeJobText(text) {
  const source = typeof text === "string" ? text : "";
  const trimmed = source.replace(/\r\n/g, "\n").trim();
  if (!trimmed) throw new Error("Ingen annonstext att analysera.");
  if (trimmed.length < 40) throw new Error("Annonstexten verkar ofullständig (minst 40 tecken).");

  const metadata = extractMetadata(trimmed);
  const allRequirements = extractRequirements(trimmed);
  // Responsibilities are duties, not demands — keep them separate so the
  // match engine never scores them as requirements.
  const responsibilities = allRequirements
    .filter((r) => r.category === "responsibilities")
    .map((r) => ({ id: r.id, text: r.text, category: "responsibilities" }));
  const requirements = allRequirements.filter((r) => r.category !== "responsibilities");
  const salary = extractSalary(trimmed);
  const analysis = {
    metadata,
    requirements,
    responsibilities,
    salary,
    keywords: [],
    sourceTextLength: trimmed.length,
    analyzedAt: null, // set by the store/route (pure module keeps no clock side effects)
  };
  analysis.keywords = extractKeywords(trimmed, analysis);
  return analysis;
}

export function matchAnalysis(analysis, evidence) {
  const requirementMatches = (analysis.requirements || []).map((req) => matchRequirement(req, evidence));
  const verdict = overallVerdict(requirementMatches, analysis.metadata, evidence);
  const gaps = buildGapAnalysis(requirementMatches, verdict);
  const actions = recommendedActions(gaps, verdict);
  return {
    verdict,
    requirementMatches,
    gaps,
    recommendedActions: actions,
    generatedAt: null, // set by the caller (pure module keeps no clock)
  };
}

export function summarizeAnalysis(analysis, report, id) {
  const m = analysis.metadata || {};
  return {
    id,
    jobTitle: m.jobTitle || "Namnlös annons",
    company: m.company || null,
    location: m.location || null,
    country: m.country || null,
    workMode: m.workMode || "okänd",
    employmentType: m.employmentType || null,
    seniority: m.seniority ? m.seniority.label : null,
    salary: analysis.salary ? `${analysis.salary.raw}` : null,
    requirementCount: (analysis.requirements || []).length,
    verdict: report ? report.verdict.label : null,
    score: report ? report.verdict.score : null,
    analyzedAt: analysis.analyzedAt || null,
  };
}
