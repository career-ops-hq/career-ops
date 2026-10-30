import test from "node:test";
import assert from "node:assert/strict";
import { normalizeToApplicationUrl } from "../../src/lib/apply/url-normalize.mjs";

test("normalizeToApplicationUrl correctly handles ATS JD and application URLs", () => {
  const ashbyJd = "https://jobs.ashbyhq.com/ziina/b52d240f-2ccb-4aea-800b-623e9ca8ae09";
  assert.equal(
    normalizeToApplicationUrl(ashbyJd),
    "https://jobs.ashbyhq.com/ziina/b52d240f-2ccb-4aea-800b-623e9ca8ae09/application",
  );

  const ashbyApp = "https://jobs.ashbyhq.com/ziina/b52d240f-2ccb-4aea-800b-623e9ca8ae09/application";
  assert.equal(
    normalizeToApplicationUrl(ashbyApp),
    "https://jobs.ashbyhq.com/ziina/b52d240f-2ccb-4aea-800b-623e9ca8ae09/application",
  );

  const genericUrl = "https://example.com/careers/engineer";
  assert.equal(normalizeToApplicationUrl(genericUrl), genericUrl);
});
