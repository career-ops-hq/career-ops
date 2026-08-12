import fs from "node:fs";
import path from "node:path";
import { run } from "./install-runtime.mjs";

const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function dashboardPlist(node, runtime, logs) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.careerops.dashboard</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(runtime, "server.js"))}</string></array>
<key>WorkingDirectory</key><string>${xml(runtime)}</string>
<key>EnvironmentVariables</key><dict><key>NODE_ENV</key><string>production</string><key>HOSTNAME</key><string>127.0.0.1</string><key>PORT</key><string>3111</string><key>CAREER_OPS_ROOT</key><string>${xml(runtime)}</string><key>OMNIROUTE_MODEL</key><string>auto/external</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs, "dashboard.log"))}</string><key>StandardErrorPath</key><string>${xml(path.join(logs, "dashboard-error.log"))}</string>
</dict></plist>`;
}

function schedulerPlist(node, runtime, logs) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.careerops.scheduler</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(runtime, "automation-scheduler.mjs"))}</string></array>
<key>WorkingDirectory</key><string>${xml(runtime)}</string><key>EnvironmentVariables</key><dict><key>OMNIROUTE_MODEL</key><string>auto/external</string></dict><key>RunAtLoad</key><true/><key>StartInterval</key><integer>3600</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs, "scheduler.log"))}</string><key>StandardErrorPath</key><string>${xml(path.join(logs, "scheduler-error.log"))}</string>
</dict></plist>`;
}

function bootstrap(uid, plistPath) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = run("/bin/launchctl", ["bootstrap", `gui/${uid}`, plistPath], true);
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  run("/bin/launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
}

export function installAgents({ appDir, runtimeRoot, home, node }) {
  const uid = process.getuid();
  const agentsDir = path.join(home, "Library", "LaunchAgents");
  const logs = path.join(home, ".career-ops", "logs");
  const dashboardPath = path.join(agentsDir, "com.careerops.dashboard.plist");
  const schedulerPath = path.join(agentsDir, "com.careerops.scheduler.plist");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(dashboardPath, dashboardPlist(node, runtimeRoot, logs));
  fs.writeFileSync(schedulerPath, schedulerPlist(node, runtimeRoot, logs));
  for (const label of ["com.careerops.scheduler", "com.careerops.dashboard"]) {
    run("/bin/launchctl", ["bootout", `gui/${uid}/${label}`], true);
  }
  bootstrap(uid, dashboardPath);
  bootstrap(uid, schedulerPath);
  const dock = run("/usr/bin/defaults", ["read", "com.apple.dock", "persistent-apps"], true).stdout || "";
  if (!dock.includes("Career-Ops.app")) {
    const url = `file://${appDir.replaceAll(" ", "%20")}/`;
    const entry = `{\"tile-data\"={\"file-data\"={\"_CFURLString\"=\"${url}\";\"_CFURLStringType\"=15;};\"file-label\"=\"Career-Ops\";};\"tile-type\"=\"file-tile\";}`;
    run("/usr/bin/defaults", ["write", "com.apple.dock", "persistent-apps", "-array-add", entry]);
    run("/usr/bin/killall", ["Dock"], true);
  }
  run("/usr/bin/open", [appDir]);
  return { dashboardPath, schedulerPath };
}
