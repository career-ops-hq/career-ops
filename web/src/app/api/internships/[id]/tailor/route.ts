import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import type { Internship } from "../../route";
import { appToInternship } from "../../route";

export const dynamic = "force-dynamic";

const PROFILE_FILE = () => path.join(careerOpsRoot(), "data", "resume-profile.json");

type ResumeExperience = {
  title: string;
  company: string;
  location: string;
  dates: string;
  bullets: string[];
  tags: string[];
};

type ResumeProject = {
  name: string;
  tech: string[];
  year: number;
  bullets: string[];
  tags: string[];
};

type ResumeProfile = {
  name: string;
  education: { school: string; degree: string; expected: string };
  certifications: string[];
  skills: Record<string, string[]>;
  skillKeywords: string[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  parsedFrom?: string;
  parsedAt?: string;
};

const EMPTY_PROFILE: ResumeProfile = {
  name: "",
  education: { school: "", degree: "", expected: "" },
  certifications: [],
  skills: {},
  skillKeywords: [],
  experience: [],
  projects: [],
};

function loadResumeProfile(): ResumeProfile {
  const file = PROFILE_FILE();
  try {
    fs.accessSync(file);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Fall back to empty profile if dynamic one doesn't exist yet
    return EMPTY_PROFILE;
  }
}

// Normalize a string for keyword matching (preserve hyphens for terms like scikit-learn, cross-validation)
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#/\- ]/g, "").trim();
}

// Short terms that must match as whole words to avoid false positives
// (e.g. "r" matching "intern", "go" matching "google")
const SHORT_TERMS = new Set(["r", "go", "sql", "nlp", "css", "html", "etl", "elt", "gcp", "api"]);

// Track-based default keywords when the internship has no requirements text
const TRACK_DEFAULTS: Record<string, string[]> = {
  DS: ["python", "sql", "statistics", "machine learning", "data visualization", "pandas", "tableau", "hypothesis testing", "regression", "classification"],
  DA: ["python", "sql", "excel", "tableau", "data visualization", "dashboard", "reporting", "statistical analysis", "data modeling"],
  BIE: ["python", "sql", "etl", "data pipeline", "data modeling", "data warehousing", "airflow", "aws"],
  SWE: ["python", "javascript", "algorithms", "data structures", "api", "git", "web development"],
};

// Extract requirement keywords from internship data
function extractRequirementKeywords(internship: Internship): string[] {
  const sources = [
    internship.requirements ?? "",
    internship.notes ?? "",
    internship.role ?? "",
  ].join(" ");

  const keywords: string[] = [];
  const text = norm(sources);

  // Known technical terms to look for
  const techTerms = [
    "python", "sql", "r", "java", "go", "javascript", "html", "css", "scala", "spark",
    "pandas", "numpy", "scikit-learn", "scipy", "tensorflow", "pytorch", "keras",
    "tableau", "excel", "jupyter", "git", "github", "docker", "kubernetes", "aws", "gcp", "azure",
    "kafka", "snowflake", "databricks", "bigquery", "redshift", "airflow",
    "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
    "machine learning", "deep learning", "data modeling", "data warehousing",
    "etl", "elt", "data pipeline", "data engineering",
    "statistics", "statistical analysis", "hypothesis testing", "a/b testing", "experimentation",
    "regression", "classification", "clustering", "nlp", "computer vision",
    "data visualization", "dashboard", "reporting",
    "rest api", "api", "web development",
    "algorithms", "data structures",
    "cross-validation", "random forest", "logistic regression",
    "network analysis", "graph analysis",
  ];

  for (const term of techTerms) {
    if (SHORT_TERMS.has(term)) {
      // Word-boundary match for short terms to avoid "r" matching "intern"
      if (new RegExp(`\\b${term}\\b`).test(text)) keywords.push(term);
    } else {
      if (text.includes(term)) keywords.push(term);
    }
  }

  // If no requirements text, infer from track
  if (keywords.length <= 2 && internship.track && TRACK_DEFAULTS[internship.track]) {
    return [...new Set([...keywords, ...TRACK_DEFAULTS[internship.track]])];
  }

  return [...new Set(keywords)];
}

// Score how relevant a resume item is to the internship
function scoreRelevance(tags: string[], requirementKeywords: string[], track: string | undefined): number {
  let score = 0;
  const normTags = tags.map(norm);

  for (const kw of requirementKeywords) {
    if (normTags.some((t) => t.includes(kw) || kw.includes(t))) score += 2;
  }

  // Track-based boosting
  if (track === "DS" || track === "DA") {
    const dsTerms = ["data analysis", "statistical analysis", "machine learning", "python", "sql", "tableau", "dashboard", "visualization"];
    for (const t of dsTerms) {
      if (normTags.some((tag) => tag.includes(t))) score += 1;
    }
  }
  if (track === "BIE") {
    const bieTerms = ["data pipeline", "etl", "sql", "data modeling", "api", "data engineering"];
    for (const t of bieTerms) {
      if (normTags.some((tag) => tag.includes(t))) score += 1;
    }
  }
  if (track === "SWE") {
    const sweTerms = ["web development", "api", "python", "javascript", "algorithms", "data structures", "platform"];
    for (const t of sweTerms) {
      if (normTags.some((tag) => tag.includes(t))) score += 1;
    }
  }

  return score;
}

// Match resume skills against internship requirements
function matchSkills(profile: ResumeProfile, requirementKeywords: string[]) {
  const allSkills = profile.skillKeywords;
  const matched: string[] = [];
  const gaps: string[] = [];

  for (const kw of requirementKeywords) {
    if (allSkills.some((s) => norm(s).includes(kw) || kw.includes(norm(s)))) {
      matched.push(kw);
    } else {
      gaps.push(kw);
    }
  }

  return { matched, gaps, coverage: requirementKeywords.length > 0 ? Math.round((matched.length / requirementKeywords.length) * 100) : 100 };
}

// Generate prep suggestions based on track, gaps, and the user's actual resume
function generatePrep(internship: Internship, gaps: string[], track: string | undefined, profile: ResumeProfile): string[] {
  const tips: string[] = [];
  const projectNames = profile.projects.map((p) => p.name).filter(Boolean);
  const expTitles = profile.experience.map((e) => e.title).filter(Boolean);

  if (track === "DS") {
    tips.push("Review: hypothesis testing, A/B test design, and metrics definition — common DS intern interview topics");
    if (projectNames.length > 0) tips.push(`Prepare to discuss your projects (${projectNames.slice(0, 2).join(", ")}) as proof of statistical and analytical rigor`);
    tips.push("Practice SQL window functions and CTEs — almost every DS interview includes a SQL round");
  } else if (track === "DA") {
    if (expTitles.length > 0) tips.push(`Prepare a portfolio walkthrough of your experience as ${expTitles[0]} — highlight dashboards and data storytelling`);
    tips.push("Review: translating data findings into business recommendations");
    tips.push("Practice SQL aggregations, joins, and subqueries for the technical screen");
  } else if (track === "BIE") {
    tips.push("Review: data modeling, schema design, and ETL/ELT patterns");
    tips.push("Practice SQL at intermediate-to-advanced level: CTEs, window functions, optimization");
    if (projectNames.length > 0) tips.push(`Be ready to discuss pipeline design and fault tolerance from your projects (${projectNames[0]})`);
  } else if (track === "SWE") {
    tips.push("Practice LeetCode medium-level problems: arrays, hashmaps, trees, graphs, and dynamic programming");
    if (expTitles.length > 0) tips.push(`Review your ${expTitles[0]} experience — demonstrates team collaboration`);
    tips.push("Prepare to discuss system design basics: API design, caching, databases");
  }

  if (gaps.length > 0) {
    tips.push(`Skill gaps to address: ${gaps.slice(0, 5).join(", ")}. Consider tutorials or small projects to build familiarity`);
  }

  if (internship.workAuth) {
    tips.push(`Work authorization note: ${internship.workAuth}`);
  }

  if (internship.gradEligibility) {
    tips.push(`Eligibility: ${internship.gradEligibility}. Confirm you meet this requirement before applying`);
  }

  return tips;
}

// Pick the strongest project for this role based on scored projects
function bestProject(track: string | undefined, profile: ResumeProfile, requirementKeywords: string[]): string {
  if (profile.projects.length === 0) return "No projects in resume — consider adding your strongest work";

  const scored = profile.projects
    .map((p) => ({ name: p.name, tech: p.tech, score: scoreRelevance(p.tags, requirementKeywords, track) }))
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 2);
  return top.map((p) => `${p.name} (${p.tech.join(", ")})`).join(" or ");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Read internship from applications.md
  const apps = readApplications();
  const app = apps.find((a) => a.n === id);
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
  const internship = appToInternship(app);

  const resumeProfile = loadResumeProfile();
  const track = internship.track;
  const requirementKeywords = extractRequirementKeywords(internship);
  const skills = matchSkills(resumeProfile, requirementKeywords);

  // Score and rank experience
  const rankedExperience = resumeProfile.experience
    .map((exp: ResumeExperience) => ({
      title: exp.title,
      company: exp.company,
      bullets: exp.bullets,
      score: scoreRelevance(exp.tags, requirementKeywords, track),
    }))
    .sort((a, b) => b.score - a.score);

  // Score and rank projects
  const rankedProjects = resumeProfile.projects
    .map((proj: ResumeProject) => ({
      name: proj.name,
      tech: proj.tech,
      bullets: proj.bullets,
      score: scoreRelevance(proj.tags, requirementKeywords, track),
    }))
    .sort((a, b) => b.score - a.score);

  // Build tailored bullet order for resume
  const tailoredBullets = [
    ...rankedExperience.flatMap((exp) =>
      exp.bullets.map((b) => ({ source: `${exp.title} @ ${exp.company}`, bullet: b })),
    ),
    ...rankedProjects.flatMap((proj) =>
      proj.bullets.map((b) => ({ source: proj.name, bullet: b })),
    ),
  ];

  const prep = generatePrep(internship, skills.gaps, track, resumeProfile);
  const leadProject = bestProject(track, resumeProfile, requirementKeywords);

  // Fit assessment
  let fitLevel: "strong" | "moderate" | "stretch";
  if (skills.coverage >= 70) fitLevel = "strong";
  else if (skills.coverage >= 40) fitLevel = "moderate";
  else fitLevel = "stretch";

  return NextResponse.json({
    internship: {
      company: internship.company,
      role: internship.role,
      track,
      requirements: internship.requirements,
      notes: internship.notes,
      deadline: internship.deadline,
      workAuth: internship.workAuth,
      gradEligibility: internship.gradEligibility,
    },
    fit: {
      level: fitLevel,
      skillCoverage: skills.coverage,
      matchedSkills: skills.matched,
      gapSkills: skills.gaps,
    },
    rankedExperience,
    rankedProjects,
    tailoredBullets: tailoredBullets.slice(0, 10),
    prep,
    leadProject,
    resume: {
      name: resumeProfile.name,
      education: resumeProfile.education,
      certifications: resumeProfile.certifications,
      skills: resumeProfile.skills,
    },
  });
}
