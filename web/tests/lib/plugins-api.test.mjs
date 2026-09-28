import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

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

const { GET: getPlugins, POST: postPlugins } = await import("../../src/app/api/plugins/route.ts");

async function withTempRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-plugins-test-"));
  mkdirSync(path.join(root, "config"), { recursive: true });
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    await fn({ root });
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

test("plugins GET marks configured true only when all requiredEnv variables exist", async () => {
  await withTempRoot(async () => {
    // Clear relevant env vars
    const envVars = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "NOTION_ACCESS_TOKEN", "NOTION_PARENT_PAGE_ID", "APIFY_TOKEN"];
    const saved = {};
    for (const k of envVars) {
      saved[k] = process.env[k];
      delete process.env[k];
    }

    try {
      // With nothing set, only zero-env plugins (h1b-sponsor) should be configured
      let res = await getPlugins();
      let data = await res.json();
      let gmail = data.plugins.find((p) => p.id === "gmail");
      let h1b = data.plugins.find((p) => p.id === "h1b-sponsor");
      assert.equal(gmail.configured, false);
      assert.equal(h1b.configured, true);

      // Set only 1 of 3 Gmail env vars -> still false
      process.env.GMAIL_REFRESH_TOKEN = "some-refresh-token";
      res = await getPlugins();
      data = await res.json();
      gmail = data.plugins.find((p) => p.id === "gmail");
      assert.equal(gmail.configured, false);

      // Set all 3 Gmail env vars -> now true
      process.env.GMAIL_CLIENT_ID = "some-client-id";
      process.env.GMAIL_CLIENT_SECRET = "some-secret";
      res = await getPlugins();
      data = await res.json();
      gmail = data.plugins.find((p) => p.id === "gmail");
      assert.equal(gmail.configured, true);
    } finally {
      for (const k of envVars) {
        if (saved[k] !== undefined) process.env[k] = saved[k];
        else delete process.env[k];
      }
    }
  });
});

test("plugins GET returns 500 when plugins.json is not an array or invalid JSON", async () => {
  await withTempRoot(async ({ root }) => {
    const { writeFileSync } = await import("node:fs");
    const pluginsPath = path.join(root, "config", "plugins.json");

    // Invalid JSON
    writeFileSync(pluginsPath, "{ not valid json");
    let res = await getPlugins();
    assert.equal(res.status, 500);
    let data = await res.json();
    assert.match(data.error, /Failed to parse plugins\.json/);

    // Valid JSON but not an array
    writeFileSync(pluginsPath, JSON.stringify({ enabled: ["gmail"] }));
    res = await getPlugins();
    assert.equal(res.status, 500);
    data = await res.json();
    assert.match(data.error, /plugins\.json is not an array/);
  });
});
