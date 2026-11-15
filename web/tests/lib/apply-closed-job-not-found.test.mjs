// An Ashby posting that has been taken down renders "Job not found" in the page
// body while the title stays the company name. Apply must report it as closed,
// not as a generic "couldn't find a fillable form".
//
// Run (from web/): node --experimental-strip-types --test tests/lib/apply-closed-job-not-found.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import "../helpers/web-ts-alias-loader.mjs";

const { classifyEmpty } = await import("../../src/lib/apply/diagnose.ts");

function pageWith(url, title, body) {
  return {
    url: () => url,
    evaluate: async () => ({ t: title.toLowerCase(), body: body.toLowerCase(), hasPassword: false, challengeDom: false }),
  };
}

describe("classifyEmpty reports a closed Ashby posting", () => {
  for (const url of [
    "https://jobs.ashbyhq.com/elevenlabs/203ef08b-7bb0-42b7-8099-d3d770fe3615",
    "https://jobs.ashbyhq.com/genspark/8647213a-b890-417a-bd5d-7d1293d2f33a",
  ]) {
    test(`"Job not found" body on ${url}`, async () => {
      const issue = await classifyEmpty(pageWith(url, "ElevenLabs", "Job not found"), url);
      assert.equal(issue.level, "block");
      assert.equal(issue.code, "expired");
    });
  }

  test("an ordinary page without the phrase is still no-form", async () => {
    const url = "https://careers.acme.test/role";
    const issue = await classifyEmpty(pageWith(url, "Acme role", "Apply for this role at Acme."), url);
    assert.equal(issue.code, "no-form");
  });
});
