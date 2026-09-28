import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readProfileCandidateInfo } from "@/lib/career-ops";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { type, company, role, recipient, fitPoints } = body;

    const { name: candidateName } = readProfileCandidateInfo();

    let subject = "";
    let emailBody = "";

    switch (type) {
      case "recruiter-app":
        subject = `Application: ${role} — ${candidateName}`;
        emailBody = `Hi ${recipient || "there"},

I recently applied for the ${role} opening at ${company} and wanted to reach out directly to express my strong interest.

A quick summary of why I believe I'd be a great fit:
- ${fitPoints || "Extensive background delivering scalable architectures and high-impact features."}
- Proven track record in rapid execution, clear communication, and system reliability.

I have attached my CV for your convenience. I'd love the opportunity to connect briefly if you feel my background aligns with what you're looking for.

Best regards,
${candidateName}`;
        break;

      case "referral":
        subject = `Quick question regarding ${company} / ${role}`;
        emailBody = `Hi ${recipient || "there"},

Hope you're having a great week!

I noticed that ${company} is currently looking for a ${role}. Given your experience at ${company}, I was hoping to ask you a couple of quick questions about the team culture and priorities.

If you have a quick 5 minutes, I'd be incredibly grateful for any insights you might be open to sharing.

Thanks so much,
${candidateName}`;
        break;

      case "followup":
        subject = `Following up: ${role} application — ${candidateName}`;
        emailBody = `Hi ${recipient || "there"},

I wanted to follow up on my application for the ${role} position at ${company}. 

I remain very excited about the opportunity and the team's mission. Please let me know if there are any additional materials or details I can provide to support my application.

Thank you again for your time and consideration!

Best,
${candidateName}`;
        break;

      case "interview-thanks":
        subject = `Thank you — ${company} ${role} interview`;
        emailBody = `Hi ${recipient || "there"},

Thank you so much for taking the time to speak with me today about the ${role} role at ${company}.

I really enjoyed our conversation, especially learning more about your team's upcoming roadmap and technical challenges. Our discussion reinforced my enthusiasm for joining ${company}.

Looking forward to the next steps!

Warmly,
${candidateName}`;
        break;

      default:
        subject = `Inquiry regarding ${role} at ${company}`;
        emailBody = `Hi ${recipient || "there"},

I am reaching out regarding the ${role} role at ${company}. I'd love to connect and share more about how my experience aligns with your team's goals.

Best,
${candidateName}`;
    }

    return NextResponse.json({
      subject,
      body: emailBody,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
