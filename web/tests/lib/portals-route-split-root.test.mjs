import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import "../helpers/web-ts-alias-loader.mjs";

const { POST } = await import("../../src/app/api/portals/route.ts");
const fixtures = [];

after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

test("a split data root seeds portals.yml from the code root template", async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "career-ops-portals-route-"));
  fixtures.push(fixture);
  const codeRoot = path.join(fixture, "code");
  const dataRoot = path.join(fixture, "data");
  mkdirSync(path.join(codeRoot, "templates"), { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(
    path.join(codeRoot, "templates", "portals.example.yml"),
    "title_filter:\n  positive: [Template Role]\nsources:\n  greenhouse: true\n",
  );

  const previousRoot = process.env.CAREER_OPS_ROOT;
  const previousCodeRoot = process.env.CAREER_OPS_CODE_ROOT;
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  try {
    const response = await POST(new Request("http://localhost/api/portals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles: ["Assistente de Vendas"], location: ["Lisboa"] }),
    }));

    assert.equal(response.status, 200);
    const saved = readFileSync(path.join(dataRoot, "portals.yml"), "utf8");
    assert.match(saved, /Assistente de Vendas/);
    assert.match(saved, /Lisboa/);
    assert.match(saved, /greenhouse: true/);
  } finally {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    if (previousCodeRoot === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
    else process.env.CAREER_OPS_CODE_ROOT = previousCodeRoot;
  }
});
