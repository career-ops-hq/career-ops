// gate3-artifacts.test.mjs — what Gate 3 is allowed to audit.
//
// WHY THIS EXISTS
//   The original resolver globbed `output/cv-*.payload.json` and took the newest
//   match. Nothing in the pdf lane writes that name — modes/pdf.md Step 18 writes
//   the render payload to `/tmp/cv-{candidate}-{company}.json` — so the glob only
//   ever matched artifacts from openai-tailor.mjs, a DIFFERENT tool. Gate 3 was
//   linting a weeks-old CV against the current posting and reporting it as this
//   run's verdict. These tests pin identity-by-observation so that cannot come
//   back: the payload must be the one THIS run wrote, proved by diffing against a
//   pre-run snapshot.
//
// Fixtures use a real temp dir rather than mocking fs, because the whole contract
// is mtime-vs-snapshot arithmetic — a mock would assert the implementation, not
// the behaviour. Timings are separated well beyond filesystem mtime granularity.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  snapshotTempPayloads,
  resolveFreshTempPayload,
  manifestPayloadForReport,
} from "../../src/lib/core/gate3-artifacts.ts";

/** A fresh temp dir per test; payloads are written with an explicit mtime so the
 *  before/after comparison never depends on how fast the test runs. */
function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate3-artifacts-test-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writePayload(dir, name, mtimeSec) {
  const full = path.join(dir, name);
  fs.writeFileSync(full, JSON.stringify({ candidate: { name: "Test" } }), "utf-8");
  if (mtimeSec != null) {
    const t = mtimeSec * 1000;
    fs.utimesSync(full, t / 1000, t / 1000);
  }
  return full;
}

test("a payload written during the run is resolved", () => {
  withTmp((dir) => {
    const before = snapshotTempPayloads(dir);
    const written = writePayload(dir, "cv-shivanand-shah-acme.json");
    assert.equal(resolveFreshTempPayload(before, dir), written);
  });
});

test("a PRE-EXISTING payload is not audited — the bug this replaces", () => {
  // The regression in one assertion: yesterday's CV sits in /tmp, this run wrote
  // no payload, and the resolver must return null rather than linting yesterday's
  // file against today's JD. The old glob could not tell these two cases apart.
  withTmp((dir) => {
    writePayload(dir, "cv-shivanand-shah-stale.json", 1_700_000_000);
    const before = snapshotTempPayloads(dir);
    assert.equal(resolveFreshTempPayload(before, dir), null);
  });
});

test("a payload REWRITTEN by this run is resolved even though it existed before", () => {
  // Same filename across runs is normal (the company slug repeats), so a
  // snapshot match alone must not veto the audit — only an unchanged mtime does.
  withTmp((dir) => {
    writePayload(dir, "cv-shivanand-shah-acme.json", 1_700_000_000);
    const before = snapshotTempPayloads(dir);
    writePayload(dir, "cv-shivanand-shah-acme.json", 1_800_000_000);
    assert.equal(resolveFreshTempPayload(before, dir), path.join(dir, "cv-shivanand-shah-acme.json"));
  });
});

test("no snapshot means no answer — fail open rather than audit an arbitrary file", () => {
  withTmp((dir) => {
    writePayload(dir, "cv-shivanand-shah-acme.json");
    assert.equal(resolveFreshTempPayload(null, dir), null);
  });
});

test("an unreadable temp dir yields null instead of throwing", () => {
  assert.equal(resolveFreshTempPayload(new Map(), path.join(os.tmpdir(), "no-such-dir-xyz")), null);
  assert.equal(snapshotTempPayloads(path.join(os.tmpdir(), "no-such-dir-xyz")).size, 0);
});

test("non-payload files in temp are ignored", () => {
  withTmp((dir) => {
    const before = snapshotTempPayloads(dir);
    writePayload(dir, "cv-shivanand-shah-acme.payload.json"); // openai-tailor's shape
    writePayload(dir, "some-unrelated-file.json");
    fs.writeFileSync(path.join(dir, "cv-notes.txt"), "x", "utf-8");
    assert.equal(resolveFreshTempPayload(before, dir), null);
  });
});

test("when several payloads are fresh, the newest wins", () => {
  // A pdf run writes one payload; several hits mean a bundle or a stray. Newest
  // is the defensible tie-break and the route still reports what it audited.
  withTmp((dir) => {
    const before = snapshotTempPayloads(dir);
    writePayload(dir, "cv-shivanand-shah-old.json", 1_700_000_000);
    writePayload(dir, "cv-shivanand-shah-new.json", 1_800_000_000);
    assert.equal(resolveFreshTempPayload(before, dir), path.join(dir, "cv-shivanand-shah-new.json"));
  });
});

// --- manifest fallback (the bundle flow, cv/tailored/vNNN/cv.json) -------------

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate3-root-test-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeIndex(root, rows) {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "data", "pdf-index.tsv"),
    "# report\tpdf\thtml\tformat\tdate — written by generate-pdf.mjs, do not edit\n" + rows,
    "utf-8",
  );
}

test("the manifest resolves a bundle payload that exists on disk", () => {
  withRoot((root) => {
    fs.mkdirSync(path.join(root, "cv", "tailored", "v001"), { recursive: true });
    fs.writeFileSync(path.join(root, "cv", "tailored", "v001", "cv.json"), "{}", "utf-8");
    writeIndex(root, "135\toutput/cv-x.pdf\tcv/tailored/v001/cv.json\ta4\t2026-09-19\n");
    assert.equal(manifestPayloadForReport(root, "135"), path.join(root, "cv/tailored/v001/cv.json"));
  });
});

test("a blank manifest JSON column resolves to null, never a guess", () => {
  // 47 of 51 real rows are blank: generate-pdf.mjs's
  // workspaceRelativeManifestPath() returns "" for /tmp paths. An empty column
  // must NOT fall back to some other file or the newest payload on disk.
  withRoot((root) => {
    writeIndex(root, "171\toutput/cv-shivanand-shah-fareportal-2026-09-29.pdf\t\ta4\t2026-09-29\n");
    assert.equal(manifestPayloadForReport(root, "171"), null);
  });
});

test("a manifest pointer to a deleted file resolves to null", () => {
  withRoot((root) => {
    writeIndex(root, "135\toutput/cv-x.pdf\tcv/tailored/v001/cv.json\ta4\t2026-09-19\n");
    assert.equal(manifestPayloadForReport(root, "135"), null);
  });
});

test("the newest row wins when a report has several", () => {
  withRoot((root) => {
    fs.mkdirSync(path.join(root, "cv", "tailored", "v001"), { recursive: true });
    fs.mkdirSync(path.join(root, "cv", "tailored", "v002"), { recursive: true });
    fs.writeFileSync(path.join(root, "cv", "tailored", "v001", "cv.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(root, "cv", "tailored", "v002", "cv.json"), "{}", "utf-8");
    writeIndex(
      root,
      "135\toutput/cv-x.pdf\tcv/tailored/v001/cv.json\ta4\t2026-09-19\n" +
        "135\toutput/cv-y.pdf\tcv/tailored/v002/cv.json\ta4\t2026-09-28\n",
    );
    assert.equal(manifestPayloadForReport(root, "135"), path.join(root, "cv/tailored/v002/cv.json"));
  });
});

test("an unknown report, a missing index, and an empty report all resolve to null", () => {
  withRoot((root) => {
    writeIndex(root, "135\toutput/cv-x.pdf\tcv/tailored/v001/cv.json\ta4\t2026-09-19\n");
    assert.equal(manifestPayloadForReport(root, "999"), null);
    assert.equal(manifestPayloadForReport(root, ""), null);
    assert.equal(manifestPayloadForReport(root, "   "), null);

    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "gate3-bare-"));
    try {
      assert.equal(manifestPayloadForReport(bare, "135"), null);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});