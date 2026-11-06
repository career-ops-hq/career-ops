// Apply must refuse Workday, iCIMS, and UKG (UltiPro) before Playwright opens
// a window. The Chrome error below is the bug: openSession launches first and
// only then notices the host.
//
// Run (from web/): node --experimental-strip-types --test tests/lib/apply-unsupported-ats.test.mjs

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
const { unsupportedInAppAts, checklistHrefFor } = await import("../../src/lib/apply/unsupported-ats.mjs");
const { sessionFollowUp } = await import("../../src/lib/apply/session-result.mjs");

const MESSAGE = {
  Workday: "This posting is on Workday. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app, so no browser was opened.",
  iCIMS: "This posting is on iCIMS. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app, so no browser was opened.",
  UKG: "This posting is on UKG. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app, so no browser was opened.",
};
const CLOSED = {
  Workday: "This posting is on Workday. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app. The window was closed.",
  iCIMS: "This posting is on iCIMS. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app. The window was closed.",
  UKG: "This posting is on UKG. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app. The window was closed.",
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
      context: () => ({ pages: () => [] }),
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

test("POST /api/apply/session omits the checklist link when no application number is sent", async () => {
  globalThis.__applyLaunchAttempts = 0;
  const restore = setHostResolver(async () => ["93.184.216.34"]);
  try {
    const { POST } = await import("../../src/app/api/apply/session/route.ts");
    const res = await POST(
      new Request("http://fixture.invalid/api/apply/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://careers-acme.icims.com/jobs/1" }),
      }),
    );
    const body = await res.json();
    assert.equal(res.status, 200, body.error || JSON.stringify(body));
    assert.equal(body.unsupported, true);
    assert.equal(body.vendor, "icims");
    assert.equal(body.label, "iCIMS");
    assert.equal(body.message, MESSAGE.iCIMS);
    assert.equal(Object.hasOwn(body, "checklistHref"), false);
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
      assert.equal(issue.message, CLOSED[label]);
    });
  }

  test("notmyworkdayjobs.com is not Workday", async () => {
    const issue = await classifyEmpty(quietPage(), "https://notmyworkdayjobs.com/role");
    assert.equal(["workday", "icims", "ultipro"].includes(issue.code), false);
  });

  test("a redirect onto Workday is the ATS block", async () => {
    const issue = await classifyEmpty(quietPage("https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role"), "https://careers.acme.test/role");
    assert.equal(issue.code, "workday");
    assert.equal(issue.message, CLOSED.Workday);
  });

  test("a Workday jobs index is the ATS block, not a listing page", async () => {
    const issue = await classifyEmpty(quietPage(), "https://acme.wd1.myworkdayjobs.com/jobs");
    assert.equal(issue.code, "workday");
    assert.equal(issue.message, CLOSED.Workday);
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
  assert.deepEqual(acted, { blocked: workday });
  assert.deepEqual(gotos, []);
  assert.deepEqual(clicks, []);
});

test("tryApplyTrigger does not click an Apply link whose href is UKG", async () => {
  const ultipro = "https://acme.ultipro.com/jobs/1";
  const { page, gotos, clicks } = pageForTrigger({ applyHref: ultipro });
  const acted = await tryApplyTrigger(page);
  assert.deepEqual(acted, { blocked: ultipro });
  assert.deepEqual(gotos, []);
  assert.deepEqual(clicks, []);
});

test("tryApplyTrigger still opens a Greenhouse application link", async () => {
  const greenhouse = "https://boards.greenhouse.io/acme/jobs/123";
  const { page, gotos, clicks } = pageForTrigger({ atsHref: greenhouse });
  const acted = await tryApplyTrigger(page);
  assert.equal(acted.blocked, undefined);
  assert.ok(acted.followed);
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

test("greenhouse, Lever, Ashby, and a lookalike host are not blocked", async () => {
  assert.equal(await unsupportedInAppAts("https://boards.greenhouse.io/acme/jobs/123"), null);
  assert.equal(await unsupportedInAppAts("https://jobs.lever.co/acme/role"), null);
  assert.equal(await unsupportedInAppAts("https://jobs.ashbyhq.com/acme/role"), null);
  assert.equal(await unsupportedInAppAts("https://notmyworkdayjobs.com/role"), null);
  assert.equal(await unsupportedInAppAts("https://acme.successfactors.com/job"), null);
  assert.equal(await unsupportedInAppAts("https://acme.taleo.net/career"), null);
});

test("ultipro.ca uses the UKG label from the shared vendor table", async () => {
  const hit = await unsupportedInAppAts("https://acme.ultipro.ca/jobs/1");
  assert.equal(hit.vendor, "ultipro");
  assert.equal(hit.label, "UKG");
  assert.equal(hit.postingUrl, "https://acme.ultipro.ca/jobs/1");
});

test("checklist links accept only a numeric application id", () => {
  assert.equal(checklistHrefFor("12"), "/pipeline/12/apply");
  assert.equal(checklistHrefFor(" 12 "), "/pipeline/12/apply");
  assert.equal(checklistHrefFor("12/../etc"), null);
  assert.equal(checklistHrefFor(""), null);
  assert.equal(checklistHrefFor(undefined), null);
});

test("sessionFollowUp stops drive and prefill for an unsupported body", () => {
  const plan = sessionFollowUp({
    unsupported: true,
    message: MESSAGE.Workday,
    postingUrl: "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role",
    checklistHref: "/pipeline/12/apply",
  });
  assert.equal(plan.kind, "unsupported");
  assert.equal(plan.message, MESSAGE.Workday);
  assert.equal(plan.checklistHref, "/pipeline/12/apply");
  assert.equal(sessionFollowUp({ id: "apply-1", fields: [] }).kind, "continue");
  assert.equal(sessionFollowUp(null).kind, "continue");
});

function careerPage(careerUrl, blockedHref, closed, options = {}) {
  let current = careerUrl;
  let applyClicked = false;
  let pendingLate = false;
  let popupHref = "";
  let popupWaits = 0;
  let initialWait = true;
  const popupPages = [];
  const extraPages = options.extraPages ?? [];
  const frame = {
    url: () => current,
    evaluate: async () => {
      if (options.formAfterRedirect && String(current).includes("myworkdayjobs")) {
        return { title: "Role", fields: [{ id: "co0", type: "email", label: "Email", required: true }] };
      }
      throw new Error("document is not defined");
    },
    waitForSelector: async () => null,
  };
  const context = {
    route: async () => {},
    routeWebSocket: async () => {},
    setDefaultTimeout() {},
    pages: () => [...extraPages, ...popupPages],
    newPage: async () => page,
    close: async () => { closed.push(true); },
  };
  const page = {
    url: () => current,
    context: () => context,
    goto: async (href) => {
      if (options.redirectOn && href === options.redirectOn) {
        if (options.redirectAfterWait) {
          current = href;
          pendingLate = true;
        } else {
          current = options.redirectTo;
        }
      }
      return { status: () => 200, headers: () => ({}) };
    },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {
      if (initialWait && options.redirectOnFirstWait) {
        current = options.redirectOnFirstWait;
        initialWait = false;
      }
      if (pendingLate) {
        current = options.redirectTo;
        pendingLate = false;
      }
      if (applyClicked && options.popupBlankAfterSettle) {
        if (popupPages.length === 0) {
          popupHref = "about:blank";
          popupPages.push({ url: () => popupHref });
        }
        popupWaits += 1;
        if (popupWaits >= 3 && popupHref === "about:blank") popupHref = options.popupBlankAfterSettle;
      }
      if (applyClicked && options.popupBlankThen) {
        if (popupPages.length === 0) {
          popupHref = "about:blank";
          popupPages.push({ url: () => popupHref });
        } else if (popupHref === "about:blank") {
          popupHref = options.popupBlankThen;
        }
      }
      if (applyClicked && options.popupOnWait && options.popupUrl && popupPages.length === 0) {
        popupPages.push({ url: () => options.popupUrl });
      }
    },
    screenshot: async () => Buffer.from("career"),
    title: async () => "Acme role",
    evaluate: async () => {
      throw new Error("document is not defined");
    },
    frames: () => [frame],
    mainFrame: () => frame,
    locator(selector) {
      const hit = !options.noAtsLink && /myworkdayjobs|myworkdaysite|icims\.com|ultipro/.test(String(selector));
      const node = {
        count: async () => (hit ? 1 : 0),
        getAttribute: async () => (hit ? blockedHref : null),
        isVisible: async () => false,
        click: async () => {},
        first() { return this; },
      };
      return { first: () => node };
    },
    getByRole(_role, roleOptions) {
      const wantsApply = Boolean(options.applyClick) && /apply/i.test(String(roleOptions?.name ?? ""));
      const node = {
        count: async () => (wantsApply ? 1 : 0),
        isVisible: async () => wantsApply,
        innerText: async () => "Apply",
        getAttribute: async () => null,
        click: async () => {
          if (!wantsApply) return;
          applyClicked = true;
          if (options.popupUrl && !options.popupOnWait) popupPages.push({ url: () => options.popupUrl });
        },
        first() { return this; },
        or() { return this; },
      };
      return node;
    },
  };
  return {
    isConnected: () => false,
    newContext: async () => context,
  };
}

describe("openSession closes a career page whose Apply link is a blocked ATS", { concurrency: 1 }, () => {
  let restore;
  before(() => {
    restore = setHostResolver(async () => ["93.184.216.34"]);
  });
  after(() => {
    restore?.();
    clearTimeout(globalThis.__coIdleTimer);
    globalThis.__coIdleTimer = undefined;
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = undefined;
  });

  for (const [href, vendor, label] of [
    ["https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role", "workday", "Workday"],
    ["https://careers-acme.icims.com/jobs/1", "icims", "iCIMS"],
    ["https://acme.ultipro.com/jobs/1", "ultipro", "UKG"],
  ]) {
    test(`${label} Apply link`, async () => {
      const career = "https://careers.example.com/jobs/1";
      const closed = [];
      globalThis.__applyCareerPage = () => careerPage(career, href, closed);
      const before = globalThis.__applyLaunchAttempts;
      const result = await openSession(career);
      assert.equal(globalThis.__applyLaunchAttempts, before + 1);
      assert.deepEqual(closed, [true]);
      assert.equal(result.unsupported.vendor, vendor);
      assert.equal(result.unsupported.label, label);
      assert.equal(result.unsupported.postingUrl, href);
      assert.equal(result.message, CLOSED[label]);
    });
  }

  test("a generic apply link that lands on Workday is refused", async () => {
    const career = "https://careers.example.com/jobs/1";
    const applyHref = "https://careers.example.com/jobs/1/apply";
    const landed = "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role";
    const closed = [];
    globalThis.__applyCareerPage = () => careerPage(career, applyHref, closed, { redirectOn: applyHref, redirectTo: landed });
    const before = globalThis.__applyLaunchAttempts;
    const result = await openSession(career);
    assert.equal(globalThis.__applyLaunchAttempts, before + 1);
    assert.deepEqual(closed, [true]);
    assert.equal(result.unsupported.vendor, "workday");
    assert.equal(result.unsupported.postingUrl, landed);
    assert.equal(result.message, CLOSED.Workday);
  });

  test("an Apply click that opens an iCIMS popup is refused", async () => {
    const career = "https://careers.example.com/jobs/1";
    const popup = "https://careers-acme.icims.com/jobs/9";
    const closed = [];
    globalThis.__applyCareerPage = () => careerPage(career, null, closed, { noAtsLink: true, applyClick: true, popupUrl: popup });
    const before = globalThis.__applyLaunchAttempts;
    const result = await openSession(career);
    assert.equal(globalThis.__applyLaunchAttempts, before + 1);
    assert.deepEqual(closed, [true]);
    assert.equal(result.unsupported.vendor, "icims");
    assert.equal(result.unsupported.postingUrl, popup);
    assert.equal(result.message, CLOSED.iCIMS);
  });

  test("a Workday tab that was already open does not refuse Apply", async () => {
    const career = "https://careers.example.com/jobs/1";
    const closed = [];
    globalThis.__applyCareerPage = () => careerPage(career, null, closed, {
      noAtsLink: true,
      applyClick: true,
      extraPages: [{ url: () => "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role" }],
    });
    await assert.rejects(() => openSession(career), /Couldn't find a fillable form/);
    assert.deepEqual(closed, [true]);
  });

  test("a career page that reaches Workday during the first form wait is refused", async () => {
    const career = "https://careers.example.com/jobs/1";
    const landed = "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role";
    const closed = [];
    globalThis.__applyCareerPage = () => careerPage(career, null, closed, {
      noAtsLink: true,
      redirectOnFirstWait: landed,
      formAfterRedirect: true,
    });
    const result = await openSession(career);
    assert.deepEqual(closed, [true]);
    assert.equal(result.id, undefined);
    assert.equal(result.unsupported.vendor, "workday");
    assert.equal(result.unsupported.postingUrl, landed);
    assert.equal(result.message, CLOSED.Workday);
  });

  test("a generic apply link that reaches Workday during the form wait is refused", async () => {
    const career = "https://careers.example.com/jobs/1";
    const applyHref = "https://careers.example.com/jobs/1/apply";
    const landed = "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role";
    const closed = [];
    globalThis.__applyCareerPage = () => careerPage(career, applyHref, closed, {
      redirectOn: applyHref,
      redirectTo: landed,
      redirectAfterWait: true,
      formAfterRedirect: true,
    });
    const result = await openSession(career);
    assert.deepEqual(closed, [true]);
    assert.equal(result.id, undefined);
    assert.equal(result.unsupported.vendor, "workday");
    assert.equal(result.unsupported.postingUrl, landed);
    assert.equal(result.message, CLOSED.Workday);
  });

  test("an Apply click whose popup is still blank after the form wait and then lands on iCIMS is refused", async () => {
    const career = "https://careers.example.com/jobs/1";
    const popup = "https://careers-acme.icims.com/jobs/9";
    const closed = [];
    globalThis.__applyCareerPage = () => careerPage(career, null, closed, {
      noAtsLink: true,
      applyClick: true,
      popupBlankAfterSettle: popup,
    });
    const result = await openSession(career);
    assert.deepEqual(closed, [true]);
    assert.equal(result.id, undefined);
    assert.equal(result.unsupported.vendor, "icims");
    assert.equal(result.unsupported.postingUrl, popup);
    assert.equal(result.message, CLOSED.iCIMS);
  });

  test("an Apply click whose popup is blank at the first look and lands on iCIMS later is refused", async () => {
    const career = "https://careers.example.com/jobs/1";
    const popup = "https://careers-acme.icims.com/jobs/9";
    const closed = [];
    globalThis.__applyCareerPage = () => careerPage(career, null, closed, {
      noAtsLink: true,
      applyClick: true,
      popupBlankThen: popup,
    });
    const result = await openSession(career);
    assert.deepEqual(closed, [true]);
    assert.equal(result.id, undefined);
    assert.equal(result.unsupported.vendor, "icims");
    assert.equal(result.unsupported.postingUrl, popup);
    assert.equal(result.message, CLOSED.iCIMS);
  });

  test("an Apply click that opens an iCIMS popup after the click is refused", async () => {
    const career = "https://careers.example.com/jobs/1";
    const popup = "https://careers-acme.icims.com/jobs/9";
    const closed = [];
    globalThis.__applyCareerPage = () => careerPage(career, null, closed, {
      noAtsLink: true,
      applyClick: true,
      popupOnWait: true,
      popupUrl: popup,
    });
    const result = await openSession(career);
    assert.deepEqual(closed, [true]);
    assert.equal(result.unsupported.vendor, "icims");
    assert.equal(result.unsupported.postingUrl, popup);
    assert.equal(result.message, CLOSED.iCIMS);
  });
});

const execFileAsync = promisify(execFile);

async function runChild(source) {
  const dir = await mkdtemp(join(tmpdir(), "apply-ats-"));
  const file = join(dir, "child.mjs");
  try {
    await writeFile(file, source);
    const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", file], {
      cwd: join(here, "../.."),
      timeout: 30_000,
    });
    return JSON.parse(stdout.trim().split("\n").filter(Boolean).pop());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a failed vendor import succeeds on the next call", async () => {
  const vendor = pathToFileURL(join(here, "../../src/lib/apply/unsupported-ats.mjs")).href;
  const missing = join(here, "../fixtures");
  const url = "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role";
  const result = await runChild(`
    process.env.CAREER_OPS_CODE_ROOT = ${JSON.stringify(missing)};
    const { unsupportedInAppAts } = await import(${JSON.stringify(vendor)});
    const url = ${JSON.stringify(url)};
    let rejected = false;
    try {
      await unsupportedInAppAts(url);
    } catch {
      rejected = true;
    }
    delete process.env.CAREER_OPS_CODE_ROOT;
    const hit = await unsupportedInAppAts(url);
    console.log(JSON.stringify({ rejected, vendor: hit && hit.vendor, postingUrl: hit && hit.postingUrl }));
  `);
  assert.equal(result.rejected, true);
  assert.equal(result.vendor, "workday");
  assert.equal(result.postingUrl, url);
});

test("POST /api/apply/session returns a controlled error when the vendor file cannot load", async () => {
  const route = pathToFileURL(join(here, "../../src/app/api/apply/session/route.ts")).href;
  const alias = pathToFileURL(join(here, "../helpers/web-ts-alias-loader.mjs")).href;
  const liveness = pathToFileURL(join(root, "liveness-browser.mjs")).href;
  const missing = join(here, "../fixtures");
  const result = await runChild(`
    import { register } from "node:module";
    register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(`
      export async function resolve(specifier, context, nextResolve) {
        if (specifier === "playwright-core") {
          return { url: ${JSON.stringify(stubUrl)}, shortCircuit: true };
        }
        return nextResolve(specifier, context);
      }
    `)}`)}, import.meta.url);
    await import(${JSON.stringify(alias)});
    process.env.CAREER_OPS_CODE_ROOT = ${JSON.stringify(missing)};
    const { setHostResolver } = await import(${JSON.stringify(liveness)});
    setHostResolver(async () => ["93.184.216.34"]);
    const { POST } = await import(${JSON.stringify(route)});
    const res = await POST(new Request("http://fixture.invalid/api/apply/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role" }),
    }));
    const body = await res.json();
    console.log(JSON.stringify({
      status: res.status,
      hasError: typeof body.error === "string" && body.error.length > 0,
      unsupported: body.unsupported === true,
      launch: globalThis.__applyLaunchAttempts || 0,
    }));
  `);
  assert.equal(result.status, 500);
  assert.equal(result.hasError, true);
  assert.equal(result.unsupported, false);
  assert.equal(result.launch, 0);
});
