import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listTree } from "../../../lib/walk-tree.mjs";
import { readJsonObject } from "../../src/lib/json-body.ts";

const post = (body) => new Request("http://127.0.0.1/api/x", { method: "POST", body });

test("readJsonObject returns the parsed object", async () => {
  assert.deepEqual(await readJsonObject(post('{"n":"7","status":"Applied"}')), { n: "7", status: "Applied" });
});

test("readJsonObject returns null for bodies a route cannot read fields from", async () => {
  for (const body of ["null", "[]", "[1]", '"x"', "1", "true", "not json", ""]) {
    assert.equal(await readJsonObject(post(body)), null, body);
  }
});

test("every API route reads its JSON body through readJsonObject", () => {
  const apiDir = fileURLToPath(new URL("../../src/app/api", import.meta.url));
  const direct = listTree(apiDir, { match: /route\.ts$/ })
    .filter((f) => fs.readFileSync(f, "utf8").includes("req.json()"))
    .map((f) => path.relative(apiDir, f).split(path.sep).join("/"))
    .sort();
  assert.deepEqual(direct, ["cv/ingest/route.ts", "explore/add/route.ts", "profile/route.ts", "scheduled-jobs/[id]/route.ts", "scheduled-jobs/route.ts"]);
});
