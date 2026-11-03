import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// The onboarding banner and the setup checklist choose between "start with the
// assistant" and "connect your AI CLI in Config". They used to decide on the
// saved cliId alone, so a stale id (its CLI since uninstalled, #4012) still
// offered the assistant, and with two or more CLIs installed the kickoff then
// failed with "choose one in Config" instead of the banner sending the user
// there. Both now ask resolveCliId(), the check a Run makes; its stale-id
// behaviour is covered against the real function in saved-cli-resolve.test.mjs.
// These assertions cover the wiring, in the source-reading style of
// config-form-persist-wiring.test.mjs.

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/components", rel), "utf8");

for (const rel of ["onboarding-banner.tsx", "home/onboarding-progress.tsx"]) {
  const src = read(rel);

  test(`${rel} decides "has a CLI" with resolveCliId()`, () => {
    assert.match(src, /import\s*{[^}]*\bresolveCliId\b[^}]*}\s*from\s*"@\/lib\/saved-cli"/);
    assert.match(src, /resolveCliId\(\)\.then\(\(id\)\s*=>\s*{\s*if\s*\(live\)\s*setCli\(!!id\);?\s*}\)/);
  });

  test(`${rel} no longer trusts the saved cliId on its own`, () => {
    assert.doesNotMatch(src, /\breadSavedCliId\b/, "the saved id alone stays truthy after its CLI is uninstalled");
    assert.doesNotMatch(src, /localStorage\.getItem\("career-ops:config"\)/, "read the config through lib/saved-cli");
  });

  test(`${rel} ignores a resolution that lands after unmount`, () => {
    assert.match(src, /let live = true;/);
    assert.match(src, /live = false;/);
  });
}
