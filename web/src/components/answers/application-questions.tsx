"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2, Check } from "lucide-react";
import { splitQuestions, wordCapFrom } from "@/lib/apply/questions.mjs";
import { isSensitiveQuestion } from "@/lib/apply/sensitive-questions.mjs";
import { mergeDraftedAnswers, sameAnswers } from "@/lib/apply/answer-sync.mjs";

// Application follow-up questions, on the job page.
//
// Applications routinely ask free-text questions ("Describe a workflow you've
// meaningfully changed using AI in the last few months. Under 150 words."). The
// only place to draft one used to be the apply flow, which needs a live browser
// session on the employer's form, so when that could not open there was nowhere
// to put the question at all.
//
// This works with no session and no successful apply: paste the questions, draft
// answers from the same grounded planner the apply prefill uses, edit them, and
// they persist into the report's `## Application Answers` section that the CLI
// apply mode already knows how to reuse.

type Q = { question: string; answer: string; maxWords?: number };

const CONFIG_KEY = "career-ops:config";

/**
 * The CLI the user picked in Config, or null when they have not picked one.
 *
 * Read on every render rather than cached: Config is a different page, and a
 * stale null here would disable drafting on a machine that can perfectly well
 * draft.
 */
function cliId(): string | null {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}").cliId || null;
  } catch {
    return null;
  }
}

/**
 * Words in an answer, counted the way a person counts them.
 *
 * Only ever shown next to the cap the question states. It is never used to
 * truncate: the cap is the employer's rule, and cutting an answer to fit it
 * would be worse than showing the candidate they are over.
 */
function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * The Application Questions panel for one report.
 *
 * @param props.n The report number these questions are stored against.
 */
export function ApplicationQuestions({ n }: { n: string }) {
  const [questions, setQuestions] = useState<Q[]>([]);
  const [paste, setPaste] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "draft">(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"saved" | "block-h" | null>(null);
  // The list as the report last confirmed holding it, or null while nothing has
  // been written. "Saved" is then a comparison rather than a flag, so no edit
  // path can forget to clear it and an edit typed and undone goes back to saved.
  const [onDisk, setOnDisk] = useState<Q[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/answers?n=${encodeURIComponent(n)}`);
      const j = await r.json();
      if (Array.isArray(j.freeText)) {
        setQuestions(j.freeText);
        // Only a saved section is on disk. Block H content is a draft from the
        // evaluation that nothing has written against this report yet.
        if (j.source === "saved") setOnDisk(j.freeText);
      }
      if (j.source === "saved" || j.source === "block-h") setSource(j.source);
    } catch {
      /* best effort: an empty section is the normal starting state */
    } finally {
      setLoading(false);
    }
  }, [n]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Send the current list to /api/answers and fold the reply back in.
   *
   * The boxes stay editable while this runs, because drafting can take minutes
   * and a candidate who already knows an answer should not have to wait to type
   * it. mergeDraftedAnswers is what makes that safe, and merging inside the state
   * updater is what makes it exact: `prev` is the list including every keystroke,
   * including ones landed after this function started.
   */
  const post = async (body: Record<string, unknown>, as: "save" | "draft") => {
    const sent = questions;
    setBusy(as);
    setError(null);
    try {
      const r = await fetch("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, questions: sent, ...body }),
      });
      const j = await r.json();
      if (!r.ok || j.error) {
        setError(typeof j.error === "string" ? j.error : "That did not work.");
        return;
      }
      if (!Array.isArray(j.questions)) return;
      const incoming = j.questions as Q[];
      // What the route wrote is what the report now holds, whether or not the
      // screen has moved past it.
      setOnDisk(incoming);
      setQuestions((prev) => mergeDraftedAnswers({ sent, current: prev, incoming }) as Q[]);
      setSource("saved");
    } catch {
      setError("That did not work.");
    } finally {
      setBusy(null);
    }
  };

  /** Turn whatever is in the paste box into questions and append them. */
  const addPasted = () => {
    const added = splitQuestions(paste).map((question: string) => ({
      question,
      answer: "",
      maxWords: wordCapFrom(question),
    }));
    if (added.length === 0) return;
    setQuestions((prev) => [...prev, ...added]);
    setPaste("");
  };

  /** Replace one answer with what the candidate has typed. */
  const update = (i: number, answer: string) => {
    setQuestions((prev) => prev.map((item, idx) => (idx === i ? { ...item, answer } : item)));
  };

  /** Drop one question from the list. Nothing is written until a save. */
  const remove = (i: number) => {
    setQuestions((prev) => prev.filter((_, idx) => idx !== i));
  };

  if (loading) return null;

  const saved = sameAnswers(onDisk, questions);
  const unanswered = questions.filter((q) => !q.answer.trim()).length;
  // What the Draft button will actually attempt. Sensitive questions are never
  // sent to the planner, so counting them here would promise drafts the route is
  // going to refuse, leaving the button enabled with nothing to do.
  const draftable = questions.filter((q) => !q.answer.trim() && !isSensitiveQuestion(q.question)).length;
  const cli = cliId();

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-lg text-landing">Application questions</h2>
        {questions.length > 0 && (
          <span className="text-xs text-faint">
            {questions.length} question{questions.length === 1 ? "" : "s"}
            {unanswered > 0 ? ` · ${unanswered} unanswered` : " · all answered"}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        Paste the follow-up questions this application asks. Answers are drafted from your CV and
        profile, saved onto this report, and reused next time you apply here.
      </p>

      {/* Seeded content is a suggestion, not a record. Saying so prevents a draft
          written during evaluation from being mistaken for an answer already sent. */}
      {source === "block-h" && questions.length > 0 && (
        <p className="mt-2 rounded-lg border border-border bg-surface/40 px-3 py-2 text-xs text-muted">
          Starting from the answers drafted during this offer&apos;s evaluation. Nothing is stored
          against this report until you save.
        </p>
      )}

      {questions.length > 0 && (
        <ol className="mt-4 space-y-4">
          {questions.map((q, i) => {
            const words = countWords(q.answer);
            const over = q.maxWords ? words > q.maxWords : false;
            const yours = isSensitiveQuestion(q.question);
            return (
              <li key={`${i}-${q.question.slice(0, 24)}`} className="rounded-xl border border-border bg-surface/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-foreground">{q.question}</p>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label="Remove question"
                    className="shrink-0 rounded-md p-1 text-faint transition-colors hover:text-rose-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {/* Named on the question itself, not only in the note under the
                    buttons, so it is clear why this one box never fills in. */}
                {yours && (
                  <p className="mt-1.5 text-xs text-faint">Yours to answer. This one is never drafted.</p>
                )}
                <textarea
                  value={q.answer}
                  onChange={(e) => update(i, e.target.value)}
                  rows={q.answer ? 5 : 3}
                  placeholder={busy === "draft" && !yours ? "Drafting…" : "Your answer, or draft it below"}
                  className="mt-2.5 w-full resize-y rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50"
                />
                <div className="mt-1 flex items-center gap-3 text-xs">
                  <span className={over ? "text-rose-400" : "text-faint"}>
                    {words} word{words === 1 ? "" : "s"}
                    {q.maxWords ? ` / ${q.maxWords}` : ""}
                  </span>
                  {over && <span className="text-rose-400">over the limit this question states</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-4">
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          placeholder={"Paste one or more questions.\nOne per line, or separated by blank lines."}
          className="w-full resize-y rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addPasted}
            disabled={!paste.trim()}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            <Plus className="size-3.5" /> Add
          </button>

          <button
            type="button"
            onClick={() => post({ draft: true, cliId: cli }, "draft")}
            disabled={busy !== null || draftable === 0 || !cli}
            title={
              !cli
                ? "Choose an AI tool in Config first"
                : draftable === 0
                  ? unanswered > 0
                    ? "The questions still blank are yours to answer"
                    : "Every question already has an answer"
                  : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
          >
            {busy === "draft" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {busy === "draft" ? "Drafting…" : `Draft ${draftable || ""} answer${draftable === 1 ? "" : "s"}`.trim()}
          </button>

          <button
            type="button"
            onClick={() => post({}, "save")}
            disabled={busy !== null || questions.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
            {saved && busy === null ? "Saved" : "Save"}
          </button>
        </div>
        {!cli && (
          <p className="mt-2 text-xs text-faint">Pick an AI tool in Config to draft answers. You can still write and save them yourself.</p>
        )}
        <p className="mt-2 text-xs text-faint">
          Legal, visa, work authorization, salary and demographic questions are left blank on purpose.
          Those are yours to answer.
        </p>
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      </div>
    </section>
  );
}
