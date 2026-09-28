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
  const portfolioMatch = rawText.match(/(?:https?:\/\/)?([a-zA-Z0-9-]+\.(?:dev|io|me|com|ai|tech))\b/i);

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

  // Build clean Markdown format strictly from present content
  const mdParts: string[] = [];
  mdParts.push(`# CV -- ${name || "Candidate"}\n`);
  if (location) mdParts.push(`**Location:** ${location}`);
  if (emailMatch) mdParts.push(`**Email:** ${emailMatch[0]}`);
  if (phoneMatch) mdParts.push(`**Phone:** ${phoneMatch[0]}`);
  if (linkedinMatch) mdParts.push(`**LinkedIn:** ${linkedinMatch[0]}`);
  if (githubMatch) mdParts.push(`**GitHub:** ${githubMatch[0]}`);
  if (portfolioMatch) mdParts.push(`**Portfolio:** ${portfolioMatch[0]}`);

  // Summary section
  let inSummary = false;
  let summaryText = "";
  for (const line of lines) {
    if (/summary|profile|about me|professional summary/i.test(line) && line.length < 35) {
      inSummary = true;
      continue;
    }
    if (inSummary && (/experience|work history|employment|education|skills|projects/i.test(line) && line.length < 35)) {
      inSummary = false;
      break;
    }
    if (inSummary) {
      summaryText += line + " ";
    }
  }

  if (summaryText.trim()) {
    mdParts.push("\n## Professional Summary\n");
    mdParts.push(summaryText.trim() + "\n");
  } else if (title) {
    mdParts.push("\n## Professional Summary\n");
    mdParts.push(`${title}\n`);
  }

  // Work experience
  let inExp = false;
  let expText = "";
  for (const line of lines) {
    if (/experience|employment|work history|professional experience/i.test(line) && line.length < 35) {
      inExp = true;
      continue;
    }
    if (inExp && (/education|skills|projects|certifications|publications/i.test(line) && line.length < 35)) {
      inExp = false;
      break;
    }
    if (inExp) {
      expText += line + "\n";
    }
  }

  if (expText.trim()) {
    mdParts.push("\n## Work Experience\n");
    mdParts.push(expText.trim() + "\n");
  }

  if (foundSkills.length > 0) {
    mdParts.push("\n## Skills\n");
    mdParts.push(`- **Core Stack:** ${foundSkills.join(", ")}\n`);
  }

  // Education
  const eduLines = lines.filter((l) => /bachelor|master|phd|b\.s\.|m\.s\.|b\.a\.|university|college|institute|polytechnic/i.test(l));
  if (eduLines.length > 0) {
    mdParts.push("\n## Education\n");
    eduLines.slice(0, 4).forEach((edu) => mdParts.push(`- ${edu}`));
  }

  return {
    rawText,
    markdown: mdParts.join("\n"),
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
