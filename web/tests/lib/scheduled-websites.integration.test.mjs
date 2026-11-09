import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addMonitor, readMonitorStore } from "../../../portal-monitor.mjs";
import { readScheduledStore, withScheduledStore } from "../../src/lib/scheduled-jobs-store.mjs";

function sourcePage(count) {
  return { jobs: Array.from({ length: count }, (_, i) => ({
    id: i + 1, title: `AI student fixture ${i + 1}`,
    absolute_url: `https://employer.example/jobs/${i + 1}`,
    location: { name: 'London' },
    // Deliberately no posting date: change detection must still work.
  })) };
}

test("real scheduled worker baselines a website, then delivers and notifies only new undated listings", { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-websites-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, "data");
  fs.mkdirSync(data, { recursive: true });
  const source = await addMonitor(root, { name: "Fixture board", url: "https://boards.greenhouse.io/fixture-primary", autoMonitor: false }, {
    provider: { id: "greenhouse", fetch: async () => [{ title: "AI fixture", url: "https://boards.greenhouse.io/fixture-primary/fixture-ai-10000", company: "Fixture" }] },
  });
  const storePath = path.join(data, "scheduled-jobs.json");
  const id = randomUUID();
  const now = new Date().toISOString();
  await withScheduledStore(storePath, (store) => store.jobs.push({
    id, name: "Daily AI", status: "active", engine: "full", startAt: now, nextRunAt: now, createdAt: now, updatedAt: now,
    timezone: "UTC", every: 1, unit: "days", filters: { ats: [], websiteIds: [source.id], positive: ["AI"], negative: [],
      allow: [], block: [], blockHard: [], alwaysAllow: [], sinceDays: 7 },
  }));
  const payloadPath = path.join(root, "fixture-data.json");
  const loaderPath = path.join(root, "fixture-fetch.mjs");
  fs.writeFileSync(loaderPath, `import fs from 'node:fs'; globalThis.fetch = async url => { if (!String(url).startsWith('https://boards-api.greenhouse.io/v1/boards/fixture-primary/jobs?')) throw new Error('Unexpected network request'); return Response.json(JSON.parse(fs.readFileSync(${JSON.stringify(payloadPath)}, 'utf8'))); };`);
  const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const run = () => {
    const child = spawnSync(process.execPath, ["--import", pathToFileURL(loaderPath).href, path.join(codeRoot, "web/scripts/scheduled-jobs-runner.mjs"), "--job", id], {
      cwd: codeRoot, encoding: "utf8", timeout: 20000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_SCHEDULED_JOBS_PATH: storePath,
        CAREER_OPS_PIPELINE: path.join(data, "pipeline.md"), CAREER_OPS_TRACKER: path.join(data, "applications.md"), CAREER_OPS_SCAN_HISTORY: path.join(data, "scan-history.tsv") },
    });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout.trim().split("\n").at(-1));
  };
  fs.writeFileSync(payloadPath, JSON.stringify(sourcePage(1)));
  const baseline = run();
  assert.equal(baseline.rolesFound, 0);
  assert.match(baseline.message, /1 website baselined/);
  assert.match(baseline.message, /1 listing included with unknown posting dates/);
  assert.equal(fs.existsSync(path.join(data, "pipeline.md")), false);
  assert.equal(readScheduledStore(storePath).jobs[0].websiteCheckpoints[source.id].seenKeys.length, 1);

  fs.writeFileSync(payloadPath, JSON.stringify(sourcePage(2)));
  const second = run();
  assert.equal(second.rolesFound, 1);
  assert.match(fs.readFileSync(path.join(data, "pipeline.md"), "utf8"), /AI student fixture 2/);
  const persisted = readMonitorStore(root);
  assert.deepEqual(persisted.sources[0].seenKeys, [], "per-search checkpoint must not advance the source monitor");
  assert.equal(persisted.notices.length, 1);
  assert.equal(persisted.notices[0].count, 1);

  assert.equal(run().rolesFound, 0);
  assert.equal(readMonitorStore(root).notices.length, 1, "repeat scans must not produce duplicate notices");
});
