import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/web-ts-alias-loader.mjs";

const { dispatch } = await import("../../src/app/actions/registry.ts");

// setProfile / setPortals return a `failure` promise with their DoneInfo, so
// the console can mark the confirmation that started the write as failed
// instead of reporting "saved" for a write the route refused.
function context({ profile = null, portals = null } = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      push() {}, replace() {}, startJob() { return "job-1"; }, inbox: [], applications: [], jobForUrl() {},
      rememberFact() {}, writeStatus() {}, setApplyField() {}, startApply() {},
      writeProfile: async (patch) => { calls.push(["profile", patch]); return profile; },
      writePortals: async (roles, location) => { calls.push(["portals", roles, location]); return portals; },
    },
  };
}

test("a saved profile and scan targets settle failure to null", async () => {
  const { ctx, calls } = context();
  const result = dispatch("setProfile", { roles: ["Engineer"], location: "Berlin" }, ctx);
  assert.equal(result.status, "confirm");
  const info = result.run();
  assert.equal(await info.failure, null);
  assert.deepEqual(calls.map((c) => c[0]), ["profile", "portals"]);
});

test("either setProfile write failing is reported on its confirmation", async () => {
  const { ctx } = context({ portals: "Your scan targets were NOT saved: write failed." });
  const info = dispatch("setProfile", { roles: ["Engineer"] }, ctx).run();
  assert.equal(await info.failure, "Your profile was saved. Your scan targets were NOT saved: write failed.");

  const profileOnly = context({ profile: "Your profile was NOT saved: HTTP 500." });
  assert.equal(
    await dispatch("setProfile", { roles: ["Engineer"] }, profileOnly.ctx).run().failure,
    "Your profile was NOT saved: HTTP 500. Your scan targets were saved.",
  );
  // No roles, so no scan-target write: nothing to report as saved alongside.
  assert.equal(
    await dispatch("setProfile", { location: "Berlin" }, profileOnly.ctx).run().failure,
    "Your profile was NOT saved: HTTP 500.",
  );

  const both = context({ profile: "Your profile was NOT saved: HTTP 409.", portals: "Your scan targets were NOT saved: HTTP 409." });
  const reason = await dispatch("setProfile", { roles: ["Engineer"] }, both.ctx).run().failure;
  assert.equal(reason, "Your profile was NOT saved: HTTP 409. Your scan targets were NOT saved: HTTP 409.");
});

test("setPortals hands back the scan-target write's own failure", async () => {
  const { ctx } = context({ portals: "Your scan targets were NOT saved: portals.yml contains invalid YAML." });
  const info = dispatch("setPortals", { roles: ["Engineer"] }, ctx).run();
  assert.equal(await info.failure, "Your scan targets were NOT saved: portals.yml contains invalid YAML.");
});
