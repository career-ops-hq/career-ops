import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const swiftSource = fs.readFileSync(path.join(root, "desktop", "CareerOpsApp.swift"), "utf8");
const healthRoute = fs.readFileSync(path.join(root, "web", "src", "app", "api", "health", "route.ts"), "utf8");

test("desktop readiness uses a side-effect-free health endpoint", () => {
  assert.match(swiftSource, /private let healthURL = URL\(string: "http:\/\/127\.0\.0\.1:3111\/api\/health"\)!/);
  assert.doesNotMatch(swiftSource, /private let statusURL/);
  assert.match(healthRoute, /export async function GET\(\)/);
  assert.match(healthRoute, /ok:\s*true/);
});

test("dashboard service is not killed during every normal app launch", () => {
  assert.match(swiftSource, /kickDashboardService\(forceRestart: false\)/);
  assert.match(swiftSource, /forceRestart \? \["kickstart", "-k"/);
});

test("WKWebView navigation failures recover automatically", () => {
  assert.match(swiftSource, /didFailProvisionalNavigation/);
  assert.match(swiftSource, /didFail navigation/);
  assert.match(swiftSource, /scheduleProbe\(after: 10\.0/);
  assert.match(swiftSource, /cachePolicy: \.reloadIgnoringLocalCacheData/);
});
