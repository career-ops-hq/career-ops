import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  colIndex,
  fitColumnIndex,
  fitTone,
  isStarTableHeader,
  parsePipeTable,
  splitPipeTables,
} from "@/lib/report-tables.mjs";

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function markdownComponents(fitCol: number) {
  let tdIndex = 0;
  return {
    tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => {
      tdIndex = 0;
      return <tr {...props}>{children}</tr>;
    },
    td: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => {
      const i = tdIndex++;
      const tone = i === fitCol ? fitTone(nodeText(children)) : null;
      if (!tone) return <td {...props}>{children}</td>;
      return (
        <td {...props}>
          <Badge tone={tone}>{children}</Badge>
        </td>
      );
    },
  };
}

function StarCards({ header, rows }: { header: string[]; rows: string[][] }) {
  const iNum = colIndex(header, ["#"]);
  const iReq = colIndex(header, ["jd requirement", "requirement"]);
  const iStory = colIndex(header, ["story"]);
  const iS = colIndex(header, ["s"]);
  const iT = colIndex(header, ["t"]);
  const iA = colIndex(header, ["a"]);
  const iR = colIndex(header, ["r"]);
  const iRef = colIndex(header, ["reflection"]);

  const fields = [
    { label: "Situation", i: iS },
    { label: "Task", i: iT },
    { label: "Action", i: iA },
    { label: "Result", i: iR },
    { label: "Reflection", i: iRef },
  ].filter((f) => f.i >= 0);

  return (
    <ol className="my-4 list-none space-y-2 p-0">
      {rows.map((row, i) => {
        const num = iNum >= 0 ? row[iNum] : String(i + 1);
        const req = iReq >= 0 ? row[iReq] : "";
        const story = iStory >= 0 ? row[iStory] : "";
        return (
          <li key={i}>
            <details className="group overflow-hidden rounded-xl border border-border bg-surface/40">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-hover">
                <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-faint">{num}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{req || story || `Story ${num}`}</span>
                  {req && story ? <span className="mt-0.5 block text-xs text-muted">{story}</span> : null}
                </span>
                <ChevronDown className="mt-0.5 size-4 shrink-0 text-faint transition-transform group-open:rotate-180" />
              </summary>
              <dl className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-2">
                {fields.map((f) => {
                  const value = row[f.i] ?? "";
                  if (!value) return null;
                  return (
                    <div key={f.label} className={f.label === "Reflection" ? "sm:col-span-2" : undefined}>
                      <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{f.label}</dt>
                      <dd className="mt-1 text-sm text-foreground">{value}</dd>
                    </div>
                  );
                })}
              </dl>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

/** GFM report body: STAR+R grids become cards; Fit cells become tone badges. */
export function ReportMarkdown({ children }: { children: string }) {
  const chunks = splitPipeTables(children);
  return (
    <>
      {chunks.map((c, i) => {
        if (c.type === "table") {
          const parsed = parsePipeTable(c.text);
          if (parsed && isStarTableHeader(parsed.header)) {
            return <StarCards key={i} header={parsed.header} rows={parsed.rows} />;
          }
          const fitCol = parsed ? fitColumnIndex(parsed.header) : -1;
          return (
            <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={markdownComponents(fitCol)}>
              {c.text}
            </ReactMarkdown>
          );
        }
        return (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
            {c.text}
          </ReactMarkdown>
        );
      })}
    </>
  );
}
