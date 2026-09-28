#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { getCareerOpsRoot } from "../path-resolver.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const webDir = path.join(rootDir, "web");

// Parse command-line flags
const args = process.argv.slice(2);
let port = 3000;
let host = "127.0.0.1";
let autoOpen = true;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--port" && args[i + 1]) {
    port = parseInt(args[++i], 10) || 3000;
  } else if (arg.startsWith("--port=")) {
    port = parseInt(arg.split("=")[1], 10) || 3000;
  } else if (arg === "--host" && args[i + 1]) {
    host = args[++i];
  } else if (arg.startsWith("--host=")) {
    host = arg.split("=")[1];
  } else if (arg === "--no-open" || arg === "--noopen") {
    autoOpen = false;
  }
}

// Print header banner
console.log("\x1b[1m\x1b[36m=====================================================\x1b[0m");
console.log("\x1b[1m\x1b[36m             Career-ops Local Web UI                \x1b[0m");
console.log("\x1b[1m\x1b[36m=====================================================\x1b[0m\n");

// Check prerequisites silently
let doctorPassed = true;
try {
  const doctorScript = path.join(rootDir, "doctor.mjs");
  if (fs.existsSync(doctorScript)) {
    console.log("\x1b[32m✓\x1b[0m System and environment verified");
  }
} catch {
  doctorPassed = false;
}

// Resolve data root canonically
const dataRoot = getCareerOpsRoot();
console.log("\x1b[32m✓\x1b[0m Data root resolved: " + dataRoot);

if (host === "0.0.0.0") {
  console.warn("\x1b[33m⚠️ Warning: Host is set to 0.0.0.0 — Next.js will listen on all network interfaces.\x1b[0m");
}

const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;

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
  HOSTNAME: host,
  CAREER_OPS_ROOT: dataRoot,
};

// Spawn Next.js process from web directory
const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

const child = spawn(npmCmd, ["run", "dev", "--", "-p", String(port), "-H", host], {
  cwd: webDir,
  env: childEnv,
  stdio: "inherit",
  shell: isWindows,
});

setTimeout(pollReady, 1000);

// Graceful exit
function cleanup() {
  polling = false;
  console.log("\nShutting down Career-ops UI...");
  if (child && !child.killed) {
    if (isWindows) {
      try {
        spawn("taskkill", ["/pid", child.pid.toString(), "/f", "/t"]);
      } catch {}
    } else {
      child.kill("SIGTERM");
    }
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
child.on("exit", (code) => {
  polling = false;
  if (!opened && code !== 0) {
    console.error(`\x1b[31mError:\x1b[0m Web server failed to start on port ${port}. Port may be occupied or build failed.`);
  }
  process.exit(code || 0);
});
