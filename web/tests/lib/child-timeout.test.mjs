// A child that ignores SIGTERM used to leave the request open. These two
// routes now escalate to SIGKILL and answer. CAREER_OPS_CHILD_TIMEOUT_MS is
// the startup budget: the child has to be running, with its handler
// installed, before the first signal. The route's grace period is still 2s.
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

const codeRoot = mkdtempSync(join(tmpdir(), "co-child-timeout-code-"));
const dataRoot = mkdtempSync(join(tmpdir(), "co-child-timeout-data-"));
const pidFile = join(codeRoot, "child.pid");
const ENV_KEYS = ["CAREER_OPS_CODE_ROOT", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER", "CAREER_OPS_CHILD_TIMEOUT_MS", "CO_FIXTURE_PID"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
// Windows kills SIGTERM immediately, like SIGKILL, so the handler never runs
// and the grace window never elapses. The timeout message still has to show
// on every platform. The grace floor and the exit-on-signal case stay on POSIX.
const canCatchTerm = process.platform !== "win32";
const STARTUP_MS = 2_000;
const GRACE_MS = 2_000;
const graceFloor = STARTUP_MS + GRACE_MS - 500;
const REQUEST_CAP_MS = 12_000;

before(() => {
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_DATA_DIR = "";
  process.env.CAREER_OPS_TRACKER = "";
  process.env.CAREER_OPS_CHILD_TIMEOUT_MS = String(STARTUP_MS);
  process.env.CO_FIXTURE_PID = pidFile;
});

after(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(codeRoot, { recursive: true, force: true });
  rmSync(dataRoot, { recursive: true, force: true });
});

// The fixture records its pid before it waits. Node's own test timeout is
// infinite, so a route that never answers would never reach the elapsed
// check. The cap rejects, and the fixture is stopped when the request
// settles, including when the route answers while the child is still alive.
function fixture(source) {
  return `import { writeFileSync } from "node:fs";
if (process.env.CO_FIXTURE_PID) writeFileSync(process.env.CO_FIXTURE_PID, String(process.pid));
${source}`;
}

function parentPid(pid) {
  try {
    const out = process.platform === "win32"
      ? execFileSync("powershell.exe", [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`,
        ], { encoding: "utf8", timeout: 5_000, windowsHide: true })
      : execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000 });
    const parent = Number(String(out).trim());
    return Number.isInteger(parent) ? parent : null;
  } catch {
    return null;
  }
}

function stopFixture() {
  let pid;
  try {
    pid = Number(readFileSync(pidFile, "utf8"));
  } catch {
    return;
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  try {
    process.kill(pid, 0);
  } catch {
    return;
  }
  // A reused pid belongs to some other process. Only our child is stopped.
  if (parentPid(pid) !== process.pid) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // It exited between the checks.
  }
}

async function finishOrStop(work) {
  try { unlinkSync(pidFile); } catch { /* the first request has no pid file */ }
  let timer;
  const cap = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`request stayed open past ${REQUEST_CAP_MS}ms`)), REQUEST_CAP_MS);
  });
  try {
    return await Promise.race([Promise.resolve(work), cap]);
  } finally {
    clearTimeout(timer);
    stopFixture();
  }
}

const HANG = fixture('process.on("SIGTERM", () => {});\nsetInterval(() => {}, 1e9);\n');
const EXIT_ON_TERM = fixture('process.on("SIGTERM", () => { console.log(JSON.stringify({ added: 1, already: 0, found: 1, message: "Added 1." })); process.exit(0); });\nsetInterval(() => {}, 1e9);\n');

test("a tracker delete that ignores SIGTERM is stopped and the next delete can run", { timeout: 45_000 }, async () => {
  writeFileSync(join(codeRoot, "tracker.mjs"), `// tracker.mjs delete --num\n${HANG}`);
  const { POST } = await import("@/app/api/tracker/delete/route.ts");
  const started = Date.now();
  const res = await finishOrStop(POST(new Request("http://localhost/api/tracker/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ n: "4" }),
  })));
  const body = await res.json();
  const elapsed = Date.now() - started;
  assert.equal(res.status, 400);
  assert.equal(body.error, "Delete timed out after 30 seconds and was stopped.");
  assert.ok(elapsed < REQUEST_CAP_MS, `the request stayed open (${elapsed}ms)`);
  if (canCatchTerm) assert.ok(elapsed >= graceFloor, `killed too soon (${elapsed}ms)`);

  writeFileSync(join(codeRoot, "tracker.mjs"), fixture("// tracker.mjs delete --num\nprocess.exit(0);\n"));
  const again = await finishOrStop(POST(new Request("http://localhost/api/tracker/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ n: "4" }),
  })));
  assert.equal(again.status, 200, JSON.stringify(await again.json()));

  if (!canCatchTerm) return;
  writeFileSync(join(codeRoot, "tracker.mjs"), `// tracker.mjs delete --num\n${EXIT_ON_TERM}`);
  const kept = await finishOrStop(POST(new Request("http://localhost/api/tracker/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ n: "4" }),
  })));
  const keptBody = await kept.json();
  assert.equal(kept.status, 200, JSON.stringify(keptBody));
  assert.equal(keptBody.ok, true);
});

test("a LinkedIn import that ignores SIGTERM is stopped", { timeout: 45_000 }, async () => {
  writeFileSync(join(codeRoot, "linkedin-import.mjs"), HANG);
  const { POST } = await import("@/app/api/linkedin-import/route.ts");
  const started = Date.now();
  const res = await finishOrStop(POST(new Request("http://localhost/api/linkedin-import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Engineer at Example\nhttps://example.test/jobs/1" }),
  })));
  const body = await res.json();
  const elapsed = Date.now() - started;
  assert.equal(res.status, 500);
  assert.equal(body.uncertain, true);
  assert.equal(body.message, "The import timed out after 30 seconds and was stopped. Check Pipeline before pasting again.");
  assert.ok(elapsed < REQUEST_CAP_MS, `the request stayed open (${elapsed}ms)`);
  if (canCatchTerm) assert.ok(elapsed >= graceFloor, `killed too soon (${elapsed}ms)`);
  if (!canCatchTerm) return;

  writeFileSync(join(codeRoot, "linkedin-import.mjs"), EXIT_ON_TERM);
  const kept = await finishOrStop(POST(new Request("http://localhost/api/linkedin-import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Engineer at Example\nhttps://example.test/jobs/1" }),
  })));
  const keptBody = await kept.json();
  assert.equal(kept.status, 200, JSON.stringify(keptBody));
  assert.equal(keptBody.added, 1);
  assert.equal(keptBody.message, "Added 1.");
});
