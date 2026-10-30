import { ChevronDown } from "lucide-react";
import { prepQuestions, readMachineSummary } from "@/lib/machine-summary.mjs";

const MATCH_LABEL: Record<string, { text: string; className: string }> = {
  strong: { text: "prove it", className: "text-emerald-600 dark:text-emerald-400" },
  partial: { text: "show depth", className: "text-amber-600 dark:text-amber-400" },
  missing: { text: "gap plan", className: "text-red-600 dark:text-red-400" },
};

export function PrepPack({ report, company }: { report: string; company: string }) {
  const summary = readMachineSummary(report);
  const questions = summary ? prepQuestions(summary) : [];
  if (questions.length === 0) return null;
  return (
    <details data-testid="prep-pack" className="group mt-3 overflow-hidden rounded-xl border border-border bg-surface/30">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 py-3 transition-colors hover:bg-surface-hover">
        <span className="text-sm font-medium">Interview prep</span>
        <span className="hidden truncate text-xs text-faint sm:inline">
          {questions.length} likely question{questions.length === 1 ? "" : "s"} from the requirements this role weighs most
        </span>
        <ChevronDown className="ml-auto size-4 shrink-0 text-faint transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-4 py-3">
        <ol className="space-y-3">
          {questions.map((q) => (
            <li key={q.requirement} className="text-sm">
              <p className="text-foreground">{q.question}</p>
              <p className="mt-0.5 text-xs text-faint">
                {q.requirement} · {q.importance} ·{" "}
                <span className={MATCH_LABEL[q.match].className}>{MATCH_LABEL[q.match].text}</span>
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted">
          Pair each question with a STAR story from your Interview Plan. For drafted answers and a company brief, run{" "}
          <code className="text-foreground">/career-ops interview-prep</code> for {company || "this role"} in your AI CLI.
        </p>
      </div>
    </details>
  );
}
