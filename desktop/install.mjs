import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installApp, installRuntime } from "./install-runtime.mjs";
import { installAgents } from "./install-agents.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const home = os.homedir();
const appDir = path.join(home, "Applications", "Career-Ops.app");
const runtimeRoot = path.join(home, "Library", "Application Support", "Career-Ops", "runtime");
const node = process.execPath;

installRuntime(root, runtimeRoot);
installApp(root, appDir);
const agents = installAgents({ appDir, runtimeRoot, home, node });

console.log("CAREER_OPS_DESKTOP_INSTALLED");
console.log(`APP=${appDir}`);
console.log(`RUNTIME=${runtimeRoot}`);
console.log(`DASHBOARD_AGENT=${agents.dashboardPath}`);
console.log(`SCHEDULER_AGENT=${agents.schedulerPath}`);
