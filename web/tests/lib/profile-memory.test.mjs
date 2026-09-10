// Tests for readProfileMemory(): what modes/_profile.md actually contributes to
// a prompt (#4003).
//
// The failure this file exists to stop is a silent one: when the read returns
// "", buildPrompt() drops the whole "Durable notes about the user" section
// rather than emitting an empty one, so a run with no guardrails is
// byte-indistinguishable from a run that never had any. Nothing errors, nothing
// is logged, and the output looks exactly like correctly constrained output.
// That is why the last test here asserts on the built PROMPT and not only on
// this function's return value.
//
// Run:  node --test tests/lib/profile-memory.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readProfileMemory, NOTES_START, NOTES_END } from "../../src/lib/profile-memory.mjs";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";

// Synthetic, and deliberately of the KIND users really put in this file: the
// rules that keep generated CVs and form answers honest.
const HANDWRITTEN = `# Profile customization

## Archetypes
- Staff platform engineer at a mid-size SaaS company

## Never claim
- I contributed to the billing migration, I did not lead it.
- The 40% latency figure covers one service, not the whole platform.
`;

const ROOTS = [];

function makeRoot({ profile, legacy } = {}) {
  const root = mkdtempSync(join(tmpdir(), "co-profile-mem-"));
  ROOTS.push(root);
  if (profile !== undefined) {
    mkdirSync(join(root, "modes"), { recursive: true });
    writeFileSync(join(root, "modes", "_profile.md"), profile);
  }
  if (legacy !== undefined) {
    mkdirSync(join(root, ".career-ops-web"), { recursive: true });
    writeFileSync(join(root, ".career-ops-web", "memory.md"), legacy);
  }
  return root;
}

test.after(() => {
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

test("a profile with no managed block still reaches the prompt", () => {
  // Given: the DEFAULT state of an install. modes/_profile.template.md ships
  // with no co-web-notes markers, doctor.mjs auto-copies it, and rememberFact()
  // is the only thing that ever creates the block, so until the web assistant
  // happens to remember something, every personalized profile looks like this.
  const root = makeRoot({ profile: HANDWRITTEN });

  const memory = readProfileMemory(root);

  assert.match(memory, /I contributed to the billing migration/);
  assert.match(memory, /Staff platform engineer/);
});

test("a managed block does not displace the content around it", () => {
  // Given: the state after the assistant has remembered one fact. The block now
  // exists, and the marker slice used to return ONLY its bullets, silently
  // dropping everything the user hand-wrote in the same file.
  const root = makeRoot({
    profile: `${HANDWRITTEN}
## Notes from the web assistant
${NOTES_START}
- Prefers fully remote roles.
${NOTES_END}
`,
  });

  const memory = readProfileMemory(root);

  assert.match(memory, /Prefers fully remote roles/);
  assert.match(memory, /I contributed to the billing migration/);
});

test("the legacy .career-ops-web/memory.md is still read when there is no profile", () => {
  // Given: an install that predates modes/_profile.md as the memory store.
  // Deleting the second fs read in readProfileMemory() is what fails this.
  const root = makeRoot({ legacy: "- Wants roles in the EU only.\n" });

  assert.equal(readProfileMemory(root), "- Wants roles in the EU only.");
});

test("an empty profile falls through to the legacy store rather than shadowing it", () => {
  // Given: doctor.mjs created modes/_profile.md but nothing has been written to
  // it. An existing file must not win over a legacy store that has content.
  const root = makeRoot({ profile: "\n\n  \n", legacy: "- Wants roles in the EU only.\n" });

  assert.equal(readProfileMemory(root), "- Wants roles in the EU only.");
});

test("nothing on disk reads as no memory, not as an error", () => {
  assert.equal(readProfileMemory(makeRoot()), "");
});

test("the profile lands in the prompt buildPrompt() actually sends", () => {
  // The whole point. buildPrompt() omits the notes section entirely for an empty
  // memory, so asserting on readProfileMemory()'s return value alone would not
  // catch a break between the two.
  const root = makeRoot({ profile: HANDWRITTEN });

  const prompt = buildPrompt({
    kind: "evaluate",
    input: "https://example.com/jobs/1",
    memory: readProfileMemory(root),
    today: "2026-09-07",
  });

  assert.match(prompt, /Durable notes about the user/);
  assert.match(prompt, /I contributed to the billing migration, I did not lead it\./);
});
