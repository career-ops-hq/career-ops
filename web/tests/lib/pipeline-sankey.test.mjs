// Graph + layout tests for the analytics Pipeline Sankey.
// Run:  node --test tests/lib/pipeline-sankey.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import "../helpers/web-ts-alias-loader.mjs";
import { cn } from "../../src/lib/cn.ts";
import { classifyLeaf, buildPipelineSankey, layoutSankey, NODE_DEFS, parseStatusLog, statusToken } from "../../src/lib/pipeline-sankey.mjs";

test("PipelineSankey renders every canonical node label in PT-PT", async () => {
  const expected = {
    Tracked: "Acompanhadas",
    SKIP: "Ignoradas",
    "Still evaluated": "Avaliadas",
    "Discarded (no application recorded)": "Descartadas sem candidatura",
    Submitted: "Enviadas",
    Waiting: "À espera",
    "Company engaged": "Empresa respondeu",
    "Rejected (no interview)": "Recusadas sem entrevista",
    Discarded: "Descartadas",
    Screening: "Triagem",
    Interview: "Entrevista",
    Offer: "Proposta",
    Hired: "Contratação",
    "Rejected after interview": "Recusadas após entrevista",
    "Discarded after interview": "Descartadas após entrevista",
  };
  assert.deepEqual(NODE_DEFS.map(({ label }) => label), Object.keys(expected));

  await loadBindings();
  const source = fs.readFileSync(new URL("../../src/components/analytics/pipeline-sankey.tsx", import.meta.url), "utf8");
  const { code } = await transform(source, {
    filename: "pipeline-sankey.tsx",
    jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  });
  const links = NODE_DEFS.slice(1).map((node, index) => ({
    source: NODE_DEFS[index].id,
    target: node.id,
    value: 1,
  }));
  const graph = {
    nodes: NODE_DEFS.map((node) => ({ ...node, value: 1 })),
    links,
    total: NODE_DEFS.length,
  };
  const graphBoundary = {
    buildPipelineSankey: () => graph,
    layoutSankey: () => ({
      width: 920,
      height: 440,
      nodes: graph.nodes.map((node, index) => ({ ...node, x: index * 4, y: index * 4, width: 12, height: 30 })),
      links: graph.links.map((link) => ({ ...link, d: "M0,0 C1,1 2,2 3,3", thickness: 1 })),
    }),
  };
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => id === "@/lib/pipeline-sankey.mjs" ? graphBoundary
      : id === "@/lib/cn" ? { cn }
        : require(id),
    module,
    module.exports,
  );

  const html = renderToStaticMarkup(createElement(module.exports.PipelineSankey, {
    applications: [{ n: "1", status: "Applied" }],
    statusLog: [],
  }));
  const visible = html.match(/<text\b[^>]*>[\s\S]*?<\/text>/g).join(" ");
  const titles = html.match(/<title>[\s\S]*?<\/title>/g).join(" ");
  const table = html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] ?? "";
  for (const label of Object.values(expected)) {
    assert.ok(visible.includes(label), `visible SVG text must include ${label}`);
    assert.ok(titles.includes(label), `native SVG title text must include ${label}`);
    assert.ok(table.includes(`<td>${label}</td>`), `screen-reader table must include ${label}`);
  }
  for (const [index, link] of links.entries()) {
    const sourceLabel = expected[NODE_DEFS[index].label];
    const targetLabel = expected[NODE_DEFS[index + 1].label];
    assert.ok(
      titles.includes(`<title>1 oportunidades: ${sourceLabel} → ${targetLabel}</title>`),
      `SVG link title must translate ${sourceLabel} → ${targetLabel}`,
    );
  }
});

test("statusToken uses canonStatus aliases (same map as Analytics)", () => {
  assert.equal(statusToken("Interview"), "INTERVIEW");
  assert.equal(statusToken("Interview 2026-08-20"), "INTERVIEW");
  assert.equal(statusToken("**Rejected**"), "REJECTED");
  assert.equal(statusToken("—"), "DISCARDED");
  assert.equal(statusToken("Oferta"), "OFFER");
  assert.equal(statusToken("**Mülakat**"), "INTERVIEW");
  assert.equal(statusToken("Entrevista"), "INTERVIEW");
  assert.equal(statusToken("Rechazado"), "REJECTED");
});

test("parseStatusLog skips header and reads Interview→Rejected rows", () => {
  const rows = parseStatusLog(
    "num\tdate\tfrom\tto\tsource\tnote\n13\t2026-08-26\tInterview\tRejected\tset-status\t\n3\t2026-08-15\tApplied\tRejected\tset-status\t\n",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].num, 13);
  assert.equal(rows[0].from, "Interview");
  assert.equal(rows[0].to, "Rejected");
});

test("rejected after interview stays on the interview path", () => {
  const leaf = classifyLeaf({ n: 13, status: "Rejected" }, [{ num: 13, from: "Interview", to: "Rejected" }]);
  assert.equal(leaf, "rejectedInterview");
});

test("rejected with no interview log is rejectedApply", () => {
  const leaf = classifyLeaf({ n: 3, status: "Rejected" }, [{ num: 3, from: "Applied", to: "Rejected" }]);
  assert.equal(leaf, "rejectedApply");
});

test("current Interview counts as interview even without a log", () => {
  assert.equal(classifyLeaf({ n: 46, status: "Interview" }, []), "interview");
});

test("Discarded with no application in the log is not a submission", () => {
  // Closed or withdrawn before applying: the core counts Discarded in neither
  // submitted nor decided unless the history proves an application.
  assert.equal(classifyLeaf({ n: 7, status: "Discarded" }, []), "discardedEarly");
  assert.equal(classifyLeaf({ n: 7, status: "Discarded" }, [{ num: 7, from: "Evaluated", to: "Discarded" }]), "discardedEarly");
  // Empty and "—" statuses fold to DISCARDED through canonStatus.
  assert.equal(classifyLeaf({ n: 8, status: "—" }, []), "discardedEarly");
  assert.equal(classifyLeaf({ n: 9, status: "" }, []), "discardedEarly");
  // Another row's application is not evidence for this one.
  assert.equal(classifyLeaf({ n: 7, status: "Discarded" }, [{ num: 70, from: "Applied", to: "Discarded" }]), "discardedEarly");
});

test("Discarded after reaching Applied or later stays under Submitted", () => {
  assert.equal(classifyLeaf({ n: 7, status: "Discarded" }, [{ num: 7, from: "Applied", to: "Discarded" }]), "discarded");
  assert.equal(classifyLeaf({ n: 7, status: "Descartado" }, [{ num: 7, from: "Respondido", to: "Descartado" }]), "discarded");
  assert.equal(classifyLeaf({ n: 7, status: "Discarded" }, [{ num: 7, from: "Rejected", to: "Discarded" }]), "discarded");
  assert.equal(classifyLeaf({ n: 7, status: "Discarded" }, [{ num: 7, from: "Interview", to: "Discarded" }]), "discardedInterview");
});

test("buildPipelineSankey conserves tracked = skip + evaluated + submitted", () => {
  const apps = [
    { n: 1, status: "SKIP" },
    { n: 2, status: "Evaluated" },
    { n: 3, status: "Applied" },
    { n: 4, status: "Applied" },
    { n: 5, status: "Responded" },
    { n: 12, status: "Interview" },
    { n: 13, status: "Rejected" },
    { n: 26, status: "Rejected" },
  ];
  const log = [{ num: 13, from: "Interview", to: "Rejected" }];
  const g = buildPipelineSankey(apps, log);
  const v = Object.fromEntries(g.nodes.map((n) => [n.id, n.value]));
  assert.equal(g.total, 8);
  assert.equal(v.tracked, 8);
  assert.equal(v.skip, 1);
  assert.equal(v.evaluated, 1);
  assert.equal(v.submitted, 6);
  assert.equal(v.waiting, 2);
  assert.equal(v.engaged, 3);
  assert.equal(v.rejectedApply, 1);
  assert.equal(v.screening, 1);
  assert.equal(v.interview, 1);
  assert.equal(v.rejectedInterview, 1);
  assert.equal(v.tracked, v.skip + v.evaluated + v.submitted);
  assert.equal(v.submitted, v.waiting + v.engaged + v.rejectedApply);
  assert.equal(v.engaged, v.screening + v.interview + v.rejectedInterview);
});

test("buildPipelineSankey keeps pre-application Discarded rows out of Submitted", () => {
  const apps = [
    { n: 1, status: "Applied" },
    { n: 2, status: "Discarded" }, // posting closed before applying
    { n: 3, status: "Discarded" }, // withdrew after applying
    { n: 4, status: "—" }, // folds to Discarded, no history
  ];
  const log = [
    { num: 2, from: "Evaluated", to: "Discarded" },
    { num: 3, from: "Applied", to: "Discarded" },
  ];
  const g = buildPipelineSankey(apps, log);
  const v = Object.fromEntries(g.nodes.map((n) => [n.id, n.value]));
  const flow = (source, target) => g.links.find((l) => l.source === source && l.target === target)?.value;
  assert.equal(v.tracked, 4);
  assert.equal(v.discardedEarly, 2);
  assert.equal(v.submitted, 2);
  assert.equal(v.waiting, 1);
  assert.equal(v.discarded, 1);
  assert.equal(v.tracked, v.discardedEarly + v.submitted);
  assert.equal(v.submitted, v.waiting + v.discarded);
  assert.equal(flow("tracked", "discardedEarly"), 2);
  assert.equal(flow("tracked", "submitted"), 2);
  assert.equal(flow("submitted", "discarded"), 1);
});

test("empty apps yield empty graph", () => {
  const g = buildPipelineSankey([]);
  assert.equal(g.total, 0);
  assert.equal(g.nodes.length, 0);
  assert.equal(g.links.length, 0);
});

test("layoutSankey positions nodes and draws a path per live link", () => {
  const g = buildPipelineSankey(
    [
      { n: 1, status: "Applied" },
      { n: 2, status: "Interview" },
      { n: 3, status: "Rejected" },
    ],
    [{ num: 3, from: "Interview", to: "Rejected" }],
  );
  const laid = layoutSankey(g, { width: 800, height: 300 });
  assert.equal(laid.nodes.length, g.nodes.length);
  assert.equal(laid.links.length, g.links.length);
  for (const n of laid.nodes) {
    assert.ok(n.width > 0);
    assert.ok(n.height > 0);
    assert.ok(n.x >= 0);
    assert.ok(n.y >= 0);
  }
  for (const l of laid.links) {
    assert.ok(l.d.startsWith("M"));
    assert.ok(l.d.includes("C"));
    assert.ok(l.thickness > 0);
  }
});

// ── readStatusLog(): the ledger read behind the Sankey ──────────────────────
// A missing data/status-log.tsv is normal and charts from the snapshot; any
// other read failure must surface instead of passing for an empty log. It lives
// in career-ops.ts, reached through the shared @/ alias hook, with
// CAREER_OPS_ROOT pointed at a scratch data root.
const skipTs = !process.features?.typescript && "this Node cannot import career-ops.ts (no type stripping)";
const { readStatusLog, readApplicationStatusLog } = skipTs ? {} : await import("@/lib/career-ops");

function withDataRoot(setup, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sankey-status-log-"));
  fs.mkdirSync(path.join(root, "data"));
  fs.writeFileSync(path.join(root, "data/applications.md"), "");
  setup(path.join(root, "data"));
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("readStatusLog: a present log is parsed from the data root", { skip: skipTs }, () => {
  const tsv = "13\t2026-08-26\tInterview\tRejected\tset-status\t\n";
  const rows = withDataRoot((data) => fs.writeFileSync(path.join(data, "status-log.tsv"), tsv), () => readStatusLog());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].num, 13);
});

test("readStatusLog: a missing log is an empty log", { skip: skipTs }, () => {
  assert.deepEqual(withDataRoot(() => {}, () => readStatusLog()), []);
});

test("Sankey and cumulative tiles read the same active tracker's ledger", { skip: skipTs }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sankey-tracker-"));
  const priorRoot = process.env.CAREER_OPS_ROOT;
  const priorTracker = process.env.CAREER_OPS_TRACKER;
  const ledger = (num) => `${num}\t2026-08-26\tOffer\tRejected\tset-status\t\n`;
  try {
    process.env.CAREER_OPS_ROOT = root;
    delete process.env.CAREER_OPS_TRACKER;
    for (const [dir, num] of [["", 1], ["data", 2], ["custom", 3]]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, "applications.md"), "");
      fs.writeFileSync(path.join(root, dir, "status-log.tsv"), ledger(num));
    }
    const check = (num) => {
      assert.equal(readApplicationStatusLog(), ledger(num));
      assert.deepEqual(readStatusLog(), parseStatusLog(ledger(num)));
    };
    check(2);
    fs.unlinkSync(path.join(root, "data/applications.md"));
    check(1);
    const custom = path.join(root, "custom/applications.md");
    process.env.CAREER_OPS_TRACKER = custom;
    check(3);
    process.env.CAREER_OPS_TRACKER = path.relative(process.cwd(), custom);
    check(3);
    // A FILE symlink needs a privilege a non-elevated Windows shell lacks, and
    // a junction only links directories, so this one leg has no stand-in there.
    // Skip it by name; any other error is still a failure.
    let linked = true;
    try {
      fs.symlinkSync(custom, path.join(root, "linked.md"));
    } catch (e) {
      if (e?.code !== "EPERM" || e?.syscall !== "symlink") throw e;
      linked = false;
      t.diagnostic("symlinked-tracker leg skipped: no symlink privilege (EPERM)");
    }
    if (linked) {
      process.env.CAREER_OPS_TRACKER = path.join(root, "linked.md");
      check(3);
    }
  } finally {
    if (priorRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = priorRoot;
    if (priorTracker === undefined) delete process.env.CAREER_OPS_TRACKER;
    else process.env.CAREER_OPS_TRACKER = priorTracker;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readStatusLog: an unreadable log throws instead of reading as empty", { skip: skipTs }, () => {
  // A directory where the file should be: EISDIR, a read failure that is not ENOENT.
  withDataRoot(
    (data) => fs.mkdirSync(path.join(data, "status-log.tsv")),
    () => assert.throws(() => readStatusLog(), (err) => err?.code !== undefined && err.code !== "ENOENT"),
  );
});
