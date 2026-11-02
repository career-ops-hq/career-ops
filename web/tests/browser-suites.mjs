#!/usr/bin/env node
// tests/browser-suites.mjs — runs the tests/lib/*.browser.test.mjs suites, each
// against a web server of its own on disposable data (#5764).
//
// `npm test` discovers those suites too, and there they skip: each needs a
// running server's URL in an env var, and nothing set one, so they ran on no CI
// job. For every suite this creates the data root its header asks for, starts
// the BUILT app (`node server.mjs start`, so run `npm run build` first) on a free
// loopback port with CAREER_OPS_ROOT pointed at it, runs the suite with its vars
// set, and stops the server. One server per suite because several write to
// their data root, and a later suite must not see an earlier one's edits.
//
// A suite skipping here is a failure, never a pass: CAREER_OPS_REQUIRE_WEB_SERVER=1
// makes a missing var throw (tests/helpers/live-server.mjs), and the runner also
// fails on any skipped or todo test the reporter counts. A browser suite missing
// from SUITES fails the run too, so a new one cannot be left out silently.
//
// The suites launch Chrome with `channel: "chrome"` (Google Chrome, not
// Playwright's bundled Chromium); GitHub's ubuntu-latest image ships it.
//
//   node tests/browser-suites.mjs                 # every suite
//   node tests/browser-suites.mjs inbox-undo      # suites whose name contains it

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRE_WEB_SERVER_ENV } from "./helpers/live-server.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB = path.join(WEB, "tests", "lib");
const FIXTURES = path.join(WEB, "tests", "fixtures");
const READY_TIMEOUT_MS = 90_000;

// The suites refuse a data root outside os.tmpdir(), comparing it with the
// root's realpath. On macOS TMPDIR is a /var symlink into /private/var, so the
// children get the resolved path or every root would look like it escaped.
process.env.TMPDIR = fs.realpathSync(os.tmpdir());

// suite → its URL var, its data-root var (when it reads the root itself), and
// the fixture generator for the root. Suites whose header asks only for
// "disposable data" get blank: no tracker, and the fictional cv.md
// assistant-focus needs.
const SUITES = {
  "accessible-names": { url: "ACCESSIBLE_NAMES_TEST_URL", fixture: "pipeline-status" },
  "analytics-views": { url: "ANALYTICS_TEST_URL", root: "ANALYTICS_TEST_ROOT", fixture: "pipeline-status" },
  "apply-field-accessibility": { url: "APPLY_FIELDS_TEST_URL", fixture: "blank" },
  "assistant-confirmation-accessibility": { url: "ASSISTANT_CONFIRM_TEST_URL", fixture: "blank" },
  "assistant-focus": { url: "ASSISTANT_FOCUS_TEST_URL", fixture: "blank" },
  "assistant-markdown-lazy": { url: "ASSISTANT_MARKDOWN_LAZY_TEST_URL", fixture: "blank" },
  "assistant-request-feedback": { url: "ASSISTANT_FEEDBACK_TEST_URL", fixture: "blank" },
  "assistant-status-recovery": { url: "ASSISTANT_STATUS_TEST_URL", fixture: "blank" },
  "back-link-scroll": { url: "BACK_SCROLL_TEST_URL", root: "BACK_SCROLL_TEST_ROOT", fixture: "pipeline-long" },
  "cv-preview-lines": { url: "CV_PREVIEW_LINES_TEST_URL", fixture: "blank" },
  "cv-studio-preview": { url: "CV_STUDIO_PREVIEW_TEST_URL", fixture: "cv-studio-preview" },
  "cv-upload": { url: "CV_UPLOAD_TEST_URL", root: "CV_UPLOAD_TEST_ROOT", fixture: "cv-upload" },
  "employer-preset": { url: "EXPLORE_EMPLOYER_TEST_URL", fixture: "blank" },
  "evaluation-options": { url: "EVALUATION_OPTIONS_TEST_URL", fixture: "inbox-undo" },
  "followups-loading": { url: "FOLLOWUPS_LOADING_TEST_URL", root: "FOLLOWUPS_LOADING_TEST_ROOT", fixture: "pipeline-status" },
  "inbox-keys": { url: "INBOX_KEYS_TEST_URL", root: "INBOX_KEYS_TEST_ROOT", fixture: "inbox-undo" },
  "inbox-undo": { url: "INBOX_UNDO_TEST_URL", root: "INBOX_UNDO_TEST_ROOT", fixture: "inbox-undo" },
  "loading-transition": { url: "LOADING_TRANSITION_TEST_URL", root: "LOADING_TRANSITION_TEST_ROOT", fixture: "pipeline-status" },
  "mobile-nav-drawer": { url: "MOBILE_NAV_TEST_URL", fixture: "blank" },
  "pipeline-inline-status": { url: "PIPELINE_STATUS_TEST_URL", root: "PIPELINE_STATUS_TEST_ROOT", fixture: "pipeline-status" },
  "pipeline-report-states": { url: "PIPELINE_REPORT_STATES_TEST_URL", root: "PIPELINE_REPORT_STATES_TEST_ROOT", fixture: "pipeline-report-states" },
  "pipeline-return": { url: "PIPELINE_RETURN_TEST_URL", root: "PIPELINE_RETURN_TEST_ROOT", fixture: "pipeline-status" },
  "pipeline-views": { url: "PIPELINE_VIEWS_TEST_URL", root: "PIPELINE_VIEWS_TEST_ROOT", fixture: "pipeline-status" },
  "skip-link": { url: "SKIP_LINK_TEST_URL", fixture: "blank" },
  "worker-feedback": { url: "WORKER_FEEDBACK_TEST_URL", fixture: "blank" },
};

// Every var any suite reads, so a value from the caller's shell cannot point a
// suite at some other server.
const SUITE_VARS = Object.values(SUITES).flatMap((s) => [s.url, s.root].filter(Boolean));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function makeRoot(fixture) {
  const result = spawnSync(process.execPath, [path.join(FIXTURES, `${fixture}.mjs`)], { encoding: "utf8", env: process.env });
  if (result.status !== 0) throw new Error(`fixture ${fixture} failed: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
}

// detached, so the server and the next process server.mjs spawns share a
// process group that stop() can signal in one call.
function startServer(root, port, log) {
  const env = { ...process.env, CAREER_OPS_ROOT: root, NEXT_TELEMETRY_DISABLED: "1" };
  for (const name of ["CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER", "CAREER_OPS_WEB_ALLOWED_HOSTS", ...SUITE_VARS]) delete env[name];
  const child = spawn(process.execPath, ["server.mjs", "start", "-p", String(port)], {
    cwd: WEB, env, detached: true, stdio: ["ignore", log, log],
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  return { child, exited };
}

async function waitReady(url, server) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let gone = null;
  server.exited.then((how) => { gone = how; });
  while (Date.now() < deadline) {
    if (gone) throw new Error(`server exited before it answered (code ${gone.code}, signal ${gone.signal})`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      await response.body?.cancel();
      if (response.status < 500) return;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not answer ${url} within ${READY_TIMEOUT_MS / 1000}s`);
}

async function stop(server) {
  try { process.kill(-server.child.pid, "SIGTERM"); } catch { return; }
  const timer = setTimeout(() => { try { process.kill(-server.child.pid, "SIGKILL"); } catch { /* gone */ } }, 10_000);
  await server.exited;
  clearTimeout(timer);
}

// Echoes the suite's output and returns it, so the summary counts can be read.
function runSuite(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--test", "--test-reporter=spec", file], {
      cwd: WEB, env, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => { out += chunk; process.stdout.write(chunk); });
    }
    // close, not exit: exit can fire before the last of stdout arrives, and
    // the summary counts are read from the end of it.
    child.once("close", (code) => resolve({ code, out }));
  });
}

function count(out, label) {
  const match = out.match(new RegExp(`^ℹ ${label} (\\d+)$`, "m"));
  return match ? Number(match[1]) : null;
}

const onDisk = fs.readdirSync(LIB).filter((f) => f.endsWith(".browser.test.mjs")).map((f) => f.replace(/\.browser\.test\.mjs$/, "")).sort();
const unlisted = onDisk.filter((name) => !SUITES[name]);
const stale = Object.keys(SUITES).filter((name) => !onDisk.includes(name));
if (unlisted.length || stale.length) {
  if (unlisted.length) console.error(`❌ not in tests/browser-suites.mjs SUITES, so they would never run: ${unlisted.join(", ")}`);
  if (stale.length) console.error(`❌ in SUITES but no tests/lib/<name>.browser.test.mjs exists: ${stale.join(", ")}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(WEB, ".next", "BUILD_ID"))) {
  console.error("❌ no production build in .next/ — run `npm run build` first");
  process.exit(1);
}

const filter = process.argv[2];
const selected = Object.keys(SUITES).filter((name) => !filter || name.includes(filter));
if (selected.length === 0) {
  console.error(`❌ no browser suite name contains "${filter}"`);
  process.exit(1);
}

// One run of one suite on a fresh data root and server. Returns null when it
// passed, else what went wrong and whether a second run could change that: a
// suite that skips or runs nothing does so every time, so only a failing exit
// or a server that would not start is retried.
async function attempt(name) {
  const suite = SUITES[name];
  const file = path.join("tests", "lib", `${name}.browser.test.mjs`);
  let root;
  let server;
  let logPath;
  let problem = null;
  try {
    root = makeRoot(suite.fixture);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    logPath = path.join(root, "..", `${path.basename(root)}-server.log`);
    const log = fs.openSync(logPath, "w");
    server = startServer(root, port, log);
    fs.closeSync(log);
    await waitReady(url, server);
    // FORCE_COLOR=0: an inherited FORCE_COLOR colors the reporter's summary
    // lines, and count() would then find no tests.
    const env = { ...process.env, [REQUIRE_WEB_SERVER_ENV]: "1", FORCE_COLOR: "0" };
    for (const name of SUITE_VARS) delete env[name];
    env[suite.url] = url;
    if (suite.root) env[suite.root] = root;
    const { code, out } = await runSuite(file, env);
    const tests = count(out, "tests");
    const skipped = count(out, "skipped");
    const todo = count(out, "todo");
    // Skips first: a run that both skipped and failed must not be cleared by a
    // clean retry.
    if (skipped > 0 || todo > 0) problem = { message: `${skipped ?? "?"} skipped, ${todo ?? "?"} todo — a skip here is a failure`, retryable: false };
    else if (code !== 0) problem = { message: `exited ${code}`, retryable: true };
    else if (!tests) problem = { message: "ran no tests", retryable: false };
    else if (skipped === null || todo === null) problem = { message: "the reporter printed no skipped/todo counts", retryable: false };
  } catch (err) {
    problem = { message: err.message, retryable: true };
  } finally {
    if (server) await stop(server);
    if (problem && logPath && fs.existsSync(logPath)) {
      console.log(`--- ${name} server log ---\n${fs.readFileSync(logPath, "utf8").slice(-8_000)}`);
    }
    if (logPath) fs.rmSync(logPath, { force: true });
    if (root) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
  return problem;
}

// A failing suite gets one more run, on a new root and server, because some
// pages intermittently render a second copy of their content (#5764), which
// trips Playwright's strict mode in a suite that is otherwise green. A suite
// that fails twice fails the run, and one that passes only on the second try
// is named in the summary and, on GitHub Actions, as a warning annotation.
const failures = [];
const flaky = [];
for (const name of selected) {
  console.log(`\n▶ ${name}`);
  const first = await attempt(name);
  if (!first) continue;
  if (!first.retryable) { failures.push(`${name}: ${first.message}`); continue; }
  console.log(`\n↻ ${name} failed (${first.message}); running it once more on a new server`);
  const second = await attempt(name);
  if (second) failures.push(`${name}: ${second.message} (and ${first.message} on the first run)`);
  else flaky.push(`${name}: ${first.message} on the first run, passed on the second`);
}

console.log("");
if (flaky.length) {
  console.log(`⚠️  ${flaky.length} browser suite(s) passed only on a second run:\n  ${flaky.join("\n  ")}`);
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const line of flaky) console.log(`::warning title=Flaky browser suite::${line}`);
  }
}
if (failures.length) {
  console.error(`❌ ${failures.length} of ${selected.length} browser suites failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`✅ ${selected.length} browser suites ran against a live server, none skipped`);
