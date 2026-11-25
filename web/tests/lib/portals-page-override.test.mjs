// Portals page and /api/portals must open the same file doctorState and the
// scanner use: CAREER_OPS_PORTALS when set, else <root>/portals.yml.
//
// Repro (Fri 2026-10-16 dogfood): CAREER_OPS_PORTALS=/tmp/.../portals.yml with
// "Alt Portal Co", root portals.yml absent → CLI doctor ✓ portals found, web
// /portals showed an empty list (seeded from the example template).
//
// Run: npm test -- tests/lib/portals-page-override.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "../..");

const HARDCODED = /path\.join\(\s*root\s*,\s*["']portals\.yml["']\s*\)/;

test("portals page and API routes resolve portals.yml through portalsConfigPath", () => {
  const files = [
    "src/app/portals/page.tsx",
    "src/app/api/portals/route.ts",
    "src/app/api/portals/verify/route.ts",
  ];
  for (const rel of files) {
    const src = readFileSync(join(webRoot, rel), "utf8");
    assert.match(src, /portalsConfigPath/, `${rel} must call portalsConfigPath`);
    assert.equal(HARDCODED.test(src), false, `${rel} still hardcodes path.join(root, "portals.yml")`);
  }
});

const skipTs = !process.features?.typescript && "this Node cannot import career-ops.ts (no type stripping)";
const mods = skipTs
  ? {}
  : {
      ...(await import("@/lib/career-ops")),
      ...(await import("@/lib/portals-config.mjs")),
    };

test("watched companies load from CAREER_OPS_PORTALS when set", { skip: skipTs }, () => {
  const root = mkdtempSync(join(tmpdir(), "co-portals-page-"));
  const prevRoot = process.env.CAREER_OPS_ROOT;
  const prevPortals = process.env.CAREER_OPS_PORTALS;
  try {
    mkdirSync(join(root, "templates"), { recursive: true });
    writeFileSync(join(root, "templates/portals.example.yml"), "tracked_companies: []\n");
    const alt = join(root, "alt-portals.yml");
    writeFileSync(
      alt,
      "tracked_companies:\n  - name: Alt Portal Co\n    careers_url: https://jobs.example.test/alt\n",
    );
    process.env.CAREER_OPS_ROOT = root;
    process.env.CAREER_OPS_PORTALS = alt;
    const file = mods.portalsConfigPath(root);
    assert.equal(file, alt);
    const { doc, seeded } = mods.loadPortalsDocument(file, join(root, "templates/portals.example.yml"));
    assert.equal(seeded, false);
    const watched = mods.watchedCompanies(doc);
    assert.equal(watched.length, 1);
    assert.equal(watched[0].name, "Alt Portal Co");
  } finally {
    if (prevRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prevRoot;
    if (prevPortals === undefined) delete process.env.CAREER_OPS_PORTALS;
    else process.env.CAREER_OPS_PORTALS = prevPortals;
    rmSync(root, { recursive: true, force: true });
  }
});
