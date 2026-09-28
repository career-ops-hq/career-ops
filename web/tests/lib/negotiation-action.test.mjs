import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

// Register Node alias loader for '@/lib/...'
const webSrc = fileURLToPath(new URL("../../src/", import.meta.url));
const loader = `
  import { existsSync } from "node:fs";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(${JSON.stringify(webSrc)}, specifier.slice(2));
      for (const ext of [".ts", ".tsx", ".mjs", ".js", ""]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, pathToFileURL(webSrc));

const {
  extractVerifiedAchievements,
  generateCounterOfferLetter,
  buildNegotiationPrompt,
  executeNegotiationAiAction,
} = await import("../../src/lib/negotiation.mjs");

const { GET: getNegotiate, POST: postNegotiate } = await import("../../src/app/api/negotiate/route.ts");

const SAMPLE_CV = `JOHN DOE
john@example.com | +1234567890 | San Francisco, CA

Experience
Senior Software Engineer | Acme Corp | 2022 - Present
• Architected scalable FastAPI APIs improving application scalability by 30%.
• Built distributed task scheduler handling 2M requests/day with 99.99% uptime.
• Automated CI/CD pipelines reducing deployment friction by 75%.
`;

const SAMPLE_STORY_BANK = `### [Scaling] High-Throughput Job Processing
**Situation:** System was struggling with peak morning loads.
**Task:** Redesign queue architecture.
**Action:** Implemented RabbitMQ with Celery and Redis caching.
**Result:** Scaled throughput by 30% and cut p99 latency to 45ms.

### [Unverified Story] Invented Numbers
**Action:** Rebuilt legacy databases.
**Result:** Increased database query performance by 999% and saved 5000 hours.
`;

async function withTempRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-negotiate-test-"));
  mkdirSync(path.join(root, "config"), { recursive: true });
  mkdirSync(path.join(root, "interview-prep"), { recursive: true });

  writeFileSync(path.join(root, "cv.md"), SAMPLE_CV);
  writeFileSync(path.join(root, "interview-prep", "story-bank.md"), SAMPLE_STORY_BANK);
  writeFileSync(
    path.join(root, "config", "profile.yml"),
    "candidate:\n  full_name: John Doe\n  email: john@example.com\ncompensation:\n  target_range: $180,000 - $210,000\n"
  );

  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    await fn({ root });
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

// ──────────────── 1. STAR Achievement Extraction & Grounding ────────────────

test("extracts and verifies achievements against cv.md facts", () => {
  const achievements = extractVerifiedAchievements({
    cvContent: SAMPLE_CV,
    storyBankContent: SAMPLE_STORY_BANK,
  });

  assert.ok(achievements.length >= 3, `Expected at least 3 achievements, got ${achievements.length}`);

  // Verified CV bullet
  const cvItem = achievements.find((a) => a.text.includes("improving application scalability by 30%"));
  assert.ok(cvItem, "CV bullet point should be extracted");
  assert.equal(cvItem.verified, true);
  assert.equal(cvItem.metric, "30%");

  // Story bank item whose numbers (30%) exist in CV -> verified
  const verifiedStory = achievements.find((a) => a.title.includes("High-Throughput Job Processing"));
  assert.ok(verifiedStory, "Story bank item should be parsed");

  // Story bank item with invented numbers (999%, 5000) not in CV -> unverified
  const unverifiedStory = achievements.find((a) => a.title.includes("Invented Numbers"));
  assert.ok(unverifiedStory, "Unverified story should be detected");
  assert.equal(unverifiedStory.verified, false, "Claim with numbers missing from cv.md must be marked unverified");
});

// ──────────────── 2. Tone Selection ────────────────

test("generates counter-offer with collaborative tone", () => {
  const letter = generateCounterOfferLetter({
    company: "Vercel",
    role: "Senior AI Engineer",
    recruiterName: "Sarah",
    currentOffer: "$175,000",
    targetAsk: "$195,000",
    strategy: "base",
    tone: "collaborative",
    achievement: "architected scalable FastAPI APIs improving application scalability by 30%",
  });

  assert.match(letter, /Dear Sarah,/);
  assert.match(letter, /genuinely thrilled about the team/i);
  assert.match(letter, /Is there flexibility within your compensation band/i);
  assert.match(letter, /improving application scalability by 30%/);
});

test("generates counter-offer with assertive tone", () => {
  const letter = generateCounterOfferLetter({
    company: "Stripe",
    role: "Staff Infrastructure Engineer",
    recruiterName: "Alex",
    currentOffer: "$180,000",
    targetAsk: "$205,000",
    strategy: "base",
    tone: "assertive",
    achievement: "built distributed task scheduler handling 2M requests/day",
  });

  assert.match(letter, /confident in the technical ownership/i);
  assert.match(letter, /fully prepared to accept and sign the agreement immediately/i);
  assert.match(letter, /handling 2M requests\/day/);
});

test("generates counter-offer with strategic / ROI-anchored tone", () => {
  const letter = generateCounterOfferLetter({
    company: "Anthropic",
    role: "Lead Platform Engineer",
    recruiterName: "David",
    currentOffer: "$190,000",
    targetAsk: "$215,000",
    strategy: "base",
    tone: "strategic",
    achievement: "automated CI/CD pipelines reducing deployment friction by 75%",
  });

  assert.match(letter, /ensure long-term parity with the business impact/i);
  assert.match(letter, /drive immediate measurable returns/i);
  assert.match(letter, /reducing deployment friction by 75%/);
});

// ──────────────── 3. Strategy Selection ────────────────

test("competing offer strategy incorporates competing numbers and closing commitment", () => {
  const letter = generateCounterOfferLetter({
    company: "Databricks",
    role: "Staff Engineer",
    recruiterName: "Rachel",
    currentOffer: "$180,000",
    targetAsk: "$200,000",
    strategy: "competing",
    tone: "collaborative",
    competingOffer: "$195,000",
    achievement: "automated CI/CD pipelines reducing deployment friction by 75%",
  });

  assert.match(letter, /\$195,000/);
  assert.match(letter, /decline the other opportunity and sign with you right away/i);
});

test("geographic defense strategy emphasizes value-based national parity", () => {
  const letter = generateCounterOfferLetter({
    company: "Shopify",
    role: "Senior Backend Engineer",
    recruiterName: "Mark",
    currentOffer: "$165,000",
    targetAsk: "$185,000",
    strategy: "geo",
    achievement: "architected scalable FastAPI APIs improving application scalability by 30%",
  });

  assert.match(letter, /location-based salary bands/i);
  assert.match(letter, /identical regardless of physical location/i);
  assert.match(letter, /top-of-band national target of \$185,000/);
});

test("equity and sign-on pivot strategy bridges base salary ceilings", () => {
  const letter = generateCounterOfferLetter({
    company: "OpenAI",
    role: "AI Engineer",
    recruiterName: "Emma",
    currentOffer: "$175,000",
    targetAsk: "$195,000",
    strategy: "equity",
    achievement: "built distributed task scheduler handling 2M requests/day",
  });

  assert.match(letter, /fixed base salary ceiling/i);
  assert.match(letter, /Year 1 sign-on bonus or an expanded initial equity/i);
});

// ──────────────── 4. Prompt Grounding Invariant ────────────────

test("buildNegotiationPrompt embeds strict anti-hallucination instructions", () => {
  const prompt = buildNegotiationPrompt({
    company: "Acme Corp",
    role: "Principal Engineer",
    recruiterName: "Sarah",
    currentOffer: "$180,000",
    targetAsk: "$210,000",
    strategy: "base",
    tone: "strategic",
    verifiedAchievements: [{ source: "cv", text: "Scaled API throughput by 30%" }],
    candidateName: "John Doe",
  });

  assert.match(prompt, /STRICT GROUNDING INVARIANT/);
  assert.match(prompt, /NEVER invent, extrapolate, or fabricate/);
  assert.match(prompt, /Scaled API throughput by 30%/);
});

// ──────────────── 5. API Endpoints Integration ────────────────

test("GET /api/negotiate returns verified achievements and candidate targeting", async () => {
  await withTempRoot(async () => {
    const res = await getNegotiate();
    const data = await res.json();

    assert.equal(data.candidateName, "John Doe");
    assert.equal(data.candidateEmail, "john@example.com");
    assert.ok(Array.isArray(data.achievements));
    assert.ok(data.achievements.length >= 3);
    assert.ok(data.achievements.some((a) => a.text.includes("scalability by 30%")));
  });
});

test("POST /api/negotiate returns grounded letter with requested strategy and tone", async () => {
  await withTempRoot(async () => {
    const req = new Request("http://fixture.invalid/api/negotiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: "Figma",
        role: "Senior AI Systems Engineer",
        recruiterName: "Lisa",
        currentOffer: "$175,000",
        targetAsk: "$195,000",
        strategy: "base",
        tone: "strategic",
        achievement: "Architected scalable FastAPI APIs improving application scalability by 30%.",
      }),
    });

    const res = await postNegotiate(req);
    const data = await res.json();

    assert.equal(data.ok, true);
    assert.equal(data.grounded, true);
    assert.equal(data.strategy, "base");
    assert.equal(data.tone, "strategic");
    assert.match(data.letter, /Dear Lisa,/);
    assert.match(data.letter, /Figma/);
    assert.match(data.letter, /improving application scalability by 30%/);
  });
});
