import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { after, before, describe, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import "../helpers/web-ts-alias-loader.mjs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync as writeSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const stubUrl = pathToFileURL(join(here, "../fixtures/playwright-launch-stub.mjs")).href;
const root = join(here, "..", "..", "..");

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "playwright-core") {
        return { url: ${JSON.stringify(stubUrl)}, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const playwright = await import("playwright-core");
if (!playwright.chromium?.launch?.refusedByTest) {
  throw new Error("Refusing to run: playwright-core was not stubbed, so openSession could launch Chrome.");
}

// End to end for apply.handoff_hosts: the real Apply entry points must refuse
// a listed host before Chrome is launched, show the error for a broken
// profile, and leave every other host alone. playwright-core is stubbed (as in
// apply-unsupported-ats.test.mjs), so a missing refusal fails an assertion
// instead of opening a browser.
//
// Run (from web/): node --experimental-strip-types --test tests/lib/apply-handoff-hosts-flow.test.mjs

// The data root the code under test reads config/profile.yml from.
const dataRoot = mkdtempSync(join(tmpdir(), "handoff-flow-"));
mkdirSync(join(dataRoot, "config"));
const profileFile = join(dataRoot, "config", "profile.yml");
const writeProfile = (text) => writeSync(profileFile, text);
writeProfile('apply:\n  handoff_hosts: ["gupy.io", "linkedin.com."]\n');
const previousRoot = process.env.CAREER_OPS_ROOT;
process.env.CAREER_OPS_ROOT = dataRoot;
after(() => {
  if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
  else process.env.CAREER_OPS_ROOT = previousRoot;
  rmSync(dataRoot, { recursive: true, force: true });
});

const { setHostResolver } = await import(pathToFileURL(join(root, "liveness-browser.mjs")).href);
const { openSession } = await import("../../src/lib/apply/session.ts");
const { classifyEmpty, tryApplyTrigger } = await import("../../src/lib/apply/diagnose.ts");
const { POST } = await import("../../src/app/api/apply/session/route.ts");

const LISTED = "https://acme.gupy.io/jobs/123";

function quietPage(current = "https://careers.acme.test/role") {
  return {
    url: () => current,
    evaluate: async () => ({ t: "Acme role", body: "Apply for this role at Acme.", hasPassword: false, challengeDom: false }),
  };
}

function pageWithApplyLink(href) {
  const gotos = [];
  const clicks = [];
  const apply = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => "Apply",
    evaluate: async () => ({ tag: "a", type: "", role: "link", inForm: false, text: "Apply" }),
    getAttribute: async (name) => (name === "href" ? href : null),
    click: async () => {
      clicks.push("apply");
    },
  };
  return {
    gotos,
    clicks,
    page: {
      url: () => "https://careers.acme.test/jobs/1",
      context: () => ({ pages: () => [] }),
      evaluate: async () => undefined,
      goto: async (to) => {
        gotos.push(to);
      },
      locator: () => ({ first: () => ({ count: async () => 0, getAttribute: async () => null }), evaluateAll: async () => [] }),
      getByRole: () => ({ or: () => ({ first: () => apply }) }),
    },
  };
}

const post = (payload) =>
  POST(
    new Request("http://fixture.invalid/api/apply/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

describe("apply.handoff_hosts through the real Apply entry points", { concurrency: 1 }, () => {
  let restore;
  before(() => {
    restore = setHostResolver(async () => ["93.184.216.34"]);
  });
  after(() => restore?.());

  test("openSession refuses a listed host's subdomain without launching Chrome", async () => {
    globalThis.__applyLaunchAttempts = 0;
    const result = await openSession(LISTED);
    assert.equal(globalThis.__applyLaunchAttempts, 0);
    assert.equal(result.unsupported.vendor, "handoff");
    assert.equal(result.unsupported.label, "gupy.io");
    assert.equal(result.unsupported.postingUrl, LISTED);
    assert.match(result.message, /apply\.handoff_hosts/);
    assert.match(result.message, /no browser was opened/);
  });

  test("a host configured with a trailing dot is refused too", async () => {
    globalThis.__applyLaunchAttempts = 0;
    const result = await openSession("https://www.linkedin.com/jobs/view/4001");
    assert.equal(globalThis.__applyLaunchAttempts, 0);
    assert.equal(result.unsupported?.label, "linkedin.com");
  });

  test("POST /api/apply/session returns the refusal panel's link and checklist", async () => {
    globalThis.__applyLaunchAttempts = 0;
    const res = await post({ url: LISTED, n: "7" });
    const body = await res.json();
    assert.equal(res.status, 200, body.error || JSON.stringify(body));
    assert.equal(body.unsupported, true);
    assert.equal(body.vendor, "handoff");
    assert.equal(body.postingUrl, LISTED);
    assert.equal(body.checklistHref, "/pipeline/7/apply");
    assert.equal(globalThis.__applyLaunchAttempts, 0);
  });

  test("an unlisted host still goes to the browser", async () => {
    globalThis.__applyLaunchAttempts = 0;
    await openSession("https://careers.acme.test/jobs/1").catch(() => null);
    assert.ok(globalThis.__applyLaunchAttempts > 0, "the stub launch was reached");
  });

  test("a broken profile is reported and nothing launches", async () => {
    writeProfile('apply:\n  handoff_hosts: ["gupy.io"\n');
    try {
      globalThis.__applyLaunchAttempts = 0;
      const res = await post({ url: LISTED });
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.ok(String(body.error).includes("profile.yml"), body.error);
      assert.equal(globalThis.__applyLaunchAttempts, 0);
    } finally {
      writeProfile('apply:\n  handoff_hosts: ["gupy.io", "linkedin.com."]\n');
    }
  });

  test("a missing profile changes nothing", async () => {
    rmSync(profileFile);
    try {
      globalThis.__applyLaunchAttempts = 0;
      await openSession(LISTED).catch(() => null);
      assert.ok(globalThis.__applyLaunchAttempts > 0, "no list, so the browser is tried as before");
    } finally {
      writeProfile('apply:\n  handoff_hosts: ["gupy.io", "linkedin.com."]\n');
    }
  });

  test("a page that redirected onto a listed host is a handoff block", async () => {
    const issue = await classifyEmpty(quietPage(LISTED), "https://careers.acme.test/role");
    assert.equal(issue.level, "block");
    assert.equal(issue.code, "handoff");
    assert.match(issue.message, /The window was closed\./);
  });

  test("tryApplyTrigger does not click an Apply link that leads to a listed host", async () => {
    const { page, gotos, clicks } = pageWithApplyLink(LISTED);
    const acted = await tryApplyTrigger(page);
    assert.deepEqual(acted, { blocked: LISTED });
    assert.deepEqual(gotos, []);
    assert.deepEqual(clicks, []);
  });
});
