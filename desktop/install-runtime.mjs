import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function run(command, args, allowFailure = false) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")}\n${result.stderr || result.stdout}`);
  }
  return result;
}
export function installRuntime(root, runtimeRoot) {
  const webRoot = path.join(root, "web");
  const standalone = path.join(webRoot, ".next", "standalone");
  if (!fs.existsSync(path.join(standalone, "server.js"))) {
    throw new Error("Standalone-bygget saknas. Kör npm run build i web/ först.");
  }
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.cpSync(standalone, runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(runtimeRoot, ".next"), { recursive: true });
  fs.cpSync(path.join(webRoot, ".next", "static"), path.join(runtimeRoot, ".next", "static"), { recursive: true, force: true });
  if (fs.existsSync(path.join(webRoot, "public"))) {
    fs.cpSync(path.join(webRoot, "public"), path.join(runtimeRoot, "public"), { recursive: true, force: true });
  }
  for (const name of fs.readdirSync(root)) {
    if (name.endsWith(".mjs") || name.endsWith(".json")) {
      fs.copyFileSync(path.join(root, name), path.join(runtimeRoot, name));
    }
  }
  for (const name of ["providers", "plugins", "lib", "templates", "config", "seeds"]) {
    const source = path.join(root, name);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(runtimeRoot, name), { recursive: true, force: true });
  }
  for (const name of ["data", "profiles"]) {
    const source = path.join(root, name);
    const destination = path.join(runtimeRoot, name);
    if (fs.existsSync(source) && !fs.existsSync(destination)) fs.cpSync(source, destination, { recursive: true });
  }
  for (const packageName of ["js-yaml", "argparse", "dotenv"]) {
    const source = path.join(webRoot, "node_modules", packageName);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(runtimeRoot, "node_modules", packageName), { recursive: true, force: true });
  }
  fs.copyFileSync(path.join(root, "scripts", "automation-scheduler.mjs"), path.join(runtimeRoot, "automation-scheduler.mjs"));
}
export function installApp(root, appDir) {
  const contents = path.join(appDir, "Contents");
  const macos = path.join(contents, "MacOS");
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(macos, { recursive: true });
  run("/usr/bin/xcrun", ["swiftc", path.join(root, "desktop", "CareerOpsApp.swift"), "-o", path.join(macos, "Career-Ops"), "-framework", "Cocoa", "-framework", "WebKit"]);
  fs.writeFileSync(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Career-Ops</string>
<key>CFBundleIdentifier</key><string>com.careerops.desktop</string>
<key>CFBundleName</key><string>Career-Ops</string>
<key>CFBundleDisplayName</key><string>Career-Ops</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`);
  run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appDir]);
}
