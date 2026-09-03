#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const shouldScan = args.includes("--scan") || args.includes("--search");

console.log("==================================================");
console.log(
  shouldScan
    ? "🚀 Career-Ops All-in-One: Scan + Backend + Frontend"
    : "🚀 Career-Ops Local Dashboard: Backend + Frontend"
);
console.log("==================================================");

if (shouldScan) {
  console.log("\n🔍 Step 1/3: Running portal job search scan...");
  try {
    execSync("node scan.mjs", { cwd: __dirname, stdio: "inherit" });
    console.log("\n✅ Job search scan completed! Updated pipeline.md with latest vacancies.\n");
  } catch (err) {
    console.error("\n⚠️ Scan finished with notes:", err.message);
  }
}

// 1. Start Backend Server
console.log(
  shouldScan
    ? "🌐 Step 2/3: Starting backend server on http://127.0.0.1:3001 ..."
    : "Starting backend server on http://127.0.0.1:3001 ..."
);
const serverProcess = spawn("node", ["--experimental-strip-types", "server/index.ts"], {
  cwd: __dirname,
  stdio: "inherit"
});

// 2. Start Vite Frontend
console.log(
  shouldScan
    ? "💻 Step 3/3: Starting Vite frontend on http://localhost:5173 ..."
    : "Starting Vite frontend on http://localhost:5173 ..."
);
const uiProcess = spawn("npm", ["run", "dev", "--prefix", "ui"], {
  cwd: __dirname,
  stdio: "inherit"
});

const cleanup = () => {
  console.log("\nStopping Career-Ops Dashboard...");
  serverProcess.kill("SIGTERM");
  uiProcess.kill("SIGTERM");
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
