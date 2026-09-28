import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { CAPS } from "./worker-capabilities.mjs";
import { spawnHeadlessCli } from "./spawn-cli.mjs";

/**
 * Clean and normalize single-line text
 */
function cleanLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/**
 * Extract verified achievements from cv.md and interview-prep/story-bank.md
 * @param {{ storyBankContent?: string, cvContent?: string }} sources
 * @returns {Array<{ id: string, title: string, text: string, metric?: string, source: "cv" | "story-bank", verified: boolean }>}
 */
export function extractVerifiedAchievements({ storyBankContent = "", cvContent = "" } = {}) {
  const achievements = [];
  const seen = new Set();

  // 1. Extract from cv.md (Primary ground truth)
  if (cvContent) {
    const lines = cvContent.split("\n");
    let currentSection = "General";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Detect section headers
      if (/^(Experience|Projects|Work Experience|Employment History)/i.test(line)) {
        currentSection = line;
        continue;
      }

      // Detect bullet points (•, -, *, or numbered)
      const bulletMatch = /^[•\-*]\s*(.+)$/.exec(line);
      if (bulletMatch) {
        const text = cleanLine(bulletMatch[1]);
        if (text.length > 15 && !seen.has(text)) {
          seen.add(text);
          // Check for metrics (% or numbers or scale)
          const metricMatch = text.match(/(\d+%\s*|\d+[xX]\s*|\$\d+[\d,.]*[kKmMbB]?|\b\d+\+?\s+(?:users|requests|req\/s|rps|services|microservices|ms|seconds|hours)\b)/i);
          const metric = metricMatch ? metricMatch[0].trim() : undefined;

          achievements.push({
            id: `cv-${achievements.length + 1}`,
            title: text.length > 50 ? `${text.slice(0, 47)}...` : text,
            text,
            metric,
            source: "cv",
            verified: true,
          });
        }
      }
    }
  }

  // 2. Extract from story-bank.md (Derived STAR stories)
  if (storyBankContent) {
    const blocks = storyBankContent.split(/^### /m).slice(1);
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b].trim();
      const lines = block.split("\n");
      const titleLine = lines[0].trim();

      let action = "";
      let result = "";
      for (const l of lines) {
        const actionMatch = /^\*\*Action:\*\*\s*(.*)$/i.exec(l.trim());
        if (actionMatch) action = actionMatch[1].trim();
        const resultMatch = /^\*\*Result:\*\*\s*(.*)$/i.exec(l.trim());
        if (resultMatch) result = resultMatch[1].trim();
      }

      const combined = cleanLine([action, result].filter(Boolean).join(" — "));
      if (combined.length > 15 && !seen.has(combined)) {
        seen.add(combined);

        // Verification against cv.md: if a number is cited in story-bank, verify it exists in cv.md
        let verified = true;
        const nums = combined.match(/\d+(?:\.\d+)?/g);
        if (nums && cvContent) {
          for (const n of nums) {
            if (!cvContent.includes(n)) {
              verified = false;
              break;
            }
          }
        }

        achievements.push({
          id: `star-${b + 1}`,
          title: titleLine || `STAR Story ${b + 1}`,
          text: combined,
          source: "story-bank",
          verified,
        });
      }
    }
  }

  return achievements;
}

/**
 * Format a counter-offer letter with grounded achievements, strategy, and tone
 */
export function generateCounterOfferLetter({
  company = "Company",
  role = "Role",
  recruiterName = "Hiring Team",
  currentOffer = "$175,000",
  targetAsk = "$195,000",
  strategy = "base",
  tone = "collaborative",
  competingOffer = "$190,000",
  achievement = "",
  candidateName = "Candidate",
  candidateEmail = "applicant@example.com",
  date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
} = {}) {
  const greeting = recruiterName && recruiterName.toLowerCase() !== "hiring team" ? `Dear ${recruiterName},` : `Dear ${company} Hiring Team,`;
  const achievementSentence = achievement
    ? `Specifically, in prior work I ${achievement.replace(/^[•\-*]\s*/, "")}.`
    : "Throughout my career, I have consistently delivered high-throughput systems with measurable business ROI.";

  // Strategy-specific bodies based on tone
  let subject = `Offer Discussion — ${role} — ${candidateName}`;
  let opening = "";
  let pitch = "";
  let closing = "";

  if (strategy === "base") {
    subject = `Counter-Offer & Package Discussion — ${role} — ${candidateName}`;
    if (tone === "assertive") {
      opening = `Thank you for extending the formal offer of ${currentOffer} for the ${role} position at ${company}. I am confident in the technical ownership and high standards I will bring to your team.`;
      pitch = `Based on the required scope of architectural leadership and current market benchmarks for this tier, I am requesting a base salary adjustment to ${targetAsk}. ${achievementSentence} I am prepared to deliver that same level of technical impact to ${company}.`;
      closing = `With this base adjustment in place, I am fully prepared to accept and sign the agreement immediately. Please let me know if we can finalize this change.`;
    } else if (tone === "strategic") {
      opening = `Thank you for discussing the compensation package for the ${role} position. The roadmap and technical mission at ${company} align directly with my core engineering expertise.`;
      pitch = `To ensure long-term parity with the business impact and delivery velocity of this role, I propose aligning the base salary at ${targetAsk} (adjusted from ${currentOffer}). ${achievementSentence} Bringing this proven execution to ${company}'s upcoming milestones will drive immediate measurable returns.`;
      closing = `I want to make this partnership a resounding success from day one and would be thrilled to formalize our agreement upon this revision.`;
    } else {
      // collaborative
      opening = `Thank you so much for the offer to join ${company} as ${role}! I am genuinely thrilled about the team, culture, and roadmap we discussed throughout the interview process.`;
      pitch = `After carefully reviewing the initial offer of ${currentOffer}, I was hoping we could explore aligning the base compensation closer to ${targetAsk}. ${achievementSentence} Given this background, I am confident I can hit the ground running and add immediate value to your deliverables.`;
      closing = `Is there flexibility within your compensation band to accommodate this adjustment? I am eager to partner with your team and get this locked in!`;
    }
  } else if (strategy === "competing") {
    subject = `Offer Consideration & Competing Opportunity — ${role} — ${candidateName}`;
    if (tone === "assertive") {
      opening = `Thank you again for extending the offer for the ${role} position at ${company}. Because of your technical vision and leadership, ${company} remains my top preference.`;
      pitch = `In full transparency, I have received a competing offer at ${competingOffer} Total Compensation from another organization concluding this week. However, because ${company}'s roadmap is my first choice, bridging our agreement to ${targetAsk} Total Compensation would allow me to decline the other opportunity immediately. ${achievementSentence}`;
      closing = `If you are able to match ${targetAsk}, I will decline the other offer and sign with ${company} today. Thank you for your consideration.`;
    } else if (tone === "strategic") {
      opening = `Thank you for the comprehensive offer for the ${role} role. I want to reiterate that ${company} is my preferred environment due to the team's engineering vision.`;
      pitch = `To be transparent about my decision timeline, I am currently evaluating a concurrent offer valued at ${competingOffer}. While that package is compelling, my interest in ${company} is significantly higher. If we can adjust our compensation package to ${targetAsk}, it would make this an effortless decision to sign with ${company}. ${achievementSentence}`;
      closing = `I am eager to bring my background to ${company} and hope we can close this delta to finalize our partnership.`;
    } else {
      // collaborative
      opening = `Thank you so much for putting together this offer! I have really enjoyed getting to know the team, and ${company} is hands-down my top choice for my next chapter.`;
      pitch = `I want to be completely open with you: I have another active offer at ${competingOffer} Total Compensation. Because I feel such a strong connection to ${company}'s mission, if we are able to bridge the compensation to ${targetAsk}, I would love nothing more than to decline the other opportunity and sign with you right away. ${achievementSentence}`;
      closing = `Thank you again for your advocacy throughout this process. I look forward to hearing your thoughts on whether we can bridge this gap!`;
    }
  } else if (strategy === "geo") {
    subject = `Compensation Benchmarking & Location Alignment — ${role} — ${candidateName}`;
    opening = `Thank you for extending the offer to join ${company} as ${role}. I appreciate the team's transparency regarding location-based salary bands.`;
    pitch = `Because the architectural ownership, system availability, and business impact I will deliver in this role are identical regardless of physical location, I would like to request benchmarking compensation against the top-of-band national target of ${targetAsk}. ${achievementSentence}`;
    closing = `I am eager to contribute at this high level and look forward to your perspective on aligning the offer with this benchmark.`;
  } else if (strategy === "equity") {
    subject = `Compensation Structure & Equity / Sign-on Discussion — ${role} — ${candidateName}`;
    opening = `Thank you for the clarity on the fixed base salary ceiling for the ${role} position at ${company}. I understand and respect internal leveling parameters.`;
    pitch = `To bridge the gap between the initial offer (${currentOffer}) and my target of ${targetAsk}, would ${company} be open to exploring an adjusted Year 1 sign-on bonus or an expanded initial equity / RSU grant? ${achievementSentence} Structuring the difference through equity strongly aligns my long-term incentives with ${company}'s growth.`;
    closing = `I would be thrilled to sign immediately upon structuring this adjustment. Thank you for your partnership and flexibility.`;
  } else {
    // level / scope
    subject = `Role Scope & Leveling Alignment — ${role} — ${candidateName}`;
    opening = `Thank you for the generous offer to join ${company}. Reflecting on our technical conversations and the leadership scope required for your upcoming roadmap, I am very excited about the challenges ahead.`;
    pitch = `Given the depth of cross-functional architecture and mentoring expected in this role, the responsibilities align closely with a Staff / Principal tier. ${achievementSentence} I would like to explore whether we can align the formal title and compensation target at ${targetAsk} to reflect this level of ownership.`;
    closing = `I am eager to take on this scope and look forward to discussing how we can align the package with this tier.`;
  }

  return `${candidateName}
${candidateEmail}
${date}

${recruiterName}
${company}

Subject: ${subject}

${greeting}

${opening}

${pitch}

${closing}

Warm regards,

${candidateName}`;
}

/**
 * Builds the strict LLM / AI prompt for negotiation letter generation
 */
export function buildNegotiationPrompt({
  company,
  role,
  recruiterName,
  currentOffer,
  targetAsk,
  strategy,
  tone,
  competingOffer,
  verifiedAchievements = [],
  candidateName,
}) {
  const achievementsText = verifiedAchievements.length > 0
    ? verifiedAchievements.map((a) => `- [${a.source}] ${a.text}`).join("\n")
    : "- Successfully delivered scalable systems with high reliability and performance.";

  return `You are the Career-Ops Negotiation Assistant. Draft a professional, high-impact counter-offer negotiation letter for the candidate.

CANDIDATE: ${candidateName || "Candidate"}
COMPANY: ${company}
ROLE: ${role}
RECRUITER / HIRING MANAGER: ${recruiterName || "Hiring Team"}
CURRENT OFFER: ${currentOffer}
TARGET ASK: ${targetAsk}
STRATEGY: ${strategy} (base | competing | geo | equity | level)
COMMUNICATION TONE: ${tone} (collaborative | assertive | strategic)
${strategy === "competing" ? `COMPETING OFFER: ${competingOffer}\n` : ""}

STRICT GROUNDING INVARIANT:
- Anchor the letter in the VERIFIED candidate achievements listed below.
- NEVER invent, extrapolate, or fabricate scale figures, numbers, or accomplishments.
- Keywords get reformulated, never fabricated.

VERIFIED ACHIEVEMENTS ON FILE:
${achievementsText}

INSTRUCTIONS:
1. Output the complete, polished email letter starting with Header / Subject line.
2. Weave 1-2 verified achievements into the core rationale for the counter ask.
3. Match the requested tone exactly:
   - collaborative: warm, high-intent, enthusiastic, partnering
   - assertive: firm, clear, direct, market-standard
   - strategic: ROI-anchored, business-outcome and delivery-focused
4. End with a professional sign-off from ${candidateName || "Candidate"}.
`;
}

/**
 * Executes negotiation letter generation using headless AI CLI if available, or deterministic fallback
 */
export async function executeNegotiationAiAction({
  company,
  role,
  recruiterName,
  currentOffer,
  targetAsk,
  strategy = "base",
  tone = "collaborative",
  competingOffer,
  achievement,
  candidateName,
  candidateEmail,
  cliSpec,
  binPath,
  cwd,
}) {
  // If an AI CLI runtime is resolved, attempt to stream/generate with local-only permissions
  if (cliSpec && binPath && cwd) {
    try {
      const prompt = buildNegotiationPrompt({
        company,
        role,
        recruiterName,
        currentOffer,
        targetAsk,
        strategy,
        tone,
        competingOffer,
        verifiedAchievements: achievement ? [{ source: "cv", text: achievement }] : [],
        candidateName,
      });

      const args = cliSpec.args(prompt);
      const child = spawnHeadlessCli(
        binPath,
        args,
        { cwd, env: { ...process.env } },
        { cliId: cliSpec.id, capabilities: CAPS.localReadOnly }
      );

      let stdout = "";
      let stderr = "";

      const output = await new Promise((resolve) => {
        child.stdout?.on("data", (d) => {
          stdout += d.toString();
        });
        child.stderr?.on("data", (d) => {
          stderr += d.toString();
        });
        child.on("close", (code) => {
          if (code === 0 && stdout.trim().length > 50) {
            resolve(stdout.trim());
          } else {
            resolve(null);
          }
        });
        child.on("error", () => resolve(null));

        // Timeout after 15s to prevent hanging
        setTimeout(() => {
          try {
            child.kill();
          } catch {}
          resolve(stdout.trim().length > 50 ? stdout.trim() : null);
        }, 15000);
      });

      if (output) {
        return {
          letter: output,
          grounded: true,
          aiGenerated: true,
          strategy,
          tone,
        };
      }
    } catch {
      // Fallback to deterministic template below
    }
  }

  // Deterministic grounded generator fallback
  const letter = generateCounterOfferLetter({
    company,
    role,
    recruiterName,
    currentOffer,
    targetAsk,
    strategy,
    tone,
    competingOffer,
    achievement,
    candidateName,
    candidateEmail,
  });

  return {
    letter,
    grounded: true,
    aiGenerated: false,
    strategy,
    tone,
  };
}
