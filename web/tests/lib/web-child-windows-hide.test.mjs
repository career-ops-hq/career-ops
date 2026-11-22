// Every child process the web server starts must start without a console
// (windowsHide). On Windows a long-lived server whose inherited console has
// gone stale kills each child at DLL init with 0xC0000142, with no stdout and
// no stderr (#3809). #4253 put windowsHide on spawnHeadlessCli and on the four
// routes that execFile a core script, on the rule that nothing the web spawns
// needs a console. The status and follow-up writes (core-cli.ts), tracker
// delete, PDF render, evaluate persist, the scanner, the pipeline writer,
// employer discovery, the fencing probe and the version probe all kept
// launching with one.
//
// Two layers. The core-cli and tracker-delete launches are driven for real
// through a recording child_process wrapper. A census then reads every call of
// a child_process launcher in web/src (and of the spawnFn the PDF and persist
// helpers are handed) and requires windowsHide: true in that call's own
// arguments. A route.ts execFile is left to core-script-routes.test.mjs, which
// drives each of those routes and asserts the same thing.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listTree } from "../../../lib/walk-tree.mjs";
import "../helpers/web-ts-alias-loader.mjs";

const codeRoot = mkdtempSync(join(tmpdir(), "co-child-hide-code-"));
const dataRoot = mkdtempSync(join(tmpdir(), "co-child-hide-data-"));
const ENV_KEYS = ["CAREER_OPS_CODE_ROOT", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realExecFile = childProcess.execFile;
const realSpawn = childProcess.spawn;
const launches = [];

before(() => {
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  process.env.CAREER_OPS_ROOT = dataRoot;
  // Would each pull a read back out of the sandbox.
  process.env.CAREER_OPS_DATA_DIR = "";
  process.env.CAREER_OPS_TRACKER = "";
  childProcess.execFile = function recordingExecFile(file, args, options, callback) {
    launches.push({ via: "execFile", file, script: args?.[0], options });
    return realExecFile.call(this, file, args, options, callback);
  };
  childProcess.spawn = function recordingSpawn(file, args, options) {
    launches.push({ via: "spawn", file, script: args?.[0], options });
    return realSpawn.call(this, file, args, options);
  };
  syncBuiltinESMExports();
});

after(() => {
  childProcess.execFile = realExecFile;
  childProcess.spawn = realSpawn;
  syncBuiltinESMExports();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(codeRoot, { recursive: true, force: true });
  rmSync(dataRoot, { recursive: true, force: true });
});

/** Write the stand-in for a core script into the temp checkout. */
function standIn(name, body) {
  writeFileSync(join(codeRoot, `${name}.mjs`), body);
}

// ---------------------------------------------------------------------------
// Driven: the two write paths a user triggers from the tracker.
// ---------------------------------------------------------------------------

test("runCoreCli (status and follow-up writes) launches with process.execPath and windowsHide", async () => {
  // Given set-status answers normally
  standIn("set-status", "console.log(JSON.stringify({ ok: true }));");
  const { runCoreCli } = await import("@/lib/core-cli.ts");

  // When the web runs it
  launches.length = 0;
  const result = await runCoreCli("set-status", ["--json"]);

  // Then it ran once, with this process's Node and no console to inherit
  assert.equal(result.code, 0);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].script, join(codeRoot, "set-status.mjs"));
  assert.equal(launches[0].file, process.execPath);
  assert.equal(launches[0].options?.windowsHide, true);
});

test("tracker delete launches tracker.mjs with windowsHide", async () => {
  // Given a tracker.mjs new enough to delete (trackerCanDelete reads its source)
  standIn("tracker", "// tracker.mjs delete --num stand-in\nprocess.exit(0);");
  const { POST } = await import("@/app/api/tracker/delete/route.ts");

  // When a dry-run delete is requested
  launches.length = 0;
  const res = await POST(
    new Request("http://localhost/api/tracker/delete", {
      method: "POST",
      body: JSON.stringify({ n: "1", dryRun: true }),
    }),
  );

  // Then the script ran once, with no console to inherit
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(launches.length, 1);
  assert.equal(launches[0].script, join(codeRoot, "tracker.mjs"));
  assert.equal(launches[0].file, process.execPath);
  assert.equal(launches[0].options?.windowsHide, true);
});

// ---------------------------------------------------------------------------
// Census: every launch in web/src carries windowsHide in its own arguments.
// ---------------------------------------------------------------------------

/**
 * Blank comments and the contents of string, template and regex literals,
 * keeping every offset and newline, so that neither a "(" nor a launcher name
 * inside one can be read as code. Template literals are blanked whole,
 * including any ${} in them, which is fine here: no launch is written inside
 * one.
 */
function maskNonCode(src) {
  const out = src.split("");
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  let prev = ""; // last significant code character, for the regex heuristic
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      blank(i + 1, Math.min(j, src.length));
      i = j + 1;
      prev = c;
      continue;
    }
    // A "/" opens a regex literal where an operand is expected, which is after
    // an operator or opening punctuation, or at the start of the file.
    if (c === "/" && (prev === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      prev = "/";
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
}

// Launchers: node:child_process's own, the promisified execFile, and the
// spawnFn parameter the PDF and persist helpers take. A member call such as
// `re.exec(` is not a launch, hence the lookbehind.
const LAUNCH = /(?<![\w$.])(spawn|spawnSync|execFile|execFileSync|execFileAsync|execSync|exec|fork|spawnFn)\s*\(/g;

function launchCalls(file) {
  const source = readFileSync(file, "utf8");
  const masked = maskNonCode(source);
  const calls = [];
  for (const m of masked.matchAll(LAUNCH)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let k = open; k < masked.length; k++) {
      if (masked[k] === "(") depth++;
      else if (masked[k] === ")" && --depth === 0) {
        close = k;
        break;
      }
    }
    const end = close < 0 ? masked.length : close;
    calls.push({
      name: m[1],
      line: masked.slice(0, m.index).split("\n").length,
      args: masked.slice(open + 1, end),
      // The launched command when it is written as a literal, for POSIX_ONLY.
      command: /^\s*["'`]([^"'`]+)["'`]/.exec(source.slice(open + 1, end))?.[1] ?? null,
    });
  }
  return calls;
}

// Launches that never run on Windows, where windowsHide is a no-op, keyed by
// file and the literal command they launch. An entry the census no longer
// sees fails below, so this list can only shrink.
const POSIX_ONLY = new Map([
  ["lib/scheduler-status.ts crontab", "readUnixTask's linux branch reads the user's crontab"],
  ["lib/scheduler-status.ts launchctl", "readUnixTask's darwin branch asks launchd for the job"],
]);

test("census: every child launch in web/src passes windowsHide: true", () => {
  const src = fileURLToPath(new URL("../../src", import.meta.url));
  const files = listTree(src, { match: /\.(?:ts|tsx|mjs|js)$/ });
  const seen = [];
  const offenders = [];
  const posixOnlySeen = new Set();
  for (const file of files) {
    const rel = relative(src, file).split(sep).join("/");
    for (const call of launchCalls(file)) {
      // Each route.ts execFile is driven for real by core-script-routes.test.mjs.
      if (call.name === "execFile" && rel.startsWith("app/api/") && rel.endsWith("/route.ts")) continue;
      seen.push(`${rel}:${call.line} ${call.name}`);
      const posixKey = `${rel} ${call.command}`;
      if (POSIX_ONLY.has(posixKey)) {
        posixOnlySeen.add(posixKey);
        continue;
      }
      if (!/\bwindowsHide\s*:\s*true\b/.test(call.args)) offenders.push(`${rel}:${call.line} ${call.name}(…)`);
    }
  }
  // Premise: the census sees the launches it exists to check, including the
  // headless-CLI boundary #4253 fixed and a spawnFn helper.
  assert.ok(seen.some((s) => s.startsWith("lib/spawn-cli.mjs:")), `census never saw spawn-cli.mjs:\n${seen.join("\n")}`);
  assert.ok(seen.some((s) => s.startsWith("lib/pdf-render.mjs:") && s.endsWith(" spawnFn")), "census never saw a spawnFn launch");
  assert.ok(seen.length >= 12, `census saw only ${seen.length} launches:\n${seen.join("\n")}`);
  assert.deepEqual(offenders, [], "these launches let the child inherit the server's console (#3809)");
  assert.deepEqual(
    [...POSIX_ONLY.keys()].filter((k) => !posixOnlySeen.has(k)),
    [],
    "POSIX_ONLY entries no launch matches any more; remove them",
  );
});

test("census masker: launcher names inside comments, strings and regexes are not calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "co-child-hide-mask-"));
  try {
    const file = join(dir, "probe.ts");
    writeFileSync(
      file,
      [
        "// spawn(binPath) in a comment",
        "/* execFile(x) in a block */",
        'const s = "spawn(x)";',
        "const t = `exec(${y})`;",
        "const r = /spawn\\(/;",
        "const u = 'https://example.com/spawn(1)';",
        'run.exec("x");',
        'execFile(process.execPath, ["a)"], { windowsHide: true }, () => {});',
        "spawn(cmd, [], { cwd });",
      ].join("\n"),
    );
    assert.deepEqual(
      launchCalls(file).map((c) => [c.line, c.name, /windowsHide\s*:\s*true/.test(c.args)]),
      [
        [8, "execFile", true],
        [9, "spawn", false],
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
