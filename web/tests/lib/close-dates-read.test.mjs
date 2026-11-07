import "../helpers/web-ts-alias-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
process.env.CAREER_OPS_CODE_ROOT = repo;

const { withCloseDates } = await import("../../src/lib/career-ops.ts");

const apps = [{ n: "1", url: "https://jobs.example.com/role" }];

function useRoot() {
  const root = mkdtempSync(join(tmpdir(), "co-close-read-"));
  const saved = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  return {
    root,
    restore() {
      if (saved === undefined) delete process.env.CAREER_OPS_ROOT;
      else process.env.CAREER_OPS_ROOT = saved;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("a missing scan history leaves close dates off the rows", async () => {
  const fixture = useRoot();
  try {
    const out = await withCloseDates(apps);
    assert.equal(out, apps);
    assert.equal(out[0].closesAt, undefined);
  } finally {
    fixture.restore();
  }
});

test("a scan history that cannot be read is reported", async () => {
  const fixture = useRoot();
  try {
    mkdirSync(join(fixture.root, "data", "scan-history.tsv"), { recursive: true });
    await assert.rejects(() => withCloseDates(apps), (err) => err && err.code !== "ENOENT");
  } finally {
    fixture.restore();
  }
});

test("a readable scan history still attaches the close day", async () => {
  const fixture = useRoot();
  try {
    mkdirSync(join(fixture.root, "data"));
    const line = `https://jobs.example.com/role${"\t".repeat(15)}2026-10-03\n`;
    writeFileSync(join(fixture.root, "data", "scan-history.tsv"), line);
    const out = await withCloseDates(apps);
    assert.equal(out[0].closesAt, "2026-10-03");
  } finally {
    fixture.restore();
  }
});
