import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recordedGetFetch, knownJdInput, KNOWN_JD_REQUEST_LIMIT, validateArchiveSourcePacket, validateArchiveSourceBinding } from '../read-known-jd.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ORIGINAL = 'https://jobs.ashbyhq.com/fictional/11111111-1111-4111-8111-111111111111';
const API = 'https://api.ashbyhq.com/posting-api/job-board/fictional';
const JD = 'Own the product roadmap, discovery and delivery. Partner with engineering and customers, define success measures, and validate product decisions against research. '.repeat(8);

test('metadata observer preserves the exact response/options without reading or cloning the body', async () => {
  const records = [], options = { headers: { accept: 'application/json', 'user-agent': 'fictional-client', authorization: 'private-not-recorded', cookie: 'private-not-recorded' }, redirect: 'error', signal: new AbortController().signal };
  const response = { status: 200, url: API, redirected: false,
    get clone() { throw Error('must not clone'); }, get json() { throw Error('must not consume'); }, get text() { throw Error('must not consume'); } };
  const wrapped = recordedGetFetch(async (url, init) => { assert.equal(url, API); assert.equal(init, options); return response; }, records, () => '2026-01-01T00:00:00.000Z');
  assert.equal(await wrapped(API, options), response);
  assert.equal(records.length, 1);
  assert.equal(records[0].httpStatus, 200);
  assert.equal(records[0].finalURL, API);
  assert.equal(records[0].accept, 'application/json');
  assert.equal(records[0].userAgent, 'fictional-client');
  assert.doesNotMatch(JSON.stringify(records), /private-not-recorded|authorization|cookie/);
});

test('metadata observer rejects non-GET before a request and records network failure without inventing status', async () => {
  const records = []; let calls = 0;
  const wrapped = recordedGetFetch(async () => { calls++; throw Error('fictional network failure'); }, records);
  await assert.rejects(wrapped(API, { method: 'POST' }));
  assert.equal(calls, 0); assert.equal(records.length, 0);
  await assert.rejects(wrapped(API));
  assert.equal(calls, 1); assert.equal(records[0].httpStatus, null); assert.equal(records[0].finalURL, null);
});

test('URL boundary preserves the literal URL but rejects userinfo, control characters and non-web inputs', () => {
  assert.equal(knownJdInput(ORIGINAL).originalURL, ORIGINAL);
  for (const input of ['not a URL', 'file:///etc/passwd', 'https://user:password@example.test/job', ORIGINAL + '\n', ' https://example.test/job', 'https://example.test/\u0000']) assert.equal(knownJdInput(input), null);
  for (const url of ['https://linkedin.com/jobs/1', 'https://uk.linkedin.com/jobs/1', 'https://LINKEDIN.COM./jobs/1']) assert.equal(knownJdInput(url).linkedIn, true);
});

function fixture(t, { status = 200, description = JD, isListed = true, url = ORIGINAL, payload } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'known-jd-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = path.join(root, 'fetch-calls.jsonl');
  const preload = path.join(root, 'fetch-preload.mjs');
  const parses = path.join(root, 'body-parses.jsonl');
  const json = payload ?? { jobs: [{ id: ORIGINAL.split('/').at(-1), title: 'Fictional Product Manager', descriptionPlain: description, location: 'Fictional location', workplaceType: 'Remote', employmentType: 'FullTime', isListed }] };
  fs.writeFileSync(preload, `import fs from 'node:fs'; globalThis.fetch=async(url,options)=>{fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({url,headers:Object.fromEntries(new Headers(options?.headers))})+'\\n');return {status:${status},ok:${status >= 200 && status < 300},url:String(url),redirected:false,clone:()=>{throw Error('must not clone')},json:async()=>{fs.appendFileSync(${JSON.stringify(parses)},'parsed\\n');return (${JSON.stringify(json)});}};};`);
  const run = (args = ['--request', '-'], input = JSON.stringify({ url }), script = path.join(ROOT, 'read-known-jd.mjs')) => spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, script, ...args], { cwd: root, input, encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root } });
  const requests = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const bodyParses = () => fs.existsSync(parses) ? fs.readFileSync(parses, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  return { root, run, requests, bodyParses };
}

test('actual isolated CLI delegates native Ashby normalization once and records actual transport separately', t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.originalURL, ORIGINAL); assert.equal(packet.result.url, ORIGINAL);
  assert.equal(packet.result.ats, 'ashby'); assert.equal(packet.result.title, 'Fictional Product Manager');
  assert.ok(packet.result.text.includes(JD.trim()));
  assert.equal(packet.transport.fetchCallCount, 1); assert.equal(f.requests().length, 1);
  assert.equal(packet.transport.requests[0].requestURL, API); assert.equal(packet.transport.requests[0].finalURL, API);
  assert.equal(packet.transport.requests[0].httpStatus, 200);
  assert.equal(packet.transport.requests[0].accept, 'application/json');
  assert.match(packet.transport.requests[0].userAgent, /career-ops\/1\.0/);
  assert.equal(packet.textCap, 20_000); assert.ok(!('open' in packet)); assert.ok(!('isListed' in packet));
});

test('native unlisted marker survives without a fabricated open verdict', t => {
  const f = fixture(t, { isListed: false }), packet = JSON.parse(f.run().stdout);
  assert.match(packet.result.text, /Not currently listed \(isListed: false\)/);
  assert.ok(!('open' in packet)); assert.ok(!('isListed' in packet));
});

test('actual non-200 and any-2xx facts are not rewritten as HTTP200', t => {
  for (const status of [201, 403, 404, 410]) {
    const f = fixture(t, { status }), packet = JSON.parse(f.run().stdout);
    assert.equal(packet.transport.requests[0].httpStatus, status);
    assert.equal(packet.result !== null, status === 201);
  }
});

test('core LinkedIn precedence and unsupported URLs cause zero fetch calls', t => {
  for (const url of ['https://linkedin.com/jobs/1', 'https://UK.LINKEDIN.COM./jobs/1', 'https://example.invalid/job/1']) {
    const f = fixture(t, { url }), packet = JSON.parse(f.run().stdout);
    assert.equal(packet.result, null); assert.equal(packet.transport.fetchCallCount, 0); assert.deepEqual(f.requests(), []);
  }
});

test('request bound is checked before JSON parse; help/import never reads input or fetches', async t => {
  const f = fixture(t);
  assert.equal(f.run(['--request', '-'], ' '.repeat(KNOWN_JD_REQUEST_LIMIT + 1)).status, 2);
  for (const flag of ['--help', '-h']) {
    const run = f.run([flag], '{not json'); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Usage:/);
  }
  assert.equal(f.run(['--help', '--unexpected']).status, 2);
  const before = globalThis.fetch;
  await import(pathToFileURL(path.join(ROOT, 'read-known-jd.mjs')).href + '?import-safe');
  assert.equal(globalThis.fetch, before);
  assert.deepEqual(f.requests(), []);
});

test('CLI invocation through a linked checkout still reads the request', t => {
  const f = fixture(t); const link = path.join(f.root, 'linked');
  try { fs.symlinkSync(ROOT, link, 'junction'); } catch (error) { if (['EPERM','EACCES','ENOSYS'].includes(error.code)) { t.skip('directory links unavailable'); return; } throw error; }
  const result = f.run(['--request', '-'], JSON.stringify({ url: ORIGINAL }), path.join(link, 'read-known-jd.mjs'));
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).result.ats, 'ashby');
});


test('actual isolated Workday CLI carries same-response facts with exactly one fetch and body parse', t => {
  const url = 'https://fictional.wd1.myworkdayjobs.com/External/job/Remote/Fictional-Manager_R123456?source=fixture';
  const externalPath = '/job/Remote/Renamed-Fictional-Manager_R123456';
  for (const [state, value] of [['boolean', true], ['boolean', false], ['absent', undefined], ['invalid', null]]) {
    const info = { title: 'Fictional Manager', jobDescription: `<p>${JD}</p>`, jobReqId: 'R123456', externalPath,
      ...(state !== 'absent' ? { canApply: value } : {}) };
    const f = fixture(t, { url, payload: { jobPostingInfo: info } }), run = f.run();
    assert.equal(run.status, 0, run.stderr); const packet = JSON.parse(run.stdout);
    assert.equal(packet.originalURL, url); assert.equal(packet.result.url, url); assert.equal(packet.result.ats, 'workday');
    assert.equal(packet.result.sourceFacts.canApplyState, state);
    assert.deepEqual(packet.result.sourceFacts.jobPostingInfo, { title: info.title, jobReqId: 'R123456', externalPath,
      ...(state === 'boolean' ? { canApply: value } : {}) });
    assert.equal(packet.transport.fetchCallCount, 1); assert.equal(f.requests().length, 1); assert.equal(f.bodyParses(), 1);
    assert.equal(packet.transport.requests[0].httpStatus, 200); assert.equal('open' in packet, false);
    assert.ok(packet.result.text.includes(JD.trim()));
  }
});

const PUBLISHER = 'https://www.arbeitnow.com/jobs/companies/fictional/fictional-product-manager-123456';
const APPLY = `${PUBLISHER}/apply`;
const DESTINATION = `${ORIGINAL}/application?source=fictional`;
function publisherFixture(t, { href = APPLY, location = DESTINATION, originalStatus = 200, applyStatus = 302, apiStatus = 200, listed = true, extra = false, htmlOverride } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'known-jd-chain-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = path.join(root, 'calls.jsonl'), bodies = path.join(root, 'bodies.jsonl'), preload = path.join(root, 'preload.mjs');
  const html = htmlOverride ?? `<html><a href="${href}">Apply</a>${extra ? `<a href="${APPLY}">Apply again</a>` : ''}</html>`;
  const board = { jobs: [{ id: ORIGINAL.split('/').at(-1), title: 'Fictional Product Manager', descriptionPlain: JD, isListed: listed }] };
  fs.writeFileSync(preload, `import fs from 'node:fs';
    globalThis.fetch=async(url,options)=>{
      const u=String(url);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({url:u,redirect:options?.redirect,headers:Object.fromEntries(new Headers(options?.headers))})+'\\n');
      const publisher=u===${JSON.stringify(PUBLISHER)},apply=u===${JSON.stringify(APPLY)};
      if(!publisher&&!apply&&u!==${JSON.stringify(API)})throw Error('unexpected endpoint');
      const status=publisher?${originalStatus}:apply?${applyStatus}:${apiStatus};
      return {status,ok:status>=200&&status<300,url:u,redirected:false,headers:new Headers(apply?{location:${JSON.stringify(location)}}:{}),clone(){throw Error('clone forbidden')},
        body:publisher?(async function*(){fs.appendFileSync(${JSON.stringify(bodies)},'html\\n');yield Buffer.from(${JSON.stringify(html)});})():apply?(async function*(){fs.appendFileSync(${JSON.stringify(bodies)},'redirect\\n');yield Buffer.from('redirect body');})():null,
        async json(){fs.appendFileSync(${JSON.stringify(bodies)},'json\\n');return ${JSON.stringify(board)};}};
    };`);
  const run = () => spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, path.join(ROOT, 'read-known-jd.mjs'), '--request', '-'],
    { cwd: root, input: JSON.stringify({ url: PUBLISHER }), encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root } });
  const lines = file => fs.existsSync(file) ? fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean) : [];
  return { run, requests: () => lines(calls).map(JSON.parse), bodies: () => lines(bodies) };
}

test('actual publisher CLI uses observed same-posting href and manual302 then native ATS once', t => {
  const f = publisherFixture(t), run = f.run(); assert.equal(run.status,0,run.stderr);
  const packet = JSON.parse(run.stdout), checked = validateArchiveSourcePacket(packet,PUBLISHER);
  assert.equal(checked.ok,true,checked.error); assert.equal(packet.version,2);
  assert.equal(packet.originalURL,PUBLISHER); assert.equal(packet.sourcePostingURL,DESTINATION); assert.equal(packet.result.url,DESTINATION);
  assert.deepEqual(f.requests().map(r=>r.url),[PUBLISHER,APPLY,API]);
  assert.deepEqual(f.requests().slice(0,2).map(r=>r.redirect),['manual','manual']);
  assert.deepEqual(f.bodies(),['html','redirect','json']); assert.equal(packet.transport.fetchCallCount,3);
  assert.equal(packet.transport.requests[1].location,DESTINATION);
  assert.equal(checked.binding.sourcePostingURL,DESTINATION); assert.equal(checked.binding.transport.requests[2].finalURL,API);
  assert.deepEqual(checked.binding.sourceFacts,{type:'ashby-listing',isListedState:'boolean',isListed:true});
  const receipt=validateArchiveSourceBinding(checked.binding,PUBLISHER);
  assert.equal(receipt.ok,true);assert.equal(receipt.apiRequest.finalURL,API);
  assert.equal('open' in checked.binding,false);assert.equal('eligible' in checked.binding,false);
});

test('publisher absence/foreign href and non-known redirect never invent a source route', t => {
  for (const [options, expectedCalls] of [[{href:'https://example.invalid/apply'},1],[{originalStatus:302},1],
    [{location:'https://linkedin.com/jobs/1'},2],[{location:'http://127.0.0.1/job/1'},2],[{applyStatus:301},2]]) {
    const f=publisherFixture(t,options),run=f.run();assert.equal(run.status,0,run.stderr);
    const packet=JSON.parse(run.stdout);assert.equal(packet.result,null);assert.equal(f.requests().length,expectedCalls);
    assert.equal(validateArchiveSourcePacket(packet,PUBLISHER).ok,false);
  }
});

test('source packet and receipt validators reject wrong binding, status, cap and extra requests', t => {
  const f=publisherFixture(t),packet=JSON.parse(f.run().stdout);
  const good=validateArchiveSourcePacket(packet,PUBLISHER);assert.equal(good.ok,true,good.error);
  for(const mutate of [p=>{p.originalURL=PUBLISHER+'-other';},p=>{p.chain.observedApplyHref=APPLY+'/other';},
    p=>{p.transport.requests[1].location=ORIGINAL;},p=>{p.transport.requests[2].httpStatus=201;},
    p=>{p.transport.requests[2].finalURL='https://example.invalid/fake';},p=>{p.result.url=ORIGINAL;},
    p=>{p.result.text+='…';},p=>{p.result.text='x'.repeat(20000);},p=>{p.result.text='Location: Somewhere';},
    p=>{p.transport.requests.push({...p.transport.requests[2]});p.transport.fetchCallCount++;}]) {
    const value=structuredClone(packet);mutate(value);assert.equal(validateArchiveSourcePacket(value,PUBLISHER).ok,false);
  }
  const corrupted=structuredClone(good.binding);corrupted.atsIdentity.parts.jobId='different';
  assert.equal(validateArchiveSourceBinding(corrupted,PUBLISHER).ok,false);
  assert.equal(validateArchiveSourceBinding(good.binding,PUBLISHER+'-other').ok,false);
});

test('only actual structured closure blocks reuse; JD wording cannot invent listed status', t => {
  const f=publisherFixture(t,{listed:false}),closed=JSON.parse(f.run().stdout);
  assert.equal(validateArchiveSourcePacket(closed,PUBLISHER).ok,false);
  const valid=publisherFixture(t),packet=JSON.parse(valid.run().stdout);
  packet.result.text='Applications closed (canApply: false)\n\n'+JD;
  assert.equal(validateArchiveSourcePacket(packet,PUBLISHER).ok,true,'untrusted text is not structured status');
  packet.result.sourceFacts={type:'ashby-listing',isListedState:'absent'};
  const unknown=validateArchiveSourcePacket(packet,PUBLISHER);assert.equal(unknown.ok,true);assert.equal('isListed' in unknown.binding.sourceFacts,false);
  packet.result.sourceFacts={type:'ashby-listing',isListedState:'boolean',isListed:'true'};
  assert.equal(validateArchiveSourcePacket(packet,PUBLISHER).ok,false);
});

test('fixed synchronous loader is import-safe and exposes pure validators without CLI/global changes', t => {
  const f=fixture(t);const run=spawnSync(process.execPath,['-e',`const before=globalThis.fetch;const m=require(${JSON.stringify(path.join(ROOT,'read-known-jd.mjs'))});if(globalThis.fetch!==before||typeof m.validateArchiveSourcePacket!=='function'||typeof m.validateArchiveSourceBinding!=='function')process.exit(1);console.log('import-safe');`],
    {cwd:f.root,input:'not JSON',encoding:'utf8',env:{...process.env,CAREER_OPS_ROOT:f.root,CAREER_OPS_DATA_DIR:f.root}});
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.trim(),'import-safe');assert.deepEqual(f.requests(),[]);
});


test('publisher link extraction ignores data attributes, quoted examples and inert HTML', t => {
  for (const htmlOverride of [`<a data-href="${APPLY}">Not a link</a>`, `<a title="href='${APPLY}'">Not a link</a>`,
    `<!--<a href="${APPLY}">Comment</a>-->`, `<script>const example='<a href="${APPLY}">';</script>`,
    `<a href="${APPLY}" href="https://example.invalid/other">Ambiguous</a>`]) {
    const f=publisherFixture(t,{htmlOverride}),run=f.run();assert.equal(run.status,0,run.stderr);
    assert.equal(JSON.parse(run.stdout).result,null);assert.equal(f.requests().length,1);
  }
  const htmlOverride=`<a href="${APPLY}">One</a><a href="${new URL(APPLY).pathname}">Same observed route</a>`;
  const f=publisherFixture(t,{htmlOverride}),run=f.run();assert.equal(run.status,0,run.stderr);
  assert.equal(validateArchiveSourcePacket(JSON.parse(run.stdout),PUBLISHER).ok,true);assert.equal(f.requests().length,3);
});
