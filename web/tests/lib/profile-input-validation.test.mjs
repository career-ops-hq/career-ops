import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";
import * as yaml from "js-yaml";

const webSrc = fileURLToPath(new URL("../../src/", import.meta.url));
const loader = `
  import { existsSync } from "node:fs";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(${JSON.stringify(webSrc)}, specifier.slice(2));
      for (const ext of [".ts", ".tsx", ".mjs", ".js", ""]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, pathToFileURL(webSrc));


const { POST } = await import("../../src/app/api/profile/route.ts");
const source = "# Original fixture comment\ncandidate:\n  full_name: Fixture Candidate\n  email: fixture@example.invalid\ncompensation:\n  currency: USD\n";
async function fixture(t, body) {
  const root = mkdtempSync(path.join(tmpdir(), "profile-input-"));
  const previous = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  t.after(() => {
    if (previous === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const config = path.join(root, "config");
  mkdirSync(config);
  const file = path.join(config, "profile.yml");
  writeFileSync(file, source);
  const response = await POST(new Request("http://fixture.invalid/api/profile", {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  }));
  return { response, file, config };
}

for (const [name, body] of [
  ["null", "null"], ["array", "[]"], ["string", '"fixture"'],
  ["malformed JSON", "{"],
  ["string roles", '{"roles":"backend"}'],
  ["object name", '{"name":{"bad":"object"}}'],
  ["numeric email", '{"email":42}'],
  ["boolean location", '{"location":true}'],
  ["mixed roles", '{"roles":["Engineer",42]}'],
  ["null roles", '{"roles":null}'],
  ["string salary", '{"compMin":"100","compMax":200}'],
  ["infinite salary", '{"compMin":1e400,"compMax":200}'],
  ["negative salary", '{"compMin":-1,"compMax":200}'],
  ["reversed range", '{"compMin":200,"compMax":100}'],
  ["object currency", '{"currency":{}}'],
  ["array remote", '{"remote":[]}'],
]) {
  test(`${name} returns 400 without changing any files`, async (t) => {
    const { response, file, config } = await fixture(t, body);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
    assert.equal(readFileSync(file, "utf8"), source);
    assert.deepEqual(readdirSync(config), ["profile.yml"]);
  });
}

test("valid partial updates retain unrelated settings and exact-byte backup", async (t) => {
  const { response, file, config } = await fixture(t, JSON.stringify({
    name: "Updated Fixture", roles: ["Backend Engineer"], compMin: 100, compMax: 200,
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(yaml.load(readFileSync(file, "utf8")), {
    candidate: { full_name: "Updated Fixture", email: "fixture@example.invalid" },
    target_roles: { primary: ["Backend Engineer"] },
    compensation: { currency: "USD", target_range: "100-200" },
  });
  const backups = readdirSync(config).filter((f) => f.startsWith("profile.yml.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(path.join(config, backups[0]), "utf8"), source);
});
