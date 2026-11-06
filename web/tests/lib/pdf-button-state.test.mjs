import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coverDraftButtonState, pdfButtonState, pdfJobRefreshesReport } from "../../src/lib/pdf-button-state.mjs";

const reason = "This run didn't produce a tailored CV to render, so no PDF was generated — re-run it to verify. (The agent emitted no <<cv-html>> envelope, so there is no CV to render.)";
const failed = {
  id: "job-7",
  status: "error",
  steps: [
    { kind: "status", label: "Starting…" },
    { kind: "tool", label: "read_file" },
    { kind: "status", label: reason },
  ],
};

test("a failed run with no earlier CV shows the reason next to Generate", () => {
  assert.deepEqual(pdfButtonState(failed, false), { kind: "idle", failure: { jobId: "job-7", reason } });
});

test("a failed regenerate keeps the earlier CV link and still shows the reason", () => {
  assert.deepEqual(pdfButtonState(failed, true), { kind: "ready", failure: { jobId: "job-7", reason } });
});

test("a failed run with no status step still names a failure", () => {
  assert.deepEqual(pdfButtonState({ id: "job-8", status: "error", steps: [] }, false), {
    kind: "idle",
    failure: { jobId: "job-8", reason: "The run stopped before it finished." },
  });
});

test("only this offer's finished pdf job refreshes the report", () => {
  assert.equal(pdfJobRefreshesReport({ kind: "pdf", input: "4" }, "4"), true);
  assert.equal(pdfJobRefreshesReport({ kind: "pdf", input: "5" }, "4"), false);
  assert.equal(pdfJobRefreshesReport({ kind: "evaluate", input: "4" }, "4"), false);
  assert.equal(pdfJobRefreshesReport(null, "4"), false);
  const button = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../src/components/generate-pdf-button.tsx"),
    "utf8",
  );
  assert.match(button, /pdfJobRefreshesReport\(detail, n\)/);
  assert.match(button, /router\.refresh\(\)/);
});

test("a finished run with no file on disk is not View tailored CV", () => {
  assert.deepEqual(pdfButtonState({ id: "job-9", status: "done", steps: [] }, false), { kind: "idle", failure: null });
});

test("a finished run whose file is on disk is View tailored CV", () => {
  assert.deepEqual(pdfButtonState({ id: "job-9", status: "done", steps: [] }, true), { kind: "ready", failure: null });
});

test("a running job links to its log", () => {
  assert.deepEqual(pdfButtonState({ id: "job-10", status: "running", steps: [] }, true), { kind: "running", jobId: "job-10" });
});

test("no job and no tracker CV is the plain Generate button", () => {
  assert.deepEqual(pdfButtonState(undefined, false), { kind: "idle", failure: null });
});


test("an evaluation stop cannot make a PDF ready", () => {
  assert.deepEqual(pdfButtonState({ id: "gated", status: "gated", steps: [] }, false), { kind: "idle", failure: null });
});

test("a finished cover job with a usable score is ready without a CV file on disk", () => {
  const job = { id: "cover-1", status: "done", steps: [], result: { score: 5, summary: "Draft written." } };
  assert.deepEqual(pdfButtonState(job, false), { kind: "idle", failure: null });
  assert.deepEqual(coverDraftButtonState(job), { kind: "ready", failure: null });
});

test("a finished cover job with no usable score stays a retry", () => {
  const fallback = "The cover run finished without a usable draft.";
  assert.deepEqual(coverDraftButtonState({ id: "cover-4", status: "done", steps: [], result: { score: null, summary: "" } }), {
    kind: "idle",
    failure: { jobId: "cover-4", reason: fallback },
  });
  assert.deepEqual(coverDraftButtonState({ id: "cover-5", status: "done", steps: [], result: { score: null, summary: "No letter." } }), {
    kind: "idle",
    failure: { jobId: "cover-5", reason: "No letter." },
  });
  assert.deepEqual(coverDraftButtonState({ id: "cover-6", status: "done", steps: [] }), {
    kind: "idle",
    failure: { jobId: "cover-6", reason: fallback },
  });
  assert.deepEqual(coverDraftButtonState({ id: "cover-7", status: "done", steps: [], result: { score: Infinity, summary: "" } }), {
    kind: "idle",
    failure: { jobId: "cover-7", reason: fallback },
  });
});

test("a weak cover verdict is a retry, not a draft link", () => {
  const thin = {
    id: "cover-2",
    status: "done",
    steps: [],
    result: { score: 1, summary: "Too thin." },
  };
  assert.deepEqual(coverDraftButtonState(thin), {
    kind: "idle",
    failure: { jobId: "cover-2", reason: "Too thin." },
  });
  assert.deepEqual(
    coverDraftButtonState({ id: "cover-3", status: "done", steps: [], result: { score: 2, summary: "Usable." } }),
    { kind: "ready", failure: null },
  );
});
