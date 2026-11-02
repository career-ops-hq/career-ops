#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getCareerOpsRoot } from "../path-resolver.mjs";
import { isWildcardAddress, planNextRun } from "../web/src/lib/bind-host.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const webDir = path.join(rootDir, "web");

// Port and host validation helpers
function parsePort(val) {
  if (!/^\d+$/.test(val)) return null;
  const p = Number(val);
  if (p < 1 || p > 65535) return null;
  return p;
}

const HOST_PATTERN = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*|\[[0-9a-fA-F:]+\])$/;

function checkPortAvailable(testPort, testHost) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      resolve(err.code !== "EADDRINUSE");
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(testPort, testHost === "0.0.0.0" ? undefined : testHost);
  });
}

// Parse command-line flags
const args = process.argv.slice(2);
let port = 3000;
let host = "127.0.0.1";
let autoOpen = true;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--port") {
    if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
      console.error("\x1b[31mError:\x1b[0m --port requires an integer value between 1 and 65535.");
      process.exit(1);
    }
    const parsed = parsePort(args[++i]);
    if (parsed === null) {
      console.error("\x1b[31mError:\x1b[0m Invalid --port value. Port must be an integer between 1 and 65535.");
      process.exit(1);
    }
    port = parsed;
  } else if (arg.startsWith("--port=")) {
    const parsed = parsePort(arg.slice(7));
    if (parsed === null) {
      console.error("\x1b[31mError:\x1b[0m Invalid --port value. Port must be an integer between 1 and 65535.");
      process.exit(1);
    }
    port = parsed;
  } else if (arg === "--host") {
    if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
      console.error("\x1b[31mError:\x1b[0m --host requires a hostname or IP address.");
      process.exit(1);
    }
    const val = args[++i];
    if (!HOST_PATTERN.test(val)) {
      console.error(`\x1b[31mError:\x1b[0m Invalid --host value: "${val}". Must be a valid hostname or IP address.`);
      process.exit(1);
    }
    host = val;
  } else if (arg.startsWith("--host=")) {
    const val = arg.slice(7);
    if (!HOST_PATTERN.test(val)) {
      console.error(`\x1b[31mError:\x1b[0m Invalid --host value: "${val}". Must be a valid hostname or IP address.`);
      process.exit(1);
    }
    host = val;
  } else if (arg === "--no-open" || arg === "--noopen") {
    autoOpen = false;
  } else if (arg === "--help" || arg === "-h") {
    console.log("Usage: npm run ui [options]");
    console.log("Options:");
    console.log("  --port=<num>    Port to listen on (default: 3000)");
    console.log("  --host=<addr>   Host interface to bind to (default: 127.0.0.1)");
    console.log("  --no-open       Do not open the browser automatically");
    process.exit(0);
  }
}

try {
  createRequire(path.join(webDir, "package.json")).resolve("next/package.json");
} catch (err) {
  if (err.code !== "MODULE_NOT_FOUND") throw err;
  console.error("\x1b[31mError:\x1b[0m Web UI dependencies are not installed (next was not found from web/).");
  console.error("Install them once, then retry:  npm --prefix web ci\n");
  process.exit(1);
}

// Print header banner
console.log("\x1b[1m\x1b[36m=====================================================\x1b[0m");
console.log("\x1b[1m\x1b[36m             Career-ops Local Web UI                \x1b[0m");
console.log("\x1b[1m\x1b[36m=====================================================\x1b[0m\n");

// Resolve data root canonically
const dataRoot = getCareerOpsRoot();
console.log("\x1b[32m✓\x1b[0m Data root resolved: " + dataRoot);

// Plan Next.js run and resolve bind host from CAREER_OPS_WEB_ALLOWED_HOSTS
const plan = planNextRun({
  command: "dev",
  extra: host !== "127.0.0.1" ? ["-H", host, "-p", String(port)] : ["-p", String(port)],
  envValue: process.env.CAREER_OPS_WEB_ALLOWED_HOSTS,
});
if (!plan.ok) {
  console.error(`\x1b[31mError:\x1b[0m ${plan.error}`);
  process.exit(1);
}
if (host !== "127.0.0.1" && plan.grantsNoNewHost) {
  console.error(`\x1b[31mError:\x1b[0m --host cannot open the UI to the network without CAREER_OPS_WEB_ALLOWED_HOSTS opt-in.`);
  console.error(`To allow network access, set CAREER_OPS_WEB_ALLOWED_HOSTS="${host}". See web/README.md.\n`);
  process.exit(1);
}

const bindHost = plan.hostFlagSupplied ? host : plan.bindHost;

// Verify target port is not already occupied by an unrelated service
const isAvailable = await checkPortAvailable(port, bindHost);
if (!isAvailable) {
  console.error(`\x1b[31mError:\x1b[0m Port ${port} is already in use by another process.`);
  console.error(`Please specify an alternate port using --port=<number>.\n`);
  process.exit(1);
}

// Bracketed host for HTTP URL if IPv6 literal; use localhost for wildcard addresses
const rawUrlHost = isWildcardAddress(bindHost) ? "localhost" : bindHost;
const urlHost = rawUrlHost.includes(":") && !rawUrlHost.startsWith("[") ? `[${rawUrlHost}]` : rawUrlHost;

const url = `http://${urlHost}:${port}`;

console.log("\n\x1b[1mStarting Career-ops Web Server...\x1b[0m");
console.log(`\x1b[32mWeb UI:\x1b[0m \x1b[4m\x1b[34m${url}\x1b[0m\n`);
console.log("Press \x1b[1mCtrl+C\x1b[0m to stop.\n");

// Function to open browser
function openBrowser(targetUrl) {
  if (!autoOpen) return;
  const platform = process.platform;
  let cmd, cmdArgs;
  if (platform === "win32") {
    cmd = "cmd.exe";
    cmdArgs = ["/c", "start", targetUrl];
  } else if (platform === "darwin") {
    cmd = "open";
    cmdArgs = [targetUrl];
  } else {
    cmd = "xdg-open";
    cmdArgs = [targetUrl];
  }
  try {
    spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Ignore browser open errors
  }
}

// Check if next is ready before opening
let opened = false;
let polling = true;
function pollReady() {
  if (opened || !polling) return;
  const req = http.get(url, (res) => {
    res.resume();
    if (res.statusCode && res.statusCode < 500 && !opened && polling) {
      opened = true;
      openBrowser(url);
    } else if (polling && !opened) {
      setTimeout(pollReady, 500);
    }
  });
  req.on("error", () => {
    if (polling && !opened) setTimeout(pollReady, 500);
  });
}

// Environment for the web server
const childEnv = {
  ...process.env,
  PORT: String(port),
  HOSTNAME: bindHost,
  CAREER_OPS_ROOT: dataRoot,
};

// Spawn Next.js server directly via node executable (no shell parsing, avoiding shell escaping issues)
const isWindows = process.platform === "win32";
const serverScript = path.join(webDir, "server.mjs");
const serverArgs = [serverScript, "dev", "-p", String(port)];
if (bindHost !== "127.0.0.1") {
  serverArgs.push("-H", bindHost);
}

const child = spawn(process.execPath, serverArgs, {
  cwd: webDir,
  env: childEnv,
  stdio: "inherit",
  shell: false,
});

setTimeout(pollReady, 1000);

// Graceful exit
let shuttingDown = false;
function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  polling = false;
  console.log("\nShutting down Career-ops UI...");
  if (child && !child.killed && child.exitCode === null) {
    if (isWindows) {
      try {
        spawnSync("taskkill", ["/pid", child.pid.toString(), "/f", "/t"], { stdio: "ignore" });
      } catch {}
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  } else {
    process.exit(0);
  }
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
child.on("exit", (code, signal) => {
  polling = false;
  if (!opened && code !== 0) {
    console.error(`\x1b[31mError:\x1b[0m Web server exited ${code === null ? `on ${signal}` : `with code ${code}`} before it was ready. The output above says why.`);
  }
  process.exit(code || 0);
});
