// The assistant console's profile and scan-target writes used to end in
// `.catch(() => {})` without reading the response, so a 409 (a malformed
// config/profile.yml or portals.yml the route refuses to overwrite) or a 500
// read as saved. postAssistantWrite is what the console now awaits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { postAssistantWrite } from "../../src/lib/assistant-file-write.mjs";

function response(status, body) { return new Response(typeof body === "string" ? body : JSON.stringify(body), { status }); }

test("a confirmed write resolves to null and posts the body as JSON", async () => {
  const requests = [];
  const failure = await postAssistantWrite("/api/portals", { roles: ["Engineer"] }, async (url, init) => {
    requests.push({ url, method: init.method, data: JSON.parse(init.body) });
    return response(200, { ok: true, roles: 1 });
  });
  assert.equal(failure, null);
  assert.deepEqual(requests, [{ url: "/api/portals", method: "POST", data: { roles: ["Engineer"] } }]);
});

for (const [status, body, expected] of [
  [409, { error: "portals.yml contains invalid YAML" }, "portals.yml contains invalid YAML"],
  [500, { error: "write failed" }, "write failed"],
  [400, { error: "no roles" }, "no roles"],
  [502, "<html>bad gateway</html>", "HTTP 502"],
  [200, { ok: false }, "HTTP 200"],
  [200, "not json", "HTTP 200"],
]) test(`${status} ${JSON.stringify(body)} is reported, not taken for a save`, async () => {
  assert.equal(await postAssistantWrite("/api/profile", {}, async () => response(status, body)), expected);
});

test("a request that never completes is reported", async () => {
  assert.equal(await postAssistantWrite("/api/profile", {}, async () => { throw new Error("disconnected"); }), "the request failed");
});
