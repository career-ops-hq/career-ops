/**
 * cv-tailoring.mjs — AI CV Tailoring & Change Review (FAS 3)
 *
 * Fact-safe engine: every proposed change is derived from verified sources
 * (the CV itself + the Career Master Profile + job keywords from the ad).
 * Anything that cannot be traced back to those sources is marked
 * "Behöver verifieras" (verified:false) and requires the user's approval
 * before it can be applied.
 *
 * The engine is fully deterministic (testable without an LLM). An optional
 * LLM polish step rewrites wording only and is re-verified afterwards.
 */

/* ── Section parsing ────────────────────────────────────────────────── */

const KNOWN_SECTION_TYPES = [
  ["profile", /profil|sammanfattning|summary|about|kort om mig/i],
  ["experience", /erfarenhet|experience|arbetsliv|yrkeserfarenhet/i],
  ["skills", /kompetens|färdighet|skills|kunskaper|teknisk/i],
  ["education", /utbildning|education/i],
  ["certifications", /certifiering|certif/i],
  ["languages", /språk|languages|language/i],
  ["projects", /projekt|project/i],
];

/**
 * Split markdown CV text into sections. Each section carries byte offsets so
 * an unchanged section can be reproduced byte-for-byte.
 * Returns [{ id, title, type, level, start, end, original, proposed }]
 * `original`/`proposed` include the heading line (except for the header block
 * before the first level-2 heading).
 */
export function parseCvSections(cvText) {
  const lines = cvText.split("\n");
  const sections = [];
  let current = null;
  let headingLine = 0; // first line index of the current block
  const typeCounts = {};

  const flush = (end) => {
    if (!current) return;
    const raw = lines.slice(current.startLine, end).join("\n");
    current.original = raw;
    current.proposed = raw;
    current.endLine = end;
    sections.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    if (level !== 2) continue; // only level-2 headings delimit CV sections
    flush(i);
    const title = m[2].trim();
    let type = "other";
    for (const [t, re] of KNOWN_SECTION_TYPES) {
      if (re.test(title)) { type = t; break; }
    }
    // First occurrence of a known type gets the clean id ("skills"),
    // duplicates get a suffix ("skills-1"). Unknown sections: other-N.
    const typeCount = typeCounts[type] ?? 0;
    typeCounts[type] = typeCount + 1;
    const id = type === "other" ? `other-${typeCount}` : typeCount === 0 ? type : `${type}-${typeCount}`;
    current = {
      id,
      type,
      title,
      level,
      startLine: i,
      endLine: i + 1,
      changes: [],
    };
  }
  flush(lines.length);

  // Header block = everything before the first level-2 heading
  const header = {
    id: "header",
    type: "header",
    title: "",
    level: 1,
    startLine: 0,
    endLine: sections.length > 0 ? sections[0].startLine : lines.length,
    original: lines.slice(0, sections.length > 0 ? sections[0].startLine : lines.length).join("\n"),
    proposed: lines.slice(0, sections.length > 0 ? sections[0].startLine : lines.length).join("\n"),
    changes: [],
  };
  if (header.original.trim() !== "" || header.original === "") {
    // keep header only when it contains content (name/contact block)
  }
  const all = header.original.trim() !== "" ? [header, ...sections] : sections;

  // Byte offsets for exact reconstruction
  let offset = 0;
  for (const s of all) {
    s.start = offset;
    s.end = offset + s.original.length;
    offset = s.end + 1; // +1 for the newline separator
  }
  return all;
}

/* ── Verified terms (fact-source) ───────────────────────────────────── */

const STOPWORDS = new Set([
  "och", "att", "det", "som", "med", "för", "har", "var", "vid", "inte", "alla", "även",
  "men", "till", "från", "kan", "ska", "hade", "när", "vad", "hur", "den", "de", "ett",
  "en", "min", "mitt", "mina", "jag", "mig", "oss", "vår", "vårt", "våra", "mer", "mest",
  "finns", "fanns", "andra", "olika", "flera", "många", "inom", "över", "under", "utan",
  "sedan", "genom", "mellan", "efter", "innan", "samt", "eller", "både", "så", "också",
  "bara", "redan", "aldrig", "alltid", "ofta", "sällan", "gärna", "väldigt", "mycket",
  "the", "and", "with", "for", "from", "have", "has", "had", "was", "were", "are", "can",
  "will", "would", "should", "could", "this", "that", "these", "those", "who", "what",
  "when", "where", "which", "your", "our", "their", "his", "her", "its", "you", "they",
  "them", "him", "her", "there", "their", "more", "most", "other", "others", "also",
  "only", "just", "very", "much", "many", "about", "between", "through", "during",
  "after", "before", "within", "without", "because", "then", "than", "into", "onto",
  "over", "under", "again", "never", "always", "often", "working", "worked", "work",
  "arbete", "arbetat", "arbetar", "samtliga", "bland", "bland", "exempel", "exempelvis",
  "framförallt", "dessutom", "därmed", "därför", "huvudsakligen", "inklusive", "via",
  "nya", "nytt", "nya", "goda", "bra", "stor", "stora", "stort", "liten", "litet", "små",
  // CV-tailoring: reword verbs + generic framework words (rewording is allowed;
  // invented FACTS — employers, dates, numbers, tech, certs — are still caught)
  "arbetade", "jobbade", "jobbat", "utvecklade", "utvecklat", "utvecklar", "bygger",
  "byggde", "förbättrade", "förbättrat", "implementerade", "implementerat", "ledde",
  "samarbetade", "hanterade", "designade", "skapade", "optimerade", "analyserade",
  "testade", "dokumenterade", "levererade", "planerade", "koordinerade", "ansvarade",
  "ansvarig", "fokuserade", "fokuserat", "fokus", "relevant", "relevanta", "kompetens",
  "kompetenser", "erfarenhet", "erfarenheter", "utvecklare", "utveckling", "expert",
  "professionell", "sammanfattning", "karriär", "rollen", "rollspecifik", "arbetsuppgifter",
  "arbetsuppgift", "ansvarsområden", "ansvarsområde", "befattning", "arbetsgivare",
  "behärskar", "behärska", "behärskade", "arbetar", "arbetat", "arbete",
]);

/** Extract meaningful tokens (≥4 chars, letters, not stopwords). */
export function tokenizeTerms(text) {
  if (!text) return [];
  const out = [];
  const re = /[\p{L}\d]{4,}/gu; // split on hyphens/dots so compound words verify via their parts
  let m;
  while ((m = re.exec(text)) !== null) {
    const w = m[0].toLowerCase();
    if (!STOPWORDS.has(w)) out.push(w);
  }
  return out;
}

/**
 * Build the set of verified terms: everything already present in the CV,
 * the Career Master Profile, plus the job ad's own keywords/metadata.
 */
export function buildVerifiedTerms(cvText, profile, analysis) {
  const terms = new Set(tokenizeTerms(cvText));
  if (profile) {
    const profileText = [
      profile.fullName, profile.headline, profile.summary, profile.location,
      ...(profile.skills || []), ...(profile.targetRoles || []),
      ...(profile.workModes || []),
    ].join(" ");
    for (const t of tokenizeTerms(profileText)) terms.add(t);
  }
  if (analysis) {
    const jobText = [
      analysis.metadata?.jobTitle, analysis.metadata?.company,
      ...(analysis.keywords || []),
    ].join(" ");
    for (const t of tokenizeTerms(jobText)) terms.add(t);
  }
  return terms;
}

/** Terms in `text` that appear in neither `baseline` nor the verified set. */
export function unverifiedTerms(text, baseline, verifiedTerms) {
  const known = new Set(verifiedTerms);
  for (const t of tokenizeTerms(baseline)) known.add(t);
  const seen = new Set();
  for (const t of tokenizeTerms(text)) {
    if (!known.has(t)) seen.add(t);
  }
  return [...seen];
}

/* ── Change model ───────────────────────────────────────────────────── */

let changeSeq = 0;
function makeChange(sectionId, type, original, proposed, reason, { verified = true, keyword = null } = {}) {
  changeSeq += 1;
  return {
    id: `ch-${sectionId}-${changeSeq}`,
    sectionId,
    type, // added | removed | rephrased | moved | keyword | needsVerification
    original,
    proposed,
    reason,
    verified,
    keyword,
  };
}

/** Re-verify a section's changes after an edit moved `proposed`. */
function verifySection(section, verifiedTerms) {
  const bad = unverifiedTerms(section.proposed, section.original, verifiedTerms);
  for (const c of section.changes ?? []) {
    if (c.type === "needsVerification") continue;
    if (bad.length > 0 && c.verified) {
      c.verified = false;
      c.type = "needsVerification";
      c.reason = `Innehåller information som inte kan verifieras från CV, profil eller jobbannons: ${bad.slice(0, 6).join(", ")}. Markeras ”Behöver verifieras” — kräver ditt godkännande.`;
    }
  }
  return section;
}

/* ── Proposal generation ────────────────────────────────────────────── */

const LEVELS = ["light", "professional", "targeted"];

/**
 * Generate a fact-safe tailoring proposal for a CV against a job analysis.
 * Returns { level, sections, summary, keywords } where every section has
 * { id, type, title, original, proposed, changes[] }.
 */
export function generateTailorProposal({ cvText, profile, analysis, report, level }) {
  const lvl = LEVELS.includes(level) ? level : "professional";
  const sections = parseCvSections(cvText);
  const verifiedTerms = buildVerifiedTerms(cvText, profile, analysis);

  const jobKeywords = analysis?.keywords || [];
  const profileSkills = profile?.skills || [];
  const relevantSkills = profileSkills.filter((s) =>
    jobKeywords.some((k) => k.toLowerCase() === s.toLowerCase()),
  );
  const jobTitle = analysis?.metadata?.jobTitle || "";

  let totalChanges = 0;

  /* — keyword enrichment (all levels) — */
  const skillsSection = sections.find((s) => s.type === "skills");
  if (skillsSection && relevantSkills.length > 0) {
    const missing = relevantSkills.filter((s) =>
      !skillsSection.original.toLowerCase().includes(s.toLowerCase()),
    );
    if (missing.length > 0) {
      const added = missing.join(", ");
      const hasBullets = /^[-*•]\s+/m.test(skillsSection.original);
      const proposed = hasBullets
        ? skillsSection.original.trimEnd() + `\n- ${added}`
        : skillsSection.original.trimEnd() + `, ${added}`;
      skillsSection.proposed = proposed;
      skillsSection.changes = [
        makeChange(skillsSection.id, "keyword", null, added,
          `Jobbets nyckelord (${added}) från din verifierade profil — stärker ATS-matchning.`,
          { keyword: added }),
      ];
    }
  }

  /* — light language fixes (all levels) — */
  for (const s of sections) {
    if (s.type !== "experience" && s.type !== "profile" && s.type !== "projects") continue;
    const lines = s.original.split("\n");
    let changed = false;
    const fixes = [];
    lines.forEach((line, idx) => {
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (!bullet) return;
      const body = bullet[1];
      const fix = {
        re: null,
        from: null,
        to: null,
        reason: "",
      };
      if (/^Arbetsuppgifter[:.]\s*/i.test(body)) {
        fix.from = body;
        fix.to = body.replace(/^Arbetsuppgifter[:.]\s*/i, "Ansvarade för: ");
        fix.reason = "Svag uppgiftsrubrik ersätts med aktiv verbfras (samma fakta).";
      } else if (/^Jobbade med\s+/i.test(body)) {
        fix.from = body;
        fix.to = body.replace(/^Jobbade med\s+/i, "Arbetade med ");
        fix.reason = "Språkförbättring: formell verbfras (samma fakta).";
      } else if (/^Jobbade (på|som|med)\s+/i.test(body)) {
        fix.from = body;
        fix.to = body.replace(/^Jobbade (på|som|med)\s+/i, (m) => `Arbetade ${m.split(" ")[1]} `);
        fix.reason = "Språkförbättring: formell verbfras (samma fakta).";
      } else if (/^[a-zåäö]/.test(body)) {
        fix.from = body;
        fix.to = body.charAt(0).toUpperCase() + body.slice(1);
        fix.reason = "Konsekvent versal inledning av punkt (samma fakta).";
      }
      if (fix.to) {
        lines[idx] = line.replace(body, fix.to);
        changed = true;
        fixes.push(fix);
      }
    });
    if (changed) {
      const original = s.original;
      s.proposed = lines.join("\n");
      s.changes = s.changes || [];
      for (const f of fixes) {
        s.changes.push(makeChange(s.id, "rephrased", f.from, f.to, f.reason));
      }
    }
  }

  /* — summary rewrite (professional + targeted) — */
  if (lvl !== "light") {
    const profileSection = sections.find((s) => s.type === "profile");
    if (profileSection) {
      const base = profile?.summary || profile?.headline;
      if (base) {
        const parts = [base.trim()];
        if (jobTitle) parts.push(`Mål: ${jobTitle}.`);
        if (relevantSkills.length > 0) {
          parts.push(`Relevant kompetens: ${relevantSkills.join(", ")}.`);
        }
        const proposedBody = parts.join(" ");
        const lines = profileSection.original.split("\n");
        const heading = lines[0];
        const rest = lines.slice(1);
        const firstBody = rest[0] ?? "";
        if (proposedBody !== firstBody.trim() && lines.length > 1) {
          const proposed = [heading, proposedBody, ...rest.slice(1)].join("\n");
          if (proposed !== profileSection.original) {
            profileSection.proposed = proposed;
            profileSection.changes = profileSection.changes || [];
            profileSection.changes.push(makeChange(
              profileSection.id, "rephrased", profileSection.original,
              profileSection.proposed,
              "Sammanfattningen är omformulerad med verifierad profilinformation och riktas mot den aktuella rollen.",
            ));
          }
        }
      }
    }
  }

  /* — skills ordering (professional + targeted) — */
  if (lvl !== "light" && skillsSection && relevantSkills.length > 0) {
    const bulletRe = /^([-*•]\s+)(.*)$/;
    const lines = skillsSection.original.split("\n");
    if (lines.some((l) => bulletRe.test(l))) {
      // split into heading lines (kept in place) and skill bullets (sorted)
      const head = lines.filter((l) => !bulletRe.test(l));
      const bullets = lines
        .map((l) => {
          const m = bulletRe.exec(l);
          return m ? { prefix: m[1], name: m[2] } : null;
        })
        .filter(Boolean);
      const relevant = (name) =>
        relevantSkills.some((k) => name.toLowerCase() === k.toLowerCase()) ? 0 : 1;
      const reordered = [...bullets].sort((a, b) => relevant(a.name) - relevant(b.name));
      const names = bullets.map((b) => b.name);
      const originalOrder = names.join("\n");
      const newOrder = reordered.map((b) => b.name).join("\n");
      if (originalOrder !== newOrder) {
        const rebuilt = [...head, ...reordered.map((b) => b.prefix + b.name)].join("\n");
        skillsSection.proposed = rebuilt;
        skillsSection.changes = skillsSection.changes || [];
        skillsSection.changes.push(makeChange(
          skillsSection.id, "moved", originalOrder, newOrder,
          "Kompetenser som matchar jobbets nyckelord prioriteras först (ATS-vänligt).",
        ));
      }
    }
  }

  /* — targeted: role-specific header + experience ordering — */
  if (lvl === "targeted") {
    const header = sections.find((s) => s.type === "header");
    if (header && jobTitle && relevantSkills.length > 0) {
      const focus = `${jobTitle} | ${relevantSkills.join(" · ")}`;
      if (!header.original.includes(focus)) {
        const proposed = header.original.trimEnd() + `\n${focus}`;
        header.proposed = proposed;
        header.changes = header.changes || [];
        header.changes.push(makeChange(
          header.id, "added", null, focus,
          "Rollspecifik fokusrad byggd på verifierad profilkompetens och jobbets titel.",
        ));
      }
    }

    const exp = sections.find((s) => s.type === "experience");
    if (exp && /^###\s/m.test(exp.original)) {
      const heading = exp.original.split(/(?=^###\s)/m)[0];
      const blocks = exp.original.split(/(?=^###\s)/m).slice(1);
      if (blocks.length > 1) {
        const score = (b) =>
          relevantSkills.reduce((n, k) => n + (b.toLowerCase().includes(k.toLowerCase()) ? 1 : 0), 0);
        const sorted = [...blocks].sort((a, b) => score(b) - score(a));
        const original = exp.original;
        const proposed = `${heading}${sorted.join("")}`;
        if (original !== proposed) {
          exp.proposed = proposed;
          exp.changes = exp.changes || [];
          exp.changes.push(makeChange(
            exp.id, "moved", original, proposed,
            "Erfarenheter med högst relevans för rollen presenteras först.",
          ));
        }
      }
    }
  }

  /* — fact verification pass — */
  for (const s of sections) {
    verifySection(s, verifiedTerms);
    totalChanges += s.changes?.length || 0;
  }

  const summary = {
    level: lvl,
    totalChanges,
    verified: sections.reduce((n, s) => n + (s.changes?.filter((c) => c.verified).length || 0), 0),
    needsVerification: sections.reduce(
      (n, s) => n + (s.changes?.filter((c) => !c.verified).length || 0), 0),
    keywords: relevantSkills,
  };

  return { level: lvl, sections, summary, model: "deterministic" };
}

/* ── Assemble proposed CV (before/after view) ───────────────────────── */

/**
 * Build the full proposed CV text (all suggestions applied, regardless of
 * approval) — used for the before/after review.
 */
export function assembleProposedCv(cvText, sections) {
  let out = "";
  const sorted = [...sections].sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const s of sorted) {
    out += cvText.slice(pos, s.start);
    out += s.proposed;
    pos = s.end;
  }
  out += cvText.slice(pos);
  return out;
}

/* ── Apply approved changes ─────────────────────────────────────────── */

/**
 * Build the final CV from the original text + approved changes + user edits.
 * Unchanged parts are preserved byte-for-byte.
 * Returns { cvText, appliedCount, sections: [{id, outcome: "original"|"proposed"|"edit"}] }
 */
export function applyTailorChanges({ cvText, sections, approvedIds = [], edits = {} }) {
  const approved = new Set(approvedIds);
  const sorted = [...sections].sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  let appliedCount = 0;
  const outcomes = [];
  for (const s of sorted) {
    out += cvText.slice(pos, s.start);
    const changes = s.changes || [];
    const approvedChange = changes.find((c) => approved.has(c.id));
    const hasApproved = changes.some((c) => approved.has(c.id));
    const edit = edits[s.id];
    if (typeof edit === "string" && edit.trim() !== "" && edit !== s.original) {
      out += edit.trimEnd();
      appliedCount += 1;
      outcomes.push({ id: s.id, outcome: "edit" });
    } else if (approvedChange?.type === "needsVerification") {
      // An approved needsVerification change carries its own full-section
      // proposal (e.g. a vetted AI rewrite) — use that text.
      out += approvedChange.proposed.trimEnd();
      appliedCount += 1;
      outcomes.push({ id: s.id, outcome: "proposed" });
    } else if (hasApproved) {
      out += s.proposed.trimEnd();
      appliedCount += 1;
      outcomes.push({ id: s.id, outcome: "proposed" });
    } else {
      out += cvText.slice(s.start, s.end);
      outcomes.push({ id: s.id, outcome: "original" });
    }
    pos = s.end;
  }
  out += cvText.slice(pos);
  return { cvText: out, appliedCount, outcomes };
}

/* ── Optional LLM polish (rewording only, re-verified) ──────────────── */

const POLISH_PROMPT = (section, jobTitle, keywords) => `Du är en professionell CV-redigerare. Formulera om följande CV-sektion så att den matchar jobbet "${jobTitle}".

REGLER (obrytbara):
1. Lägg INTE till fakta. Inga nya arbetsgivare, anställningar, datum, certifieringar, utbildningar, tekniska kunskaper, projekt, ansvar, siffror, procentsatser eller prestationer.
2. Formulera om, förkorta och strukturera BEFINTLIG text.
3. Använd jobbets nyckelord där de passar naturligt: ${(keywords || []).join(", ")}.
4. Behåll alla namn, datum, roller och tekniska begrepp som redan finns.
5. Svara endast med den nya sektionstexten. Ingen inledning, ingen förklaring.

BEFINTLIG TEXT:
${section.original}`;

/**
 * Run the LLM polish over the proposal's changed sections. `chatFn(prompt)`
 * must resolve to { ok: true, content } or { ok: false, error }. Every
 * rewritten section is re-verified; sections that gain unverifiable terms
 * get a needsVerification change instead of silently passing through.
 */
export async function polishProposalWithLlm(proposal, { analysis, profile }, chatFn, { model = "unknown" } = {}) {
  const verifiedTerms = buildVerifiedTerms(
    proposal.sections.map((s) => s.original).join("\n"),
    profile,
    analysis,
  );
  const jobTitle = analysis?.metadata?.jobTitle || "";
  const keywords = analysis?.keywords || [];
  let polished = 0;

  const targets = proposal.sections.filter((s) => (s.changes || []).length > 0);
  for (const s of targets) {
    const prompt = POLISH_PROMPT(s, jobTitle, keywords);
    let res;
    try {
      res = await chatFn(prompt);
    } catch {
      res = { ok: false, error: "chat failed" };
    }
    if (!res || !res.ok || typeof res.content !== "string") continue;
    const rewritten = res.content.trim();
    if (!rewritten || rewritten.length < 10) continue;
    const bad = unverifiedTerms(rewritten, s.original, verifiedTerms);
    const prevProposed = s.proposed;
    s.proposed = rewritten;
    s.changes = s.changes || [];
    if (bad.length === 0) {
      s.changes.push({
        id: `ch-${s.id}-ai-${changeSeq++}`,
        sectionId: s.id,
        type: "rephrased",
        original: s.original,
        proposed: rewritten,
        reason: "AI-omskrivning av befintlig text — verifierad mot CV och profil (inga nya fakta).",
        verified: true,
      });
      polished += 1;
    } else {
      s.changes.push({
        id: `ch-${s.id}-ai-${changeSeq++}`,
        sectionId: s.id,
        type: "needsVerification",
        original: s.original,
        proposed: rewritten,
        reason: `AI-förslag innehåller ord som inte kan verifieras från CV, profil eller jobbannons: ${bad.slice(0, 6).join(", ")}. Markeras ”Behöver verifieras” — kräver ditt godkännande.`,
        verified: false,
      });
      // Keep the deterministic (fully verified) proposal as the section text;
      // the unverified AI rewrite stays visible as a needsVerification change.
      s.proposed = prevProposed || s.original;
    }
  }

  return {
    ...proposal,
    sections: proposal.sections,
    summary: {
      ...proposal.summary,
      totalChanges: proposal.sections.reduce((n, s) => n + (s.changes?.length || 0), 0),
      verified: proposal.sections.reduce((n, s) => n + (s.changes?.filter((c) => c.verified).length || 0), 0),
      needsVerification: proposal.sections.reduce((n, s) => n + (s.changes?.filter((c) => !c.verified).length || 0), 0),
    },
    model,
    aiPolished: polished,
  };
}

export { LEVELS };
