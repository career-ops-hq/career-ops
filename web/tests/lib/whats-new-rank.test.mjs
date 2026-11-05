// What's new orders the capped pool by fit. The scan-history walk stays
// newest-line-first. This drives the route so the JSON the home paints is
// the order a person sees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const LOADER = pathToFileURL(join(WEB, "tests", "helpers", "web-ts-alias-loader.mjs")).href;

const DRIVER = `
const { GET } = await import("@/app/api/whats-new/route.ts");
const res = await GET(new Request("http://localhost/api/whats-new?limit=2"));
console.log(JSON.stringify({ status: res.status, body: await res.json() }));
`;

function day(offset) {
  return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
}

test("what's new lists a fit ahead of a newer miss", () => {
  const root = mkdtempSync(join(tmpdir(), "co-whatsnew-rank-"));
  try {
    mkdirSync(join(root, "data"), { recursive: true });
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, "config", "profile.yml"), [
      "target_roles:",
      "  primary:",
      "    - Senior Data Analyst",
      "location:",
      "  city: Austin",
      "compensation:",
      "  minimum: \"$100k\"",
      "  currency: USD",
      "  location_flexibility: Remote preferred",
      "",
    ].join("\n"));
    const header = "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation";
    const rows = [
      header,
      `https://example.com/fit\t${day(4)}\ttest\tSenior Data Analyst\tAcme\tadded\tRemote`,
      `https://example.com/city\t${day(1)}\ttest\tOffice Manager\tAcme\tadded\tAustin, TX`,
      `https://example.com/new\t${day(0)}\ttest\tZookeeper\tZoo\tadded\tBerlin`,
    ];
    writeFileSync(join(root, "data", "scan-history.tsv"), rows.join("\n"));
    const driver = join(root, "driver.mjs");
    writeFileSync(driver, DRIVER);
    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--import", LOADER, driver],
      {
        cwd: WEB,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          CAREER_OPS_ROOT: root,
          CAREER_OPS_DATA_DIR: "",
          CAREER_OPS_TRACKER: "",
          CAREER_OPS_PROFILE: "",
        },
      },
    );
    const line = out.trim().split("\n").filter(Boolean).at(-1);
    const body = JSON.parse(line);
    assert.equal(body.status, 200);
    assert.equal(body.body.count, 3);
    assert.deepEqual(body.body.offers.map((offer) => offer.url), [
      "https://example.com/fit",
      "https://example.com/city",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
