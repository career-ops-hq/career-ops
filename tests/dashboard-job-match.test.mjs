import test from "node:test";
import assert from "node:assert/strict";
import { analyzeJobMatch } from "../server/jobMatch.mjs";

const classify = (title, jd) => analyzeJobMatch({ title, company: "Test", location: "EU Remote" }, jd);

test("1. React Next.js TypeScript frontend is BEST MATCH", () => {
  assert.equal(classify("Senior Frontend Developer", "Required: React, Next.js and TypeScript. Build accessible web applications and own frontend architecture.").matchClassification, "BEST MATCH");
});

test("2. React Native Expo iOS Android is SKIP and React Native is not React web", () => {
  const result = classify("Senior React Native Developer", "Required React Native and Expo. Build iOS and Android mobile applications.");
  assert.equal(result.matchClassification, "SKIP");
  assert.equal(result.signals.reactWebCount, 0);
});

for (const [number, stack, jd] of [
  [3, "Java / React", "Java and Spring are required. Own backend APIs and microservices. React is used for a small UI."],
  [4, ".NET / React", ".NET and C# are required. Primary ownership is backend services; React supports the UI."],
  [5, "Python / React", "Python and FastAPI are required. Build backend APIs and services. React is secondary."]
]) {
  test(`${number}. ${stack} backend-primary fullstack is LOW MATCH`, () => {
    assert.equal(classify(`Senior Fullstack ${stack}`, jd).matchClassification, "LOW MATCH");
  });
}

test("6. frontend-heavy TypeScript React Node.js fullstack is STRONG or BEST", () => {
  assert.match(classify("Fullstack TypeScript / React / Node.js", "Primarily frontend-focused: build React and TypeScript web UI. Maintain light Node.js APIs.").matchClassification, /^(BEST|STRONG) MATCH$/);
});

test("7. React TypeScript frontend with optional Node.js is BEST MATCH", () => {
  assert.equal(classify("Frontend Engineer React / TypeScript", "React and TypeScript are required for frontend web applications. Node.js is optional / nice-to-have.").matchClassification, "BEST MATCH");
});

test("8. Magento Hyva frontend is BEST MATCH", () => {
  assert.equal(classify("Magento Frontend Developer / Hyvä", "Build Magento 2 storefronts with Hyvä.").matchClassification, "BEST MATCH");
});

test("9. Shopify Liquid frontend is BEST MATCH", () => {
  assert.equal(classify("Shopify / Liquid Frontend Developer", "Develop Shopify themes using Liquid.").matchClassification, "BEST MATCH");
});

test("e-commerce keyword does not make QA, analyst, or project management a Best Match", () => {
  for (const title of ["QA Engineer (Magento)", "Business Analyst (Shopify)", "Project Manager (Magento Exp)"]) {
    assert.notEqual(classify(title, "Work with a Magento and Shopify delivery team.").matchClassification, "BEST MATCH");
  }
});

test("Vue title with incidental React mention is not promoted", () => {
  assert.equal(classify("Senior Frontend Engineer (Vue)", "Vue is required. Familiarity with React is a plus.").matchClassification, "LOW MATCH");
});

test("mandatory Python excludes Best Match even in a frontend-dominant JD", () => {
  const result = classify("Senior Frontend Developer", "React, Next.js and TypeScript frontend is dominant. Strong Python experience is required for supporting APIs.");
  assert.equal(result.matchClassification, "LOW MATCH");
});

test("mandatory backend ownership is LOW even with React and Node.js", () => {
  const result = classify("Fullstack React+Node", "React UI plus mandatory ownership of backend microservices and distributed services.");
  assert.equal(result.matchClassification, "LOW MATCH");
});

test("mandatory language is distinguished from optional local language", () => {
  assert.equal(classify("Frontend React Engineer", "React and TypeScript required. German is nice-to-have.").matchClassification, "BEST MATCH");
  assert.equal(classify("Frontend React Engineer", "React and TypeScript required. Fluent German is mandatory.").matchClassification, "LOW MATCH");
});
