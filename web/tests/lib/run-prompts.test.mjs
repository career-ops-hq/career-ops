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

// ── the tracker-additions TSV row (#1298) ───────────────────────────────────
//
// The web is a WRITER of batch/tracker-additions/*.tsv, not just a reader of the
// tracker. merge-tracker accepts 9 fields forever, so a stale template can never
// go red — it just silently leaves every web-evaluated job out of the URL dedup.
// Nothing else in this repo can catch that, which is why it is asserted here.

/** The example row the evaluate prompt tells the agent to append. */
function exampleTsvRow(prompt) {
  const line = prompt.split("\n").find((l) => l.includes("\t"));
  assert.ok(line, "the evaluate prompt must contain a literal tab-separated example row");
  return line.trim().split("\t");
}

test("buildPrompt: the evaluate prompt's TSV row carries all 10 fields, url last", () => {
  // Given an evaluate run
  const prompt = buildPrompt({ kind: "evaluate", input: "https://acme.com/jobs/7", memory: "", today: "2026-08-04" });
  const fields = exampleTsvRow(prompt);

  // Then the row has the 10 fields merge-tracker reads, with the posting URL last
  assert.equal(fields.length, 10, `expected 10 tab-separated fields, got ${fields.length}: ${JSON.stringify(fields)}`);
  assert.match(fields[9], /posting URL/i, "the 10th field must be the posting URL");
  // ...and the prose agrees, so the agent is not told "9" while shown 10
  assert.match(prompt, /10 TAB-separated columns/);
});

test("buildPrompt: the evaluate prompt demands an EMPTY url field, never a placeholder", () => {
  // Given merge-tracker's parseTsvExtras drops "N/A"/"-" precisely so they can't
  // be misread as the row's LOCATION, and an unconditional template is one an
  // agent actually follows
  const prompt = buildPrompt({ kind: "evaluate", input: "https://acme.com/jobs/7", memory: "", today: "2026-08-04" });

  // Then the instruction says to write all 10 fields and leave the last empty
  assert.match(prompt, /ALWAYS write all 10 fields/i);
  assert.match(prompt, /EMPTY if there is no posting URL/i);
  assert.match(prompt, /never "N\/A"/i);
});

// ── the posted: segment (#2692) ─────────────────────────────────────────────
//
// The dashboard's POSTED column parses this out of the tracker's Notes cell.
// The date is interpolated by the server from what the scanner recorded, never
// requested from the agent: modes/oferta.md is explicit that a guessed date is
// worse than an absent one, because the column renders absent as `—` and would
// render an invented one as a fresh requisition.

test("buildPrompt: a known posting date becomes its own trailing segment", () => {
  const prompt = buildPrompt({ kind: "evaluate", input: "https://acme.com/jobs/7", memory: "", today: "2026-08-14", postedAt: "2026-08-07" });
  const fields = exampleTsvRow(prompt);

  assert.equal(fields.length, 10, "the row must still carry all 10 fields");
  // Canonical form, from the regex that CONSUMES it: separator-anchored `; `,
  // label, colon, ISO date. A mid-sentence mention is deliberately not metadata.
  assert.match(fields[8], /; posted: 2026-08-07$/);
});

test("buildPrompt: no known date writes NO segment, never a guess", () => {
  for (const postedAt of [undefined, null, "", "unknown", "7 Aug 2026", "2026-8-7", "1999-01-01"]) {
    const prompt = buildPrompt({ kind: "evaluate", input: "https://acme.com/jobs/7", memory: "", today: "2026-08-14", postedAt });
    const fields = exampleTsvRow(prompt);
    assert.equal(fields.length, 10, `field count changed for ${JSON.stringify(postedAt)}`);
    assert.ok(!/posted:/.test(fields[8]), `wrote a posted segment for ${JSON.stringify(postedAt)}: ${fields[8]}`);
  }
});

test("buildPrompt: the row without a date is byte-identical to before the feature", () => {
  // The segment is the ONLY difference between the two prompts, so a run with no
  // recorded date cannot drift from what the CLI has always produced.
  const withDate = buildPrompt({ kind: "evaluate", input: "u", memory: "", today: "2026-08-14", postedAt: "2026-08-07" });
  const without = buildPrompt({ kind: "evaluate", input: "u", memory: "", today: "2026-08-14" });
  assert.equal(withDate.replace("; posted: 2026-08-07", ""), without);
});
