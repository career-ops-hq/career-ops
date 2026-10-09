import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../src/components");
const shell = readFileSync(join(root, "app-shell.tsx"), "utf8");
const beta = readFileSync(join(root, "beta/beta-banner.tsx"), "utf8");
const assistant = readFileSync(join(root, "assistant-console.tsx"), "utf8");

function labelledButtonClasses(source, label) {
  const aria = source.indexOf(`aria-label="${label}"`);
  assert.notEqual(aria, -1);
  const button = source.lastIndexOf("<button", aria);
  const match = source.slice(button, aria + 500).match(/className="([^"]+)"/);
  assert.ok(match);
  return match[1];
}

test("mobile fixed controls remain separate 44px icon targets without covering content", () => {
  assert.match(shell, /<main className="[^"]*max-sm:pb-20[^"]*"/);
  assert.match(labelledButtonClasses(beta, "Comunicar erro"), /\bmax-sm:size-11\b/);
  assert.match(labelledButtonClasses(beta, "Comunicar erro"), /\bmax-sm:shrink-0\b/);
  assert.match(beta, /<span className="[^"]*hidden[^"]*sm:inline[^"]*">Comunicar erro<\/span>/);
  assert.match(labelledButtonClasses(assistant, "Abrir assistente"), /\bmax-sm:size-11\b/);
  assert.match(assistant, /<span className="[^"]*hidden[^"]*sm:inline[^"]*">Assistente<\/span>/);
});
