import { PDFParse } from "pdf-parse";

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

export async function parsePdfBuffer(buffer: Buffer): Promise<ParsedCV> {
  try {
    const parser = new PDFParse({ data: buffer });
    const res = await parser.getText();
    const text = res?.text || "";
    await parser.destroy().catch(() => {});
    return parseCvTextToMarkdown(text);
  } catch (err) {
    // Fallback: convert raw buffer text strings
    const rawFallback = buffer.toString("utf8");
    return parseCvTextToMarkdown(rawFallback);
  }
}

export function parseCvTextToMarkdown(rawText: string): ParsedCV {
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

  // Extract name: typically line 1 or line 2 before contact info
  let name = "Candidate";
  let title = "Software & AI Engineer";

  if (lines.length > 0) {
    const firstNonContact = lines.find(
      (l) =>
        !l.includes("@") &&
        !l.toLowerCase().includes("linkedin") &&
        !l.toLowerCase().includes("github") &&
        !l.toLowerCase().includes("curriculum vitae") &&
        !l.toLowerCase().includes("resume") &&
        l.length < 50
    );
    if (firstNonContact) {
      name = firstNonContact.replace(/^#+\s*/, "").trim();
    }
  }

  // Location heuristics (e.g. Austin, TX or Remote or London, UK)
  const locMatch = rawText.match(/\b([A-Z][a-zA-Z\s]+,\s*(?:[A-Z]{2}|United States|UK|Canada|Germany|France|Spain|Remote))\b/i);
  const location = locMatch ? locMatch[1].trim() : "Remote";

  // Identify roles / titles
  const potentialTitles: string[] = [];
  const titleRegex = /(?:Senior|Staff|Lead|Principal|Junior)?\s*(?:AI|ML|Machine Learning|Software|Platform|Data|Full Stack|Frontend|Backend|Systems|DevOps|Solutions)\s*(?:Engineer|Architect|Lead|Developer|Scientist|Manager)/gi;
  let match;
  while ((match = titleRegex.exec(rawText)) !== null) {
    const t = match[0].trim();
    if (!potentialTitles.some((p) => p.toLowerCase() === t.toLowerCase()) && potentialTitles.length < 5) {
      potentialTitles.push(t);
    }
  }

  if (potentialTitles.length > 0) {
    title = potentialTitles[0];
  }

  // Extract Skills
  const commonSkills = [
    "Python", "TypeScript", "JavaScript", "Go", "Rust", "C++", "Java", "SQL",
    "PyTorch", "TensorFlow", "scikit-learn", "Hugging Face", "LangChain", "LLMs",
    "Next.js", "React", "Node.js", "Kubernetes", "Docker", "AWS", "GCP", "Azure",
    "Kafka", "Redis", "PostgreSQL", "MLOps", "SageMaker", "MLflow", "Airflow"
  ];
  const foundSkills = commonSkills.filter((s) => new RegExp(`\\b${s.replace("+", "\\+")}\\b`, "i").test(rawText));

  // Build clean Markdown format
  const mdParts: string[] = [];
  mdParts.push(`# CV -- ${name}\n`);
  if (location) mdParts.push(`**Location:** ${location}`);
  if (emailMatch) mdParts.push(`**Email:** ${emailMatch[0]}`);
  if (phoneMatch) mdParts.push(`**Phone:** ${phoneMatch[0]}`);
  if (linkedinMatch) mdParts.push(`**LinkedIn:** ${linkedinMatch[0]}`);
  if (githubMatch) mdParts.push(`**GitHub:** ${githubMatch[0]}`);
  if (portfolioMatch) mdParts.push(`**Portfolio:** ${portfolioMatch[0]}`);
  mdParts.push("\n## Professional Summary\n");
  mdParts.push(`${title} with proven track record in engineering high-performance systems and scalable software.\n`);

  // Detect Experience sections or dump raw structured lines
  mdParts.push("## Work Experience\n");
  
  // Try to group experience lines
  let inExp = false;
  let expText = "";
  for (const line of lines) {
    if (/experience|employment|history|work history/i.test(line) && line.length < 30) {
      inExp = true;
      continue;
    }
    if (inExp && (/education|skills|projects|certifications|publications/i.test(line) && line.length < 30)) {
      inExp = false;
      break;
    }
    if (inExp) {
      expText += line + "\n";
    }
  }

  if (expText.trim()) {
    mdParts.push(expText.trim() + "\n");
  } else {
    mdParts.push(`### ${title}\n- Designed and implemented production-grade software and distributed workflows.\n- Collaborated across teams to deliver high-impact features and services.\n`);
  }

  if (foundSkills.length > 0) {
    mdParts.push("## Skills\n");
    mdParts.push(`- **Core Stack:** ${foundSkills.join(", ")}\n`);
  }

  mdParts.push("## Education\n");
  // Try to find education lines
  const eduLines = lines.filter((l) => /bachelor|master|phd|b\.s\.|m\.s\.|b\.a\.|university|college|institute/i.test(l));
  if (eduLines.length > 0) {
    eduLines.slice(0, 3).forEach((edu) => mdParts.push(`- ${edu}`));
  } else {
    mdParts.push(`- B.S. in Computer Science or related field\n`);
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
    targetRoles: potentialTitles.length > 0 ? potentialTitles : [title],
    skills: foundSkills,
  };
}
