import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { pickAwaitingDecision } from "../../src/lib/home/awaiting.mjs";
import { todaySnapshot } from "../../src/lib/home/today-snapshot.mjs";

const source = readFileSync(new URL("../../src/components/home/today-dashboard.tsx", import.meta.url), "utf8");
await loadBindings();
const { code } = await transform(source, {
  filename: "today-dashboard.tsx",
  jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
});
const require = createRequire(import.meta.url);
const scoreOf = (score) => Number.parseFloat(score);
let decisions;

// Render the real dashboard; replace only framework context and child boundaries.
// The decision-card calls expose the parent's selected rows, not the card's UI.
const dependencies = {
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  "@/lib/fonts": { instrumentSerif: { className: "instrument-serif" } },
  "@/lib/format": { scoreNum: scoreOf },
  "@/lib/pt-pt": { PT_PT_LOCALE: "pt-PT" },
  "@/lib/home/awaiting.mjs": { pickAwaitingDecision },
  "@/components/explore/discovery-card": { DiscoveryCard: () => null },
  "@/components/home/follow-up-card": { FollowUpCard: () => null },
  "@/components/home/decision-card": { DecisionCard: ({ app }) => { decisions.push(app.n); return null; } },
  "@/components/quick-evaluate": { QuickEvaluate: () => null },
};
const module = { exports: {} };
new Function("require", "module", "exports", code)(
  (id) => dependencies[id] ?? require(id), module, module.exports,
);

for (const [count, headline, visible] of [
  [0, "Está tudo em dia.", []],
  [1, "1 decisão pendente", ["1"]],
  [8, "8 decisões pendentes", ["1", "2", "3", "4", "5", "6"]],
]) test(`Hoje: ${headline}, com ${visible.length} cartões`, () => {
  const snapshot = todaySnapshot({
    applications: [
      ...Array.from({ length: count }, (_, i) => ({
        n: String(i + 1), status: "Evaluated", date: "2026-10-06", score: "4.5/5",
      })),
      { n: "history", status: "Applied" },
    ],
    inbox: [],
  }, scoreOf);
  decisions = [];
  const html = renderToStaticMarkup(createElement(module.exports.TodayDashboard, { ...snapshot, inBetween: false }));
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
  assert.equal(heading.replace(/<[^>]*>/g, ""), headline);
  assert.deepEqual(decisions, visible, "the dashboard must pass at most six pending rows to its cards");
  if (count) assert.ok(heading.includes(`<span class="text-brand tabular-nums">${count}</span>`));
});
