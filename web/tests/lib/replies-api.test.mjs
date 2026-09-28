import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

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

const { GET: getReplies, POST: postReplies } = await import("../../src/app/api/replies/route.ts");

async function withTempRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-replies-test-"));
  mkdirSync(path.join(root, "data"), { recursive: true });
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

test("replies POST classifies genuine rejections vs scheduling messages containing unfortunately", async () => {
  await withTempRoot(async () => {
    // 1. Scheduling message with conversational "unfortunately" should classify as interview
    const schedReq = new Request("http://fixture.invalid/api/replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Unfortunately Sarah is out on Monday, but we would love to schedule a call to interview you this week.",
        subject: "Next steps with Acme",
      }),
    });
    const schedRes = await postReplies(schedReq);
    assert.equal(schedRes.status, 200);
    const schedData = await schedRes.json();
    assert.equal(schedData.candidate.classification, "interview");

    // 2. Clear rejection email should classify as rejection
    const rejReq = new Request("http://fixture.invalid/api/replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Thank you for taking the time to speak with us. Unfortunately, we have decided to move forward with other candidates whose experience more closely matches our needs.",
        subject: "Your application at Acme",
      }),
    });
    const rejRes = await postReplies(rejReq);
    assert.equal(rejRes.status, 200);
    const rejData = await rejRes.json();
    assert.equal(rejData.candidate.classification, "rejection");
  });
});
