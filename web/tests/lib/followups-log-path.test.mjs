import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import "../helpers/web-ts-alias-loader.mjs";

const { POST, DELETE } = await import("../../src/app/api/followups/log/route.ts");
const header = "| num | appNum | date | company | role | channel | contact | notes |\n|---|---|---|---|---|---|---|---|\n";
const request = (method, body) => new Request("http://fixture.invalid/api/followups/log", {
  method,
  body: JSON.stringify(body),
});

for (const mode of ["absolute", "relative"]) {
  test(`follow-up writes use the ${mode} override and preserve the default log`, async (t) => {
    const codeRoot = mkdtempSync(join(tmpdir(), "co-followups-code-"));
    const dataRoot = mkdtempSync(join(tmpdir(), "co-followups-data-"));
    const defaultLog = join(dataRoot, "data", "follow-ups.md");
    const selectedLog = join(codeRoot, "selected.md");
    const original = header + "| 1 | 2 | 2026-11-20 | Default fixture | | Other | | |\n";
    mkdirSync(join(dataRoot, "data"));
    writeFileSync(defaultLog, original);
    writeFileSync(selectedLog, header + "| 1 | 3 | 2026-11-20 | Selected fixture | | Other | | |\n");

    const env = {
      CAREER_OPS_CODE_ROOT: codeRoot,
      CAREER_OPS_DATA_DIR: dataRoot,
      CAREER_OPS_ROOT: dataRoot,
      CAREER_OPS_FOLLOWUPS: mode === "absolute" ? selectedLog : relative(codeRoot, selectedLog),
    };
    for (const [key, value] of Object.entries(env)) {
      const previous = process.env[key];
      process.env[key] = value;
      t.after(() => {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      });
    }
    t.after(() => {
      rmSync(codeRoot, { recursive: true, force: true });
      rmSync(dataRoot, { recursive: true, force: true });
    });

    assert.equal((await DELETE(request("DELETE", { num: 1 }))).status, 200);
    assert.equal(readFileSync(defaultLog, "utf8"), original);
    assert.equal(readFileSync(selectedLog, "utf8"), header);

    assert.equal((await POST(request("POST", { appNum: 3, company: "New fixture", date: "2026-11-21" }))).status, 200);
    assert.equal(readFileSync(defaultLog, "utf8"), original);
    assert.match(readFileSync(selectedLog, "utf8"), /\| 1 \| 3 \| 2026-11-21 \| New fixture \|/);
  });
}
