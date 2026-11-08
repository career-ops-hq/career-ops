import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { materializeTailoredCv, restoreNewestFirst } from "../../src/lib/cv-from-json.mjs";

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const CV_MD = `## Experience

### Globex -- Remote

**Analyst**
2020 - 2024

- Shipped the weekly report

### Initech -- Remote

**Associate**
2016 - 2019

- Filed the numbers
`;

function payload() {
  return {
    lang: "en",
    page_format: "letter",
    candidate: {
      name: "Jane Doe",
      title: "Senior Analyst",
      email: "jane@example.com",
      location: "Example City",
    },
    summary: "Analyst who ships the weekly report.",
    competencies: ["Weekly reporting"],
    experience: [
      {
        company: "Initech",
        role: "Associate",
        location: "Remote",
        dates: "2016 - 2019",
        bullets: ["Filed the numbers"],
      },
      {
        company: "Globex",
        role: "Lead Analyst",
        location: "Remote",
        dates: "2020 - 2024",
        bullets: ["Shipped the weekly report"],
      },
    ],
    education: [{ title: "BSc Reports", org: "Example University", year: "2016" }],
    skills: [{ category: "Tools", items: "Spreadsheets" }],
  };
}

test("restoreNewestFirst puts a later-starting role back above an earlier one", async () => {
  const { parseExperienceStart } = await import(pathToFileURL(path.join(CORE, "cv-experience-order.mjs")).href);
  const scrambled = [
    { company: "Initech", dates: "2016 - 2019" },
    { company: "Globex", dates: "2020 - 2024" },
  ];
  const restored = restoreNewestFirst(scrambled, parseExperienceStart);
  assert.equal(restored.reordered, true);
  assert.deepEqual(restored.experience.map((entry) => entry.company), ["Globex", "Initech"]);

  const sameYear = restoreNewestFirst([
    { company: "Initech", dates: "2020 - 2021" },
    { company: "Globex", dates: "Jun 2020 - 2022" },
  ], parseExperienceStart);
  assert.equal(sameYear.reordered, false);
  assert.equal(sameYear.experience[0].company, "Initech");
});

test("a JSON envelope builds HTML, warns on a drifted title, and writes the ATS sibling", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cv-json-"));
  const saved = {
    root: process.env.CAREER_OPS_ROOT,
    data: process.env.CAREER_OPS_DATA_DIR,
    profile: process.env.CAREER_OPS_PROFILE,
  };
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_ROOT = dir;
  try {
    mkdirSync(path.join(dir, "config"), { recursive: true });
    mkdirSync(path.join(dir, "reports"), { recursive: true });
    mkdirSync(path.join(dir, "output"), { recursive: true });
    writeFileSync(path.join(dir, "config", "profile.yml"), "name: Jane Doe\n");
    writeFileSync(path.join(dir, "cv.md"), CV_MD);
    writeFileSync(path.join(dir, "reports", "001-acme-2026-01-01.md"), "# Acme\n\n## Keywords extracted\n\n- Zorblax\n");
    const htmlPath = path.join(dir, ".career-ops-web", "pdf-tmp", "cv-web-018.html");
    const finalPdf = path.join(dir, "output", "cv-jane-doe-018-acme-2026-11-05.pdf");

    const result = await materializeTailoredCv({
      envelope: { ok: true, kind: "json", format: "letter", payload: payload(), warnings: [] },
      coreRoot: CORE,
      dataRoot: dir,
      reportFile: "reports/001-acme-2026-01-01.md",
      htmlPath,
      finalPdf,
    });

    assert.equal(result.ok, true, result.error);
    assert.match(result.html, /Jane Doe/);
    assert.ok(result.html.indexOf("Globex") < result.html.indexOf("Initech"), "Globex stays above Initech");
    const { validateCvExperienceOrder } = await import(pathToFileURL(path.join(CORE, "cv-experience-order.mjs")).href);
    assert.doesNotThrow(() => validateCvExperienceOrder(result.html));
    assert.ok(result.warnings.some((warning) => warning.includes("Lead Analyst") && warning.includes("Analyst")));
    assert.ok(result.warnings.some((warning) => /newest-first/i.test(warning)));
    assert.ok(result.warnings.some((warning) => warning.includes("Zorblax")));
    assert.equal(result.ats.finalPdf, path.join(dir, "output", "cv-jane-doe-018-acme-ats-2026-11-05.pdf"));
    assert.equal(existsSync(result.ats.html), true);
    assert.match(readFileSync(result.ats.html, "utf8"), /Jane Doe/);
  } finally {
    if (saved.root === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = saved.root;
    if (saved.data === undefined) delete process.env.CAREER_OPS_DATA_DIR;
    else process.env.CAREER_OPS_DATA_DIR = saved.data;
    if (saved.profile === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = saved.profile;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a marker format replaces a disagreeing page_format in the built CV", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cv-format-"));
  const saved = {
    root: process.env.CAREER_OPS_ROOT,
    data: process.env.CAREER_OPS_DATA_DIR,
    profile: process.env.CAREER_OPS_PROFILE,
  };
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_ROOT = dir;
  try {
    mkdirSync(path.join(dir, "config"), { recursive: true });
    writeFileSync(path.join(dir, "config", "profile.yml"), "name: Jane Doe\n");
    writeFileSync(path.join(dir, "cv.md"), CV_MD);
    const body = payload();
    body.page_format = "letter";
    const htmlPath = path.join(dir, "cv.html");
    const result = await materializeTailoredCv({
      envelope: { ok: true, kind: "json", format: "a4", payload: body, warnings: [] },
      coreRoot: CORE,
      dataRoot: dir,
      htmlPath,
      finalPdf: path.join(dir, "output", "cv-jane-doe-018-acme-2026-11-05.pdf"),
    });
    assert.equal(result.ok, true, result.error);
    assert.match(result.html, /max-width:\s*210mm/);
    assert.doesNotMatch(result.html, /max-width:\s*8\.5in/);
    assert.match(readFileSync(result.ats.html, "utf8"), /max-width:\s*210mm/);
  } finally {
    if (saved.root === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = saved.root;
    if (saved.data === undefined) delete process.env.CAREER_OPS_DATA_DIR;
    else process.env.CAREER_OPS_DATA_DIR = saved.data;
    if (saved.profile === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = saved.profile;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a legacy HTML envelope is kept as emitted and does not grow an ATS sibling", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cv-html-"));
  try {
    const result = await materializeTailoredCv({
      envelope: { ok: true, kind: "html", html: "<p>Jane Doe</p>", format: "letter", warnings: [] },
      coreRoot: CORE,
      dataRoot: dir,
      htmlPath: path.join(dir, "cv.html"),
      finalPdf: path.join(dir, "output", "cv-jane-doe-018-acme-2026-11-05.pdf"),
    });
    assert.equal(result.ok, true);
    assert.equal(result.html, "<p>Jane Doe</p>");
    assert.equal(result.ats, null);
    assert.deepEqual(result.warnings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a payload the title check cannot read stops the render", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cv-bad-"));
  const savedRoot = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = dir;
  try {
    writeFileSync(path.join(dir, "cv.md"), CV_MD);
    const broken = payload();
    delete broken.experience[0].dates;
    const result = await materializeTailoredCv({
      envelope: { ok: true, kind: "json", format: "letter", payload: broken, warnings: [] },
      coreRoot: CORE,
      dataRoot: dir,
      htmlPath: path.join(dir, "cv.html"),
      finalPdf: path.join(dir, "out.pdf"),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /dates/);
  } finally {
    if (savedRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = savedRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});
