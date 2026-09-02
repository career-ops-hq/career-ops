// Tests for companySlug(), the filename-matching key derived from a company
// name, and the decision that a company yields no usable key at all (#2352).
//
// Both tailored-CV lookups name files as cv-{candidate}-{company}-{date}.pdf and
// search output/ for the company segment. When the company contributes no
// ASCII alphanumerics the segment is empty, and an empty needle matches every
// file: `l.includes("")` is true for all of them, and the newest wins. A lookup
// that cannot identify the company has to say so rather than return its best
// guess, because the caller attaches the result to a real application.
//
// Run:  node --test tests/lib/company-slug.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { companySlug } from "../../src/lib/company-slug.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("companySlug: derives the slug and its first token", () => {
  assert.deepEqual(companySlug("Acme"), { slug: "acme", first: "acme" });
  assert.deepEqual(companySlug("Acme Corp"), { slug: "acme-corp", first: "acme" });
});

test("companySlug: normalizes punctuation and case the way the pdf mode names files", () => {
  // Given generate-pdf slugifies on runs of non-alphanumerics, the lookup key
  // has to collapse the same way or it will never match its own output
  assert.deepEqual(companySlug("  Jane & Co.  "), { slug: "jane-co", first: "jane" });
  assert.deepEqual(companySlug("1-800-FLOWERS"), { slug: "1-800-flowers", first: "1" });
});

test("companySlug: returns null for a company with no usable key", () => {
  // Given each of these yields an empty slug, and an empty slug is a substring
  // of every filename in output/
  for (const c of ["", "   ", "?", "—", "@", "...", "·"]) {
    assert.equal(companySlug(c), null, `${JSON.stringify(c)} must not produce a key`);
  }
});

test("companySlug: returns null for the confidential-employer marker", () => {
  // Given `?` is the tracker's locale-invariant marker for an unknown end
  // employer (agency submissions). This is the reported case: the row is real,
  // the company is deliberately unknown, and the CV lookup must not fall back to
  // whichever tailored CV happens to be newest.
  assert.equal(companySlug("?"), null);
});

test("companySlug: returns null for a company written in a non-Latin script", () => {
  // Given the slug is built from [a-z0-9] only, every company whose name carries
  // no ASCII alphanumerics collapses to the same empty key. This is not an edge
  // case: career-ops ships ja/ar/hi/tr market modes, so these are ordinary
  // employers for the users those modes exist to serve.
  for (const c of ["株式会社メルカリ", "楽天", "Яндекс", "مِنّة", "부산은행"]) {
    assert.equal(companySlug(c), null, `${c} must not produce a key`);
  }
});

test("companySlug: keeps a mixed-script name that still has ASCII to match on", () => {
  // Given a partial key is still a real key. Only a fully empty one is unusable.
  assert.deepEqual(companySlug("Ωmega"), { slug: "mega", first: "mega" });
  assert.deepEqual(companySlug("楽天 Rakuten"), { slug: "rakuten", first: "rakuten" });
});

test("companySlug: tolerates a missing company", () => {
  assert.equal(companySlug(undefined), null);
  assert.equal(companySlug(null), null);
});

test("both tailored-CV lookups derive their key through this module", () => {
  // Given the guard only holds where it is actually called. Each lookup used to
  // build the slug inline, and a call site that rebuilds it would pass every
  // assertion above while still matching every file in output/.
  const read = (p) => readFileSync(join(HERE, "..", "..", "src", p), "utf8");
  for (const site of ["lib/apply/cv.ts", "app/api/cv-pdf/route.ts"]) {
    const src = read(site);
    assert.match(src, /from "@\/lib\/company-slug\.mjs"/, `${site} must import the key derivation`);
    assert.match(src, /companySlug\(/, `${site} must call companySlug`);
    assert.ok(
      !/\.toLowerCase\(\)\.match\(\/\[a-z0-9\]\+\/g\)/.test(src),
      `${site} must not rebuild the slug inline`,
    );
  }
});
