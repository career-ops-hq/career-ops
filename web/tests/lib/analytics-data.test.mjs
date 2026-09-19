import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const loaderSrc = [
  "import { existsSync } from 'node:fs';",
  "import path from 'node:path';",
  "import { pathToFileURL } from 'node:url';",
  `const WEB_SRC = ${JSON.stringify(WEB_SRC)};`,
  "const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.mts'];",
  "export async function resolve(specifier, context, nextResolve) {",
  "  if (specifier.startsWith('@/')) {",
  "    const base = path.join(WEB_SRC, specifier.slice(2));",
  "    for (const ext of EXTS) { if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true }; }",
  "    if (existsSync(base)) return { url: pathToFileURL(base).href, shortCircuit: true };",
  "  }",
  "  return nextResolve(specifier, context);",
  "}",
].join("\n");
register("data:text/javascript," + encodeURIComponent(loaderSrc), pathToFileURL(WEB_SRC + "/"));

const { enrichAnalyticsApplication } = await import("../../src/lib/analytics-data.ts");

const application = (notes, role = "AI Engineer") => ({
  n: "1",
  date: "2026-09-18",
  company: "Example",
  role,
  score: "4.0/5",
  status: "Applied",
  pdf: "",
  report: "",
  notes,
});

test("report prose cannot become location or cross-currency compensation", () => {
  const report = `# Example\n\n**Location** | Apply to one team\n\n## Machine Summary\n\n\`\`\`yaml\narchetype_primary: AI Platform / LLMOps\ncomp_estimate_myr_month: MYR 7,000\n\`\`\``;
  const enriched = enrichAnalyticsApplication(application("Kuala Lumpur; Hybrid; MYR 7,000 monthly"), report);

  assert.equal(enriched.archetype, "AI Platform / LLMOps");
  assert.equal(enriched.location, "Kuala Lumpur");
  assert.equal(enriched.workMode, "Hybrid");
  assert.equal(enriched.payMax, 0);
  assert.equal(enriched.paySource, "");
});

test("tracker note conventions provide location, work mode and pay", () => {
  const enriched = enrichAnalyticsApplication(
    application("Berlin; Remote; Salary $140-180K (POSTED)"),
    "**Archetype:** Applied AI Engineer",
  );

  assert.equal(enriched.archetype, "Applied AI Engineer");
  assert.equal(enriched.location, "Berlin");
  assert.equal(enriched.workMode, "Remote");
  assert.equal(enriched.payMax, 180_000);
  assert.equal(enriched.paySource, "POSTED");
});

test("funding figures are not treated as compensation", () => {
  const enriched = enrichAnalyticsApplication(application("Remote; $70M Series C"));

  assert.equal(enriched.workMode, "Remote");
  assert.equal(enriched.payMax, 0);
});

test("uppercase prose and currency-less monthly shorthand stay out of analytics", () => {
  const enriched = enrichAnalyticsApplication(
    application("BEST TECHNICAL FIT IN THE PIPELINE. Salary 7K monthly."),
  );

  assert.equal(enriched.location, "");
  assert.equal(enriched.payMax, 0);
});

test("non-USD amounts and finance acronyms are not relabeled as USD or locations", () => {
  const enriched = enrichAnalyticsApplication(
    application("GL, AP, AR and trial balance. Singapore salary SGD 7K monthly."),
  );

  assert.equal(enriched.location, "Singapore");
  assert.equal(enriched.payMax, 0);
});
