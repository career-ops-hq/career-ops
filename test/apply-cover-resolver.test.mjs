import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { resolveTailoredCover } from "../web/src/lib/apply/cover.ts";

// resolveTailoredCover locates the tailored COVER LETTER PDF the pdf mode wrote to
// output/cover-…-{company}-….pdf — a sibling of resolveTailoredCv (web/src/lib/apply/cv.ts)
// that must NEVER return a CV file, even when the CV's slug matches.

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "career-ops-cover-"));
  const outDir = join(root, "output");
  mkdirSync(outDir);
  const now = Date.now();
  files.forEach(({ name, mtimeOffsetMs = 0 }, i) => {
    const p = join(outDir, name);
    writeFileSync(p, "%PDF-1.4 fixture");
    // Deterministic ordering independent of write speed/FS mtime resolution.
    const t = (now + mtimeOffsetMs) / 1000;
    utimesSync(p, t, t);
  });
  return root;
}

function withRoot(root, fn) {
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
  }
}

test("resolveTailoredCover: null when only a cv- file exists (never returns a CV as a cover)", () => {
  const root = fixture([{ name: "cv-acme-swe-2026-01-01.pdf" }]);
  withRoot(root, () => {
    assert.equal(resolveTailoredCover("Acme"), null);
  });
});

test("resolveTailoredCover: resolves a cover-…-{slug}-….pdf match", () => {
  const root = fixture([{ name: "cover-acme-swe-2026-01-01.pdf" }]);
  withRoot(root, () => {
    const p = resolveTailoredCover("Acme");
    assert.notEqual(p, null);
    assert.equal(basename(p), "cover-acme-swe-2026-01-01.pdf");
  });
});

test("resolveTailoredCover: newest match wins when multiple covers exist for the company", () => {
  const root = fixture([
    { name: "cover-acme-swe-2026-01-01.pdf", mtimeOffsetMs: -60_000 },
    { name: "cover-acme-swe-2026-02-01.pdf", mtimeOffsetMs: 0 },
  ]);
  withRoot(root, () => {
    const p = resolveTailoredCover("Acme");
    assert.equal(basename(p), "cover-acme-swe-2026-02-01.pdf");
  });
});

test("resolveTailoredCover: token boundary — \"Meta\" does not match \"Metabase\"'s cover", () => {
  const root = fixture([{ name: "cover-metabase-swe-2026-01-01.pdf" }]);
  withRoot(root, () => {
    assert.equal(resolveTailoredCover("Meta"), null);
  });
});

test("resolveTailoredCover: token boundary still resolves the real match alongside a decoy", () => {
  const root = fixture([
    { name: "cover-metabase-swe-2026-01-01.pdf" },
    { name: "cover-meta-swe-2026-01-01.pdf" },
  ]);
  withRoot(root, () => {
    const p = resolveTailoredCover("Meta");
    assert.equal(basename(p), "cover-meta-swe-2026-01-01.pdf");
  });
});

test("resolveTailoredCover: multi-word company slug matches the hyphenated filename", () => {
  const root = fixture([{ name: "cover-data-robot-mle-2026-01-01.pdf" }]);
  withRoot(root, () => {
    const p = resolveTailoredCover("Data Robot");
    assert.equal(basename(p), "cover-data-robot-mle-2026-01-01.pdf");
  });
});

test("resolveTailoredCover: empty/blank company returns null", () => {
  const root = fixture([{ name: "cover-acme-swe-2026-01-01.pdf" }]);
  withRoot(root, () => {
    assert.equal(resolveTailoredCover(""), null);
    assert.equal(resolveTailoredCover("   "), null);
    assert.equal(resolveTailoredCover(undefined), null);
  });
});

test("resolveTailoredCover: no output/ directory returns null instead of throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "career-ops-cover-empty-"));
  withRoot(root, () => {
    assert.equal(resolveTailoredCover("Acme"), null);
  });
});
