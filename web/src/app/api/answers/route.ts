import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot, rootScript, findReportFile, readMemory } from "@/lib/career-ops";
import { buildAnswerPrompt } from "@/lib/apply/answer-prompt.mjs";
import { runPlanner, type PlannerField } from "@/lib/apply/planner";
import { toAnswers } from "@/lib/apply/planner-answers.mjs";
import { buildSavePayload, mayReplaceSection } from "@/lib/apply/answers-snapshot.mjs";
import { sanitizeQuestions, wordCapFrom, type Question } from "@/lib/apply/questions.mjs";
import { isSensitiveQuestion } from "@/lib/apply/sensitive-questions.mjs";
import { extractJsonObject } from "@/lib/extract-json-object.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 320;

// Application follow-up questions, against a REPORT rather than a live form.
//
// Applications routinely ask free-text questions ("Describe a workflow you've
// changed using AI, under 150 words"). Until now the only way to draft one was
// /api/apply/prefill, which requires an open Playwright session, so whenever the
// apply flow could not open the employer's form the drafting capability went
// with it, even though drafting needs no browser at all.
//
// GET  ?n=<report>                          → the questions stored on that report
// POST {n, questions[]}                     → save questions (no drafting)
// POST {n, questions[], draft:true, cliId}  → draft the unanswered ones, then save
//
// Storage is the report's `## Application Answers` section, written through the
// core application-answers.mjs, so the CLI `apply` mode reads back exactly what
// the web UI wrote (modes/apply.md step 4 already says to reuse it).

type Stored = {
  /** A `## Application Answers` section exists on this report. */
  present: boolean;
  /**
   * We know what that section holds. False means the core reader was
   * unavailable or threw, so `rest` below is empty because nothing was read, not
   * because nothing is there. Saving over that would delete it.
   */
  readable: boolean;
  date: string;
  state: string;
  freeText: Question[];
  source?: "saved" | "block-h";
  /** The three groups this panel does not edit, carried so a save cannot drop them. */
  rest: { selections: unknown[]; fieldValues: unknown[]; files: unknown[] };
};

const EMPTY_REST = { selections: [], fieldValues: [], files: [] };

/**
 * The section heading, matched here rather than through the core module.
 *
 * The whole point of this check is to work when the core reader does not, so it
 * cannot go through it. One anchored line, the same one
 * `parseApplicationAnswersSection` looks for.
 */
const SECTION_HEADING = /^## Application Answers\s*$/m;

/**
 * Load application-answers.mjs out of the user's career-ops checkout.
 *
 * pathToFileURL, not a hand-built `file://` string: a Windows path or a space in
 * the project path does not survive naive concatenation, and CI runs Windows.
 * Mirrors the loader in lib/core/text-key.ts.
 */
async function loadCore(): Promise<Record<string, Function> | null> {
  const core = path.join(careerOpsRoot(), "application-answers.mjs");
  return import(/* webpackIgnore: true */ pathToFileURL(core).href).catch(() => null);
}

/**
 * Coerce an untrusted list into questions with a definite (possibly empty)
 * answer, so nothing downstream has to keep testing for `undefined`.
 */
function asQuestions(raw: unknown): Question[] {
  return sanitizeQuestions(raw).map((q) => ({ ...q, answer: q.answer ?? "" }));
}

/** Read the stored section through the core parser, the module that owns the format. */
async function readStored(file: string): Promise<Stored> {
  const blank = { present: false, date: "", state: "", freeText: [], rest: EMPTY_REST };

  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    // The report cannot be opened at all, so whether it holds a section is
    // unknowable. Assume it does: a refused save is recoverable, a replaced
    // section is not.
    return { ...blank, readable: false, present: true };
  }

  const mod = await loadCore();
  // An older application-answers.mjs in the user's checkout can still be written
  // to while exporting no reader. That is a normal, expected state (this route
  // handles the same skew for parseDraftAnswersBlockH below), and it is exactly
  // the state in which a save must not replace what it could not read.
  if (!mod?.parseApplicationAnswersSection) {
    return { ...blank, readable: false, present: SECTION_HEADING.test(text) };
  }

  try {
    // Lenient on purpose. The strict reader exists for modes/apply.md, which is
    // about to send a real application and should refuse a section it cannot
    // fully read. Here the user is looking at an editable page, so a section
    // with one bad line should still render the lines that are fine.
    const parsed = mod.parseApplicationAnswersSection(text) as null | Record<string, unknown>;
    if (parsed) {
      return {
        present: true,
        readable: true,
        date: String(parsed.date ?? ""),
        state: String(parsed.state ?? ""),
        freeText: asQuestions(parsed.freeText),
        source: "saved",
        rest: {
          selections: Array.isArray(parsed.selections) ? parsed.selections : [],
          fieldValues: Array.isArray(parsed.fieldValues) ? parsed.fieldValues : [],
          files: Array.isArray(parsed.files) ? parsed.files : [],
        },
      };
    }
    // Nothing saved yet. The evaluation may already have drafted answers in
    // Block H, and modes/apply.md treats those as a legitimate base for a real
    // application, so seed from them rather than showing an empty page. Nothing
    // is written until the user saves, which is why `source` is reported back:
    // the panel labels seeded content as a suggestion, not as a record.
    //
    // Optional call, not an oversight. This module is imported from the user's
    // own checkout at runtime, which may predate the Block H reader; seeding is
    // then simply skipped.
    const draft = mod.parseDraftAnswersBlockH?.(text) as null | { freeText?: unknown };
    const seeded = asQuestions(draft?.freeText);
    if (seeded.length > 0) {
      return { ...blank, readable: true, freeText: seeded, source: "block-h" };
    }
    // Read cleanly, and there is genuinely no section yet. The first save creates
    // one, which destroys nothing.
    return { ...blank, readable: true };
  } catch {
    return { ...blank, readable: false, present: SECTION_HEADING.test(text) };
  }
}

/**
 * Persist through the core script so the CLI and the web UI produce a
 * byte-identical section. The payload, including the three groups this panel
 * does not edit, is built by answers-snapshot.mjs; see its tests for why.
 */
function writeStored(file: string, snapshot: ReturnType<typeof buildSavePayload>): Promise<{ ok: boolean; error?: string }> {
  const { state } = snapshot;
  const payload = JSON.stringify(snapshot);
  const tmp = path.join(os.tmpdir(), `co-answers-${process.pid}-${randomUUID()}.json`);
  fs.writeFileSync(tmp, payload);
  return new Promise((resolve) => {
    execFile(
      "node",
      [rootScript("application-answers"), "--report", file, "--input", tmp, "--state", state],
      { cwd: careerOpsRoot(), timeout: 20_000 },
      (err, _out, stderr) => {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* best effort */
        }
        if (err) resolve({ ok: false, error: (stderr || err.message).slice(0, 200) });
        else resolve({ ok: true });
      },
    );
  });
}

/**
 * The questions stored on a report, for the panel's first render.
 *
 * `rest` is stripped from the reply: the three groups the panel does not edit are
 * carried by the server across a save, and shipping them to a browser that has no
 * use for them only invites a client that starts round-tripping them.
 */
export async function GET(req: Request) {
  const n = new URL(req.url).searchParams.get("n")?.trim() ?? "";
  if (!n) return Response.json({ error: "a report number is required" }, { status: 400 });
  // findReportFile enforces containment under the project root.
  const file = findReportFile(n);
  if (!file) return Response.json({ error: `no report found for #${n}` }, { status: 404 });
  const { rest: _rest, readable: _readable, ...stored } = await readStored(file);
  return Response.json(stored);
}

/**
 * Save questions onto a report, optionally drafting the blank ones first.
 *
 * Drafting never touches an answer that already has text, and never touches a
 * sensitive question at all. Nothing here submits anything to an employer: the
 * report is the only thing written.
 */
export async function POST(req: Request) {
  let body: { n?: string; questions?: unknown; draft?: boolean; cliId?: string; state?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const n = String(body.n ?? "").trim();
  if (!n) return Response.json({ error: "a report number is required" }, { status: 400 });
  const file = findReportFile(n);
  if (!file) return Response.json({ error: `no report found for #${n}` }, { status: 404 });

  const questions = sanitizeQuestions(body.questions);
  if (questions.length === 0) return Response.json({ error: "add at least one question" }, { status: 400 });

  const stored = await readStored(file);
  if (!mayReplaceSection(stored)) {
    return Response.json(
      {
        error:
          "this report already has an Application Answers section that could not be read, and saving replaces the whole section. Update application-answers.mjs in your career-ops checkout, then try again.",
      },
      { status: 409 },
    );
  }
  const save = (qs: Question[]) =>
    writeStored(file, buildSavePayload({ stored: { state: stored.state, ...stored.rest }, questions: qs, state: body.state }));

  if (!body.draft) {
    const saved = await save(questions);
    if (!saved.ok) return Response.json({ error: `could not save: ${saved.error}` }, { status: 500 });
    return Response.json({ ok: true, questions, drafted: 0 });
  }

  const cliId = String(body.cliId ?? "").trim();
  if (!cliId) return Response.json({ error: "no CLI selected to draft with" }, { status: 400 });
  const resolved = resolveCli(cliId);
  if (!resolved) return Response.json({ error: `CLI '${cliId}' not found on this machine` }, { status: 400 });

  // Only draft what is still blank, so an answer the user wrote or edited is
  // never silently overwritten by a regenerated one.
  const blank = questions.filter((q) => !q.answer.trim());
  // Sensitive questions are held back BEFORE the planner runs, not filtered out
  // of its reply. The planner is told to refuse them, but a refusal it declines
  // to make comes back as a confident invented answer about the candidate's visa
  // status or pay, so the safest generated value is the one never generated.
  // Each question carries the planner field id it was given, rather than the id
  // being rebuilt from a list position forty lines further down. The old form,
  // `todo.indexOf(q)`, worked only while `filter` kept the same object
  // references: insert one `.map()` between here and the merge and it returns -1
  // for every question, every draft is silently discarded, and nothing errors.
  const todo = blank.filter((q) => !isSensitiveQuestion(q.question)).map((q, i) => ({ q, id: `q${i}` }));
  if (todo.length === 0) {
    const saved = await save(questions);
    if (!saved.ok) return Response.json({ error: `could not save: ${saved.error}` }, { status: 500 });
    return Response.json({
      ok: true,
      questions,
      drafted: 0,
      note:
        blank.length > todo.length
          ? "left blank on purpose: legal, visa, work authorization, salary and demographic questions are yours to answer"
          : "every question already had an answer",
    });
  }

  const title = path.basename(file).replace(/^\d+-/, "").replace(/-\d{4}-\d{2}-\d{2}\.md$/, "").replace(/-/g, " ");
  // The cap is stated inside the question text, but stating it again as its own
  // field is what the planner acts on: buildAnswerPrompt renders it as
  // `[max N words]` and tells the planner to respect it. Parsing the cap for the
  // panel's counter and then not passing it here is how a question saying "in 50
  // words or fewer" came back at the flat ~120-word default, over the employer's
  // limit, with nothing but a red counter to show for it.
  const fields: PlannerField[] = todo.map(({ q, id }) => ({
    id,
    type: "textarea",
    label: q.question,
    required: false,
    maxWords: wordCapFrom(q.question),
  }));

  const t0 = Date.now();
  const logPath = path.join(careerOpsRoot(), ".career-ops-web", "answers.log");
  const log = (m: string) => {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${new Date().toISOString()} [+${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}\n`);
    } catch {
      /* diagnostics are best effort; never fail a draft over a log write */
    }
  };

  const run = await runPlanner({
    cliId,
    spec: resolved.spec,
    binPath: resolved.binPath,
    prompt: buildAnswerPrompt({ title, fields, memory: readMemory().trim() }),
    fieldCount: fields.length,
    cwd: careerOpsRoot(),
    t0,
    log,
  });

  if (!run.buf.trim()) {
    return Response.json(
      { error: run.signal ? "the planner was killed before answering" : "the planner produced no output" },
      { status: 500 },
    );
  }

  const { obj, truncated } = extractJsonObject(run.buf);
  if (!obj) return Response.json({ error: "could not read the planner's answer" }, { status: 500 });
  const answers = toAnswers(obj);

  // Collect first, merge second. A `.map()` that also increments an outer counter
  // reads as a transformation while being a loop with a side effect, and the two
  // halves drift the moment either is edited.
  const drafts = new Map<Question, string>();
  for (const { q, id } of todo) {
    // Said twice on purpose. `todo` already excluded these, so no value for one
    // can exist; this line is what keeps that true after a later edit changes how
    // `todo` is built. A guarantee stated only as a side effect of a filter three
    // screens up is one edit away from being gone.
    if (isSensitiveQuestion(q.question)) continue;
    const answer = answers[id];
    // needs_confirmation is the planner's own refusal flag. It is a second signal
    // rather than the guarantee: the guarantee is the predicate above.
    if (!answer || answer.needs_confirmation || !answer.value.trim()) continue;
    drafts.set(q, answer.value);
  }

  const merged = questions.map((q) => {
    const draft = drafts.get(q);
    return draft === undefined ? q : { ...q, answer: draft };
  });
  const drafted = drafts.size;

  const saved = await save(merged);
  if (!saved.ok) return Response.json({ error: `drafted, but could not save: ${saved.error}` }, { status: 500 });
  return Response.json({
    ok: true,
    questions: merged.map((q) => ({ ...q, maxWords: wordCapFrom(q.question) })),
    drafted,
    truncated,
  });
}
