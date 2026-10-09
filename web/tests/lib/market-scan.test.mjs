import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";
import "../helpers/web-ts-alias-loader.mjs";
import { buildSearchPlan } from "../../src/lib/search-plan.mjs";
import workday from "../../../providers/workday.mjs";

const { runMarketDiscovery } = await import("@/lib/core/market-scan");
const { runDiscovery } = await import("@/lib/core/scan");
const filters = { positive: [], negative: [], allow: [], block: [], alwaysAllow: [], blockHard: [], ats: [], markets: ["portugal"], sinceDays: 7, limitPerAts: 50 };
const receipt = { version: "careerops.scan.receipt@1", scanned: 1, skipped: 0, offers: [{ company: "Acme", title: "Engineer", location: "Portugal", source: "landingjobs-api", url: "https://acme.com/42", postedAt: "2026-10-05" }], errors: [], unverified_zero: [], dry_run: true };

async function sandbox(t, script, profile = "") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "market-test-"));
  const old = { CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT, CAREER_OPS_CODE_ROOT: process.env.CAREER_OPS_CODE_ROOT };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = root;
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config/profile.yml"), profile);
  if (script !== null) fs.writeFileSync(path.join(root, "scan.mjs"), script);
  t.after(() => {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("directed Workday source uses the ordinary ephemeral market scan and source receipts", async t => {
  const payload = { ...receipt, scanned: 3, offers: [{ ...receipt.offers[0], company: "Auchan Portugal", title: "Operador/a de loja", source: "workday-api", url: "https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail/job/Lisboa/Operador_JR123" }] };
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('arguments.json', JSON.stringify({args:process.argv.slice(2),portals:process.env.CAREER_OPS_PORTALS,config:fs.readFileSync(process.env.CAREER_OPS_PORTALS,'utf8')})); console.log(${JSON.stringify(JSON.stringify(payload))});`);
  const input = { ...filters, positive: ["Operador de Loja"] };
  const events = [];
  const run = await runMarketDiscovery(input, event => events.push(event), buildSearchPlan(input, "precise"));
  const recorded = JSON.parse(fs.readFileSync(path.join(root, "arguments.json"), "utf8"));
  const config = yaml.load(recorded.config);
  assert.deepEqual(config.job_boards[0], { name: "Auchan Portugal", provider: "workday", enabled: true, careers_url: "https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail" });
  assert.deepEqual(workday.detect(config.job_boards[0]), { url: "https://auchanportugal.wd3.myworkdayjobs.com/wday/cxs/auchanportugal/auchan-retail/jobs" });
  assert.equal(config.tracked_companies, undefined);
  assert.deepEqual(recorded.args, ["--dry-run", "--json", "--since", "7"]);
  assert.equal(run.status, "ok");
  assert.equal(run.offers[0].source, "workday-api");
  assert.equal(events[0].source, "Auchan Portugal");
  assert.equal(events.find(event => event.kind === "sourceDone" && event.source === "Auchan Portugal").count, 1);
  assert.equal(fs.existsSync(recorded.portals), false);
  assert.equal(fs.existsSync(path.join(root, "data")), false);
});

test("market child uses dry-run JSON, ephemeral config, and cleans it after success", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('arguments.json', JSON.stringify({ args: process.argv.slice(2), portals: process.env.CAREER_OPS_PORTALS, config: fs.readFileSync(process.env.CAREER_OPS_PORTALS, 'utf8') })); console.log(${JSON.stringify(JSON.stringify(receipt))});`);
  const events = [];
  const run = await runMarketDiscovery(filters, e => events.push(e));
  assert.equal(run.offers.length, 1);
  const recorded = JSON.parse(fs.readFileSync(path.join(root, "arguments.json"), "utf8"));
  assert.deepEqual(recorded.args, ["--dry-run", "--json", "--since", "7"]);
  assert.match(recorded.config, /landingjobs/);
  assert.doesNotMatch(recorded.config, /strict: true/);
  assert.equal(fs.existsSync(recorded.portals), false);
  assert.equal(fs.existsSync(path.join(root, "data")), false);
  assert.equal(events[0].kind, "sourceStart");
  assert.ok(events.some(e => e.kind === "sourceDone"));
  assert.equal(events.find(e => e.kind === "sourceDone").count, 1);
});

test("missing scanner and malformed output produce failed source states", async t => {
  const root = await sandbox(t, null);
  assert.equal((await runMarketDiscovery(filters, () => {})).valid, false);
  fs.writeFileSync(path.join(root, "scan.mjs"), "console.log('bad JSON')");
  assert.equal((await runMarketDiscovery(filters, () => {})).status, "failed");
});

test("timeout preserves a flushed receipt as partial and cleans ephemeral config", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('temp-path', process.env.CAREER_OPS_PORTALS); process.on('SIGTERM', () => { console.log(${JSON.stringify(JSON.stringify(receipt))}); process.exit(2); }); setInterval(() => {}, 1000);`, "scan:\n  timeout_seconds: 1\n");
  const events = [];
  const run = await runMarketDiscovery(filters, e => events.push(e));
  assert.equal(run.status, "partial");
  assert.equal(run.offers.length, 1);
  assert.equal(run.sources[0].state, "error");
  assert.ok(events.some(e => e.kind === "sourceError"));
  assert.equal(events.filter(e => e.kind === "sourceDone").length, 0);
  assert.equal(fs.existsSync(fs.readFileSync(path.join(root, "temp-path"), "utf8")), false);
});

test("ATS success survives a missing market scanner without a fatal error", async t => {
  const root = await sandbox(t, null);
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), `// --json capHit\nconsole.log(JSON.stringify({ companiesScanned:1, offers:[{company:'Acme',title:'Engineer',url:'https://acme.com/42',location:'Portugal',source:'greenhouse-full'}] }));`);
  const events = [];
  const offers = await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e));
  assert.equal(offers.length, 1);
  assert.equal(events.filter(e => e.kind === "error").length, 0);
  assert.equal(events.find(e => e.kind === "summary").status, "partial");
});

test("market-only route retains its selection and terminal NDJSON receipt", async t => {
  await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(receipt))});`);
  const { POST } = await import("@/app/api/explore/route");
  const response = await POST(new Request("http://localhost/api/explore", { method: "POST", body: JSON.stringify(filters) }));
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(events[0].ats, []);
  assert.equal(events.at(-1).kind, "done");
  assert.equal(events.at(-1).count, 1);
  assert.deepEqual(events.at(-1).cost, { tokens: 0, usd: 0 });
  assert.equal(events.find(e => e.kind === "summary").status, "partial");
  assert.ok(events.some(e => e.kind === "sourceStart" && e.source === "Landing.jobs"));
  assert.ok(events.some(e => e.kind === "sourceError" && e.source === "wttj"));
});

test("the API enforces freelance as WTTJ-only even when employment ATS are requested", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('market-ran', fs.readFileSync(process.env.CAREER_OPS_PORTALS)); console.log(${JSON.stringify(JSON.stringify(receipt))});`);
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), "import fs from 'node:fs'; fs.writeFileSync('ats-ran', 'yes');");
  const { POST } = await import("@/app/api/explore/route");
  const response = await POST(new Request("http://localhost/api/explore", {
    method: "POST",
    body: JSON.stringify({ ...filters, opportunityType: "freelance", ats: ["greenhouse", "lever"], markets: [] }),
  }));
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.deepEqual(events[0].ats, []);
  assert.equal(fs.existsSync(path.join(root, "ats-ran")), false);
  assert.match(fs.readFileSync(path.join(root, "market-ran"), "utf8"), /contract_type:freelance/);
  assert.equal(events.at(-1).offers[0].opportunityType, "freelance");
});

test("runner counts missing locations and rejects present locations outside its market", async t => {
  const payload = { ...receipt, offers: [{ ...receipt.offers[0], location: "" }, { ...receipt.offers[0], url: "https://acme.com/43", location: "Madrid, Spain" }] };
  await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(payload))});`);
  const run = await runMarketDiscovery(filters, () => {});
  assert.equal(run.missingLocation, 1);
  assert.equal(run.offers.length, 0);
  assert.equal(run.valid, true);
});

test("both scanners begin before either completes and duplicate sources survive", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('market-started', 'yes'); const timer = setInterval(() => { if(fs.existsSync('ats-started')) { clearInterval(timer); console.log(${JSON.stringify(JSON.stringify(receipt))}); } }, 10);`, "scan:\n  timeout_seconds: 1\n");
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), `// --json capHit\nimport fs from 'node:fs'; fs.writeFileSync('ats-started', 'yes'); const timer = setInterval(() => { if(fs.existsSync('market-started')) { clearInterval(timer); console.log(JSON.stringify({companiesScanned:1,offers:[{company:'Acme',title:'Engineer',url:'https://acme.com/42?utm_source=ats',location:'',source:'greenhouse-full'}]})); } }, 10);`);
  const events = [];
  const offers = await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e));
  assert.equal(offers.length, 1);
  assert.equal(offers[0].location, "Portugal");
  assert.deepEqual(offers[0].sources, ["greenhouse-full", "landingjobs-api"]);
  assert.equal(events.find(e => e.kind === "summary").status, "partial");
});

test("a fatal market child cannot suppress a valid empty ATS receipt", async t => {
  const root = await sandbox(t, "process.exit(1)");
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), "// --json capHit\nconsole.log(JSON.stringify({companiesScanned:1,offers:[]}));");
  const events = [];
  assert.deepEqual(await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e)), []);
  assert.equal(events.find(e => e.kind === "summary").status, "partial");
  assert.equal(events.filter(e => e.kind === "error").length, 0);
});

test("exit 2 preserves market offers and marks failed sources", async t => {
  const payload = { ...receipt, errors: [{ company: "getManfred (EN)", error: "offline" }] };
  await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(payload))}); process.exit(2);`);
  const run = await runMarketDiscovery({ ...filters, markets: ["portugal", "spain"] }, () => {});
  assert.equal(run.offers.length, 1);
  assert.equal(run.status, "partial");
  assert.equal(run.sources.find(s => s.source === "getManfred (EN)").state, "error");
});

test("a timeout with no receipt is failed and leaves no ephemeral file", async t => {
  const root = await sandbox(t, "import fs from 'node:fs'; fs.writeFileSync('temp-path', process.env.CAREER_OPS_PORTALS); setInterval(() => {},1000);", "scan:\n  timeout_seconds: 1\n");
  const run = await runMarketDiscovery(filters, () => {});
  assert.equal(run.valid, false);
  assert.equal(run.status, "failed");
  assert.equal(fs.existsSync(fs.readFileSync(path.join(root, "temp-path"), "utf8")), false);
});

test("profile targeting seeds query providers without changing explicit title filters", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('portals-copy', fs.readFileSync(process.env.CAREER_OPS_PORTALS)); console.log(${JSON.stringify(JSON.stringify(receipt))});`, "target_roles:\n  primary:\n    - Data Engineer\n");
  const run = await runMarketDiscovery({ ...filters, markets: ["europe"] }, () => {});
  assert.equal(run.status, "ok");
  const config = fs.readFileSync(path.join(root, "portals-copy"), "utf8");
  assert.match(config, /Data Engineer/);
  assert.doesNotMatch(config, /title_filter:/);
});

test("empty freelance discovery ignores non-empty profile targets", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('portals-copy', fs.readFileSync(process.env.CAREER_OPS_PORTALS)); console.log(${JSON.stringify(JSON.stringify(receipt))});`, "target_roles:\n  primary:\n    - Data Engineer\n");
  await runMarketDiscovery({ ...filters, opportunityType: "freelance", markets: [] }, () => {});
  const config = fs.readFileSync(path.join(root, "portals-copy"), "utf8");
  assert.deepEqual(yaml.load(config).job_boards[0].wttj.queries, []);
  assert.doesNotMatch(config, /Data Engineer/);
});

test("new country selection writes one WTTJ board with its specific country filter", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('portals-copy', fs.readFileSync(process.env.CAREER_OPS_PORTALS)); console.log(${JSON.stringify(JSON.stringify(receipt))});`);
  const run = await runMarketDiscovery({ ...filters, positive: ["designer"], markets: ["netherlands"] }, () => {});
  const config = fs.readFileSync(path.join(root, "portals-copy"), "utf8");
  assert.equal(run.status, "ok");
  assert.match(config, /"provider":"wttj"/);
  assert.match(config, /"filters":"offices\.country_code:NL"/);
  assert.doesNotMatch(config, /offices\.country_code:GB/);
});

test("all selected paths failing reports one fatal outcome", async t => {
  const payload = { ...receipt, offers: [], errors: [{ company: "Landing.jobs", error: "offline" }] };
  await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(payload))}); process.exit(2);`);
  const events = [];
  assert.deepEqual(await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e)), []);
  assert.equal(events.filter(e => e.kind === "error").length, 1);
  assert.equal(events.find(e => e.kind === "summary").status, "failed");
});

test("an ATS child failure keeps its readable receipt but marks the joint search partial", async t => {
  const root = await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(receipt))});`);
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), "// --json capHit\nconsole.log(JSON.stringify({companiesScanned:1,offers:[]})); process.exit(1);");
  const events = [];
  assert.equal((await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e))).length, 1);
  assert.equal(events.find(e => e.kind === "summary").status, "partial");
  assert.ok(events.some(e => e.kind === "sourceError" && e.source === "greenhouse"));
  assert.equal(events.filter(e => e.kind === "error").length, 0);
});

test("nonzero market receipt reconciles source errors, incomplete summary and terminal offers", async t => {
  await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(receipt))}); process.exit(2);`);
  const { POST } = await import("@/app/api/explore/route");
  const response = await POST(new Request("http://localhost/api/explore", { method: "POST", body: JSON.stringify(filters) }));
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  const summary = events.find(e => e.kind === "summary");
  assert.equal(summary.status, "partial");
  assert.deepEqual(summary.incomplete, ["Landing.jobs", "wttj"]);
  assert.equal(summary.sources[0].state, "error");
  assert.ok(events.some(e => e.kind === "sourceError" && e.source === "Landing.jobs"));
  assert.equal(events.filter(e => e.kind === "sourceDone").length, 0);
  assert.equal(events.at(-1).kind, "done");
  assert.equal(events.at(-1).offers.length, 1);
  assert.equal(events.filter(e => e.kind === "error").length, 0);
});

test("skipped market receipt is failed alone and partial beside a valid ATS result", async t => {
  const payload = { ...receipt, scanned: 0, skipped: 1, offers: [] };
  const root = await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(payload))});`);
  const events = [];
  assert.deepEqual(await runDiscovery(filters, e => events.push(e)), []);
  assert.equal(events.find(e => e.kind === "summary").status, "failed");
  assert.deepEqual(events.find(e => e.kind === "summary").incomplete, ["Landing.jobs", "wttj"]);
  assert.equal(events.find(e => e.kind === "summary").sources[0].state, "skipped");
  assert.equal(events.filter(e => e.kind === "sourceDone").length, 0);
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), "// --json capHit\nconsole.log(JSON.stringify({companiesScanned:1,companiesAvailable:1,capHit:false,unreachableBoards:0,postingsDroppedNoDate:0,datasetStatus:{greenhouse:'ok'},offers:[]}));");
  const joined = [];
  assert.deepEqual(await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => joined.push(e)), []);
  assert.equal(joined.find(e => e.kind === "summary").status, "partial");
  assert.deepEqual(joined.find(e => e.kind === "summary").incomplete, ["Landing.jobs", "wttj"]);
  assert.equal(joined.filter(e => e.kind === "error").length, 0);
});

test("market scope filters provisional and terminal ATS offers and counts missing locations", async t => {
  const root = await sandbox(t, `console.log(${JSON.stringify(JSON.stringify({ ...receipt, offers: [] }))});`);
  const raw = ["Lisboa", "Madrid, Spain", "New York, United States", ""].map((location, i) => ({ company: "Acme", title: "Engineer", url: `https://acme.com/${i}`, location, source: "greenhouse-full" }));
  for (const json of [true, false]) {
    const script = json
      ? `// --json capHit\nconst offers = ${JSON.stringify(raw)}; for (const offer of offers) console.error(JSON.stringify({kind:'offer',...offer})); console.log(JSON.stringify({companiesScanned:1,offers}));`
      : raw.map(o => `console.log(${JSON.stringify(`  + [greenhouse-full] n/a | ${o.company} | ${o.title} | ${o.location}\n${o.url}`)});`).join("\n");
    fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), script);
    const events = [];
    const offers = await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e));
    assert.deepEqual(offers.map(o => o.location), ["Lisboa"]);
    assert.deepEqual(events.filter(e => e.kind === "offer").map(e => e.offer.location), ["Lisboa"]);
    assert.equal(events.find(e => e.kind === "summary").missingLocation, 1);
    const unrestricted = await runDiscovery({ ...filters, ats: ["greenhouse"], markets: [] }, () => {});
    assert.equal(unrestricted.length, 4);
  }
});

test("final market scope keeps worldwide remote offers and their merged ATS origins", async t => {
  const remoteOffer = { ...receipt.offers[0], location: "Worldwide", source: "remotive-api" };
  const root = await sandbox(t, `console.log(${JSON.stringify(JSON.stringify({ ...receipt, offers: [remoteOffer] }))});`);
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), `// --json capHit\nconsole.log(JSON.stringify({companiesScanned:1,offers:[${JSON.stringify({ ...remoteOffer, source: "greenhouse-full" })}]}));`);
  for (const ats of [[], ["greenhouse"]]) {
    const offers = await runDiscovery({ ...filters, ats, markets: ["remote"] }, () => {});
    assert.equal(offers.length, 1);
    assert.deepEqual(offers[0].sources, ats.length ? ["greenhouse-full", "remotive-api"] : ["remotive-api"]);
  }
});

test("unverified market zeros and omitted zero-health proof stay partial and never broaden", async t => {
  const root = await sandbox(t, null);
  for (const unverified of [["Landing.jobs"], undefined]) {
    const payload = { ...receipt, offers: [], unverified_zero: unverified };
    fs.writeFileSync(path.join(root, "scan.mjs"), `console.log(${JSON.stringify(JSON.stringify(payload))});`);
    const events = [];
    await runDiscovery({ ...filters, positive: ["designer"] }, event => events.push(event));
    assert.equal(events.find(event => event.kind === "summary").status, "partial");
    assert.equal(events.filter(event => event.kind === "phaseStart").length, 1);
    assert.equal(events.some(event => event.kind === "expansion"), false);
  }
});

test("ATS aggregate cannot hide missing health proof in one child", async t => {
  const root = await sandbox(t, null);
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), `// --json capHit
    const source = process.argv[process.argv.indexOf('--ats') + 1];
    const result = { companiesScanned:1, companiesAvailable:1, capHit:false, unreachableBoards:0, postingsDroppedNoDate:0, datasetStatus:{[source]:'ok'}, offers:[] };
    if(source === 'lever') delete result.postingsDroppedNoDate;
    console.log(JSON.stringify(result));`);
  const events = [];
  await runDiscovery({ ...filters, ats: ["greenhouse", "lever"], markets: [] }, event => events.push(event));
  assert.equal(events.find(event => event.kind === "summary").status, "partial");
  assert.deepEqual(events.find(event => event.kind === "summary").incomplete, ["lever"]);
  assert.equal(events.filter(event => event.kind === "phaseStart").length, 1);
});

test("healthy synthetic scanners run in parallel in both phases and route closes once without AI", async t => {
  const emptyReceipt = { ...receipt, scanned: 2, offers: [] };
  const root = await sandbox(t, `import fs from 'node:fs'; const phase = process.argv[process.argv.indexOf('--since') + 1];
    fs.appendFileSync('market-phases', phase + '\\n'); fs.writeFileSync('market-started-' + phase, 'yes');
    const timer = setInterval(() => { if(fs.existsSync('ats-started-' + phase)) { clearInterval(timer); console.log(${JSON.stringify(JSON.stringify(emptyReceipt))}); } },10);`, "scan:\n  timeout_seconds: 1\n");
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), `// --json capHit
    import fs from 'node:fs'; const phase = process.argv[process.argv.indexOf('--since') + 1];
    fs.appendFileSync('ats-phases', phase + '\\n'); fs.writeFileSync('ats-started-' + phase, 'yes');
    const timer = setInterval(() => { if(fs.existsSync('market-started-' + phase)) { clearInterval(timer); console.log(JSON.stringify({companiesAvailable:1,companiesScanned:1,capHit:false,datasetStatus:{greenhouse:'ok'},postingsDroppedNoDate:0,unreachableBoards:0,offers:[]})); } },10);`);
  const { POST } = await import("@/app/api/explore/route");
  const response = await POST(new Request("http://localhost/api/explore", { method: "POST", body: JSON.stringify({ ...filters, positive: ["designer"], ats: ["greenhouse"] }) }));
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(fs.readFileSync(path.join(root, "ats-phases"), "utf8"), "7\n30\n");
  assert.equal(fs.readFileSync(path.join(root, "market-phases"), "utf8"), "7\n30\n");
  assert.equal(events.filter(event => event.kind === "done").length, 1);
  assert.equal(events.filter(event => event.kind === "summary").length, 1);
  assert.deepEqual(events.filter(event => event.kind === "phaseStart").map(event => event.phase), ["precise", "broad"]);
  assert.deepEqual(events.at(-1).cost, { tokens: 0, usd: 0 });
  assert.deepEqual(events.at(-1).offers, []);
});

test("the optional search plan feeds identical geography into ephemeral config and market receipts", async t => {
  const cities = ["Lisboa", "Lisbon", "Lisbonne", "Amadora", "Sintra", "Oeiras", "Cascais", "Lisbonne, Angola", "Amadora, Spain"];
  const payload = { ...receipt, offers: cities.map((location, index) => ({ ...receipt.offers[0], location, url: `https://acme.com/${index}` })) };
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('portals-copy', fs.readFileSync(process.env.CAREER_OPS_PORTALS)); console.log(${JSON.stringify(JSON.stringify(payload))});`);
  const input = { ...filters, opportunityType: "employment", positive: ["Operador de Loja"], allow: ["Lisboa"] };
  for (const phase of ["precise", "broad"]) {
    const plan = buildSearchPlan(input, phase);
    const run = await runMarketDiscovery(input, () => {}, plan);
    const config = yaml.load(fs.readFileSync(path.join(root, "portals-copy"), "utf8"));
    assert.equal(config.location_filter.allow.includes("Lisbonne"), true);
    assert.equal(config.location_filter.allow.includes("Amadora"), phase === "broad");
    assert.deepEqual(run.offers.map(offer => offer.location), phase === "precise" ? ["Lisboa", "Lisbon", "Lisbonne"] : cities.slice(0, 7));
    assert.equal(config.title_filter.positive.includes("Retail Assistant"), phase === "broad");
  }
});
