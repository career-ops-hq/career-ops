import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CHINA_PRESET,
  CHINA_SOURCES,
  employerRequest,
  employerOutcome,
} from "../../src/lib/employer-preset.mjs";
import { scanEmployer } from "../../src/lib/core/employer-source.mjs";
import {
  runEmployerDiscovery,
  runEmployerWorker,
} from "../../src/lib/core/employer-discovery.mjs";
import * as core from "../../../scan.mjs";
import { listTree } from "../../../lib/walk-tree.mjs";
import tencent from "../../../providers/tencent.mjs";
import bytedance from "../../../providers/feishu-jobs.mjs";
import meituan from "../../../providers/meituan.mjs";

const request = {
  preset: CHINA_PRESET,
  employers: ["tencent"],
  positive: [],
  allow: [],
};
const job = (title, location, id, extra = {}) => ({
  title,
  location,
  company: "Fixture",
  url: `https://example.com/job/${id}`,
  ...extra,
});
const jobs = [
  job("大模型工程师", "北京", 1),
  job("Staff Engineer", "Shanghai/北京", 2),
  job("Staff Engineer", "London", 3),
  job("Staff Engineer", "", 4),
  job("Staff Engineer - Remote", "London", 5),
  job("Staff Engineer", "", 6, { url: "https://example.com/jobs/london/6" }),
];
const dependencies = (data) => ({
  provider: {
    async fetch() {
      return data;
    },
  },
  core,
  http: {},
});

test("request is a strict fixed allowlist with only visible positive/location terms", () => {
  assert.deepEqual(
    employerRequest({
      ...request,
      employers: ["meituan", "tencent", "meituan"],
      negative: ["Engineer"],
      sinceDays: 1,
      keywords: ["hidden"],
      allow: ["北京"],
    }),
    { ...request, employers: ["meituan", "tencent"], allow: ["北京"] },
  );
  for (const employers of [[], ["ashby"], ["bytedance", "arbitrary"], null])
    assert.throws(() => employerRequest({ ...request, employers }));
  assert.throws(() => employerRequest({ ...request, preset: "other" }));
  assert.deepEqual(CHINA_SOURCES, ["tencent", "bytedance", "meituan"]);
  const manyTerms = Array.from({ length: 101 }, (_, i) => `term-${i}`);
  assert.deepEqual(employerRequest({ ...request, positive: manyTerms }).positive, manyTerms);
});

test("adapter matches core filters for Chinese/English titles, cities, multiple and unknown locations, URL hints and remote titles", async () => {
  for (const positive of [[], ["工程师"], ["Engineer"], ["word:staff"]]) {
    for (const allow of [[], ["北京"], ["London"], ["Shanghai"]]) {
      const r = { ...request, positive, allow };
      const title = core.buildTitleFilter({ positive });
      const location = core.buildLocationFilter({ allow });
      const expected = jobs
        .filter((j) => title(j.title) && location(j.location, j.url, j.title))
        .map((j) => j.url);
      const actual = await scanEmployer("tencent", r, dependencies(jobs));
      assert.deepEqual(
        actual.offers.map((j) => j.url),
        expected,
      );
      assert.equal(actual.state, "complete");
    }
  }
});

test("missing dates survive and normalized URL identity dedupes without collapsing distinct postings", async () => {
  const result = await scanEmployer(
    "tencent",
    request,
    dependencies([
      jobs[0],
      jobs[0],
      { ...jobs[0], url: `${jobs[0].url}?utm_source=fixture` },
      { ...jobs[0], url: "https://example.com/job/other" },
    ]),
  );
  assert.equal(result.offers.length, 2);
  assert.equal(result.offers[0].postedAt, "");
});

test("malformed usable-job fields are not rendered or reported as clean empty", async () => {
  const invalid = [
    { ...jobs[0], title: "" },
    { ...jobs[0], company: "" },
    { ...jobs[0], url: "" },
    { ...jobs[0], url: "javascript:alert(1)" },
  ];
  const result = await scanEmployer("tencent", request, dependencies(invalid));
  assert.deepEqual(result.offers, []);
  assert.equal(result.state, "incomplete");
  assert.match(result.reason, /source-data problem/);
});

const payloads = {
  tencent: {
    Data: {
      Count: 1,
      Posts: [{ RecruitPostName: "工程师", PostId: "1", LocationName: "北京" }],
    },
  },
  bytedance: {
    code: 0,
    data: {
      count: 1,
      job_post_list: [
        { title: "工程师", id: "1", city_list: [{ name: "北京" }] },
      ],
    },
  },
  meituan: {
    data: {
      page: { totalCount: 1 },
      list: [{ name: "工程师", jobUnionId: "1", cityList: ["北京"] }],
    },
  },
};
for (const provider of [tencent, bytedance, meituan]) {
  const source = provider === bytedance ? "bytedance" : provider.id;
  test(`${provider.id}: real provider retains its fetch/parse behavior, finite transport and only explicit filters`, async () => {
    let calls = 0;
    const r = await scanEmployer(
      source,
      { ...request, allow: ["北京"] },
      {
        provider,
        core,
        http: {
          async fetchJson(url, options) {
            calls++;
            assert.equal(options.timeoutMs, 10_000);
            return structuredClone(payloads[source]);
          },
          sleep: async () => {},
        },
      },
    );
    assert.equal(calls, 1);
    assert.equal(r.state, "complete");
    assert.equal(r.offers.length, 1);
    assert.equal(r.offers[0].source, source);
    assert.equal(r.offers[0].postedAt, "");
  });
}

test("raw provider omissions and unreadable responses are source problems, not empty success", async () => {
  const deps = {
    provider: tencent,
    core,
    http: {
      fetchJson: async () => ({ Data: { Count: 1, Posts: [{ PostId: "1" }] } }),
    },
  };
  const r = await scanEmployer("tencent", request, deps);
  assert.equal(r.state, "incomplete");
  assert.equal(r.offers.length, 0);
  await assert.rejects(
    scanEmployer("tencent", request, {
      ...deps,
      http: { fetchJson: async () => ({}) },
    }),
    /Source-data problem/,
  );
});

test("page cap and swallowed mid-pagination errors retain results and disclose incomplete coverage", async () => {
  let calls = 0;
  const r = await scanEmployer("tencent", request, {
    provider: tencent,
    core,
    http: {
      async fetchJson() {
        calls++;
        return {
          Data: {
            Count: 2000,
            Posts: [{ RecruitPostName: "Engineer", PostId: String(calls) }],
          },
        };
      },
      sleep: async () => {},
    },
  });
  assert.equal(calls, 10);
  assert.equal(r.offers.length, 10);
  assert.equal(r.state, "incomplete");
  assert.match(r.reason, /page cap/);
  calls = 0;
  const partial = await scanEmployer("tencent", request, {
    provider: tencent,
    core,
    http: {
      async fetchJson() {
        if (calls++) throw new Error("fixture timeout");
        return {
          Data: {
            Count: 200,
            Posts: [{ RecruitPostName: "Engineer", PostId: "1" }],
          },
        };
      },
      sleep: async () => {},
    },
  });
  assert.equal(partial.offers.length, 1);
  assert.equal(partial.state, "incomplete");
});

test("orchestration executes only selected providers and preserves all four terminal outcomes, including partial zero", async () => {
  for (const states of [
    ["complete", "complete"],
    ["complete", "failed"],
    ["failed", "failed"],
    ["incomplete", "failed"],
  ]) {
    for (const matches of [false, true]) {
      const events = [];
      const calls = [];
      const offers = await runEmployerDiscovery(
        { ...request, employers: ["tencent", "meituan"] },
        {
          codeRoot: "unused",
          onEvent: (e) => events.push(e),
          runSource: async (id, r) => {
            calls.push(id);
            assert.deepEqual(r.employers, ["tencent", "meituan"]);
            const state = states[id === "tencent" ? 0 : 1];
            return {
              id,
              state,
              reason: state === "complete" ? "" : "fixture source problem",
              offers:
                matches && state !== "failed"
                  ? [{ ...jobs[0], source: id }]
                  : [],
            };
          },
        },
      );
      assert.deepEqual(calls, ["tencent", "meituan"]);
      const summary = events.find((e) => e.kind === "summary");
      assert.equal(
        summary.employerOutcome.state,
        states.every((s) => s === "failed")
          ? "failed"
          : states.every((s) => s === "complete")
            ? "complete"
            : "partial",
      );
      assert.match(summary.employerOutcome.message, /Tencent|Meituan/);
      assert.equal(
        events.filter((e) => e.kind === "offer").length,
        offers.length,
      );
      if (states.every((s) => s === "complete") && !matches)
        assert.match(
          summary.employerOutcome.message,
          /No matches for this scan/,
        );
    }
  }
});

test("worker lifecycle times out, cancels, and leaves user files byte-identical; it never invokes scanner main or models", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "employer-worker-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worker = path.join(dir, "web/src/lib/core");
  mkdirSync(worker, { recursive: true });
  const sentinel = {
    "portals.yml": "do not overwrite",
    "config/profile.yml": "fixture",
    "data/pipeline.md": "pipeline",
    "data/scan-history.tsv": "history",
    "data/portal-health.tsv": "health",
  };
  for (const [name, bytes] of Object.entries(sentinel)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), bytes);
  }
  const actualWorker = readFileSync(
    new URL("../../src/lib/core/employer-source.mjs", import.meta.url),
    "utf8",
  );
  writeFileSync(
    path.join(worker, "employer-source.mjs"),
    "setInterval(()=>{},1000);",
  );
  const timeout = await runEmployerWorker("tencent", request, {
    codeRoot: dir,
    timeoutMs: 100,
  });
  assert.equal(timeout.state, "failed");
  assert.match(timeout.reason, /timed out/);
  const abort = new AbortController();
  abort.abort();
  const cancelled = await runEmployerWorker("tencent", request, {
    codeRoot: dir,
    signal: abort.signal,
  });
  assert.match(cancelled.reason, /interrupted/);
  // Real worker uses real core/provider imports and a fixture-only HTTP transport.
  writeFileSync(path.join(worker, "employer-source.mjs"), actualWorker);
  writeFileSync(
    path.join(dir, "web/src/lib/employer-preset.mjs"),
    readFileSync(new URL("../../src/lib/employer-preset.mjs", import.meta.url)),
  );
  mkdirSync(path.join(dir, "providers"));
  writeFileSync(
    path.join(dir, "scan.mjs"),
    `import { readFileSync } from "node:fs";
const modules = JSON.parse(readFileSync(new URL("./modules.json", import.meta.url), "utf8"));
const core = await import(modules.scan);
export const { buildTitleFilter, buildLocationFilter, normalizeUrlForDedup } = core;`,
  );
  writeFileSync(
    path.join(dir, "providers/tencent.mjs"),
    `import { readFileSync } from "node:fs";
const modules = JSON.parse(readFileSync(new URL("../modules.json", import.meta.url), "utf8"));
export default (await import(modules.tencent)).default;`,
  );
  writeFileSync(
    path.join(dir, "providers/_http.mjs"),
    `import { readFileSync } from "node:fs";
const payload = JSON.parse(readFileSync(new URL("./tencent-response.json", import.meta.url), "utf8"));
export const makeHttpCtx = () => ({ fetchJson: async () => structuredClone(payload) });`,
  );
  writeFileSync(path.join(dir, "modules.json"), JSON.stringify({
    scan: new URL("../../../scan.mjs", import.meta.url).href,
    tencent: new URL("../../../providers/tencent.mjs", import.meta.url).href,
  }));
  writeFileSync(path.join(dir, "providers/tencent-response.json"), JSON.stringify(payloads.tencent));
  const before = listTree(dir).sort();
  const success = await runEmployerWorker("tencent", request, {
    codeRoot: dir,
    timeoutMs: 10000,
  });
  assert.equal(success.state, "complete");
  assert.equal(success.offers.length, 1);
  assert.deepEqual(listTree(dir).sort(), before);
  for (const [name, bytes] of Object.entries(sentinel))
    assert.equal(readFileSync(path.join(dir, name), "utf8"), bytes);
});

test("filter codec round-trips preset selection and terms without changing legacy defaults", async () => {
  const {
    DEFAULT_FILTERS,
    parseExplorePatch,
    filtersToParams,
    paramsToFilters,
  } = await import("../../src/lib/explore.ts");
  assert.equal(DEFAULT_FILTERS.preset, undefined);
  const f = parseExplorePatch({
    ...request,
    employers: ["tencent", "bytedance"],
    positive: ["工程师"],
    allow: ["北京"],
  });
  const restored = paramsToFilters(new URLSearchParams(filtersToParams(f)));
  assert.equal(restored.preset, CHINA_PRESET);
  assert.deepEqual(restored.employers, ["tencent", "bytedance"]);
  assert.deepEqual(restored.positive, ["工程师"]);
  assert.deepEqual(restored.allow, ["北京"]);
  const empty = parseExplorePatch({ ...request, employers: [] });
  assert.deepEqual(
    paramsToFilters(new URLSearchParams(filtersToParams(empty))).employers,
    [],
  );
  assert.throws(() => employerRequest({ ...request, employers: ["alibaba"] }));
});
