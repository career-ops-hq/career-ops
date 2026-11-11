import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const frame = read("components/page-frame.tsx");
const pipeline = read("components/pipeline-view.tsx");

test("wide pages grow to 1800px and reading pages stay on the 1152px cap", () => {
  assert.match(frame, /default:\s*"max-w-6xl"/);
  assert.match(frame, /wide:\s*"max-w-\[1800px\]"/);
  assert.match(frame, /px-4 py-6 sm:px-6 sm:py-8 max-sm:pb-24/);
  assert.match(pipeline, /<PageFrame width="wide">/);
  assert.match(read("components/analytics-view.tsx"), /<PageFrame width="wide">/);
  for (const rel of [
    "components/explore/explorer-view.tsx",
    "components/scheduled-jobs-view.tsx",
    "app/documents/page.tsx",
    "app/explore/loading.tsx",
    "app/scheduled-scans/loading.tsx",
    "components/page-loading-skeletons.tsx",
  ]) {
    assert.match(read(rel), /pageFrameWidthClass\.wide/, rel);
  }
  assert.match(read("components/report-view.tsx"), /<PageFrame className="max-w-3xl/);
  assert.doesNotMatch(read("components/report-view.tsx"), /width="wide"/);
  assert.match(read("app/cv/loading.tsx"), /max-w-6xl/);
  assert.match(read("app/login/loading.tsx"), /max-w-5xl/);
  assert.match(read("app/pipeline/[id]/loading.tsx"), /max-w-6xl/);
});

test("pipeline company and role use the wide row and the date cell stays put", () => {
  assert.match(pipeline, /min-\[1440px\]:table-fixed/);
  assert.match(pipeline, /min-w-\[44rem\]/);
  assert.match(pipeline, /max-w-64 truncate min-\[1440px\]:min-w-0 min-\[1440px\]:flex-1 min-\[1440px\]:max-w-none" title=\{company\.label\}/);
  assert.match(pipeline, /max-w-60 truncate min-\[1440px\]:min-w-0 min-\[1440px\]:flex-1 min-\[1440px\]:max-w-none" title=\{r\.role\}/);
  assert.match(pipeline, /<td className="hidden whitespace-nowrap px-3 py-3 text-faint tabular-nums lg:table-cell">\{r\.date\}<\/td>/);
});
