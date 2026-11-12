import "../helpers/web-ts-alias-loader.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizePageFormat, PAGE_FORMATS, DEFAULT_PAGE_FORMAT, PAGE_WIDTHS } from "../../src/lib/page-formats.mjs";
import { resolveRenderPageFormat } from "../../src/lib/core/page-format.mjs";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";
import { spawnGeneratePdf } from "../../src/lib/pdf-render.mjs";

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Dynamic import for route.ts so the alias loader is active
const { POST } = await import("../../src/app/api/run/route.ts");

describe("CV format generation and propagation (Issue #6919)", () => {
  // 1. Format normalization & validation
  test("normalizePageFormat: accepts valid formats case-insensitively and trimmed", () => {
    assert.equal(normalizePageFormat("a4"), "a4");
    assert.equal(normalizePageFormat("A4"), "a4");
    assert.equal(normalizePageFormat(" letter "), "letter");
    assert.equal(normalizePageFormat("LETTER"), "letter");
  });

  test("normalizePageFormat: rejects unsupported or non-string format values", () => {
    assert.equal(normalizePageFormat(""), null);
    assert.equal(normalizePageFormat("   "), null);
    assert.equal(normalizePageFormat("docx"), null);
    assert.equal(normalizePageFormat("invalid"), null);
    assert.equal(normalizePageFormat("pdf"), null);
    assert.equal(normalizePageFormat(null), null);
    assert.equal(normalizePageFormat(undefined), null);
    assert.equal(normalizePageFormat(123), null);
    assert.equal(normalizePageFormat({}), null);
  });

  // 2. API Route validation and error handling
  test("POST /api/run: rejects unsupported format with status 400 and actionable error", async () => {
    const invalidFormats = ["docx", "invalid", "pdf", "legal"];
    for (const fmt of invalidFormats) {
      const req = new Request("http://localhost/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "pdf", input: "1", cliId: "gemini", format: fmt }),
      });
      const res = await POST(req);
      assert.equal(res.status, 400, `Expected 400 for format "${fmt}"`);
      const data = await res.json();
      assert.deepEqual(data, { error: `Invalid format "${fmt}". Use: a4, letter` });
    }
  });

  test("POST /api/run: rejects non-string unsupported format values with status 400", async () => {
    for (const fmt of [123, false, { type: "a4" }]) {
      const req = new Request("http://localhost/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "pdf", input: "1", cliId: "gemini", format: fmt }),
      });
      const res = await POST(req);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /^Invalid format .*\. Use: a4, letter$/);
    }
  });

  test("POST /api/run: missing format field is accepted and does not fail format validation", async () => {
    // When format is omitted
    const req = new Request("http://localhost/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "pdf", input: "1", cliId: "gemini" }),
    });
    const res = await POST(req);
    // Should pass format validation and reach CLI lookup / CV check (not 400 Invalid format)
    if (res.status === 400) {
      const data = await res.json();
      assert.ok(!data.error?.startsWith("Invalid format"), `Unexpected format error: ${data.error}`);
    }
  });

  test("POST /api/run: null format field is accepted and does not fail format validation", async () => {
    const req = new Request("http://localhost/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "pdf", input: "1", cliId: "gemini", format: null }),
    });
    const res = await POST(req);
    if (res.status === 400) {
      const data = await res.json();
      assert.ok(!data.error?.startsWith("Invalid format"), `Unexpected format error: ${data.error}`);
    }
  });

  test("POST /api/run: empty string format field is accepted and does not fail format validation", async () => {
    for (const emptyFmt of ["", "   "]) {
      const req = new Request("http://localhost/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "pdf", input: "1", cliId: "gemini", format: emptyFmt }),
      });
      const res = await POST(req);
      if (res.status === 400) {
        const data = await res.json();
        assert.ok(!data.error?.startsWith("Invalid format"), `Unexpected format error: ${data.error}`);
      }
    }
  });

  test("POST /api/run: explicitly configured format is accepted and does not fail format validation", async () => {
    for (const validFmt of ["a4", "letter", "A4", " letter "]) {
      const req = new Request("http://localhost/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "pdf", input: "1", cliId: "gemini", format: validFmt }),
      });
      const res = await POST(req);
      if (res.status === 400) {
        const data = await res.json();
        assert.ok(!data.error?.startsWith("Invalid format"), `Unexpected format error: ${data.error}`);
      }
    }
  });

  // 3. Prompt construction with explicit format vs default fallback
  test("buildPrompt: explicit a4 format instructs agent to use format='a4' and 210mm width", () => {
    const prompt = buildPrompt({
      kind: "pdf",
      input: "1",
      memory: "",
      today: "2026-11-12",
      pageFormat: { setting: "a4", letterCountries: [] },
      codeRoot: CORE,
    });

    assert.ok(prompt.includes('<<cv-html format="a4">>'), "Prompt must require format='a4'");
    assert.ok(prompt.includes(PAGE_WIDTHS.a4), "Prompt must specify 210mm body width");
    assert.ok(!prompt.includes('<<cv-html format="letter">>'), "Prompt must not offer letter when a4 is explicit");
  });

  test("buildPrompt: explicit letter format instructs agent to use format='letter' and 8.5in width", () => {
    const prompt = buildPrompt({
      kind: "pdf",
      input: "1",
      memory: "",
      today: "2026-11-12",
      pageFormat: { setting: "letter", letterCountries: [] },
      codeRoot: CORE,
    });

    assert.ok(prompt.includes('<<cv-html format="letter">>'), "Prompt must require format='letter'");
    assert.ok(prompt.includes(PAGE_WIDTHS.letter), "Prompt must specify 8.5in body width");
    assert.ok(!prompt.includes('<<cv-html format="a4">>'), "Prompt must not offer a4 when letter is explicit");
  });

  test("buildPrompt: incomplete setup with no format setting safely presents both choices", () => {
    // When setup is incomplete (modes/_profile.md missing, page_format unset)
    const prompt = buildPrompt({
      kind: "pdf",
      input: "1",
      memory: "",
      today: "2026-11-12",
      pageFormat: { setting: null, letterCountries: [] },
      codeRoot: CORE,
    });

    assert.ok(prompt.includes('<<cv-html format="a4">>'), "Prompt offers a4 choice");
    assert.ok(prompt.includes('<<cv-html format="letter">>'), "Prompt offers letter choice");
  });

  // 4. Render format resolution & precedence
  test("resolveRenderPageFormat: explicit format outranks profile setting and agent pick", async () => {
    // Explicit 'a4' outranks profile 'letter'
    const res1 = await resolveRenderPageFormat(CORE, { explicit: "a4", setting: "letter" });
    assert.equal(res1.format, "a4");

    // Explicit 'letter' outranks profile 'a4'
    const res2 = await resolveRenderPageFormat(CORE, { explicit: "letter", setting: "a4" });
    assert.equal(res2.format, "letter");

    // Explicit format wins even if agent declared the opposite, warning about the difference
    const res3 = await resolveRenderPageFormat(CORE, { explicit: "a4", declared: "letter" });
    assert.equal(res3.format, "a4");
    assert.equal(res3.warnings.length, 1);
    assert.match(res3.warnings[0], /requested as a4/);
  });

  test("resolveRenderPageFormat: missing or null explicit format falls back to profile or default", async () => {
    // With profile setting
    const fromProfile = await resolveRenderPageFormat(CORE, { explicit: null, setting: "a4" });
    assert.equal(fromProfile.format, "a4");

    // With no profile setting and no agent pick -> DEFAULT_PAGE_FORMAT ("letter")
    const fromDefault = await resolveRenderPageFormat(CORE, { explicit: null, setting: null, declared: null });
    assert.equal(fromDefault.format, DEFAULT_PAGE_FORMAT);
    assert.equal(fromDefault.warnings.length, 1);
    assert.match(fromDefault.warnings[0], /defaulting to letter/);
  });

  // 5. PDF generation spawner passes the resolved format
  test("spawnGeneratePdf: receives the resolved format in CLI arguments", async () => {
    const executedArgs = [];
    const fakeSpawn = (execPath, args, options) => {
      executedArgs.push({ execPath, args, options });
      return {
        stderr: { setEncoding: () => {}, on: () => {} },
        on: (event, handler) => {
          if (event === "close") handler(0);
        },
      };
    };

    // Test with "a4"
    await spawnGeneratePdf({
      spawnFn: fakeSpawn,
      execPath: "node",
      coreRoot: CORE,
      html: "scratch/cv.html",
      finalPdf: "output/cv.pdf",
      format: "a4",
      reportNum: "1",
    });

    assert.ok(executedArgs[0].args.includes("--format=a4"), "Expected --format=a4 in generate-pdf.mjs arguments");

    // Test with "letter"
    await spawnGeneratePdf({
      spawnFn: fakeSpawn,
      execPath: "node",
      coreRoot: CORE,
      html: "scratch/cv.html",
      finalPdf: "output/cv.pdf",
      format: "letter",
      reportNum: "1",
    });

    assert.ok(executedArgs[1].args.includes("--format=letter"), "Expected --format=letter in generate-pdf.mjs arguments");
  });

  // 6. Regression: Missing profile setup does not break CV generation (Issue #6919)
  test("regression: incomplete setup with missing modes/_profile.md generates CV using default format", async () => {
    // Incomplete setup has setting: null and declared: null
    const sheet = await resolveRenderPageFormat(CORE, {
      explicit: null,
      setting: null,
      declared: null,
      country: null,
    });

    assert.equal(sheet.format, "letter", "Must default to repository's documented DEFAULT_PAGE_FORMAT ('letter')");
    assert.ok(sheet.warnings.some((w) => w.includes("defaulting to letter")));
  });
});

