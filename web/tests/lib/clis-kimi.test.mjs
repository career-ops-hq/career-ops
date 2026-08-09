import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../../src/lib/clis.ts", import.meta.url));
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { KNOWN, searchDirs } = await import(moduleUrl);

test("registers Kimi Code CLI for headless prompts", () => {
  const kimi = KNOWN.find((cli) => cli.id === "kimi");

  assert.ok(kimi);
  assert.equal(kimi.name, "Kimi Code CLI");
  assert.equal(kimi.bin, "kimi");
  assert.equal(kimi.run, "kimi -p");
  assert.deepEqual(kimi.args("hello"), ["-p", "hello"]);
});

test("searches the official Kimi Code installation directory", () => {
  const expected = path.join(os.homedir(), ".kimi-code", "bin");

  assert.ok(searchDirs().includes(expected));
});
