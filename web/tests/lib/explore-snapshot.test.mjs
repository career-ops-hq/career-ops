import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exploreSnapshot } from "../../src/lib/explore-snapshot.mjs";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/app/explore/page.tsx"), "utf8");

test("the explore page builds its snapshot with exploreSnapshot()", () => {
  assert.match(page, /exploreSnapshot\s*\(/);
});

test("exploreSnapshot keeps the fields matching uses", () => {
  const snap = exploreSnapshot(
    [{ url: "https://jobs.example/a", company: "Acme", role: "Engineer", done: false, location: "Remote", compensation: "secret-pay" }],
    [{ n: "1", company: "Acme", role: "Engineer", notes: "secret-note-token", score: "4.2/5", status: "Applied" }],
  );
  assert.deepEqual(snap, {
    inboxUrls: ["https://jobs.example/a"],
    evaluated: [{ n: "1", company: "Acme", role: "Engineer" }],
  });
});
