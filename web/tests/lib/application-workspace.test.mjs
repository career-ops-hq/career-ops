import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(join(dir, "..", "..", "src", "components", "application-workspace.tsx"), "utf8");
const routeSource = readFileSync(join(dir, "..", "..", "src", "app", "api", "application-kit", "route.ts"), "utf8");

test("workspace UI does not contain hardcoded degree text", () => {
  assert.doesNotMatch(workspaceSource, /MSc\s+CS\s*&\s*IT/i);
});

test("workspace UI gates animations with motion-safe", () => {
  // Ensure animate-spin and animate-pulse are gated by motion-safe
  const ungatedSpin = workspaceSource.match(/(?<!motion-safe:)animate-spin/g);
  const ungatedPulse = workspaceSource.match(/(?<!motion-safe:)animate-pulse/g);
  assert.equal(ungatedSpin, null, "Found ungated animate-spin in application-workspace.tsx");
  assert.equal(ungatedPulse, null, "Found ungated animate-pulse in application-workspace.tsx");
});

test("workspace UI renders kit.gaps independently of evidence matrix", () => {
  assert.match(workspaceSource, /kit\.gaps\s*&&\s*kit\.gaps\.length\s*>\s*0/);
});

test("workspace editors have associated labels and accessible names", () => {
  assert.match(workspaceSource, /htmlFor="workspace-jd-input"/);
  assert.match(workspaceSource, /htmlFor="workspace-questions-input"/);
  assert.match(workspaceSource, /htmlFor="workspace-cover-letter-input"/);
  assert.match(workspaceSource, /htmlFor="outreach-recruiter-note"/);
  assert.match(workspaceSource, /htmlFor="outreach-hiring-manager-msg"/);
  assert.match(workspaceSource, /htmlFor="outreach-referral-msg"/);
  assert.match(workspaceSource, /htmlFor="outreach-hiring-subject"/);
  assert.match(workspaceSource, /htmlFor="outreach-hiring-body"/);
  assert.match(workspaceSource, /htmlFor="outreach-followup-subject"/);
  assert.match(workspaceSource, /htmlFor="outreach-followup-body"/);
});

test("workspace provides polite and assertive live regions", () => {
  assert.match(workspaceSource, /role="status"\s+aria-live="polite"/);
  assert.match(workspaceSource, /role="alert"\s+aria-live="assertive"/);
});

test("workspace preserves drafts across selection and editing", () => {
  assert.match(workspaceSource, /drafts/);
  assert.match(workspaceSource, /drafts\[k\.id\]/);
});

test("application-kit route derives today via localISODate rather than UTC slice", () => {
  assert.match(routeSource, /import\s*{[^}]*localISODate[^}]*}\s*from\s*["']@\/lib\/followups["']/);
  assert.match(routeSource, /localISODate\(\)/);
});
