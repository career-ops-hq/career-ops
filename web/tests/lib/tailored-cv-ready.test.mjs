import { test } from "node:test";
import assert from "node:assert/strict";
import { TAILORED_CV_MISSING, tailoredCvOnDisk } from "../../src/lib/tailored-cv-ready.mjs";

test("an indexed file is ready even when the name list is empty", () => {
  assert.equal(tailoredCvOnDisk({ indexStatus: "found", filenames: [], company: "Sundial Pharmacy" }), true);
});

test("a cv file whose name matches the company is ready", () => {
  assert.equal(
    tailoredCvOnDisk({
      filenames: ["notes.txt", "cv-sundial-pharmacy-2026-01-02.pdf"],
      company: "Sundial Pharmacy",
    }),
    true,
  );
});

test("a tracker mark is not a file, and another company's cv is not this one", () => {
  assert.equal(tailoredCvOnDisk({ filenames: ["cv-other-co.pdf"], company: "Sundial Pharmacy" }), false);
  assert.equal(tailoredCvOnDisk({ filenames: [], company: "Sundial Pharmacy" }), false);
  assert.equal(tailoredCvOnDisk({ filenames: ["cv-sundial-pharmacy.pdf"], company: "" }), false);
});

test("a missing file tells the reader to generate one", () => {
  assert.match(TAILORED_CV_MISSING, /Generate tailored CV/);
  assert.match(TAILORED_CV_MISSING, /No tailored CV file/);
});

test("a rejected index row is not rescued by a matching name", () => {
  // /api/cv-pdf answers 404 for a rejected row and never tries names.
  assert.equal(
    tailoredCvOnDisk({ indexStatus: "rejected", filenames: ["cv-sundial-pharmacy.pdf"], company: "Sundial Pharmacy" }),
    false,
  );
  assert.equal(
    tailoredCvOnDisk({ indexStatus: "not-found", filenames: ["cv-sundial-pharmacy.pdf"], company: "Sundial Pharmacy" }),
    true,
  );
});
