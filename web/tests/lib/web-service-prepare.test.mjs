import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkTree } from "../../../lib/walk-tree.mjs";
import {
  FAILURE_BACKOFF_MS,
  PrepareError,
  npmInvocation,
  prepareService,
  sourceFingerprint,
  untrackedSignature,
  walkSignature,
} from "../../src/lib/web-service-prepare.mjs";

const RUNTIME = "v26.13.0 darwin arm64";

// A web/ directory plus a fake npm that does what the real one does to the directories
// the stamps live in: `ci` deletes node_modules and recreates it, `run build` empties
// the build directory and writes BUILD_ID.
function sandbox({ lock = "lock-v1", failing = null } = {}) {
  const webDir = fs.mkdtempSync(path.join(os.tmpdir(), "co-svc-prep-"));
  fs.writeFileSync(path.join(webDir, "package-lock.json"), lock);
  const calls = [];
  const state = { fingerprint: "commit-1", runtime: RUNTIME, env: {} };
  const runNpm = (args) => {
    calls.push(args.join(" "));
    const key = args.join(" ");
    if (key === failing) return 1;
    if (key === "ci") {
      fs.rmSync(path.join(webDir, "node_modules"), { recursive: true, force: true });
      fs.mkdirSync(path.join(webDir, "node_modules"));
    } else {
      const dist = path.join(webDir, state.env.BUILD_DIST || ".next");
      fs.rmSync(dist, { recursive: true, force: true });
      fs.mkdirSync(dist, { recursive: true });
      fs.writeFileSync(path.join(dist, "BUILD_ID"), "id");
    }
    return 0;
  };
  const prepare = () =>
    prepareService({
      webDir,
      runtime: state.runtime,
      env: state.env,
      fs,
      fingerprint: () => state.fingerprint,
      runNpm,
      log: () => {},
    });
  return { webDir, calls, state, prepare, cleanup: () => fs.rmSync(webDir, { recursive: true, force: true }) };
}

function withSandbox(options, fn) {
  const sb = sandbox(options);
  try {
    return fn(sb);
  } finally {
    sb.cleanup();
  }
}

test("a first start installs and then builds", () => withSandbox({}, (sb) => {
  assert.deepEqual(sb.prepare(), { installed: true, built: true });
  assert.deepEqual(sb.calls, ["ci", "run build"]);
}));

test("a second start with nothing changed runs neither", () => withSandbox({}, (sb) => {
  sb.prepare();
  sb.calls.length = 0;
  assert.deepEqual(sb.prepare(), { installed: false, built: false });
  assert.deepEqual(sb.calls, []);
}));

test("a changed lockfile installs again and rebuilds", () => withSandbox({}, (sb) => {
  sb.prepare();
  sb.calls.length = 0;
  fs.writeFileSync(path.join(sb.webDir, "package-lock.json"), "lock-v2");
  assert.deepEqual(sb.prepare(), { installed: true, built: true });
  assert.deepEqual(sb.calls, ["ci", "run build"]);
}));

test("a new Node runtime installs again, since native dependencies are built against it", () => withSandbox({}, (sb) => {
  sb.prepare();
  sb.calls.length = 0;
  sb.state.runtime = "v26.14.0 darwin arm64";
  assert.deepEqual(sb.prepare(), { installed: true, built: true });
}));

test("changed sources rebuild without reinstalling", () => withSandbox({}, (sb) => {
  sb.prepare();
  sb.calls.length = 0;
  sb.state.fingerprint = "commit-2";
  assert.deepEqual(sb.prepare(), { installed: false, built: true });
  assert.deepEqual(sb.calls, ["run build"]);
  sb.calls.length = 0;
  assert.deepEqual(sb.prepare(), { installed: false, built: false });
}));

test("a missing build output rebuilds even when the stamp matches", () => withSandbox({}, (sb) => {
  sb.prepare();
  sb.calls.length = 0;
  fs.rmSync(path.join(sb.webDir, ".next", "BUILD_ID"));
  assert.deepEqual(sb.prepare(), { installed: false, built: true });
}));

test("a missing node_modules installs again", () => withSandbox({}, (sb) => {
  sb.prepare();
  sb.calls.length = 0;
  fs.rmSync(path.join(sb.webDir, "node_modules"), { recursive: true });
  assert.deepEqual(sb.prepare(), { installed: true, built: true });
}));

test("BUILD_DIST moves the build directory the stamp lives in", () => withSandbox({}, (sb) => {
  sb.state.env = { BUILD_DIST: ".next-svc" };
  sb.prepare();
  assert.ok(fs.existsSync(path.join(sb.webDir, ".next-svc", ".career-ops-service-build")));
  sb.calls.length = 0;
  assert.deepEqual(sb.prepare(), { installed: false, built: false });
}));

test("a failed install throws, builds nothing and leaves no stamp, so the next start retries", () => withSandbox({ failing: "ci" }, (sb) => {
  assert.throws(sb.prepare, (err) => err instanceof PrepareError && err.step === "npm ci" && err.status === 1);
  assert.deepEqual(sb.calls, ["ci"]);
  assert.ok(!fs.existsSync(path.join(sb.webDir, "node_modules", ".career-ops-service-install")));
}));

test("a failed build leaves no stamp, so the next start retries it", () => withSandbox({ failing: "run build" }, (sb) => {
  assert.throws(sb.prepare, (err) => err instanceof PrepareError && err.step === "npm run build");
  assert.ok(!fs.existsSync(path.join(sb.webDir, ".next", ".career-ops-service-build")));
  sb.calls.length = 0;
  assert.throws(sb.prepare, PrepareError);
  assert.deepEqual(sb.calls, ["run build"], "the install stamp from the first try is kept");
}));

test("a missing package-lock.json surfaces as an error instead of skipping the install", () => withSandbox({}, (sb) => {
  fs.rmSync(path.join(sb.webDir, "package-lock.json"));
  assert.throws(sb.prepare, { code: "ENOENT" });
}));

test("the retry delay after a failure is minutes, not the restart throttle", () => {
  assert.ok(FAILURE_BACKOFF_MS >= 60_000);
});

test("npmInvocation spawns npm directly off Windows", () => {
  assert.deepEqual(npmInvocation({ platform: "darwin", execPath: "/n/node", exists: () => false }), {
    command: "npm",
    prefix: [],
    shell: false,
  });
  assert.equal(npmInvocation({ platform: "linux", execPath: "/n/node", exists: () => true }).shell, false);
});

test("npmInvocation runs npm's own script with node on Windows, with no shell", () => {
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const cli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  assert.deepEqual(npmInvocation({ platform: "win32", execPath, exists: (p) => p === cli }), {
    command: execPath,
    prefix: [cli],
    shell: false,
  });
});

test("npmInvocation falls back to npm.cmd through a shell only when npm-cli.js is not beside node", () => {
  assert.deepEqual(npmInvocation({ platform: "win32", execPath: "D:\\node\\node.exe", exists: () => false }), {
    command: "npm.cmd",
    prefix: [],
    shell: true,
  });
});

test("sourceFingerprint follows the commit and the uncommitted state", () => {
  const make = (head, status = "", diff = "") => (args) =>
    ({ "rev-parse HEAD": head, "status --porcelain": status, "diff HEAD": diff })[args.join(" ")] ?? null;
  const walk = () => assert.fail("git is available, so the file walk must not run");
  const base = sourceFingerprint({ git: make("abc\n"), walk });
  assert.equal(sourceFingerprint({ git: make("abc\n"), walk }), base);
  assert.notEqual(sourceFingerprint({ git: make("def\n"), walk }), base);
  assert.notEqual(sourceFingerprint({ git: make("abc\n", " M web/a.ts\n"), walk }), base);
  assert.notEqual(sourceFingerprint({ git: make("abc\n", "", "-a\n+b\n"), walk }), base);
});

test("sourceFingerprint falls back to the file walk without git", () => {
  const a = sourceFingerprint({ git: () => null, walk: () => "files-1" });
  assert.notEqual(a, sourceFingerprint({ git: () => null, walk: () => "files-2" }));
  assert.equal(a, sourceFingerprint({ git: () => null, walk: () => "files-1" }));
});

test("walkSignature covers web/, lib/ and root scripts, and ignores installs, builds and user data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-svc-walk-"));
  try {
    const put = (rel, body) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), body);
    };
    put("web/src/app/page.tsx", "x");
    put("web/node_modules/dep/index.js", "x");
    put("web/.next/server.js", "x");
    put("web/.next-svc/server.js", "x");
    put("lib/shared.mjs", "x");
    put("path-resolver.mjs", "x");
    put("data/applications.md", "x");
    put("reports/001.md", "x");

    const sig = walkSignature({ fs, walkTree, repoRoot: root });
    const files = sig.split("\n").map((line) => line.split(":")[0]);
    assert.deepEqual(files, ["lib/shared.mjs", "path-resolver.mjs", "web/src/app/page.tsx"]);

    put("web/src/app/page.tsx", "xx");
    assert.notEqual(walkSignature({ fs, walkTree, repoRoot: root }), sig);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sourceFingerprint changes when an untracked file's contents change", () => {
  const git = (args) => ({ "rev-parse HEAD": "abc\n", "status --porcelain": "?? new.ts\n" })[args.join(" ")] ?? "";
  const walk = () => assert.fail("git is available");
  const a = sourceFingerprint({ git, walk, untracked: () => "new.ts:10:1" });
  assert.notEqual(a, sourceFingerprint({ git, walk, untracked: () => "new.ts:11:2" }));
});

test("untrackedSignature lists untracked files with size and mtime, and survives a vanished one", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-svc-untracked-"));
  try {
    fs.writeFileSync(path.join(root, "b.ts"), "12");
    fs.writeFileSync(path.join(root, "a.ts"), "1");
    const git = () => "b.ts\0a.ts\0gone.ts\0";
    const sig = untrackedSignature({ fs, git, repoRoot: root });
    const lines = sig.split("\n");
    assert.match(lines[0], /^a\.ts:1:\d+$/);
    assert.match(lines[1], /^b\.ts:2:\d+$/);
    assert.equal(lines[2], "gone.ts:gone");
    assert.equal(untrackedSignature({ fs, git: () => null, repoRoot: root }), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
