import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { after, before, describe, test } from "node:test";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import "../helpers/web-ts-alias-loader.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync as writeSync } from "node:fs";

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
const { openSession, refusedDestination, finalizeDrivenSession, getSession } = await import("../../src/lib/apply/session.ts");
const { POST: drivePost } = await import("../../src/app/api/apply/drive/route.ts");
const { POST: fillPost } = await import("../../src/app/api/apply/fill/route.ts");
const { driveSession } = await import("../../src/lib/apply/drive.ts");
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

// A fake career page for openSession: navigating to it runs `onGoto` (here,
// breaking profile.yml mid-session) and lands on `landsOn`. `closed` records
// whether the Apply window (the Playwright context) was closed.
function careerPageLandingOn(landsOn, closed, onGoto) {
  let current = "about:blank";
  const frame = {
    url: () => current,
    evaluate: async () => {
      throw new Error("document is not defined");
    },
    waitForSelector: async () => null,
  };
  const none = { count: async () => 0, isVisible: async () => false, getAttribute: async () => null, click: async () => {}, first() { return this; }, or() { return this; } };
  const context = {
    route: async () => {},
    routeWebSocket: async () => {},
    setDefaultTimeout() {},
    pages: () => [],
    newPage: async () => page,
    close: async () => {
      closed.push(true);
    },
  };
  const page = {
    url: () => current,
    context: () => context,
    goto: async () => {
      onGoto();
      current = landsOn;
      return { status: () => 200, headers: () => ({}) };
    },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    screenshot: async () => Buffer.from("career"),
    title: async () => "Acme role",
    evaluate: async () => {
      throw new Error("document is not defined");
    },
    frames: () => [frame],
    mainFrame: () => frame,
    locator: () => ({ first: () => none, evaluateAll: async () => [] }),
    getByRole: () => none,
  };
  return { isConnected: () => false, newContext: async () => context };
}

describe("the host list is read once per Apply session", { concurrency: 1 }, () => {
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
    writeProfile('apply:\n  handoff_hosts: ["gupy.io", "linkedin.com."]\n');
  });

  test("a profile that breaks after the window opens cannot leave it open", async () => {
    writeProfile('apply:\n  handoff_hosts: ["gupy.io"]\n');
    const closed = [];
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () =>
      careerPageLandingOn(LISTED, closed, () => writeProfile('apply:\n  handoff_hosts: ["gupy.io"\n'));
    const result = await openSession("https://careers.acme.test/jobs/1");
    assert.deepEqual(closed, [true], "the Apply window was closed");
    assert.equal(result.unsupported?.vendor, "handoff", "the redirect onto a listed host is still refused");
    assert.equal(result.unsupported?.postingUrl, LISTED);
  });
});

const APPLICATION_FIELDS = [
  { id: "co0", type: "text", label: "Full name", required: true },
  { id: "co1", type: "email", label: "Email", required: true },
  { id: "co2", type: "file", label: "Resume", required: true },
];
const SIGN_IN_FIELDS = [
  { id: "si0", type: "email", label: "Email", required: true },
  { id: "si1", type: "password", label: "Password", required: true },
];

// A career page with no form at first; scrolling it (nudgeScroll) moves it to
// `movesTo`, where `fields` are shown (a usable application form by default).
// `control.moveTo(href)` moves it again later, as a drive step would.
function careerPageMovingOnScroll(movesTo, closed, fields = APPLICATION_FIELDS, control = {}) {
  let current = "about:blank";
  control.moveTo = (href) => {
    current = href;
    movesTo = href;
  };
  const formHere = () => current === movesTo;
  const frame = {
    url: () => current,
    evaluate: async () => {
      if (!formHere()) throw new Error("document is not defined");
      return { title: "Apply", fields };
    },
    waitForSelector: async () => null,
  };
  const none = { count: async () => 0, isVisible: async () => false, getAttribute: async () => null, click: async () => {}, first() { return this; }, or() { return this; } };
  const context = {
    route: async () => {},
    routeWebSocket: async () => {},
    setDefaultTimeout() {},
    pages: () => [],
    newPage: async () => page,
    close: async () => {
      closed.push(true);
    },
  };
  const page = {
    url: () => current,
    context: () => context,
    goto: async (href) => {
      current = href;
      return { status: () => 200, headers: () => ({}) };
    },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    screenshot: async () => Buffer.from("career"),
    title: async () => "Acme role",
    // nudgeScroll calls page.evaluate with a scroll offset: the page moves then.
    evaluate: async (_fn, arg) => {
      if (typeof arg === "number") current = movesTo;
      throw new Error("document is not defined");
    },
    frames: () => [frame],
    mainFrame: () => frame,
    locator: () => ({ first: () => none, evaluateAll: async () => [] }),
    getByRole: () => none,
  };
  return { isConnected: () => false, newContext: async () => context };
}

describe("the final host check before a session is kept", { concurrency: 1 }, () => {
  let restore;
  before(() => {
    restore = setHostResolver(async () => ["93.184.216.34"]);
    writeProfile('apply:\n  handoff_hosts: ["gupy.io"]\n');
  });
  after(() => {
    restore?.();
    clearTimeout(globalThis.__coIdleTimer);
    globalThis.__coIdleTimer = undefined;
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = undefined;
    writeProfile('apply:\n  handoff_hosts: ["gupy.io", "linkedin.com."]\n');
  });

  test("a page that moves to a listed host while the form is recovered is refused, not registered", async () => {
    const closed = [];
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () => careerPageMovingOnScroll(LISTED, closed);
    const result = await openSession("https://careers.acme.test/jobs/1");
    assert.equal(result.id, undefined, "no session was registered");
    assert.equal(result.unsupported?.vendor, "handoff");
    assert.equal(result.unsupported?.postingUrl, LISTED);
    assert.deepEqual(closed, [true], "the Apply window was closed");
  });

  test("the same move onto Workday is refused too", async () => {
    const workday = "https://acme.wd1.myworkdayjobs.com/en-US/External/job/Role";
    const closed = [];
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () => careerPageMovingOnScroll(workday, closed);
    const result = await openSession("https://careers.acme.test/jobs/1");
    assert.equal(result.id, undefined);
    assert.equal(result.unsupported?.vendor, "workday");
    assert.deepEqual(closed, [true]);
  });

  test("a move to an unlisted host keeps the session", async () => {
    const closed = [];
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () => careerPageMovingOnScroll("https://apply.acme-careers.test/form", closed);
    const result = await openSession("https://careers.acme.test/jobs/1");
    assert.ok(result.id, JSON.stringify(result).slice(0, 300));
    assert.equal(result.unsupported, undefined);
    assert.deepEqual(closed, [], "the window stays open for filling");
  });

  test("a move to a listed host's sign-in page gets the handoff panel, not the login-wall error", async () => {
    const closed = [];
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () => careerPageMovingOnScroll(LISTED, closed, SIGN_IN_FIELDS);
    const result = await openSession("https://careers.acme.test/jobs/1");
    assert.equal(result.unsupported?.vendor, "handoff");
    assert.equal(result.unsupported?.postingUrl, LISTED);
    assert.deepEqual(closed, [true]);
  });

  test("a move to an unlisted sign-in page still gets the login-wall error", async () => {
    const closed = [];
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () => careerPageMovingOnScroll("https://login.acme-careers.test/", closed, SIGN_IN_FIELDS);
    await assert.rejects(openSession("https://careers.acme.test/jobs/1"), /log ?in|sign ?in|account/i);
    assert.deepEqual(closed, [true]);
  });
});

// An unlisted career page (no form of its own) that embeds a form in a frame
// on `frameUrl`. With `controls`, the frame also reports that many controls to
// richestControlFrame while `pageFields` sit in the main frame, so the
// deterministic form and the agent's frame differ.
function careerPageEmbedding(frameUrl, closed, { pageFields = [], frameFields = APPLICATION_FIELDS, controls = 0, control = {} } = {}) {
  // control.setFrameUrl(href): the embedded frame navigates later, as an
  // iframe that finishes loading during a drive would.
  control.setFrameUrl = (href) => {
    frameUrl = href;
  };
  let current = "about:blank";
  const counting = (fn) => String(fn).includes("contenteditable");
  const main = {
    url: () => current,
    evaluate: async (fn) => {
      if (counting(fn)) return pageFields.length;
      if (!pageFields.length) throw new Error("document is not defined");
      return { title: "Acme role", fields: pageFields };
    },
    waitForSelector: async () => null,
  };
  const child = {
    url: () => frameUrl,
    evaluate: async (fn) => (counting(fn) ? controls : { title: "", fields: frameFields }),
    waitForSelector: async () => null,
  };
  const none = { count: async () => 0, isVisible: async () => false, getAttribute: async () => null, click: async () => {}, first() { return this; }, or() { return this; } };
  const context = {
    route: async () => {},
    routeWebSocket: async () => {},
    setDefaultTimeout() {},
    pages: () => [],
    newPage: async () => page,
    close: async () => {
      closed.push(true);
    },
  };
  const page = {
    url: () => current,
    context: () => context,
    goto: async (href) => {
      current = href;
      return { status: () => 200, headers: () => ({}) };
    },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    screenshot: async () => Buffer.from("career"),
    title: async () => "Acme role",
    evaluate: async () => {
      throw new Error("document is not defined");
    },
    frames: () => [main, child],
    mainFrame: () => main,
    locator: () => ({ first: () => none, evaluateAll: async () => [] }),
    getByRole: () => none,
  };
  return { isConnected: () => false, newContext: async () => context };
}

describe("a form embedded from another host", { concurrency: 1 }, () => {
  let restore;
  before(() => {
    restore = setHostResolver(async () => ["93.184.216.34"]);
    writeProfile('apply:\n  handoff_hosts: ["gupy.io"]\n');
  });
  after(() => {
    restore?.();
    clearTimeout(globalThis.__coIdleTimer);
    globalThis.__coIdleTimer = undefined;
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = undefined;
    writeProfile('apply:\n  handoff_hosts: ["gupy.io", "linkedin.com."]\n');
  });

  test("a listed host's form inside an unlisted page is refused", async () => {
    const closed = [];
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () => careerPageEmbedding(LISTED, closed);
    const result = await openSession("https://careers.acme.test/jobs/1");
    assert.equal(result.id, undefined, "no session was registered");
    assert.equal(result.unsupported?.vendor, "handoff");
    assert.equal(result.unsupported?.postingUrl, LISTED);
    assert.deepEqual(closed, [true]);
  });

  test("a listed host's embedded sign-in form gets the handoff panel, not the login-wall error", async () => {
    const closed = [];
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () => careerPageEmbedding(LISTED, closed, { frameFields: SIGN_IN_FIELDS });
    const result = await openSession("https://careers.acme.test/jobs/1");
    assert.equal(result.unsupported?.vendor, "handoff");
    assert.equal(result.unsupported?.postingUrl, LISTED);
    assert.deepEqual(closed, [true]);
  });

  test("an unlisted host's embedded form is still supported", async () => {
    const closed = [];
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () => careerPageEmbedding("https://boards.acme-ats.test/embed/1", closed);
    const result = await openSession("https://careers.acme.test/jobs/1");
    assert.ok(result.id, JSON.stringify(result).slice(0, 300));
    assert.deepEqual(closed, []);
  });

  test("with the AI interpreter forced on, a listed host's frame is refused before the agent reads it", async () => {
    const closed = [];
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () =>
      careerPageEmbedding(LISTED, closed, { pageFields: APPLICATION_FIELDS, frameFields: [], controls: 12 });
    // An unregistered CLI id: should the check be missing, the interpreter
    // refuses it instead of launching anything.
    const result = await openSession("https://careers.acme.test/jobs/1", "not-a-registered-cli", true);
    assert.equal(result.id, undefined, "no session was registered");
    assert.equal(result.unsupported?.vendor, "handoff");
    assert.equal(result.unsupported?.postingUrl, LISTED);
    assert.deepEqual(closed, [true]);
  });
});


// The streamed drive (/api/apply/drive) works on a session that is already
// open. It reads the session's host list, so a step that lands on a listed host
// ends the drive with the refusal panel and closes the window.
describe("the streamed drive refuses a listed host", { concurrency: 1 }, () => {
  let restore;
  let fakeBin;
  let previousPath;
  before(() => {
    restore = setHostResolver(async () => ["93.184.216.34"]);
    writeProfile('apply:\n  handoff_hosts: ["gupy.io"]\n');
    // A stand-in claude first on PATH: if a refusal is missed and the drive
    // starts, this runs instead of the real CLI and leaves a mark.
    fakeBin = mkdtempSync(join(tmpdir(), "handoff-drive-bin-"));
    writeSync(join(fakeBin, "claude"), `#!/bin/sh\ntouch "${join(fakeBin, "ran")}"\necho '{"action":"stuck","reason":"fake"}'\n`, { mode: 0o755 });
    previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${delimiter}${previousPath}`;
  });
  after(() => {
    restore?.();
    process.env.PATH = previousPath;
    rmSync(fakeBin, { recursive: true, force: true });
    clearTimeout(globalThis.__coIdleTimer);
    globalThis.__coIdleTimer = undefined;
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = undefined;
    writeProfile('apply:\n  handoff_hosts: ["gupy.io", "linkedin.com."]\n');
  });

  const openUnlisted = async (closed, control) => {
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () => careerPageMovingOnScroll("https://apply.acme-careers.test/form", closed, APPLICATION_FIELDS, control);
    const opened = await openSession("https://careers.acme.test/jobs/1");
    assert.ok(opened.id, JSON.stringify(opened).slice(0, 300));
    return opened.id;
  };

  test("a session whose page moved to a listed host is refused and closed", async () => {
    const closed = [];
    const control = {};
    const id = await openUnlisted(closed, control);
    assert.equal(await refusedDestination(id), null, "an unlisted page is left alone");
    assert.deepEqual(closed, []);
    control.moveTo(LISTED);
    const hit = await refusedDestination(id);
    assert.equal(hit?.vendor, "handoff");
    assert.equal(hit?.postingUrl, LISTED);
    assert.deepEqual(closed, [true], "the window was closed");
    assert.equal(getSession(id), undefined, "the session is gone");
  });

  test("finalizing a drive that ended on a listed host gives the refusal, not a form", async () => {
    const closed = [];
    const control = {};
    const id = await openUnlisted(closed, control);
    control.moveTo(LISTED);
    const fin = await finalizeDrivenSession(id);
    assert.equal(fin?.unsupported?.vendor, "handoff");
    assert.equal(fin?.fields, undefined, "no form is handed back");
    assert.deepEqual(closed, [true]);
  });

  // The stand-in claude is a #!/bin/sh script, which Windows does not run.
  const shFixture = process.platform === "win32" && "sh fixture";

  test("POST /api/apply/drive streams the refusal panel and never starts the drive", { skip: shFixture }, async () => {
    const closed = [];
    const control = {};
    const id = await openUnlisted(closed, control);
    control.moveTo(LISTED);
    const res = await drivePost(
      new Request("http://fixture.invalid/api/apply/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, cliId: "claude", goal: "reach", application: "42" }),
      }),
    );
    const events = (await res.text()).trim().split("\n").map((line) => JSON.parse(line));
    const last = events.at(-1);
    assert.equal(last.t, "unsupported", JSON.stringify(events).slice(0, 400));
    assert.equal(last.unsupported, true);
    assert.equal(last.postingUrl, LISTED);
    assert.match(last.checklistHref ?? "", /42/);
    assert.equal(events.filter((e) => e.t === "step").length, 0, "no drive step ran");
    assert.equal(existsSync(join(fakeBin, "ran")), false, "the CLI was never started");
    assert.deepEqual(closed, [true]);
  });

  test("POST /api/apply/fill refuses a page that moved to a listed host, and fills nothing", async () => {
    const closed = [];
    const control = {};
    const id = await openUnlisted(closed, control);
    control.moveTo(LISTED);
    const res = await fillPost(
      new Request("http://fixture.invalid/api/apply/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, answers: { co0: "Ada" }, fields: APPLICATION_FIELDS, handoff: true, application: "42" }),
      }),
    );
    const body = await res.json();
    assert.equal(body.unsupported, true, JSON.stringify(body).slice(0, 300));
    assert.equal(body.postingUrl, LISTED);
    assert.match(body.checklistHref ?? "", /42/);
    assert.equal(body.steps, undefined, "no field was filled");
    assert.deepEqual(closed, [true], "the window was closed");
    assert.equal(getSession(id), undefined);
  });

  test("the fill route checks the destination after the CV lookup, right before filling", () => {
    // The CV lookup is awaited, so a check made before it could be stale by
    // the time fillSession writes. Pin the order on the route's source.
    const route = readFileSync(join(here, "../../src/app/api/apply/fill/route.ts"), "utf8");
    const cv = route.indexOf("await resolveSessionCv(");
    const check = route.indexOf("await refusedDestination(sessionId)");
    const fill = route.indexOf("await fillSession(");
    assert.ok(cv > 0 && check > 0 && fill > 0, "anchors still exist");
    assert.equal(route.split("await refusedDestination(").length - 1, 1, "one check");
    assert.ok(cv < check && check < fill, "CV lookup, then the check, then the fill");
  });

  test("the Apply page shows the refusal panel for a refused fill", () => {
    const provider = readFileSync(join(here, "../../src/components/apply/apply-provider.tsx"), "utf8");
    assert.match(provider, /const refusal = sessionFollowUp\(d\);\s*if \(refusal\.kind === "unsupported"\) \{\s*showRefusal\(refusal\)/);
  });

  test("the reach drive sends the application number, so the refusal keeps its checklist link", () => {
    const provider = readFileSync(join(here, "../../src/components/apply/apply-provider.tsx"), "utf8");
    assert.match(provider, /goal: "reach", application: nRef\.current/);
  });

  test("a listed host's iframe that loads into a session's page is refused at finalization", async () => {
    const closed = [];
    const control = {};
    globalThis.__coHeadedBrowser = undefined;
    globalThis.__applyCareerPage = () => careerPageEmbedding("https://boards.acme-ats.test/embed/1", closed, { control });
    const opened = await openSession("https://careers.acme.test/jobs/1");
    assert.ok(opened.id, JSON.stringify(opened).slice(0, 300));
    control.setFrameUrl(LISTED);
    const fin = await finalizeDrivenSession(opened.id);
    assert.equal(fin?.unsupported?.vendor, "handoff");
    assert.equal(fin?.unsupported?.postingUrl, LISTED);
    assert.equal(fin?.fields, undefined);
    assert.deepEqual(closed, [true]);
  });

  test("a page that moves while the planner thinks is refused, even when the reply is \"stuck\"", { skip: shFixture }, async () => {
    // The stand-in claude replies "stuck". The destination check sees nothing
    // before the first step and a listed host once the planner has replied.
    const hit = { vendor: "handoff", label: "gupy.io", postingUrl: LISTED };
    let checks = 0;
    const refused = async () => (++checks > 1 ? hit : null);
    const frame = { url: () => "https://careers.acme.test/jobs/1", evaluate: async () => { throw new Error("document is not defined"); } };
    const page = {
      url: () => "https://careers.acme.test/jobs/1",
      title: async () => "Acme role",
      screenshot: async () => Buffer.from("career"),
      mainFrame: () => frame,
      frames: () => [frame],
      context: () => ({ pages: () => [] }),
      waitForTimeout: async () => {},
    };
    const result = await driveSession(page, "claude", "full", async () => false, () => {}, 3, [], refused);
    assert.ok(existsSync(join(fakeBin, "ran")), "the planner (the stand-in claude) ran once");
    assert.equal(result.reason, "unsupported", JSON.stringify(result).slice(0, 300));
    assert.deepEqual(result.unsupported, hit);
    assert.equal(result.turns, 0, "no action was taken");
    rmSync(join(fakeBin, "ran"), { force: true });
  });
});

// The Apply page is React, so its handling is pinned on the source, as
// apply-handoff-wiring.test.mjs does: a refusal from either drive stream must
// reach the same panel the session open shows.
test("the Apply page shows the refusal panel for a refusal from either drive stream", () => {
  const provider = readFileSync(join(here, "../../src/components/apply/apply-provider.tsx"), "utf8");
  assert.match(provider, /ev\.t === "unsupported"[\s\S]{0,200}showRefusal\(followUp\)/, "the reach drive (goal reach)");
  assert.match(provider, /result\.status === "unsupported"\) \{\s*showRefusal\(result\)/, "the full fill (goal full)");
  assert.match(provider, /followUp\.kind === "unsupported"\) \{\s*showRefusal\(followUp\)/, "the session open");
});
