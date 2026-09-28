import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export type ReplyCandidate = {
  id: string;
  date: string;
  sender?: string;
  subject?: string;
  snippet: string;
  classification: "interview" | "rejection" | "questionnaire" | "offer" | "other";
  matchedCompany?: string;
  matchedAppNumber?: string;
  suggestedStatus?: string;
  confidence: number;
};

export async function GET() {
  const root = careerOpsRoot();
  const repliesPath = path.join(root, "data", "reply-candidates.json");

  let candidates: ReplyCandidate[] = [];
  if (fs.existsSync(repliesPath)) {
    try {
      candidates = JSON.parse(fs.readFileSync(repliesPath, "utf8"));
    } catch {}
  }

  return Response.json({
    candidates,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message, sender, subject } = body;

    if (!message || message.trim().length === 0) {
      return Response.json({ error: "Message content is required" }, { status: 400 });
    }

    const root = careerOpsRoot();
    const apps = readApplications();

    const lower = (message + " " + (subject || "")).toLowerCase();

    // Heuristic classification
    let classification: ReplyCandidate["classification"] = "other";
    let suggestedStatus = "Applied";
    let confidence = 0.7;

    if (
      lower.includes("pursuing other candidates") ||
      lower.includes("not moving forward") ||
      lower.includes("decided not to proceed") ||
      lower.includes("position has been filled") ||
      lower.includes("other candidates whose") ||
      lower.includes("not to move forward") ||
      lower.includes("will not be moving forward") ||
      lower.includes("unable to offer you") ||
      lower.includes("decided to move forward with other") ||
      lower.includes("decided to pursue other") ||
      lower.includes("unfortunately, we will not") ||
      lower.includes("unfortunately we will not") ||
      lower.includes("unfortunately, we are not") ||
      lower.includes("unfortunately we are not") ||
      lower.includes("unfortunately, we have decided") ||
      lower.includes("unfortunately we have decided") ||
      lower.includes("unfortunately, at this time") ||
      lower.includes("unfortunately at this time") ||
      lower.includes("unfortunately, after careful") ||
      lower.includes("unfortunately after careful") ||
      lower.includes("wish you the best in your job search") ||
      lower.includes("best of luck with your job search")
    ) {
      classification = "rejection";
      suggestedStatus = "Rejected";
      confidence = 0.92;
    } else if (
      lower.includes("pleased to offer") ||
      lower.includes("offer of employment") ||
      lower.includes("formal offer") ||
      lower.includes("extend an offer") ||
      lower.includes("congratulations on your offer") ||
      lower.includes("offer letter") ||
      lower.includes("compensation package")
    ) {
      classification = "offer";
      suggestedStatus = "Offer";
      confidence = 0.95;
    } else if (
      lower.includes("interview") ||
      lower.includes("chat with") ||
      lower.includes("schedule a call") ||
      lower.includes("calendly.com") ||
      lower.includes("availabilities") ||
      lower.includes("phone screen")
    ) {
      classification = "interview";
      suggestedStatus = "Interview";
      confidence = 0.9;
    } else if (
      lower.includes("assessment") ||
      lower.includes("hackerrank") ||
      lower.includes("codesignal") ||
      lower.includes("take-home") ||
      lower.includes("questionnaire")
    ) {
      classification = "questionnaire";
      suggestedStatus = "Screen";
      confidence = 0.85;
    }

    // Match company from applications
    let matchedCompany: string | undefined;
    let matchedAppNumber: string | undefined;

    for (const app of apps) {
      if (app.company && lower.includes(app.company.toLowerCase())) {
        matchedCompany = app.company;
        matchedAppNumber = app.n;
        break;
      }
    }

    const newCandidate: ReplyCandidate = {
      id: `rep-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      sender,
      subject,
      snippet: message.slice(0, 300) + (message.length > 300 ? "..." : ""),
      classification,
      matchedCompany,
      matchedAppNumber,
      suggestedStatus,
      confidence,
    };

    const repliesPath = path.join(root, "data", "reply-candidates.json");
    let current: ReplyCandidate[] = [];
    if (fs.existsSync(repliesPath)) {
      try {
        current = JSON.parse(fs.readFileSync(repliesPath, "utf8"));
      } catch {}
    }

    current.unshift(newCandidate);
    atomicWrite(repliesPath, JSON.stringify(current, null, 2));

    return Response.json({ success: true, candidate: newCandidate });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
