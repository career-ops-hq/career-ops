import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/home/decision-card.tsx"),
  "utf8",
);

test("a ação principal de Hoje abre o relatório, não regista a candidatura", () => {
  const primary = src.indexOf('href={`/pipeline/${app.n}`}');
  const mark = src.indexOf('setStatus("Applied")');
  assert.notEqual(primary, -1);
  assert.notEqual(mark, -1);
  assert.ok(primary < mark, "a ligação ao relatório deve aparecer antes da escrita do estado Applied");
  assert.match(src, /> Rever\s*</);
});
