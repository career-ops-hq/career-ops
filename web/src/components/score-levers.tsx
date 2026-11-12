import { readMachineSummary, scoreLevers } from "@/lib/machine-summary.mjs";
import { leverCopy } from "@/lib/score-claims.mjs";

type Item = { text: string; tag?: string };

function ItemList({ title, hint, items, dot }: { title: string; hint: string; items: Item[]; dot: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="text-xs text-faint">{hint}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.text} className="flex items-start gap-2 text-sm text-foreground">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`} />
            <span className="min-w-0 flex-1">{item.text}</span>
            {item.tag && <span className="shrink-0 text-[11px] uppercase tracking-wide text-faint">{item.tag}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const plain = (text: string): Item => ({ text });

export function ScoreLevers({ report }: { report: string }) {
  const summary = readMachineSummary(report);
  if (!summary) return null;
  const { holding, close, verify, strengths } = scoreLevers(summary);
  const copy = leverCopy();
  if (holding.length + close.length + verify.length + strengths.length === 0) return null;
  return (
    <section data-testid="score-levers" className="mt-4 rounded-2xl border border-border bg-surface/30 px-5 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">{copy.sectionTitle}</p>
      <div className="mt-3 grid gap-5 sm:grid-cols-2">
        <ItemList
          title={copy.holdingTitle}
          hint={copy.holdingHint}
          items={holding.map((l) => ({ text: l.text, tag: "blocker" }))}
          dot="bg-red-500"
        />
        <ItemList
          title={copy.closeTitle}
          hint={copy.closeHint}
          items={close.map((lever) => plain(lever.text))}
          dot="bg-amber-500"
        />
        <ItemList title={copy.strengthsTitle} hint={copy.strengthsHint} items={strengths.map(plain)} dot="bg-emerald-500" />
        <ItemList title={copy.verifyTitle} hint={copy.verifyHint} items={verify.map(plain)} dot="bg-sky-500" />
      </div>
    </section>
  );
}
