import assert from "node:assert/strict";
import test from "node:test";
import { companyPresentation } from "../../src/lib/company-presentation.mjs";

test("company presentation uses the trimmed company as label and logo name", () => {
  assert.deepEqual(companyPresentation({ company: "  Acme Corp  " }), {
    label: "Acme Corp",
    logoName: "Acme Corp",
  });
});

test("company presentation coerces a non-string company to text", () => {
  assert.deepEqual(companyPresentation({ company: 42 }), { label: "42", logoName: "42" });
});
