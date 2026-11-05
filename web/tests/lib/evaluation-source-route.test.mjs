// Exercise the actual POST orchestration with native readers/process boundaries
// replaced by deterministic children. No model, public HTTP or user data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readEvaluationSource } from '../../src/lib/evaluation-source.mjs';
import { parseCodexEvent, killMsForKind } from '../../src/lib/run-cli-support.mjs';
import '../helpers/web-ts-alias-loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERSIST = pathToFileURL(path.resolve(HERE, '../../src/lib/report-persist.mjs')).href;
const modules = {
  '@/lib/clis': `export const resolveCliOrFallback=()=>globalThis.__knownSourceRoute.spec; export const cliSubstitutionNotice=()=>null; export const cliUnavailableError=()=>({error:'fixture'});`,
  '@/lib/followups': `export const localISODate=()=> '2026-01-01';`,
  '@/lib/career-ops': `export const careerOpsRoot=()=>globalThis.__knownSourceRoute.root; export const readMemory=()=>''; export const findReportFile=()=>null; export const readInbox=()=>[]; export const readScanDates=()=>new Map(); export const readLanguageConfig=()=>({output:'en',modesDir:'modes',evalModeFile:'modes/oferta.md'});`,
  '@/lib/core/code-root.mjs': `export const resolveCodeRoot=()=>globalThis.__knownSourceRoute.codeRoot;`,
  '@/lib/evaluation-source.mjs': `export const readEvaluationSource=(args)=>globalThis.__knownSourceRoute.prefetch(args);`,
  '@/lib/spawn-cli.mjs': `export const spawnHeadlessCli=(...args)=>globalThis.__knownSourceRoute.spawnModel(...args);`,
  '@/lib/report-persist.mjs': `export {evaluateRunOutcome} from ${JSON.stringify(PERSIST)}; export const persistEvaluation=(args)=>globalThis.__knownSourceRoute.persist(args);`,
  '@/lib/core/run-registry': `export const acquireTrackerWrite=()=>{globalThis.__knownSourceRoute.tokens++;return 'fixture-token'};export const releaseTrackerWrite=()=>{globalThis.__knownSourceRoute.tokens--};`,
};
register(`data:text/javascript,${encodeURIComponent(`
  const modules=${JSON.stringify(modules)};
  export function resolve(specifier,context,nextResolve){
    if(modules[specifier])return {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true};
    return nextResolve(specifier,context);
  }
`)}`, import.meta.url);
const { POST } = await import('../../src/app/api/run/route.ts');

const ORIGINAL = 'https://jobs.ashbyhq.com/fictional/11111111-1111-4111-8111-111111111111?source=fixture';
const API = 'https://api.ashbyhq.com/posting-api/job-board/fictional';
const JD = 'Partner with customers and engineering to own discovery, delivery, roadmap tradeoffs and measurable product outcomes. '.repeat(8);
const SOURCE = { version: 1, originalURL: ORIGINAL, textCap: 20_000,
  result: { url: ORIGINAL, ats: 'ashby', title: 'Fictional Product Manager', text: JD },
  transport: { fetchCallCount: 1, requests: [{ requestURL: API, method: 'GET', requestedAt: '2026-01-01T00:00:00.000Z', accept: 'application/json', userAgent: 'fictional-client', httpStatus: 200, finalURL: API, redirected: false, respondedAt: '2026-01-01T00:00:01.000Z' }] } };
const REPORT = `# Evaluation: Fictional — Product Manager
## Machine Summary
\`\`\`yaml
company: Fictional
role: Product Manager
score: 4.0
via: null
\`\`\`
## A. Role
A fictional full evaluation.
## Job Description (archived verbatim)
${JD}`;
const GATE = `Stopped at a policy gate.\n<<evaluation-gate>>\n{"status":"needs_confirmation","reason":"dealbreaker","message":"Review the fictional location rule."}\n<</evaluation-gate>>\nVERDICT: N/A/5 — Policy confirmation is required.`;

function fixture(t, { sourceFailure = false, gate = false, fatal = false, abortDuring = false, sourcePacket = SOURCE, selected = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'known-source-route-'));
  const codeRoot=path.join(root,'code'), dataRoot=path.join(root,'data');
  fs.mkdirSync(path.join(codeRoot,'modes'),{recursive:true}); fs.mkdirSync(dataRoot);
  fs.writeFileSync(path.join(codeRoot,'modes/oferta.md'),'fixture mode'); fs.writeFileSync(path.join(dataRoot,'cv.md'),'fictional CV');
  if(selected) for(const file of ['modes/oferta.md','modes/_shared.md','batch/batch-prompt.md']) {
    const dest=path.join(codeRoot,file); fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.copyFileSync(path.resolve(HERE,'../../..',file),dest);
  }
  const controller = new AbortController();
  const state = { root: dataRoot, codeRoot, calls: [], persisted: [], tokens: 0, sourceCalls: [], prompts: [] };
  state.spec = { spec: { id: 'codex', name: 'Fixture Codex', streamArgs: prompt => [prompt], args: prompt => [prompt], parseEvent: parseCodexEvent }, binPath: '/fixture/codex' };
  state.prefetch = async args => {
    state.calls.push('source-start');
    const result = await readEvaluationSource({ ...args, spawnFn: (bin, argv, options) => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdout.setEncoding = () => {};
      child.stdin = new EventEmitter(); child.stdin.end = input => {
        state.sourceCalls.push({ bin, argv, options, input });
        queueMicrotask(() => {
          if (abortDuring) { controller.abort(); return; }
          if (!sourceFailure) child.stdout.emit('data', JSON.stringify(sourcePacket));
          child.emit('close', sourceFailure ? 1 : 0);
        });
      };
      child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; };
      return child;
    } });
    state.calls.push('source-close');
    return { ...result, elapsedMs: 1234 };
  };
  state.spawnModel = (_bin, argv, options) => {
    state.modelOptions=options;
    state.calls.push('model'); state.prompts.push(argv[0]);
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdout.setEncoding = child.stderr.setEncoding = () => {};
    child.kill = () => { child.emit('close', null, 'SIGTERM'); return true; };
    queueMicrotask(() => {
      if (fatal) child.stdout.emit('data', JSON.stringify({ type: 'turn.failed', error: { message: 'Fictional authoritative CLI failure' } }) + '\n');
      const text = gate ? GATE : `<<report-md>>\n${REPORT}\n<</report-md>>\nVERDICT: 4.0/5 — Fictional match.`;
      child.stdout.emit('data', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) + '\n');
      child.stdout.emit('data', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 2 } }) + '\n');
      child.emit('close', 0, null);
    });
    return child;
  };
  state.persist = async args => { state.persisted.push(args); return { ok: true, num: '101', warnings: [] }; };
  globalThis.__knownSourceRoute = state;
  t.after(() => { delete globalThis.__knownSourceRoute; fs.rmSync(root, { recursive: true, force: true }); });
  state.request = () => new Request('http://fixture.invalid/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'evaluate', input: sourcePacket.originalURL, cliId: 'codex', ...(selected?{evaluationSections:['summary']}:{}) }), signal: controller.signal });
  state.controller = controller;
  return state;
}

test('actual POST preloads once before model and preserves original input in prompt and persistence', async t => {
  const f = fixture(t); const durations = [], nativeTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => { durations.push(ms); return nativeTimeout(fn, ms, ...args); };
  t.after(() => { globalThis.setTimeout = nativeTimeout; });
  const response = await POST(f.request()); const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(response.status, 200); assert.deepEqual(f.calls, ['source-start','source-close','model']);
  assert.equal(f.sourceCalls.length, 1); assert.deepEqual(JSON.parse(f.sourceCalls[0].input), { url: ORIGINAL });
  assert.ok(f.prompts[0].endsWith(JSON.stringify({url:ORIGINAL})));
  assert.equal(f.sourceCalls[0].options.cwd,f.codeRoot);
  assert.equal(f.modelOptions.cwd,f.root);
  assert.notEqual(f.codeRoot,f.root);
  assert.ok(f.prompts[0].includes(JSON.stringify({ title: SOURCE.result.title, text: JD })));
  assert.match(f.prompts[0], /UNTRUSTED SOURCE DATA/); assert.match(f.prompts[0], /HTTP 200 alone is not open status/);
  assert.equal(f.persisted.length, 1); assert.equal(f.persisted[0].url, ORIGINAL);
  assert.equal(events.filter(e => e.type === 'done').length, 1); assert.equal(f.tokens, 0);
  assert.ok(durations.includes(killMsForKind('evaluate') - 1234), 'source time is deducted from existing model deadline');
});

test('actual POST source failure is nonfatal and never rewrites the posting URL', async t => {
  const f = fixture(t, { sourceFailure: true });
  const response = await POST(f.request()); await response.text();
  assert.equal(response.status, 200); assert.equal(f.persisted.length, 1); assert.equal(f.persisted[0].url, ORIGINAL);
  assert.match(f.prompts[0], /read was inconclusive/); assert.match(f.prompts[0], /null fetchCallCount/);
  assert.equal(f.tokens, 0);
});

test('actual POST preserves no-report stops and authoritative process errors after prefetch', async t => {
  for (const options of [{ gate: true }, { fatal: true }]) {
    const f = fixture(t, options); const response = await POST(f.request());
    const events = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.equal(f.persisted.length, 0); assert.equal(events.some(e=>e.type==='done'), false);
    assert.equal(events.some(e=>e.type==='error'), true); // main's existing no-report contract is retained
    assert.equal(f.tokens, 0);
  }
});

test('actual POST abort before or during prefetch launches no model and no persistence', async t => {
  for (const during of [false, true]) {
    const f = fixture(t, { abortDuring: during }); if (!during) f.controller.abort();
    const response = await POST(f.request());
    assert.equal(response.status, 499); assert.equal(f.prompts.length, 0); assert.equal(f.persisted.length, 0); assert.equal(f.tokens, 0);
    if (!during) assert.equal(f.sourceCalls.length, 0);
  }
});

test('actual selected POST retains its canonical selected scope and source binding', async t => {
  const f=fixture(t,{selected:true}); const response=await POST(f.request()); await response.text();
  assert.equal(response.status,200); assert.deepEqual(f.calls,['source-start','source-close','model']);
  assert.match(f.prompts[0],/USER-SELECTED EVALUATION SCOPE/); assert.match(f.prompts[0],/Selected optional sections: summary/);
  assert.match(f.prompts[0],/UNTRUSTED SOURCE DATA/); assert.doesNotMatch(f.prompts[0],/EVERY section its report template specifies/);
  assert.equal(f.persisted[0].url,ORIGINAL); assert.deepEqual(f.persisted[0].evaluationSections,['summary']);
  assert.equal(f.sourceCalls[0].options.cwd,f.codeRoot); assert.equal(f.tokens,0);
});


const WORKDAY_ORIGINAL = 'https://fictional.wd1.myworkdayjobs.com/External/job/Remote/Fictional-Manager_R123456';
function workdaySourcePacket(state, value) {
  const packet = JSON.parse(JSON.stringify(SOURCE)); packet.originalURL = packet.result.url = WORKDAY_ORIGINAL;
  packet.result.ats = 'workday'; packet.result.sourceFacts = { type: 'workday-cxs', canApplyState: state,
    jobPostingInfo: { title: packet.result.title, jobReqId: 'R123456', externalPath: '/job/Remote/Renamed-Fictional-Manager_R123456',
      ...(state === 'boolean' ? { canApply: value } : {}) } };
  const api = 'https://fictional.wd1.myworkdayjobs.com/wday/cxs/fictional/External/job/Remote/Fictional-Manager_R123456';
  packet.transport.requests[0].requestURL = packet.transport.requests[0].finalURL = api;
  return packet;
}

test('actual POST carries Workday parsed facts as data while retaining original input and remaining gates', async t => {
  for (const selected of [false, true]) {
    const sourcePacket = workdaySourcePacket('boolean', true);
    const f = fixture(t, { sourcePacket, selected }); const response = await POST(f.request()); await response.text();
    assert.equal(response.status, 200); assert.deepEqual(f.calls, ['source-start', 'source-close', 'model']);
    assert.equal(f.sourceCalls.length, 1); assert.deepEqual(JSON.parse(f.sourceCalls[0].input), { url: WORKDAY_ORIGINAL });
    const observed = f.prompts[0].split('\n').find(line => line.startsWith('{"originalURL":'));
    assert.ok(observed, 'actual prompt contains the source packet');
    assert.deepEqual(JSON.parse(observed).jobData.sourceFacts, sourcePacket.result.sourceFacts);
    assert.match(f.prompts[0], /UNTRUSTED SOURCE DATA/); assert.match(f.prompts[0], /HTTP 200 alone is not open status/);
    assert.ok(f.prompts[0].endsWith(JSON.stringify({ url: WORKDAY_ORIGINAL })));
    assert.equal(f.persisted[0].url, WORKDAY_ORIGINAL); assert.equal(f.tokens, 0);
  }
  for (const [state, value] of [['boolean', false], ['absent', undefined], ['invalid', undefined]]) {
    const sourcePacket = workdaySourcePacket(state, value), f = fixture(t, { sourcePacket, gate: true });
    const response = await POST(f.request()); const events = (await response.text()).trim().split('\n').map(JSON.parse);
    const observed = f.prompts[0].split('\n').find(line => line.startsWith('{"originalURL":'));
    assert.ok(observed, 'actual prompt contains the source packet');
    assert.deepEqual(JSON.parse(observed).jobData.sourceFacts, sourcePacket.result.sourceFacts);
    assert.equal(f.persisted.length, 0); assert.equal(events.some(e => e.type === 'done'), false); assert.equal(f.tokens, 0);
  }
});
