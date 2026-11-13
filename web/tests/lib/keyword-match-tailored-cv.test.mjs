import "../helpers/web-ts-alias-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("keyword match scores the tailored CV when its HTML exists for the report", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kw-cv-"));
  const prev = {
    CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT,
    CAREER_OPS_CODE_ROOT: process.env.CAREER_OPS_CODE_ROOT,
    CAREER_OPS_DATA_DIR: process.env.CAREER_OPS_DATA_DIR,
    CAREER_OPS_PROFILE: process.env.CAREER_OPS_PROFILE,
  };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = CODE_ROOT;
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_PROFILE;
  try {
    mkdirSync(path.join(root, "reports"), { recursive: true });
    mkdirSync(path.join(root, "output"), { recursive: true });
    mkdirSync(path.join(root, "data"), { recursive: true });
    writeFileSync(path.join(root, "cv.md"), "# Jane Doe\n\nAnalyst at Globex.\n");
    writeFileSync(path.join(root, "data", "applications.md"), "# tracker\n");
    writeFileSync(
      path.join(root, "reports", "001-acme-2026-01-01.md"),
      "## Keywords extracted\n- Zorblax\n\n## Next\n",
    );
    const pdfName = "cv-jane-doe-acme-2026-01-01.pdf";
    writeFileSync(path.join(root, "output", pdfName), "not a real pdf");
    writeFileSync(
      path.join(root, "output", "cv-jane-doe-acme-2026-01-01.html"),
      "<html><body><p>Jane Doe used Zorblax at Globex.</p></body></html>",
    );
    writeFileSync(
      path.join(root, "data", "pdf-index.tsv"),
      ["# report\tpdf\thtml\tformat\tdate", `1\toutput/${pdfName}\toutput/cv-jane-doe-acme-2026-01-01.html\tletter\t2026-01-01`].join("\n"),
    );

    const { GET } = await import("../../src/app/api/keyword-match/route.ts");
    const res = await GET(new Request("http://localhost/api/keyword-match?report=1"));
    const body = await res.json();

    assert.equal(body.available, true, JSON.stringify(body));
    assert.ok(body.result.present.includes("Zorblax"), JSON.stringify(body.result));
    assert.equal(body.result.coveragePct, 100);
    assert.deepEqual(body.result.missing, []);
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
