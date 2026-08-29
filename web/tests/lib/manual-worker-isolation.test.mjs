import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexStreamArgs } from "../../src/lib/run-cli-support.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectRoot = path.resolve(webRoot, "..");

test("repository AGENTS.md is the exact source of the interactive update bootstrap", () => {
  const agents = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
  assert.match(agents, /career-ops system files differ from v\{local\}/);
  assert.match(agents, /On the first message of each session, run silently:[\s\S]*update-system\.mjs check/);
  assert.match(agents, /Before doing ANYTHING else, check if the system is set up/);
});

test("isolated manual argv leaves the repository instruction-discovery chain", () => {
  const scratch = path.join(path.parse(projectRoot).root, "Temp", "career-ops-manual-worker-test");
  const args = codexStreamArgs("private prompt", "evaluate", {
    promptViaStdin: true,
    isolatedWorkerCwd: scratch,
    additionalWritableDir: projectRoot,
  });
  assert.equal(args[args.indexOf("--cd") + 1], scratch);
  assert.notEqual(path.resolve(scratch), projectRoot);
  assert.equal(args[args.indexOf("--add-dir") + 1], projectRoot);
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ignore-rules"));
  assert.equal(args.at(-1), "-");
});

test("normal interactive Career-Ops keeps its repository-local skill router", () => {
  const skill = fs.readFileSync(path.join(projectRoot, ".agents", "skills", "career-ops", "SKILL.md"), "utf8");
  assert.match(skill, /^name:\s*career-ops$/m);
  assert.match(skill, /Auto-pipeline detection/);
});
