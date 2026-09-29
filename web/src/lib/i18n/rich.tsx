import { Fragment, type ReactNode } from "react";

// Rich-text interpolation for translated sentences that carry markup. The whole
// sentence is translated as one string, so each language keeps its own word
// order; markup is re-attached by name:
//
//   rich(t("The scan is <b>free</b>, {n} roles found."), {
//     b: (chunk) => <strong>{chunk}</strong>,
//     n: <span className="tabular-nums">{count}</span>,
//   })
//
// `<name>chunk</name>` calls a function part with the (already translated)
// chunk; `{name}` inserts a node part. Tags do not nest. An unknown name is
// left as literal text so a typo is visible instead of silently dropped.
export type RichPart = ReactNode | ((chunk: string) => ReactNode);

const TOKEN = /<(\w+)>([\s\S]*?)<\/\1>|\{(\w+)\}/g;

export function rich(text: string, parts: Record<string, RichPart>): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const [whole, tag, chunk, slot] = match;
    const name = tag ?? slot;
    const part = parts[name];
    if (part === undefined) {
      out.push(whole);
    } else {
      const node = typeof part === "function" ? part(chunk ?? "") : part;
      out.push(<Fragment key={key++}>{node}</Fragment>);
    }
    last = index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
