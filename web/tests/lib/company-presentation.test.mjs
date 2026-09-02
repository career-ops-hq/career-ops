import { test } from "node:test";
import assert from "node:assert/strict";
import { companyPresentation, companySearchText } from "../../src/lib/company-presentation.mjs";

test("confidential employer retains agency attribution without promoting it to employer", () => {
  const presentation = companyPresentation({ company: "?", via: "Example Staffing Agency" });
  assert.deepEqual(presentation, {
    label: "Confidential · via Example Staffing Agency",
    logoName: "Example Staffing Agency",
  });
  assert.match(companySearchText({ company: "?", via: "Example Staffing Agency", role: "Example Role" }), /Example Staffing Agency/);
});

test("confidential employer without a usable intermediary has an honest fallback", () => {
  for (const via of ["—", "–", "-", "n/a", "N/A", "tbd", "none", "null", "  "]) {
    assert.deepEqual(companyPresentation({ company: "?", via }), {
      label: "Confidential employer",
      logoName: "Confidential employer",
    });
  }
});

test("known employer display remains unchanged", () => {
  assert.deepEqual(companyPresentation({ company: "Acme", via: "Example Staffing Agency" }), {
    label: "Acme",
    logoName: "Acme",
  });
});

test("confidential entries sort by their human-facing label", () => {
  const rows = [
    { company: "?", via: "Zeta Agency" },
    { company: "Acme", via: "—" },
  ];
  const ordered = [...rows].sort((a, b) => companyPresentation(a).label.localeCompare(companyPresentation(b).label));
  assert.deepEqual(ordered, [rows[1], rows[0]]);
});
