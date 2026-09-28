import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCli } from "@/lib/clis";
import { extractVerifiedAchievements, executeNegotiationAiAction } from "@/lib/negotiation.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCandidateInfo(root: string) {
  let name = "Candidate";
  let email = "applicant@example.com";
  let targetComp = "$175,000 - $200,000";

  // 1. Check profile.yml
  const profilePath = path.join(root, "config", "profile.yml");
  if (fs.existsSync(profilePath)) {
    try {
      const parsed = yaml.load(fs.readFileSync(profilePath, "utf8")) as any;
      if (parsed?.candidate?.full_name) name = parsed.candidate.full_name;
      else if (parsed?.candidate?.name) name = parsed.candidate.name;
      if (parsed?.candidate?.email) email = parsed.candidate.email;
      if (parsed?.compensation?.target_range) targetComp = parsed.compensation.target_range;
      else if (parsed?.compensation?.target) targetComp = parsed.compensation.target;
    } catch {}
  }

  // 2. Check cv.md if name is still default
  const cvPath = path.join(root, "cv.md");
  if (name === "Candidate" && fs.existsSync(cvPath)) {
    try {
      const cvText = fs.readFileSync(cvPath, "utf8");
      const firstLine = cvText.split("\n")[0]?.trim();
      if (firstLine && firstLine.length < 50 && !firstLine.startsWith("#")) {
        name = firstLine;
      }
    } catch {}
  }

  return { name, email, targetComp };
}

export async function GET() {
  const root = careerOpsRoot();
  const cvPath = path.join(root, "cv.md");
  const storyBankPath = path.join(root, "interview-prep", "story-bank.md");

  let cvContent = "";
  let storyBankContent = "";

  if (fs.existsSync(cvPath)) {
    try {
      cvContent = fs.readFileSync(cvPath, "utf8");
    } catch {}
  }

  if (fs.existsSync(storyBankPath)) {
    try {
      storyBankContent = fs.readFileSync(storyBankPath, "utf8");
    } catch {}
  }

  const achievements = extractVerifiedAchievements({ storyBankContent, cvContent });
  const candidateInfo = getCandidateInfo(root);

  return Response.json({
    achievements,
    candidateName: candidateInfo.name,
    candidateEmail: candidateInfo.email,
    targetComp: candidateInfo.targetComp,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      company = "Acme Technologies",
      role = "Senior Engineer",
      recruiterName = "Hiring Team",
      currentOffer = "$175,000",
      targetAsk = "$195,000",
      strategy = "base",
      tone = "collaborative",
      competingOffer = "$190,000",
      achievement = "",
      cliId,
    } = body;

    const root = careerOpsRoot();
    const candidateInfo = getCandidateInfo(root);

    // Resolve AI CLI if requested
    let cliSpec = undefined;
    let binPath = undefined;
    if (cliId) {
      const resolved = resolveCli(cliId);
      if (resolved) {
        cliSpec = resolved.spec;
        binPath = resolved.binPath;
      }
    }

    const result = await executeNegotiationAiAction({
      company,
      role,
      recruiterName,
      currentOffer,
      targetAsk,
      strategy,
      tone,
      competingOffer,
      achievement,
      candidateName: candidateInfo.name,
      candidateEmail: candidateInfo.email,
      cliSpec,
      binPath,
      cwd: root,
    });

    return Response.json({
      ok: true,
      letter: result.letter,
      grounded: result.grounded,
      aiGenerated: result.aiGenerated,
      strategy: result.strategy,
      tone: result.tone,
      candidateName: candidateInfo.name,
      candidateEmail: candidateInfo.email,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
