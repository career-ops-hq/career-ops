import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";

await loadBindings();
const require = createRequire(import.meta.url);
const icon = () => createElement("span");
const lucide = new Proxy({}, { get: () => icon });
const cn = (...values) => values.flat().filter(Boolean).join(" ");

async function loadComponent(relative, filename, dependencies) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const { code } = await transform(source, {
    filename,
    jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => dependencies[id] ?? (id === "lucide-react" ? lucide : require(id)),
    module,
    module.exports,
  );
  return module.exports;
}

test("freelance inbox rows show tracking actions without shortlist or A–F evaluation", async () => {
  const { TriageRow } = await loadComponent("../../src/components/inbox/triage-row.tsx", "triage-row.tsx", {
    "next/link": ({ children, ...props }) => createElement("a", props, children),
    "@/lib/explore": { ATS_LABEL: { workday: "Workday" } },
    "@/components/ui/badge": { Badge: ({ children }) => createElement("span", null, children) },
    "@/components/company-logo": { CompanyLogo: () => createElement("span") },
    "@/lib/cn": { cn },
  });
  const html = renderToStaticMarkup(createElement(TriageRow, {
    job: { url: "https://example.test/freelance", company: "Acme", role: "Designer", opportunityType: "freelance", done: false },
    source: "workday",
    age: 0,
    scored: { score: 5, tone: "good", jobId: "job-1", running: false },
    selected: false,
    shortlisted: false,
    onToggleSelect() { throw new Error("freelance cannot be selected"); },
    onSave() { throw new Error("freelance cannot be shortlisted"); },
    onSkip() {},
  }));

  assert.match(html, />Freelance</);
  assert.match(html, />Abrir</);
  assert.match(html, />Retirar</);
  assert.doesNotMatch(html, /type="checkbox"|Guardar|por avaliar|\/5|A avaliar/);
});
