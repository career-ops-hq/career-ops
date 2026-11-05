// Apply must refuse Workday, iCIMS, and UKG (UltiPro) before Playwright opens
// a window. The Chrome error below is the bug: openSession launches first and
// only then notices the host.
//
// Run (from web/): node --experimental-strip-types --test tests/lib/apply-unsupported-ats.test.mjs

import assert from "node:assert/strict";
import { register } from "node:module";
import { after, before, describe, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

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

const { setHostResolver } = await import(pathToFileURL(join(root, "liveness-browser.mjs")).href);
const { openSession } = await import("../../src/lib/apply/session.ts");
const { classifyEmpty, tryApplyTrigger } = await import("../../src/lib/apply/diagnose.ts");
const { PORTAL_TIPS } = await import("../../src/lib/apply-checklist.mjs");

const MESSAGE = {
  Workday: "This posting is on Workday. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app, so no browser was opened.",
  iCIMS: "This posting is on iCIMS. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app, so no browser was opened.",
  UKG: "This posting is on UKG. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app, so no browser was opened.",
};

const BLOCKED = [
  ["https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role", "workday", "Workday"],
  ["https://tenant.wd1.myworkdaysite.com/site", "workday", "Workday"],
  ["https://careers-acme.icims.com/jobs/1", "icims", "iCIMS"],
  ["https://acme.ultipro.com/jobs/1", "ultipro", "UKG"],
];

function quietPage(current = "https://careers.acme.test/role") {
  return {
    url: () => current,
    evaluate: async () => ({ t: "Acme role", body: "Apply for this role at Acme.", hasPassword: false, challengeDom: false }),
  };
}

function pageForTrigger({ atsHref = null, applyHref = null } = {}) {
  const gotos = [];
  const clicks = [];
  const atsLink = {
    count: async () => (atsHref ? 1 : 0),
    getAttribute: async () => atsHref,
  };
  const apply = {
    count: async () => (applyHref ? 1 : 0),
    isVisible: async () => true,
    innerText: async () => "Apply",
    getAttribute: async (name) => (name === "href" ? applyHref : null),
    click: async () => {
      clicks.push("apply");
    },
  };
  return {
    gotos,
    clicks,
    page: {
      url: () => "https://careers.acme.test/jobs/1",
      goto: async (href) => {
        gotos.push(href);
      },
      locator: () => ({ first: () => atsLink }),
      getByRole: () => ({ or: () => ({ first: () => apply }) }),
    },
  };
}

describe("openSession refuses blocked ATS hosts before Chrome", { concurrency: 1 }, () => {
  let restore;
  before(() => {
    globalThis.__applyLaunchAttempts = 0;
    restore = setHostResolver(async () => ["93.184.216.34"]);
  });
  after(() => restore?.());

  for (const [url, vendor, label] of BLOCKED) {
    test(`${vendor} ${url}`, async () => {
      const beforeAttempts = globalThis.__applyLaunchAttempts;
      const result = await openSession(url);
      assert.equal(globalThis.__applyLaunchAttempts, beforeAttempts);
      assert.equal(result.unsupported.vendor, vendor);
      assert.equal(result.unsupported.label, label);
      assert.equal(result.unsupported.postingUrl, url);
      assert.equal(result.message, MESSAGE[label]);
    });
  }
});

test("POST /api/apply/session returns the checklist link and does not launch Chrome", async () => {
  globalThis.__applyLaunchAttempts = 0;
  const restore = setHostResolver(async () => ["93.184.216.34"]);
  try {
    const { POST } = await import("../../src/app/api/apply/session/route.ts");
    const res = await POST(
      new Request("http://fixture.invalid/api/apply/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role", n: "12" }),
      }),
    );
    const body = await res.json();
    assert.equal(res.status, 200, body.error || JSON.stringify(body));
    assert.equal(body.unsupported, true);
    assert.equal(body.vendor, "workday");
    assert.equal(body.label, "Workday");
    assert.equal(body.message, MESSAGE.Workday);
    assert.equal(body.postingUrl, "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role");
    assert.equal(body.checklistHref, "/pipeline/12/apply");
    assert.equal(globalThis.__applyLaunchAttempts, 0);
  } finally {
    restore?.();
  }
});

describe("classifyEmpty uses the same refusal when no form is present", () => {
  for (const [url, vendor, label] of BLOCKED) {
    test(`${vendor} is a block with the shared message`, async () => {
      const issue = await classifyEmpty(quietPage(), url);
      assert.equal(issue.level, "block");
      assert.equal(issue.code, vendor);
      assert.equal(issue.message, MESSAGE[label]);
    });
  }

  test("notmyworkdayjobs.com is not Workday", async () => {
    const issue = await classifyEmpty(quietPage(), "https://notmyworkdayjobs.com/role");
    assert.equal(["workday", "icims", "ultipro"].includes(issue.code), false);
  });

  for (const url of ["https://boards.greenhouse.io/acme/jobs/123", "https://jobs.lever.co/acme/role", "https://jobs.ashbyhq.com/acme/role"]) {
    test(`does not block ${url}`, async () => {
      const issue = await classifyEmpty(quietPage(), url);
      assert.equal(["workday", "icims", "ultipro"].includes(issue.code), false);
    });
  }
});

test("tryApplyTrigger does not follow a Workday href", async () => {
  const workday = "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role";
  const { page, gotos, clicks } = pageForTrigger({ atsHref: workday, applyHref: workday });
  const acted = await tryApplyTrigger(page);
  assert.equal(acted, false);
  assert.deepEqual(gotos, []);
  assert.deepEqual(clicks, []);
});

test("tryApplyTrigger does not click an Apply link whose href is UKG", async () => {
  const ultipro = "https://acme.ultipro.com/jobs/1";
  const { page, gotos, clicks } = pageForTrigger({ applyHref: ultipro });
  const acted = await tryApplyTrigger(page);
  assert.equal(acted, false);
  assert.deepEqual(gotos, []);
  assert.deepEqual(clicks, []);
});

test("tryApplyTrigger still opens a Greenhouse application link", async () => {
  const greenhouse = "https://boards.greenhouse.io/acme/jobs/123";
  const { page, gotos, clicks } = pageForTrigger({ atsHref: greenhouse });
  const acted = await tryApplyTrigger(page);
  assert.equal(acted, true);
  assert.deepEqual(gotos, [greenhouse]);
  assert.deepEqual(clicks, []);
});

test("portal tips include UKG next to Workday and iCIMS", () => {
  const names = PORTAL_TIPS.map((tip) => tip.portal);
  assert.deepEqual(names.slice(0, 3), ["Workday", "iCIMS", "UKG"]);
  const ukg = PORTAL_TIPS.find((tip) => tip.portal === "UKG");
  assert.match(ukg.tip, /account/i);
  assert.match(ukg.tip, /session expires/i);
});
