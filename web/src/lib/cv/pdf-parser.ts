export type ParsedCV = {
  rawText: string;
  markdown: string;
  candidate: {
    fullName?: string;
    title?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    github?: string;
    portfolio?: string;
  };
  targetRoles: string[];
  skills: string[];
};

function identifySectionHeading(line: string): { isHeading: boolean; title: string; category?: string } {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 70) return { isHeading: false, title: "" };

  // Skip list items / bullet points
  if (/^[-*•\d+\.]\s+/.test(trimmed)) return { isHeading: false, title: "" };

  // Skip lines that look like emails, URLs, or contact info
  if (/@|https?:\/\/|www\./i.test(trimmed)) return { isHeading: false, title: "" };

  // Markdown heading: e.g. "# Summary", "## Experience", "### Projects"
  const mdMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (mdMatch) {
    const headingText = mdMatch[1].trim();
    return { isHeading: true, title: headingText, category: categorizeSection(headingText) };
  }

  // Standalone heading with colon: "Work Experience:", "Projects:"
  if (/^[A-Za-z0-9\s/&'-]{3,50}:$/.test(trimmed)) {
    const headingText = trimmed.replace(/:$/, "").trim();
    return { isHeading: true, title: headingText, category: categorizeSection(headingText) };
  }

  // All-caps heading: "WORK EXPERIENCE", "EDUCATION", "SKILLS", "PROJECTS", "PUBLICATIONS"
  if (/^[A-Z0-9\s/&'-]{3,45}$/.test(trimmed) && /[A-Z]/.test(trimmed)) {
    const words = trimmed.split(/\s+/);
    if (words.length <= 6) {
      const titleCased = trimmed
        .split(" ")
        .map((w) => (w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join(" ");
      return { isHeading: true, title: titleCased, category: categorizeSection(trimmed) };
    }
  }

  // Common heading patterns in Mixed Case
  const commonPattern = /^(professional\s+summary|summary|profile|about\s+me|work\s+experience|professional\s+experience|experience|employment(\s+history)?|skills(\s+(&|and)\s+technologies)?|technical\s+skills|core\s+stack|education|projects|selected\s+projects|certifications?|awards?|publications?|languages?|volunteer(ing)?|open\s+source|patents?|interests?|references?)$/i;
  if (commonPattern.test(trimmed)) {
    return { isHeading: true, title: trimmed, category: categorizeSection(trimmed) };
  }

  return { isHeading: false, title: "" };
}

function categorizeSection(title: string): string {
  const t = title.toLowerCase();
  if (/summary|profile|about/i.test(t)) return "summary";
  if (/experience|employment|work history/i.test(t)) return "experience";
  if (/education|academic/i.test(t)) return "education";
  if (/skills|technologies|stack|competencies/i.test(t)) return "skills";
  return "other";
}

export function parseCvTextToMarkdown(rawText: string): ParsedCV {
  if (!rawText || !rawText.trim()) {
    return {
      rawText: "",
      markdown: "",
      candidate: {},
      targetRoles: [],
      skills: [],
    };
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Extract contact info
  const emailMatch = rawText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  const phoneMatch = rawText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
  const linkedinMatch = rawText.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  const githubMatch = rawText.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
  const textWithoutKnownLinks = rawText
    .replace(emailMatch ? emailMatch[0] : "", "")
    .replace(/linkedin\.com\/[^\s|]+/gi, "")
    .replace(/github\.com\/[^\s|]+/gi, "");
  const portfolioMatch = textWithoutKnownLinks.match(/(?:https?:\/\/)?(?<!@)\b([a-zA-Z0-9-]+\.(?:dev|io|me|ai|tech))\b|(?:https?:\/\/)([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/i);

  // Extract name only if actually present in top lines
  let name: string | undefined = undefined;
  if (lines.length > 0) {
    const firstNonContact = lines.slice(0, 5).find(
      (l) =>
        !l.includes("@") &&
        !l.toLowerCase().includes("linkedin") &&
        !l.toLowerCase().includes("github") &&
        !l.toLowerCase().includes("curriculum vitae") &&
        !l.toLowerCase().includes("resume") &&
        l.length < 60 &&
        !/^https?:\/\//i.test(l)
    );
    if (firstNonContact) {
      name = firstNonContact.replace(/^#+\s*/, "").trim();
    }
  }

  // Location heuristics (e.g. Austin, TX or London, UK)
  const locMatch = rawText.match(/\b([A-Z][a-zA-Z\s]+,\s*(?:[A-Z]{2}|United States|UK|Canada|Germany|France|Spain|Remote))\b/i);
  const location = locMatch ? locMatch[1].trim() : undefined;

  // Identify roles / titles from text
  const potentialTitles: string[] = [];
  const titleRegex = /(?:Senior|Staff|Lead|Principal|Junior)?\s*(?:AI|ML|Machine Learning|Software|Platform|Data|Full Stack|Frontend|Backend|Systems|DevOps|Solutions)\s*(?:Engineer|Architect|Lead|Developer|Scientist|Manager)/gi;
  let match;
  while ((match = titleRegex.exec(rawText)) !== null) {
    const t = match[0].trim();
    if (!potentialTitles.some((p) => p.toLowerCase() === t.toLowerCase()) && potentialTitles.length < 5) {
      potentialTitles.push(t);
    }
  }

  const title = potentialTitles.length > 0 ? potentialTitles[0] : undefined;

  // Extract Skills from text
  const commonSkills = [
    "Python", "TypeScript", "JavaScript", "Go", "Rust", "C++", "Java", "SQL",
    "PyTorch", "TensorFlow", "scikit-learn", "Hugging Face", "LangChain", "LLMs",
    "Next.js", "React", "Node.js", "Kubernetes", "Docker", "AWS", "GCP", "Azure",
    "Kafka", "Redis", "PostgreSQL", "MLOps", "SageMaker", "MLflow", "Airflow"
  ];
  const foundSkills = commonSkills.filter((s) => new RegExp(`\\b${s.replace("+", "\\+")}\\b`, "i").test(rawText));

  type Section = {
    title: string;
    normalizedTitle: string;
    category: string;
    lines: string[];
  };

  const headerLines: string[] = [];
  const sections: Section[] = [];
  let currentSection: Section | null = null;

  for (const line of lines) {
    const headingInfo = identifySectionHeading(line);
    if (headingInfo.isHeading) {
      if (currentSection) {
        sections.push(currentSection);
      }
      let normTitle = headingInfo.title;
      if (headingInfo.category === "summary") normTitle = "Professional Summary";
      else if (headingInfo.category === "experience") normTitle = "Work Experience";
      else if (headingInfo.category === "education") normTitle = "Education";
      else if (headingInfo.category === "skills") normTitle = "Skills";

      currentSection = {
        title: headingInfo.title,
        normalizedTitle: normTitle,
        category: headingInfo.category || "other",
        lines: [],
      };
    } else {
      if (currentSection) {
        currentSection.lines.push(line);
      } else {
        headerLines.push(line);
      }
    }
  }
  if (currentSection) {
    sections.push(currentSection);
  }

  // Build clean Markdown format strictly from present content
  const mdParts: string[] = [];
  mdParts.push(`# CV -- ${name || "Candidate"}\n`);
  if (location) mdParts.push(`**Location:** ${location}`);
  if (emailMatch) mdParts.push(`**Email:** ${emailMatch[0]}`);
  if (phoneMatch) mdParts.push(`**Phone:** ${phoneMatch[0]}`);
  if (linkedinMatch) mdParts.push(`**LinkedIn:** ${linkedinMatch[0]}`);
  if (githubMatch) mdParts.push(`**GitHub:** ${githubMatch[0]}`);
  if (portfolioMatch) mdParts.push(`**Portfolio:** ${portfolioMatch[0]}`);

  // Unheaded lines from the top
  const unheadedLines = headerLines.filter((l) => {
    if (name && l.replace(/^#+\s*/, "").trim() === name) return false;
    const stripped = l
      .replace(emailMatch ? emailMatch[0] : "", "")
      .replace(phoneMatch ? phoneMatch[0] : "", "")
      .replace(linkedinMatch ? linkedinMatch[0] : "", "")
      .replace(githubMatch ? githubMatch[0] : "", "")
      .replace(portfolioMatch ? portfolioMatch[0] : "", "")
      .replace(location || "", "")
      .replace(/[|•\/\-,–\s]+/g, "");
    return stripped.length > 0;
  });

  const hasSummarySection = sections.some((s) => s.category === "summary");
  if (unheadedLines.length > 0) {
    if (!hasSummarySection && (unheadedLines.length > 1 || unheadedLines[0].length > 30)) {
      mdParts.push("\n## Professional Summary\n");
      mdParts.push(unheadedLines.join("\n") + "\n");
    } else {
      mdParts.push("\n" + unheadedLines.join("\n"));
    }
  } else if (!hasSummarySection && title) {
    mdParts.push("\n## Professional Summary\n");
    mdParts.push(`${title}\n`);
  }

  let renderedSkills = false;
  for (const s of sections) {
    const content = s.lines.join("\n").trim();
    if (s.category === "skills") {
      renderedSkills = true;
      mdParts.push(`\n## ${s.normalizedTitle}\n`);
      if (content) {
        mdParts.push(content + "\n");
      } else if (foundSkills.length > 0) {
        mdParts.push(`- **Core Stack:** ${foundSkills.join(", ")}\n`);
      }
    } else {
      mdParts.push(`\n## ${s.normalizedTitle}\n`);
      if (content) {
        mdParts.push(content + "\n");
      }
    }
  }

  if (!renderedSkills && foundSkills.length > 0) {
    mdParts.push("\n## Skills\n");
    mdParts.push(`- **Core Stack:** ${foundSkills.join(", ")}\n`);
  }

  return {
    rawText,
    markdown: mdParts.join("\n").trim() + "\n",
    candidate: {
      fullName: name,
      title,
      email: emailMatch ? emailMatch[0] : undefined,
      phone: phoneMatch ? phoneMatch[0] : undefined,
      location,
      linkedin: linkedinMatch ? linkedinMatch[0] : undefined,
      github: githubMatch ? githubMatch[0] : undefined,
      portfolio: portfolioMatch ? portfolioMatch[0] : undefined,
    },
    targetRoles: potentialTitles.length > 0 ? potentialTitles : (title ? [title] : []),
    skills: foundSkills,
  };
}
