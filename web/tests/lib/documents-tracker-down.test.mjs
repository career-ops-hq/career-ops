// The documents list must still name the PDFs when the tracker cannot be read.
// A directory where data/applications.md should be makes readFileSync throw
// EISDIR. That is a broken tracker, not a missing one, and it reproduces
// without chmod.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const REPO = dirname(WEB);
const LOADER = pathToFileURL(join(WEB, "tests", "helpers", "web-ts-alias-loader.mjs")).href;

const DRIVER = `
const { GET } = await import("@/app/api/documents/route.ts");
const res = await GET(new Request("http://localhost/api/documents"));
const type = res.headers.get("content-type") || "";
const body = type.includes("json") ? await res.json() : await res.text();
console.log(JSON.stringify({ status: res.status, body }));
`;

test("PDFs stay listed when the tracker cannot be read", () => {
  const root = mkdtempSync(join(tmpdir(), "co-docs-"));
  try {
    mkdirSync(join(root, "output"), { recursive: true });
    mkdirSync(join(root, "data", "applications.md"), { recursive: true });
    writeFileSync(join(root, "output", "cv-keep.pdf"), "pdf");
    const driver = join(root, "driver.mjs");
    writeFileSync(driver, DRIVER);
    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--import", LOADER, driver],
      {
        cwd: WEB,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
        env: {
          ...process.env,
          CAREER_OPS_ROOT: root,
          CAREER_OPS_DATA_DIR: "",
          CAREER_OPS_TRACKER: "",
          CAREER_OPS_PDF_INDEX: "",
          CAREER_OPS_CODE_ROOT: REPO,
        },
      },
    );
    const line = out.trim().split("\n").filter(Boolean).at(-1);
    const res = JSON.parse(line);
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.body), true);
    assert.equal(res.body.some((doc) => doc.filename === "cv-keep.pdf"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
