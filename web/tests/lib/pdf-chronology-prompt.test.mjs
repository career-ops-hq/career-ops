import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";
import { validateCvExperienceOrder } from "../../../cv-experience-order.mjs";

const args = { kind: "pdf", input: "018", memory: "", today: "2026-08-04" };

test("web PDF tailoring keeps whole roles newest-first and tailors bullets within each role", () => {
  const prompt = buildPrompt(args);
  assert.doesNotMatch(prompt, /reorder experience by relevance/i);
  assert.match(prompt, /reorder bullets within each experience entry by relevance/i);
  assert.match(prompt, /Work Experience entries in reverse-chronological order.*newest start date first/i);
  assert.match(prompt, /preserving (?:their real )?company, title, and dates from cv\.md/i);
  assert.match(prompt, /Never promote an older role above a newer role for relevance/i);
  assert.match(prompt, /check the job-period sequence is newest-first/i);
  assert.match(prompt, /Do NOT save or edit any file/);
  assert.doesNotMatch(prompt, /--allow-nonchronological|--skip-fact-check/);
});

test("the PDF chronology gate rejects the old relevance ordering but accepts newest-first entries", () => {
  const role = (dates, bullet) => `<div class="experience-entry"><span class="job-period">${dates}</span><ul><li>${bullet}</li></ul></div>`;
  const current = role("Jan 2025 - Present", "Current role");
  const earlier = role("Mar 2019 - Oct 2023", "Earlier experience relevant to the vacancy");
  assert.throws(() => validateCvExperienceOrder(earlier + current), /not in reverse-chronological order/);
  assert.doesNotThrow(() => validateCvExperienceOrder(current + earlier));
});
