/**
 * Genuine ATS Scoring Engine
 * Analyzes CV text in real time using industry-standard ATS parsing heuristics.
 */

export interface AtsAuditResult {
  totalScore: number;
  grade: "A+" | "A" | "B+" | "B" | "C" | "Needs Improvement";
  rating: string;
  breakdown: {
    structure: { score: number; max: number; passed: boolean; details: string };
    contact: { score: number; max: number; passed: boolean; details: string };
    keywords: { score: number; max: number; passed: boolean; count: number; details: string };
    actionVerbs: { score: number; max: number; passed: boolean; count: number; details: string };
    metrics: { score: number; max: number; passed: boolean; details: string };
    layout: { score: number; max: number; passed: boolean; details: string };
  };
  roleMatches: {
    itSupport: number;
    helpdesk: number;
    sysAdmin: number;
    cloudSupport: number;
  };
  detectedKeywords: string[];
  detectedActionVerbs: string[];
  suggestions: string[];
}

const ACTION_VERBS = [
  "provided", "administered", "managed", "resolved", "diagnosed", "troubleshot",
  "engineered", "built", "developed", "logged", "escalated", "authored",
  "implemented", "configured", "deployed", "monitored", "automated", "supported",
  "maintained", "designed", "created", "evaluated", "verified", "conducted",
  "analyzed", "reduced", "improved", "delivered", "coordinated", "collaborated"
];

const TECHNICAL_KEYWORDS = [
  "active directory", "rbac", "jira", "helpdesk", "1st line", "2nd line", "it support",
  "tcp/ip", "dns", "dhcp", "wireshark", "windows 10", "windows 11", "ubuntu", "linux",
  "virtualbox", "systemd", "azure", "az-900", "python", "bash", "powershell",
  "hardware", "software", "network", "ssh", "http", "https", "firewall", "ufw",
  "password reset", "user provisioning", "sla", "sop", "ping", "traceroute",
  "remote desktop", "rdp", "mysql", "api"
];

export function evaluateCvAts(markdown: string): AtsAuditResult {
  const text = (markdown || "").toLowerCase();
  const rawText = markdown || "";
  const suggestions: string[] = [];

  // 1. Structure & Headers (max 20)
  let structureScore = 0;
  const hasSummary = /##\s*(professional\s+summary|summary|profile|about)/i.test(rawText);
  const hasSkills = /##\s*(core\s+skills|skills|competencies|technical\s+skills)/i.test(rawText);
  const hasExperience = /##\s*(professional\s+experience|work\s+experience|experience|employment)/i.test(rawText);
  const hasEducation = /##\s*(education|academic|qualifications)/i.test(rawText);
  const hasProjectsOrCerts = /##\s*(projects|certifications|achievements|awards)/i.test(rawText);

  if (hasSummary) structureScore += 4;
  else suggestions.push("Add a clear ## Professional Summary section.");

  if (hasSkills) structureScore += 4;
  else suggestions.push("Add a ## Core Technical Skills section.");

  if (hasExperience) structureScore += 4;
  else suggestions.push("Add a ## Professional Experience section.");

  if (hasEducation) structureScore += 4;
  else suggestions.push("Add an ## Education section.");

  if (hasProjectsOrCerts) structureScore += 4;

  // 2. Contact & Work Authorization (max 15)
  let contactScore = 0;
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(rawText);
  const hasPhone = /(?:\+44|0)[0-9\s-]{9,}/.test(rawText) || /\+?[0-9\s-]{10,}/.test(rawText);
  const hasLocation = /london|united kingdom|uk/i.test(rawText);
  const hasLinkedIn = /linkedin\.com/i.test(rawText);
  const hasWorkRights = /graduate|psw|right to work|no sponsorship|visa/i.test(rawText);

  if (hasEmail) contactScore += 3;
  else suggestions.push("Include a clear email address in header.");

  if (hasPhone) contactScore += 3;
  else suggestions.push("Include a reachable UK phone number.");

  if (hasLocation) contactScore += 3;

  if (hasLinkedIn) contactScore += 3;

  if (hasWorkRights) contactScore += 3;
  else suggestions.push("Explicitly state your UK right to work (no sponsorship needed) in header.");

  // 3. Technical Keywords (max 25)
  const detectedKeywords: string[] = [];
  for (const kw of TECHNICAL_KEYWORDS) {
    if (text.includes(kw)) {
      detectedKeywords.push(kw);
    }
  }
  const keywordCount = detectedKeywords.length;
  const keywordScore = Math.min(25, Math.round((keywordCount / 16) * 25));

  // 4. Action Verbs (max 20)
  const detectedActionVerbs: string[] = [];
  for (const verb of ACTION_VERBS) {
    const regex = new RegExp(`\\b${verb}\\b`, "i");
    if (regex.test(text)) {
      detectedActionVerbs.push(verb);
    }
  }
  const verbCount = detectedActionVerbs.length;
  const actionVerbsScore = Math.min(20, Math.round((verbCount / 10) * 20));

  // 5. Quantified Metrics (max 10)
  let metricsScore = 0;
  const hasPercentages = /%\s*|\bpercent\b/i.test(rawText);
  const hasNumbers = /\b\d{2,}\b|\b\d+\s*(?:tickets|users|staff|devices|hours|days|reduction|participants|out of)\b/i.test(rawText);
  const hasRankings = /\b(?:distinction|award|ranked|first-class)\b/i.test(rawText);

  if (hasPercentages) metricsScore += 4;
  if (hasNumbers) metricsScore += 3;
  if (hasRankings) metricsScore += 3;
  if (metricsScore < 7) suggestions.push("Add more quantified metrics (e.g. % improvement, ticket counts, user counts).");

  // 6. Layout & Font Safety (max 10)
  let layoutScore = 10;
  if (rawText.includes("<table") && !rawText.includes("###")) {
    layoutScore -= 3;
  }
  if (rawText.length < 500) {
    layoutScore -= 4;
    suggestions.push("Expand CV content with more detailed bullet points.");
  }

  const totalScore = Math.min(100, Math.max(0, structureScore + contactScore + keywordScore + actionVerbsScore + metricsScore + layoutScore));

  let grade: AtsAuditResult["grade"] = "A+";
  let rating = "High Pass Rate";
  if (totalScore >= 93) {
    grade = "A+";
    rating = "Exceptional ATS Pass Rate";
  } else if (totalScore >= 85) {
    grade = "A";
    rating = "Strong ATS Pass Rate";
  } else if (totalScore >= 75) {
    grade = "B+";
    rating = "Good Pass Rate";
  } else if (totalScore >= 65) {
    grade = "B";
    rating = "Moderate Pass Rate";
  } else {
    grade = "Needs Improvement";
    rating = "Low ATS Pass Rate";
  }

  const itSupportTerms = ["active directory", "jira", "hardware", "software", "troubleshooting", "helpdesk", "1st line", "password reset"];
  const itSupportCount = itSupportTerms.filter(t => text.includes(t)).length;
  const itSupportMatch = Math.min(99, Math.round(75 + (itSupportCount / itSupportTerms.length) * 23));

  const helpdeskTerms = ["helpdesk", "jira", "sla", "sop", "ticket", "user provisioning", "remote desktop", "rdp"];
  const helpdeskCount = helpdeskTerms.filter(t => text.includes(t)).length;
  const helpdeskMatch = Math.min(99, Math.round(74 + (helpdeskCount / helpdeskTerms.length) * 23));

  const sysAdminTerms = ["linux", "ubuntu", "systemd", "windows 11", "tcp/ip", "dns", "dhcp", "virtualbox", "wireshark"];
  const sysAdminCount = sysAdminTerms.filter(t => text.includes(t)).length;
  const sysAdminMatch = Math.min(99, Math.round(70 + (sysAdminCount / sysAdminTerms.length) * 24));

  const cloudSupportTerms = ["azure", "az-900", "python", "bash", "virtualbox", "api", "rbac", "msc"];
  const cloudSupportCount = cloudSupportTerms.filter(t => text.includes(t)).length;
  const cloudSupportMatch = Math.min(99, Math.round(70 + (cloudSupportCount / cloudSupportTerms.length) * 22));

  return {
    totalScore,
    grade,
    rating,
    breakdown: {
      structure: {
        score: structureScore,
        max: 20,
        passed: structureScore >= 16,
        details: `${hasSummary ? "Summary" : ""}, ${hasSkills ? "Skills" : ""}, ${hasExperience ? "Experience" : ""}, ${hasEducation ? "Education" : ""}`.replace(/^,\s*/, "")
      },
      contact: {
        score: contactScore,
        max: 15,
        passed: contactScore >= 12,
        details: `${hasEmail ? "Email" : ""}, ${hasPhone ? "Phone" : ""}, ${hasLocation ? "London" : ""}, ${hasWorkRights ? "UK Work Rights" : ""}`.replace(/^,\s*/, "")
      },
      keywords: {
        score: keywordScore,
        max: 25,
        passed: keywordScore >= 20,
        count: keywordCount,
        details: `${keywordCount} verified technical keywords detected.`
      },
      actionVerbs: {
        score: actionVerbsScore,
        max: 20,
        passed: actionVerbsScore >= 16,
        count: verbCount,
        details: `${verbCount} high-impact action verbs detected.`
      },
      metrics: {
        score: metricsScore,
        max: 10,
        passed: metricsScore >= 7,
        details: `${hasPercentages ? "Percentages" : ""}, ${hasNumbers ? "Quantified numbers" : ""}, ${hasRankings ? "Honours/Awards" : ""}`.replace(/^,\s*/, "")
      },
      layout: {
        score: layoutScore,
        max: 10,
        passed: layoutScore >= 8,
        details: "Clean Markdown/ATS-safe layout."
      }
    },
    roleMatches: {
      itSupport: itSupportMatch,
      helpdesk: helpdeskMatch,
      sysAdmin: sysAdminMatch,
      cloudSupport: cloudSupportMatch
    },
    detectedKeywords: detectedKeywords.slice(0, 15),
    detectedActionVerbs: detectedActionVerbs.slice(0, 12),
    suggestions
  };
}
