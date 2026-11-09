// The web inbox mirror of pipeline-sections.mjs must agree with the core's copy
// for every heading, in every language a mode ships. A silent drift between the
// two is exactly the bug #5569 fixed (the web copy had fallen behind #5520), so
// this guards the mirror against falling behind the core again.
//
// Run (from web/):        node --test tests/lib/pipeline-sections-parity.test.mjs
// From the repo root:     node --test web/tests/lib/pipeline-sections-parity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveCodeRoot } from "../../src/lib/core/code-root.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIRROR = path.join(HERE, "..", "..", "src", "lib", "core", "pipeline-sections.mjs");
// The core table lives in the engine checkout, never the data root, so resolve
// the code root (CAREER_OPS_CODE_ROOT, else the checkout) rather than
// CAREER_OPS_ROOT — a data-only override must not quietly disable the parity
// comparison. Derive the web dir from this file so the result is cwd-independent.
const CORE_ROOT = resolveCodeRoot(path.join(HERE, "..", ".."));
const CORE = path.join(CORE_ROOT, "lib", "pipeline-sections.mjs");

const mirror = await import(pathToFileURL(MIRROR).href);
const core = fs.existsSync(CORE) ? await import(pathToFileURL(CORE).href) : null;

// Every Pending/Processed heading a mode writes, plus accented and lower-case
// hand-typed variants, non-heading lines, and `###` (not a section heading).
const HEADINGS = [
  "## Pending", "## Processed",
  "## Pendientes", "## Procesadas",
  "## Pendentes", "## Processadas",
  "## Offen", "## Verarbeitet",
  "## En attente", "## Traitees", "## Traitées",
  "## In attesa", "## Elaborati",
  "## In afwachting", "## Verwerkt",
  "## Afventer", "## Behandlede",
  "## Oczekujące", "## Przetworzone",
  "## Bekleyenler", "## İşlenenler",
  "## Menunggu", "## Diproses",
  "## Ожидающие", "## Обработанные",
  "## Очікуючі", "## Оброблені",
  "## लंबित", "## संसाधित",
  "## 대기", "## 처리 완료",
  "## pending", "##   Offen  ",
  "# Pending", "### Pending", "## Something else", "not a heading", "",
];

test("mirror sectionKind matches the core for every heading and variant", { skip: core ? false : "core lib/pipeline-sections.mjs not resolvable" }, () => {
  for (const line of HEADINGS) {
    assert.equal(
      mirror.sectionKind(line),
      core.sectionKind(line),
      `sectionKind disagreed on ${JSON.stringify(line)}`,
    );
  }
});

test("mirror processedHeadingFor matches the core for every Pending heading", { skip: core ? false : "core lib/pipeline-sections.mjs not resolvable" }, () => {
  for (const line of HEADINGS) {
    if (mirror.sectionKind(line) !== "pending") continue;
    assert.equal(
      mirror.processedHeadingFor(line),
      core.processedHeadingFor(line),
      `processedHeadingFor disagreed on ${JSON.stringify(line)}`,
    );
  }
});

test("mirror recognizes a Pending heading in every shipped language", () => {
  const pendings = [
    "## Pending", "## Pendientes", "## Pendentes", "## Offen", "## En attente",
    "## In attesa", "## In afwachting", "## Afventer", "## Oczekujące",
    "## Bekleyenler", "## Menunggu", "## Ожидающие", "## Очікуючі",
    "## लंबित", "## 대기",
  ];
  for (const line of pendings) {
    assert.equal(mirror.sectionKind(line), "pending", `expected pending for ${JSON.stringify(line)}`);
  }
});
