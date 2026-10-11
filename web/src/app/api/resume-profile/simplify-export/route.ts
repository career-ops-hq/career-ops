import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const dynamic = "force-dynamic";

type ResumeProfile = {
  name: string;
  education: { school: string; degree: string; expected: string };
  certifications: string[];
  skills: Record<string, string[]>;
  experience: {
    title: string;
    company: string;
    location: string;
    dates: string;
    bullets: string[];
  }[];
  projects: {
    name: string;
    tech: string[];
    bullets: string[];
  }[];
};

type SimplifyProfile = {
  firstName: string;
  lastName: string;
  education: { school: string; degree: string; graduationDate: string }[];
  experience: {
    title: string;
    company: string;
    location: string;
    startDate: string;
    endDate: string;
    description: string;
  }[];
  projects: { name: string; description: string; technologies: string[] }[];
  skills: string[];
  certifications: string[];
};

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function parseDateRange(dates: string): { startDate: string; endDate: string } {
  const m = dates.match(/((?:19|20)\d{2})\s*[–-]\s*((?:19|20)\d{2}|Present)/i);
  if (m) return { startDate: m[1], endDate: m[2] };
  return { startDate: dates, endDate: "" };
}

export async function GET() {
  const file = path.join(careerOpsRoot(), "data", "resume-profile.json");

  if (!fs.existsSync(file)) {
    return NextResponse.json(
      { error: "no resume profile found — upload a resume first" },
      { status: 404 },
    );
  }

  let profile: ResumeProfile;
  try {
    profile = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return NextResponse.json(
      { error: "resume profile is corrupt" },
      { status: 500 },
    );
  }

  const { firstName, lastName } = splitName(profile.name);

  const simplify: SimplifyProfile = {
    firstName,
    lastName,
    education: [
      {
        school: profile.education.school,
        degree: profile.education.degree,
        graduationDate: profile.education.expected,
      },
    ],
    experience: profile.experience.map((e) => {
      const { startDate, endDate } = parseDateRange(e.dates);
      return {
        title: e.title,
        company: e.company,
        location: e.location,
        startDate,
        endDate,
        description: e.bullets.join("\n"),
      };
    }),
    projects: profile.projects.map((p) => ({
      name: p.name,
      description: p.bullets.join("\n"),
      technologies: p.tech,
    })),
    skills: Object.values(profile.skills).flat(),
    certifications: profile.certifications,
  };

  return new NextResponse(JSON.stringify(simplify, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="simplify-profile.json"',
    },
  });
}
