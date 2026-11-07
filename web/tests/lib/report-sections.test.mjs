// Tests for the report section splitter using Node's built-in test runner.
// Imports directly from report-sections.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/report-sections.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPLY_LINE,
  applyCtaQuiet,
  applyLineLabel,
  authorLetter,
  cleanHeading,
  firstProseParagraph,
  isLeadSection,
  legitimacyTone,
  isVerdictHeading,
  splitSections,
  sectionPreview,
  verdictReason,
} from "../../src/lib/report-sections.mjs";

test("strips the author letter from the blocks the core has always written", () => {
  assert.equal(cleanHeading("A) Role Summary"), "Role Summary");
  assert.equal(cleanHeading("G) Posting Legitimacy"), "Posting Legitimacy");
});

test("H) is stripped too — the #2324 regression", () => {
  // oferta.md and auto-pipeline.md write "## H) Draft Application Answers";
  // the old [A-G] range left this one heading showing its letter.
  assert.equal(cleanHeading("H) Draft Application Answers"), "Draft Application Answers");
  assert.equal(authorLetter("H) Draft Application Answers"), "H");
});

test("a block added past H needs no code change", () => {
  assert.equal(cleanHeading("I) Something New"), "Something New");
  assert.equal(authorLetter("Z. Last One"), "Z");
});

test("the (lead) / (verdict) marker is dropped with the letter", () => {
  assert.equal(cleanHeading("F) Verdict (lead)"), "Verdict");
  assert.equal(cleanHeading("F) Verdict (verdict)"), "Verdict");
});

test("all three delimiters and the spelled-out Block form", () => {
  assert.equal(cleanHeading("B) Match with CV"), "Match with CV");
  assert.equal(cleanHeading("B. Match with CV"), "Match with CV");
  assert.equal(cleanHeading("B: Match with CV"), "Match with CV");
  assert.equal(cleanHeading("Block H: Draft Application Answers"), "Draft Application Answers");
  assert.equal(authorLetter("Block C) Red Flags"), "C");
});

test("prose is not eaten: both reads need a real delimiter", () => {
  // The delimiter, not the narrowness of the letter range, is the safety —
  // which is why widening the range costs nothing. A bare letter followed by a
  // space is prose: reading it as a section would make ReportView expand it as
  // if it were Block A.
  assert.equal(cleanHeading("A Recommendation Was Requested"), "A Recommendation Was Requested");
  assert.equal(authorLetter("A Recommendation Was Requested"), null);
  assert.equal(cleanHeading("Machine Summary"), "Machine Summary");
  assert.equal(authorLetter("Machine Summary"), null);
  assert.equal(authorLetter("Risk Summary"), null);
});

test("the spelled-out Block form is stripped for display too", () => {
  // authorLetter reads "Block A — Role Summary" as section A, so cleanHeading
  // must not leave "Block A —" in the rendered heading: classifying a heading
  // one way and displaying it another is the same inconsistency #2324 is about.
  assert.equal(cleanHeading("Block A — Role Summary"), "Role Summary");
  assert.equal(cleanHeading("Block A – Role Summary"), "Role Summary");
  assert.equal(cleanHeading("Block A - Role Summary"), "Role Summary");
  assert.equal(cleanHeading("Block A Role Summary"), "Role Summary");
  assert.equal(cleanHeading("Block C) Red Flags"), "Red Flags");
  // The word Block is what licenses the whitespace form. A bare letter still
  // needs a delimiter, or prose loses its first word.
  assert.equal(cleanHeading("A Recommendation Was Requested"), "A Recommendation Was Requested");
});

test("the spelled-out Block form keeps its letter without a delimiter", () => {
  // oferta.md:47 writes "## Block A — Role Summary": nothing follows the letter
  // but a space. Losing the letter here would drop the F verdict callout and
  // the A/B expansion on those reports.
  assert.equal(authorLetter("Block A — Role Summary"), "A");
  assert.equal(authorLetter("Block F -- Interview Plan"), "F");
  assert.equal(authorLetter("Block G Posting Legitimacy"), "G");
});

test("a heading that is only a letter keeps its original text", () => {
  assert.equal(cleanHeading("H)"), "H)");
});

test("case is normalized on the way out", () => {
  assert.equal(authorLetter("h) draft application answers"), "H");
});

test("splitSections keeps the intro and letters every section", () => {
  const body = [
    "**Score:** 4.2/5",
    "",
    "## F) Verdict (lead)",
    "Apply.",
    "",
    "## A) Role Summary",
    "Senior role.",
    "",
    "## H) Draft Application Answers",
    "Q1: ...",
  ].join("\n");

  const { intro, sections } = splitSections(body);
  assert.equal(intro, "**Score:** 4.2/5");
  assert.deepEqual(
    sections.map((s) => [s.letter, cleanHeading(s.heading)]),
    [
      ["F", "Verdict"],
      ["A", "Role Summary"],
      ["H", "Draft Application Answers"],
    ],
  );
  assert.equal(sections[2].content, "Q1: ...");
});

test("a body with no headings is all intro", () => {
  const { intro, sections } = splitSections("just prose\nand more");
  assert.equal(intro, "just prose\nand more");
  assert.deepEqual(sections, []);
});

test("the ASCII double-hyphen Block form is stripped whole", () => {
  // modes/ja/kyujin.md and modes/hi/naukri.md write "## Block A -- Role Summary"
  // for every block. The separator matched a SINGLE dash character, so each of
  // those headings rendered with a stray leading hyphen ("- Role Summary") —
  // every block of every report produced by the Japanese or Hindi mode.
  assert.equal(cleanHeading("Block A -- Role Summary"), "Role Summary");
  assert.equal(cleanHeading("Block F -- Interview Plan"), "Interview Plan");
  assert.equal(cleanHeading("Block G -- Posting Legitimacy"), "Posting Legitimacy");
  assert.equal(authorLetter("Block F -- Interview Plan"), "F");
  // A heading whose text legitimately starts with a hyphen keeps it: only the
  // separator run is consumed, and it must be attached to the letter.
  assert.equal(cleanHeading("Block A) -- keep this"), "-- keep this");
});

test("the Interview Plan at F is not a verdict", () => {
  // report-view.tsx read "whatever is lettered F" as the verdict and promoted it
  // into a callout built for a single sentence. F has been the Interview Plan
  // since before that callout existed (#1535 landed against a modes/oferta.md
  // that already read "## F) Interview Plan"), so every report rendered a table
  // into it (#3416).
  assert.equal(isVerdictHeading("F) Interview Plan"), false);
  assert.equal(isVerdictHeading("Block F -- Interview Plan"), false);
});

test("no localized mode heading is mistaken for a verdict", () => {
  // All eighteen localized modes write Interview Plan at F, so this was never an
  // English-only slip. A letter-based rule is wrong in every language at once.
  for (const heading of [
    "F) Plan rozmów kwalifikacyjnych",
    "F) План співбесід",
    "F) 面試準備計畫",
    "F) 면접 준비 계획",
    "F) Vorstellungsgesprächs-Plan",
    "F) Plan d'entretiens",
  ]) {
    assert.equal(isVerdictHeading(heading), false, heading);
  }
});

test("the authoring marker names the verdict, in any language", () => {
  // cleanHeading has always stripped a trailing "(lead)" / "(verdict)": that
  // marker is the core's deliberate signal, and it does not depend on the
  // letter or on English.
  assert.equal(isVerdictHeading("F) Verdict (lead)"), true);
  assert.equal(isVerdictHeading("C) Veredicto (lead)"), true);
  assert.equal(isVerdictHeading("A) 判定 (verdict)"), true);
  // A plainly titled block is caught too, with the letter stripped first.
  assert.equal(isVerdictHeading("Verdict"), true);
  assert.equal(isVerdictHeading("B) Verdict"), true);
  // ...but a heading that merely mentions the word is not the verdict block.
  assert.equal(isVerdictHeading("D) Verdict rationale and caveats"), false);
});

test("only Block B stays open as the lead section", () => {
  assert.equal(isLeadSection({ letter: "B", heading: "Block B — CV Match" }), true);
  assert.equal(isLeadSection({ letter: "A", heading: "Block A — Role Summary" }), false);
  assert.equal(isLeadSection({ letter: "F", heading: "Block F — Interview Plan" }), false);
  assert.equal(isLeadSection({ letter: null, heading: "Match with CV" }), true);
});

test("firstProseParagraph skips tables", () => {
  assert.equal(
    firstProseParagraph("| Field | Value |\n|-------|--------|\n| A | B |\n\nPHP is the gate."),
    "PHP is the gate.",
  );
  assert.equal(
    firstProseParagraph("| Field | Value |\n|-------|--------|\n| A | B |\nPHP is the gate."),
    "PHP is the gate.",
  );
});

test("verdictReason reads the header lede above ---", () => {
  const report = [
    "# Acme — Director of Engineering",
    "",
    "**Score:** 3.3 / 5",
    "**Decision:** Consider",
    "",
    "Hands-on Director of Software Engineering. PHP keeps this from Apply.",
    "",
    "---",
    "",
    "## Block A — Role Summary",
    "table here",
  ].join("\n");
  assert.match(verdictReason({ report, intro: "" }), /Hands-on Director/);
  assert.match(
    verdictReason({ intro: "", verdictContent: "Apply. PHP is a gate." }),
    /Apply/,
  );
});

test("verdictReason drops inline Markdown markers", () => {
  assert.equal(
    verdictReason({
      verdictContent: "**Apply.** The title and `dbt` match; see [the posting](https://example.com/jobs/1) and *one* gap.",
    }),
    "Apply. The title and dbt match; see the posting and one gap.",
  );
  assert.equal(verdictReason({ verdictContent: "Skip. Pay is 2 * 40k under the floor." }), "Skip. Pay is 2 * 40k under the floor.");
  assert.equal(verdictReason({ verdictContent: "Use snake_case_names in the dbt models." }), "Use snake_case_names in the dbt models.");
});

test("applyLineLabel: 4.0 is the apply line", () => {
  assert.equal(APPLY_LINE, 4.0);
  assert.equal(applyLineLabel(4.0), "Recommended");
  assert.equal(applyLineLabel("4.0/5"), "Recommended");
  assert.equal(applyLineLabel(3.9), "Below the apply line");
  assert.equal(applyLineLabel(null), null);
});

test("applyLineLabel: a flagged posting above the line is not Recommended", () => {
  assert.equal(applyLineLabel("4.9/5", "Proceed with Caution"), "Check the posting first");
  assert.equal(applyLineLabel("4.9/5", "Suspicious"), "Check the posting first");
  assert.equal(applyLineLabel("4.9/5", "High Confidence"), "Recommended");
  assert.equal(applyLineLabel("3.1/5", "Proceed with Caution"), "Below the apply line");
});

test("applyLineLabel: Turkish legitimacy tiers flag the posting too", () => {
  assert.equal(applyLineLabel("4.9/5", "Dikkatli İlerle"), "Check the posting first");
  assert.equal(applyLineLabel("4.9/5", "Şüpheli"), "Check the posting first");
  assert.equal(applyLineLabel("4.9/5", "Güvenilir"), "Recommended");
  assert.equal(applyCtaQuiet({ score: 4.5, legitimacy: "Şüpheli" }), true);
});

test("applyLineLabel: Chinese legitimacy tiers flag the posting too", () => {
  // modes/zh/oferta.md (Simplified) and modes/zh-TW/oferta.md (Traditional).
  assert.equal(applyLineLabel("4.9/5", "谨慎推进"), "Check the posting first");
  assert.equal(applyLineLabel("4.9/5", "疑似虚假"), "Check the posting first");
  assert.equal(applyLineLabel("4.9/5", "高置信度"), "Recommended");
  assert.equal(applyLineLabel("4.9/5", "審慎推進"), "Check the posting first");
  assert.equal(applyLineLabel("4.9/5", "疑似虛假"), "Check the posting first");
  assert.equal(applyLineLabel("4.9/5", "高信心"), "Recommended");
  assert.equal(applyCtaQuiet({ score: 4.5, legitimacy: "疑似虚假" }), true);
  assert.equal(applyCtaQuiet({ score: 4.5, legitimacy: "審慎推進" }), true);
  assert.equal(applyCtaQuiet({ score: 4.5, legitimacy: "高信心" }), false);
});

test("legitimacyTone: English, Turkish and Chinese tiers map to good / warn / bad", () => {
  assert.equal(legitimacyTone("High Confidence"), "good");
  assert.equal(legitimacyTone("Proceed with Caution"), "warn");
  assert.equal(legitimacyTone("Suspicious"), "bad");
  assert.equal(legitimacyTone("Güvenilir"), "good");
  assert.equal(legitimacyTone("Dikkatli İlerle"), "warn");
  assert.equal(legitimacyTone("Şüpheli"), "bad");
  assert.equal(legitimacyTone("高置信度"), "good");
  assert.equal(legitimacyTone("谨慎推进"), "warn");
  assert.equal(legitimacyTone("疑似虚假"), "bad");
  assert.equal(legitimacyTone("高信心"), "good");
  assert.equal(legitimacyTone("審慎推進"), "warn");
  assert.equal(legitimacyTone("疑似虛假"), "bad");
  assert.equal(legitimacyTone("unknown"), "muted");
});

test("applyCtaQuiet: below the apply line or caution legitimacy", () => {
  assert.equal(applyCtaQuiet({ score: 4.2 }), false);
  assert.equal(applyCtaQuiet({ score: 3.3 }), true);
  assert.equal(applyCtaQuiet({ score: 4.5, legitimacy: "Proceed with Caution" }), true);
  assert.equal(applyCtaQuiet({ score: 4.5, legitimacy: "Legitimate" }), false);
});

test("sectionPreview summarizes a field table without markdown residue", () => {
  const md = "| Field | Value |\n|---|---|\n| **Remote** | Seattle, WA |\n| **Comp** | $238k-$278k |\n| **TL;DR** | Fictional role at Monarch AI |";
  assert.equal(sectionPreview(md), "Remote: Seattle, WA · Comp: $238k-$278k · TL;DR: Fictional role at Monarch AI");
});

test("sectionPreview prefers prose next to a table and counts a wide table", () => {
  assert.equal(sectionPreview("| A | B |\n|---|---|\n| x | y |\n\nStrong fit overall. More detail."), "Strong fit overall.");
  assert.equal(sectionPreview("| Gap | Severity | Mitigation |\n|---|---|---|\n| SQL | Low | Course |\n| K8s | Mid | Lab |"), "2 rows");
  assert.equal(sectionPreview("| # | Situation | S | T | A | R | STAR story |\n|---|---|---|---|---|---|---|\n| 1 | a | b | c | d | e | f |"), "1 interview story");
});
