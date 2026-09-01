// Tests for the prompts /api/run sends each worker kind (#2185).
//
// The pdf prompt is the load-bearing half of this fix: it is what tells the agent
// to EMIT the CV instead of saving it. It used to live inside route.ts, where the
// only available guard was grepping the file — which matched route.ts's own
// comments and so could never fail. Asserting the returned string closes that.
//
// Run:  node --test tests/lib/run-prompts.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, isShellSafeCompanyName } from "../../src/lib/run-prompts.mjs";
import { OPEN_MARK, CLOSE_MARK } from "../../src/lib/cv-envelope.mjs";
import { OPEN_MARK as REPORT_OPEN, CLOSE_MARK as REPORT_CLOSE } from "../../src/lib/report-envelope.mjs";
import { grantsWriteCapability, toolScopeFor } from "../../src/lib/claude-invocation.mjs";

const ARGS = { input: "018", memory: "", today: "2026-08-04" };

test("buildPrompt: the pdf prompt asks for the envelope and forbids saving", () => {
  // Given a pdf run
  const prompt = buildPrompt({ kind: "pdf", ...ARGS });

  // Then it names both markers in the parser's own spelling...
  assert.ok(prompt.includes(OPEN_MARK), "pdf prompt must name the opening marker");
  assert.ok(prompt.includes(CLOSE_MARK), "pdf prompt must name the closing marker");
  // ...and tells it not to save, so an agent that ignores the envelope has been
  // told twice
  assert.match(prompt, /Do NOT save or edit any file/i);
});

test("buildPrompt: the pdf prompt does not claim the agent has no write tools", () => {
  // Given that claim is only true on Claude Code — the six CLIs invoked via
  // clis.ts's bare args keep their default tool access
  const prompt = buildPrompt({ kind: "pdf", ...ARGS });

  // Then the prompt states an instruction ("do not save"), never a false fact
  // about the agent's own capabilities. Telling an agent it lacks a tool it holds
  // invites it to test the claim.
  assert.ok(!/no file-writing tools/i.test(prompt), "must not assert a capability the agent may have");
  assert.ok(!/you have no .*tools/i.test(prompt), "must not assert a capability the agent may have");
});

test("buildPrompt: the pdf prompt never tells the agent to save a file", () => {
  // Given a pdf run
  const prompt = buildPrompt({ kind: "pdf", ...ARGS });

  // Then the pre-#2185 phrasing is gone. This is the regression that matters: the
  // tool grant and the prompt have to agree, and a prompt that asks for a write
  // the agent cannot perform produces a silently failing run.
  assert.ok(!/write the HTML to/i.test(prompt), "pdf prompt must not ask for a file write");
  assert.ok(!/\.meta\.json/.test(prompt), "pdf prompt must not name the sidecar path");
});

test("buildPrompt: the pdf prompt offers both page formats", () => {
  // Given the marker example once interpolated the parser's FALLBACK, which made
  // the prompt read "choose letter for a US/Canada company, otherwise letter" —
  // biasing every CV to one size. The tailoring rule and the fallback are separate.
  const prompt = buildPrompt({ kind: "pdf", ...ARGS });

  // Then both spellings are shown, and the rule distinguishes them
  assert.match(prompt, /format="a4"/);
  assert.match(prompt, /format="letter"/);
  assert.match(prompt, /letter for a US\/Canada company, otherwise a4/i);
});

test("buildPrompt: the pdf prompt still pins tailoring to the real mode", () => {
  // Given a pdf run — the web orchestrates the engine, it does not reimplement it
  const prompt = buildPrompt({ kind: "pdf", ...ARGS });

  // Then modes/pdf.md remains the authority, and the report number is threaded in
  assert.match(prompt, /modes\/pdf\.md/);
  assert.match(prompt, /reports\/018-\*\.md/);
});

test("buildPrompt: every kind ends with exactly one VERDICT instruction", () => {
  // Given each kind — job-store.tsx parses that final line client-side
  for (const kind of ["pdf", "research", "evaluate", "fix-portal"]) {
    const prompt = buildPrompt({ kind, ...ARGS });

    // Then the contract is present exactly once, so the parse cannot pick a
    // stray earlier mention
    const mentions = prompt.match(/VERDICT:/g) ?? [];
    assert.equal(mentions.length, 1, `${kind} must state VERDICT once, got ${mentions.length}`);
  }
});

test("buildPrompt: an unknown kind falls through to the evaluate prompt", () => {
  // Given a kind nobody has taught this map about
  // When building its prompt
  // Then it is the evaluation prompt (the documented default), not an empty string
  const prompt = buildPrompt({ kind: "some-future-kind", ...ARGS });
  assert.match(prompt, /OFFICIAL career-ops job evaluation/);
});

test("buildPrompt: memory is injected only when non-empty", () => {
  // Given a profile note, and given none
  const withMem = buildPrompt({ kind: "evaluate", input: "x", memory: "  Prefers remote.  ", today: "2026-08-04" });
  const without = buildPrompt({ kind: "evaluate", input: "x", memory: "   ", today: "2026-08-04" });

  // Then a whitespace-only memory adds no dangling header — the agent should not
  // be handed an empty "Durable notes" section to interpret
  assert.match(withMem, /Durable notes about the user/);
  assert.match(withMem, /Prefers remote\./);
  assert.ok(!/Durable notes/.test(without));
});

test("buildPrompt: every kind carries a DIRECT no-submission clause", () => {
  // AGENTS.md states the rule unconditionally: "NEVER submit an application without
  // the user reviewing it first ... always STOP before clicking Submit/Send/Apply".
  // Every pattern here must be about submitting/sending specifically. A neighbouring
  // restriction is not a substitute: fix-portal's "never touch any other company"
  // bounds WHICH company it edits and would stay green if the prompt gained a
  // "submit the application" line.
  const clauses = {
    pdf: /Do not submit anything anywhere/i,
    evaluate: /NEVER submit an application/i,
    research: /never submit, send, or click Apply/i,
    "fix-portal": /do not submit, send, or click Apply/i,
  };
  for (const [kind, pattern] of Object.entries(clauses)) {
    assert.match(buildPrompt({ kind, ...ARGS }), pattern, `${kind} must carry a direct no-submission clause`);
  }
});

test("buildPrompt: fix-portal is additionally scoped to one company and one file", () => {
  // Separate from the submission rule above, because it answers a different
  // question: this kind holds Write, Edit and Bash, so the blast radius of a
  // successful injection is every other tracked company plus any file it can reach.
  const prompt = buildPrompt({ kind: "fix-portal", ...ARGS });

  assert.match(prompt, /Never touch any other company/i);
  assert.match(prompt, /edit no file other than portals\.yml/i);
});

test("buildPrompt: research is read-only by tools as well as by instruction", () => {
  // Belt and braces: the clause above is prompt-level, and the scope backs it by
  // denying every write-capable tool. Neither alone is the whole guarantee.
  assert.equal(grantsWriteCapability(toolScopeFor("research")), false);
  assert.match(buildPrompt({ kind: "research", ...ARGS }), /report:/i);
});

test("isShellSafeCompanyName: allows real company names", () => {
  // Given names the scanner and portals.yml legitimately contain
  for (const name of ["Acme Corp", "Nestlé S.A.", "AT&T", "Foo (EU)", "Zeta+Co", "Bar/Baz", "O'Neill Ltd"]) {
    // Then they pass, so the guard cannot break a legitimate fix-portal run
    assert.equal(isShellSafeCompanyName(name), true, name);
  }
});

test("isShellSafeCompanyName: refuses anything that could close the quote", () => {
  // Given the fix-portal prompt interpolates this into `--add "<company>"` for a
  // kind that holds Bash, and company names can come from public ATS listings
  for (const name of ['x";true`;', "a$(id)", "a`id`", "a|b", "a&&b", "a;b", "a\nb", 'a" ; rm -rf ~ ; "b']) {
    // Then each is refused — the route turns this into a 400 rather than rewriting
    assert.equal(isShellSafeCompanyName(name), false, name);
  }
  // ...as are the degenerate inputs
  assert.equal(isShellSafeCompanyName(""), false);
  assert.equal(isShellSafeCompanyName("x".repeat(81)), false);
  assert.equal(isShellSafeCompanyName(undefined), false);
});

test("buildPrompt: the evaluate prompt asks for the envelope and forbids saving", () => {
  const prompt = buildPrompt({ kind: "evaluate", input: "https://acme.com/jobs/7", memory: "", today: "2026-08-04" });

  assert.ok(prompt.includes(REPORT_OPEN), "evaluate prompt must name the opening marker");
  assert.ok(prompt.includes(REPORT_CLOSE), "evaluate prompt must name the closing marker");
  assert.match(prompt, /Do NOT save or edit any file/i);
});

test("buildPrompt: the evaluate prompt does not claim the agent has no write tools", () => {
  const prompt = buildPrompt({ kind: "evaluate", input: "https://acme.com/jobs/7", memory: "", today: "2026-08-04" });

  assert.ok(!/no file-writing tools/i.test(prompt), "must not assert a capability the agent may have");
  assert.ok(!/you have no .*tools/i.test(prompt), "must not assert a capability the agent may have");
});

test("buildPrompt: the evaluate prompt never tells the agent to persist files", () => {
  const prompt = buildPrompt({ kind: "evaluate", input: "https://acme.com/jobs/7", memory: "", today: "2026-08-04" });

  assert.ok(!/node reserve-report-num/.test(prompt), "evaluate prompt must not ask the agent to reserve a number");
  assert.ok(!/node merge-tracker/.test(prompt), "evaluate prompt must not ask the agent to merge the tracker");
  assert.ok(!/Write the full report to/.test(prompt), "evaluate prompt must not ask for a report file write");
  assert.ok(!prompt.includes("\t"), "evaluate prompt must not carry a TSV template the agent would write");
});

test("buildPrompt: evaluate is read-only by tools as well as by instruction", () => {
  assert.equal(grantsWriteCapability(toolScopeFor("evaluate")), false);
  assert.match(buildPrompt({ kind: "evaluate", ...ARGS }), /Do NOT save or edit any file/i);
});

test("buildPrompt: postedAt does not change the evaluate prompt", () => {
  // The scanner date is owned by report-persist.mjs. Putting it in the prompt
  // would re-invite the agent to write a TSV row it no longer writes.
  const withDate = buildPrompt({ kind: "evaluate", input: "u", memory: "", today: "2026-08-14", postedAt: "2026-08-07" });
  const without = buildPrompt({ kind: "evaluate", input: "u", memory: "", today: "2026-08-14" });
  assert.equal(withDate, without);
});

// ── language.modes_dir / language.output ─────────────────────────────────────
//
// profile.yml's language settings were WRITE-ONLY on the web path: the settings
// UI saved language.modes_dir (India → modes/hi) but the evaluate prompt always
// hardcoded modes/oferta.md, so a web-triggered evaluation silently ignored the
// configured market. Every assertion below fails without the fix.

const DE = { output: "de", modesDir: "modes/de", evalModeFile: "modes/de/angebot.md" };

test("buildPrompt: evaluate reads the MARKET's evaluation mode, not always oferta.md", () => {
  const prompt = buildPrompt({ kind: "evaluate", ...ARGS, lang: DE });
  assert.match(prompt, /Read modes\/de\/angebot\.md and follow it EXACTLY/);
  assert.doesNotMatch(prompt, /Read modes\/oferta\.md/);
});

test("buildPrompt: evaluate still reads oferta.md when no market is configured", () => {
  const prompt = buildPrompt({ kind: "evaluate", ...ARGS });
  assert.match(prompt, /Read modes\/oferta\.md and follow it EXACTLY/);
});

test("buildPrompt: the output language is stated explicitly in the prompt", () => {
  // A headless one-shot prompt cannot read AGENTS.md the way the interactive
  // CLI does, so the composition rule has to be in the prompt itself.
  const prompt = buildPrompt({ kind: "evaluate", ...ARGS, lang: DE });
  assert.match(prompt, /Write all human-facing output in "de"/);
});

test("buildPrompt: a configured market also points the agent at its _shared.md", () => {
  const prompt = buildPrompt({ kind: "evaluate", ...ARGS, lang: DE });
  assert.match(prompt, /modes\/de\/_shared\.md/);
});

test("buildPrompt: the default configuration adds no market note", () => {
  // English/global must not be told to read modes/_shared.md for "this
  // market's vocabulary" — there is no market, and the line would be noise.
  const prompt = buildPrompt({ kind: "evaluate", ...ARGS });
  assert.match(prompt, /Write all human-facing output in "en"/);
  assert.doesNotMatch(prompt, /this market's vocabulary/);
});

test("buildPrompt: the language directive is not limited to the evaluate prompt", () => {
  // language.output governs human-facing prose generally, not only the report.
  //
  // Scope note: pdf and fix-portal are left out on purpose. pdf's prompt ends on
  // an "EXACTLY one final line" contract the directive would have to be threaded
  // around, and fix-portal repairs a YAML entry with no prose for an output
  // language to govern. Happy to send pdf as a follow-up.
  for (const kind of ["evaluate", "research"]) {
    assert.match(
      buildPrompt({ kind, ...ARGS, lang: DE }),
      /Write all human-facing output in "de"/,
      `kind ${kind} lost the language directive`,
    );
  }
});
