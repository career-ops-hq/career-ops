import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import * as explore from "../../src/lib/explore.ts";
import * as discoveryState from "../../src/lib/explore-state.mjs";
import { normalizeTextKey } from "../../src/lib/core/normalize-text-key.mjs";

await loadBindings();
const require = createRequire(import.meta.url);
const placeholder = () => null;
const icon = () => React.createElement("span");
const hooks = {
  ...React, useEffect() {}, useMemo: (fn) => fn(), useRef: (initial) => ({ current: initial }),
  useState: (initial) => [initial?.id === null ? { id: "codex", name: "Codex" } : initial, () => {}],
};

async function loadComponent(filename, dependencies) {
  const source = fs.readFileSync(new URL(`../../src/components/explore/${filename}`, import.meta.url), "utf8");
  const { code } = await transform(source, {
    filename, jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => id === "react" ? hooks : id === "lucide-react" ? new Proxy({}, { get: () => icon }) : dependencies[id] ?? require(id),
    module, module.exports,
  );
  return module.exports;
}

const { AiSearchBox } = await loadComponent("ai-search-box.tsx", { "@/components/cost/cost-badge": { CostBadge: placeholder } });
let context;
const { ExplorerView } = await loadComponent("explorer-view.tsx", {
  "next/link": { default: placeholder }, "@/lib/cn": { cn: (...values) => values.filter(Boolean).join(" ") },
  "@/lib/fonts": { instrumentSerif: { className: "serif" } }, "@/lib/core/normalize-text-key.mjs": { normalizeTextKey },
  "@/lib/explore": explore, "@/lib/explore-state.mjs": discoveryState, "@/lib/pt-pt": { PT_PT_LOCALE: "pt-PT" },
  "./explore-provider": { useExplore: () => context }, "./ai-search-box": { AiSearchBox },
  "./filter-builder": { FilterBuilder: placeholder }, "./discovering-state": { DiscoveringState: placeholder },
  "./ai-hunt-view": { AiHuntView: placeholder }, "./explore-mode-toggle": { ExploreModeToggle: placeholder },
  "./results-list": { ResultsList: placeholder }, "./schedule-job-action": { ScheduleJobAction: placeholder },
});

function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (typeof tree.type === "function") return elements(tree.type(tree.props));
  return [tree, ...elements(tree.props?.children)];
}

const filters = { ...explore.DEFAULT_FILTERS, opportunityType: "freelance", positive: ["Flutter"], markets: ["remote"], sinceDays: 14 };
const render = () => ExplorerView({ seed: { filters, seededFrom: [] }, inboxSnapshot: [], appsSnapshot: [], rootExists: true });

for (const phase of ["empty-current", "empty-loose", "degraded", "failed"]) {
  test(`${phase} ${phase.startsWith("empty") ? "prepares assisted intent without starting discovery" : "does not offer assisted fallback"}`, () => {
    const calls = [];
    context = {
      filters: structuredClone(filters), phase, mode: "scan", running: false, offers: [], aiIntent: "",
      companiesScanned: 1, companiesAvailable: 1, capHit: false, droppedNoDate: 0, partial: phase === "degraded",
      sources: { wttj: { state: phase === "degraded" ? "partial" : phase === "failed" ? "error" : "ok" } },
      status: "", error: "Falha de teste", scannerMissing: false,
      setFilters: (next) => { context.filters = next; calls.push(["filters", next]); },
      setAiIntent: (intent) => { context.aiIntent = intent; calls.push(["intent", intent]); },
      setMode: (mode) => { context.mode = mode; calls.push(["mode", mode]); },
      discover: () => calls.push(["discover"]), discoverAI: () => calls.push(["discoverAI"]),
      initFilters() {}, loadFresh() {},
    };
    const tree = render();
    const buttons = elements(tree).filter((el) => el.type === "button");
    const fallback = buttons.find((el) => el.props.children === "Preparar pesquisa assistida");
    if (!phase.startsWith("empty")) {
      assert.equal(fallback, undefined);
      assert.deepEqual(calls, []);
      return;
    }
    assert.ok(fallback, "healthy zero offers the secondary action");
    assert.ok(buttons.some((el) => renderToStaticMarkup(el).includes("Pesquisar nos últimos 30 dias") || renderToStaticMarkup(el).includes("Pesquisar 30 dias")), "direct-search retry stays available");
    fallback.props.onClick();
    assert.deepEqual(calls, [
      ["intent", "Procura oportunidades freelance. Funções: Flutter. Mercados: Remoto. Publicadas nos últimos 14 dias."],
      ["mode", "ai"],
    ]);
    assert.deepEqual(context.filters, filters);
    const assisted = render();
    assert.match(renderToStaticMarkup(assisted), /usa os teus tokens/);
    const textarea = elements(assisted).find((el) => el.type === "textarea");
    assert.equal(textarea.props.value, calls[0][1]);
    assert.equal(calls.length, 2, "rendering the prepared intent does not execute it");
    const submit = elements(assisted).find((el) => el.type === "button" && renderToStaticMarkup(el).includes("Pesquisar na web"));
    submit.props.onClick();
    assert.deepEqual(calls.at(-1), ["discoverAI"]);
  });
}
