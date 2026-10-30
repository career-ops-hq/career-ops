import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const { readLanguageConfig } = await import("../../src/lib/career-ops.ts");

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// A market directory is one that ships its own _shared.md (modes/de, modes/sg,
// ...); modes/interview, modes/pdf and the like hold sub-modes, not markets.
const MARKETS = readdirSync(join(REPO_ROOT, "modes"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(REPO_ROOT, "modes", d.name, "_shared.md")))
  .map((d) => d.name)
  .sort();

function withMarket(market, fn) {
  const root = mkdtempSync(join(tmpdir(), "lang-eval-mode-"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "profile.yml"), `language:\n  modes_dir: modes/${market}\n`);
  cpSync(join(REPO_ROOT, "modes", market), join(root, "modes", market), { recursive: true });
  const prev = { root: process.env.CAREER_OPS_ROOT, profile: process.env.CAREER_OPS_PROFILE };
  process.env.CAREER_OPS_ROOT = root;
  delete process.env.CAREER_OPS_PROFILE;
  try {
    return fn();
  } finally {
    if (prev.root === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev.root;
    if (prev.profile !== undefined) process.env.CAREER_OPS_PROFILE = prev.profile;
    rmSync(root, { recursive: true, force: true });
  }
}

test("the repo ships market directories to check", () => {
  assert.ok(MARKETS.length >= 10, `found only ${MARKETS.length}: ${MARKETS.join(", ")}`);
});

for (const market of MARKETS) {
  test(`modes_dir: modes/${market} resolves to that market's evaluation mode, not the English default`, () => {
    withMarket(market, () => {
      const lang = readLanguageConfig();
      assert.equal(lang.modesDir, `modes/${market}`);
      assert.match(lang.evalModeFile, new RegExp(`^modes/${market}/[^/]+\\.md$`));
    });
  });
}

// Their evaluation modes title themselves "A-H", which the A-F/A-G title match
// used to miss, so both fell back to modes/oferta.md.
test("modes/sg and modes/vi resolve to their A-H evaluation modes", () => {
  withMarket("sg", () => assert.equal(readLanguageConfig().evalModeFile, "modes/sg/offer.md"));
  withMarket("vi", () => assert.equal(readLanguageConfig().evalModeFile, "modes/vi/tuyen-dung.md"));
});
