import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readProfileCandidateInfo } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { company, role, motivation, impactPoints, approach, tone } = body;

    if (!company || !role) {
      return NextResponse.json({ error: "Company and role are required" }, { status: 400 });
    }

    const { name: candidateName, email: candidateEmail } = readProfileCandidateInfo();

    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const draft = `${candidateName}
${candidateEmail}
${today}

Hiring Team
${company}

Re: Application for ${role}

Dear ${company} Hiring Team,

I am writing to express my enthusiastic interest in the ${role} position at ${company}. ${motivation || `Having closely followed ${company}'s work and growth, I am deeply impressed by your engineering standards and product vision.`}

Throughout my career, I have focused on delivering scalable, high-impact systems that solve critical operational challenges:
- ${impactPoints || `Architected high-throughput services with proven reliability and performance.`}
- ${approach || `Fostered collaborative engineering practices that increased deployment velocity and code quality.`}

What excites me most about ${company} is the opportunity to contribute immediately to your team's objectives with a hands-on, metrics-driven engineering approach.

Thank you for your time and consideration. I welcome the opportunity to discuss how my background aligns with ${company}'s goals.

Sincerely,

${candidateName}`;

    return NextResponse.json({ draft });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
