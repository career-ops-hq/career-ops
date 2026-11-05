import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { readEvaluationSource, evaluationSourceEvidence } from '../../src/lib/evaluation-source.mjs';

const ORIGINAL = 'https://jobs.ashbyhq.com/fictional/11111111-1111-4111-8111-111111111111';
const API = 'https://api.ashbyhq.com/posting-api/job-board/fictional';
const TEXT = 'Location: Fictional location\nWork model: Remote\n\n' + 'Own discovery, delivery and product measurement with engineering and customers. '.repeat(10);
const transport = (status = 200) => ({ fetchCallCount: 1, requests: [{ requestURL: API, method: 'GET', requestedAt: '2026-01-01T00:00:00.000Z', accept: 'application/json', userAgent: 'fictional-client', httpStatus: status, finalURL: API, redirected: false, respondedAt: '2026-01-01T00:00:01.000Z' }] });
const packet = (overrides = {}) => ({ version: 1, originalURL: ORIGINAL, textCap: 20_000, result: { url: ORIGINAL, ats: 'ashby', title: 'Fictional Product Manager', text: TEXT }, transport: transport(), ...overrides });

function childFactory(onInput, { closeOnKill = true } = {}) {
  const calls = [], children = [];
  const spawnFn = (bin, args, options) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.pid = 4321;
    child.stdout.setEncoding = () => {};
    child.stdin = new EventEmitter();
    child.stdin.end = input => { calls.at(-1).input = input; queueMicrotask(() => onInput?.(child, input)); };
    child.kills = [];
    child.kill = signal => { child.kills.push(signal); if (closeOnKill || signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null)); return true; };
    calls.push({ bin, args, options, input: null }); children.push(child); return child;
  };
  return { spawnFn, calls, children };
}

test('packet keeps actual transport separate from untrusted JD and never infers open status', () => {
  const unlisted = packet(); unlisted.result.text = 'Not currently listed (isListed: false)\n' + TEXT;
  const result = evaluationSourceEvidence(unlisted, ORIGINAL);
  assert.equal(result.outcome, 'available'); assert.match(result.jobData.text, /isListed: false/);
  assert.equal(result.transport.requests[0].httpStatus, 200);
  assert.equal('open' in result, false); assert.equal('isListed' in result, false);
  assert.equal(result.originalURL, ORIGINAL);
});

test('HTTP201/403/404/410, missing final URL and empty results remain inconclusive, never closed', () => {
  for (const status of [201, 403, 404, 410]) {
    const result = evaluationSourceEvidence(packet({ transport: transport(status) }), ORIGINAL);
    assert.equal(result.outcome, 'inconclusive'); assert.equal(result.transport.requests[0].httpStatus, status);
    assert.equal('jobData' in result, false); assert.equal('closed' in result, false);
  }
  const missing = packet(); missing.transport.requests[0].finalURL = null;
  assert.equal(evaluationSourceEvidence(missing, ORIGINAL).outcome, 'inconclusive');
  assert.equal(evaluationSourceEvidence(packet({ result: null }), ORIGINAL).outcome, 'inconclusive');
});

test('caps, native ellipsis, thin metadata and JS shells are not injected as substantive JD', () => {
  for (const text of [TEXT + '…', 'x'.repeat(20_000), 'Location: ' + 'Somewhere '.repeat(50), 'You need to enable JavaScript to run this app.', '   ']) {
    const p = packet(); p.result.text = text;
    const result = evaluationSourceEvidence(p, ORIGINAL);
    assert.equal(result.outcome, 'inconclusive'); assert.equal('jobData' in result, false);
  }
});

test('mismatched original URL, inconsistent counts and malformed provenance cannot be trusted', () => {
  assert.equal(evaluationSourceEvidence(packet(), 'https://example.invalid/other'), null);
  for (const mutate of [p => { p.transport.fetchCallCount = 0; }, p => { p.transport.requests[0].method = 'POST'; }, p => { p.transport.requests[0].httpStatus = '200'; }, p => { p.transport.requests[0].requestedAt = 'unknown'; }, p => { p.transport.requests[0].finalURL = 'file:///private'; }]) {
    const p = packet(); mutate(p); assert.equal(evaluationSourceEvidence(p, ORIGINAL), null);
  }
  const wrong = packet(); wrong.result.url = 'https://example.invalid/other';
  assert.equal(evaluationSourceEvidence(wrong, ORIGINAL).outcome, 'inconclusive');
  const extra = packet(); extra.transport.requests[0].authorization = 'secret-never-forwarded';
  assert.doesNotMatch(JSON.stringify(evaluationSourceEvidence(extra, ORIGINAL)), /secret-never-forwarded|authorization/);
});

test('backend runs one fixed Node argv and sends URL only as JSON stdin', async () => {
  const f = childFactory(child => { child.stdout.emit('data', JSON.stringify(packet())); child.emit('close', 0); });
  const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture/root', execPath: '/fixture/node', spawnFn: f.spawnFn });
  assert.equal(result.outcome, 'available'); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args, [path.join('/fixture/root', 'read-known-jd.mjs'), '--request', '-']);
  assert.equal(f.calls[0].options.shell, false); assert.equal(f.calls[0].options.cwd, '/fixture/root');
  assert.deepEqual(JSON.parse(f.calls[0].input), { url: ORIGINAL });
  assert.equal(f.calls[0].args.some(arg => arg === ORIGINAL), false);
  assert.equal(f.children[0].listenerCount('close'), 0);
});

test('shell-looking URL bytes remain literal stdin data and are never shell argv/code', async () => {
  const input = 'https://jobs.ashbyhq.com/fictional/$(touch-owned);`echo-owned`';
  const f = childFactory(child => child.emit('close', 1));
  await readEvaluationSource({ kind: 'evaluate', input, root: '/fixture/root', spawnFn: f.spawnFn });
  assert.equal(f.calls.length, 1); assert.deepEqual(JSON.parse(f.calls[0].input), { url: input });
  assert.ok(!f.calls[0].args.some(x => x.includes('touch-owned'))); assert.equal(f.calls[0].options.shell, false);
});

test('LinkedIn, non-evaluation and invalid input do not even spawn the reader', async () => {
  const f = childFactory();
  for (const [kind, input] of [['pdf', ORIGINAL], ['cover', ORIGINAL], ['research', ORIGINAL], ['evaluate', 'https://UK.LINKEDIN.COM./jobs/1'], ['evaluate', 'https://user:password@example.test/job'], ['evaluate', ORIGINAL + '\n'], ['evaluate', 'pasted job text'], ['evaluate', 'file:///etc/passwd']]) {
    assert.equal((await readEvaluationSource({ kind, input, root: '/fixture', spawnFn: f.spawnFn })).outcome, 'skipped');
  }
  assert.equal(f.calls.length, 0);
});

test('abort before launch spawns nothing; abort during source read waits for child close', async () => {
  const before = new AbortController(); before.abort(); const unused = childFactory();
  assert.equal((await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', signal: before.signal, spawnFn: unused.spawnFn })).outcome, 'aborted');
  assert.equal(unused.calls.length, 0);
  const during = new AbortController(); const f = childFactory(() => during.abort());
  const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', signal: during.signal, spawnFn: f.spawnFn });
  assert.equal(result.outcome, 'aborted'); assert.deepEqual(f.children[0].kills, ['SIGTERM']);
});

test('deadline escalates and waits for close; helper failure does not pretend zero API calls', async () => {
  const f = childFactory(null, { closeOnKill: false });
  const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn: f.spawnFn, timeoutMs: 5, killGraceMs: 5 });
  assert.equal(result.outcome, 'inconclusive'); assert.equal(result.reason, 'timeout');
  assert.deepEqual(f.children[0].kills, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.evidence.transport.fetchCallCount, null);
});

test('packet/stdout/stderr bounds fail before parsing or forwarding oversized data', async () => {
  for (const [stream, chunk, reason] of [['stdout', 'x'.repeat(128 * 1024 + 1), 'output_limit'], ['stderr', 'x'.repeat(4097), 'stderr_limit']]) {
    const f = childFactory(child => child[stream].emit('data', chunk));
    const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn: f.spawnFn });
    assert.equal(result.reason, reason); assert.equal(result.outcome, 'inconclusive'); assert.equal('jobData' in result.evidence, false);
    assert.deepEqual(f.children[0].kills, ['SIGTERM']);
  }
  const f = childFactory(child => { child.stdout.emit('data', '{invalid'); child.emit('close', 0); });
  const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn: f.spawnFn });
  assert.equal(result.reason, 'invalid_packet'); assert.equal(result.evidence.transport.fetchCallCount, null);
});

test('a started-child kill error cannot resolve the read or cancel escalation before close', async () => {
  const f = childFactory(null, { closeOnKill: false });
  const original = f.spawnFn;
  f.spawnFn = (...args) => {
    const child = original(...args);
    child.kill = signal => {
      child.kills.push(signal);
      if (signal === 'SIGTERM') queueMicrotask(() => child.emit('error', Error('fictional kill failure')));
      else queueMicrotask(() => child.emit('close', null));
      return true;
    };
    return child;
  };
  let settled = false;
  const promise = readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn: f.spawnFn, timeoutMs: 5, killGraceMs: 30 }).then(result => { settled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(settled, false, 'SIGTERM error alone is not closure');
  const result = await promise;
  assert.equal(result.reason, 'timeout'); assert.deepEqual(f.children[0].kills, ['SIGTERM', 'SIGKILL']);
});

test('setup/stdin exceptions stop an already-started reader and wait for its close', async () => {
  for (const point of ['setup', 'stdin']) {
    const f = childFactory(null, { closeOnKill: false });
    const spawnFn = (...args) => {
      const child = f.spawnFn(...args);
      if (point === 'setup') child.stdout.setEncoding = () => { throw Error('fixture setup'); };
      else child.stdin.end = () => { throw Error('fixture stdin'); };
      return child;
    };
    let settled = false;
    const pending = readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn, killGraceMs: 1000 }).then(result => { settled = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false); assert.deepEqual(f.children[0].kills, ['SIGTERM']);
    f.children[0].emit('close', null);
    assert.equal((await pending).reason, 'helper_failed');
  }
  const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn: () => { throw Error('no child spawned'); } });
  assert.equal(result.reason, 'helper_failed');
});


const WORKDAY = 'https://fictional.wd1.myworkdayjobs.com/External/job/Remote/Fictional-Manager_R123456';
const WORKDAY_API = 'https://fictional.wd1.myworkdayjobs.com/wday/cxs/fictional/External/job/Remote/Fictional-Manager_R123456';
const WORKDAY_INFO = { title: 'Fictional Manager', jobReqId: 'R123456', externalPath: '/job/Remote/Renamed-Fictional-Manager_R123456' };
function workdayPacket(facts) {
  const p = packet(); p.originalURL = p.result.url = WORKDAY; p.result.ats = 'workday';
  p.transport.requests[0].requestURL = p.transport.requests[0].finalURL = WORKDAY_API;
  if (facts !== undefined) p.result.sourceFacts = facts;
  return p;
}
test('Workday source facts retain actual booleans and distinguish missing/invalid without an open verdict', () => {
  for (const [state, value] of [['boolean', true], ['boolean', false], ['absent', undefined], ['invalid', undefined]]) {
    const info = { ...WORKDAY_INFO, ...(state === 'boolean' ? { canApply: value } : {}) };
    const facts = { type: 'workday-cxs', canApplyState: state, jobPostingInfo: info };
    const result = evaluationSourceEvidence(workdayPacket(facts), WORKDAY);
    assert.deepEqual(result.jobData.sourceFacts, facts); assert.equal(result.outcome, 'available');
    assert.equal(result.originalURL, WORKDAY); assert.equal('open' in result, false);
    assert.equal('canApply' in result, false); assert.equal('eligible' in result, false);
  }
  assert.equal('sourceFacts' in evaluationSourceEvidence(workdayPacket(), WORKDAY).jobData, false, 'old packets remain compatible');
});
test('source facts reject malformed states/fields and whitelist away unrelated vendor data', () => {
  const base = { type: 'workday-cxs', canApplyState: 'boolean', jobPostingInfo: { ...WORKDAY_INFO, canApply: true } };
  const invalid = [null, [], { ...base, type: 'other' }, { ...base, canApplyState: 'true' },
    { ...base, canApplyState: 'absent' }, { ...base, canApplyState: 'invalid' },
    { ...base, jobPostingInfo: { ...WORKDAY_INFO, canApply: 'true' } },
    { ...base, jobPostingInfo: { ...WORKDAY_INFO, title: 'x'.repeat(1001), canApply: true } },
    { ...base, jobPostingInfo: { ...WORKDAY_INFO, externalPath: '/job/\nunsafe', canApply: true } },
    { ...base, jobPostingInfo: [] }];
  for (const facts of invalid) {
    const result = evaluationSourceEvidence(workdayPacket(facts), WORKDAY);
    assert.equal(result.outcome, 'available', 'malformed optional facts do not erase a substantive JD');
    assert.equal('sourceFacts' in result.jobData, false);
  }
  const extra = { ...base, privateExtra: 'fictional-not-forwarded', jobPostingInfo: { ...base.jobPostingInfo, extra: 'fictional-not-forwarded' } };
  assert.deepEqual(evaluationSourceEvidence(workdayPacket(extra), WORKDAY).jobData.sourceFacts, base);
  const otherVendor = packet(); otherVendor.result.sourceFacts = base;
  assert.equal('sourceFacts' in evaluationSourceEvidence(otherVendor, ORIGINAL).jobData, false);
});

function archivalPacket() {
  const originalURL='https://www.arbeitnow.com/jobs/companies/fictional/fictional-product-manager-123456';
  const sourcePostingURL=ORIGINAL+'/application?source=fictional';
  const requests=[{...transport().requests[0],requestURL:originalURL,finalURL:originalURL,httpStatus:200,location:null},
    {...transport().requests[0],requestURL:originalURL+'/apply',finalURL:originalURL+'/apply',httpStatus:302,location:sourcePostingURL},
    {...transport().requests[0],location:null}];
  return {version:2,originalURL,sourcePostingURL,textCap:20000,result:{url:sourcePostingURL,ats:'ashby',title:'Fictional Product Manager',text:TEXT,
    sourceFacts:{type:'ashby-listing',isListedState:'boolean',isListed:true}},transport:{fetchCallCount:3,requests},
    chain:{kind:'arbeitnow-apply-redirect',publisherRequestIndex:0,applyRequestIndex:1,apiRequestIndex:2,observedApplyHref:originalURL+'/apply',redirectLocation:sourcePostingURL}};
}

test('complete native v2 is held privately with original/source URLs distinct and no eligibility verdict', async () => {
  const p=archivalPacket();p.requestArchiveSource={forged:true};
  const f=childFactory(child=>{child.stdout.emit('data',JSON.stringify(p));child.emit('close',0);});
  const result=await readEvaluationSource({kind:'evaluate',input:p.originalURL,root:'/fixture',spawnFn:f.spawnFn});
  assert.equal(result.outcome,'available');assert.equal(result.evidence.originalURL,p.originalURL);
  assert.equal(result.evidence.sourcePostingURL,p.sourcePostingURL);assert.equal(result.evidence.transport.requests[1].location,p.sourcePostingURL);
  assert.deepEqual(result.evidence.jobData.sourceFacts,p.result.sourceFacts);
  assert.equal('archiveSource' in result.evidence,false);assert.equal('open' in result.evidence,false);
  assert.equal('requestArchiveSource' in result.archiveSource,false);
  assert.equal(result.archiveSource.result.url,p.sourcePostingURL);
  const {validateArchiveSourcePacket}=await import('../../../read-known-jd.mjs');
  const validated=validateArchiveSourcePacket(result.archiveSource,p.originalURL);assert.equal(validated.ok,true,validated.error);
  assert.equal(validated.binding.sourcePostingURL,p.sourcePostingURL);
});

test('legacy evidence remains supported without fabricating a reusable archive packet', async () => {
  const f=childFactory(child=>{child.stdout.emit('data',JSON.stringify(packet()));child.emit('close',0);});
  const result=await readEvaluationSource({kind:'evaluate',input:ORIGINAL,root:'/fixture',spawnFn:f.spawnFn});
  assert.equal(result.outcome,'available');assert.equal(result.archiveSource,undefined);
  const p=archivalPacket();p.result.text+='…';
  const capped=childFactory(child=>{child.stdout.emit('data',JSON.stringify(p));child.emit('close',0);});
  const missing=await readEvaluationSource({kind:'evaluate',input:p.originalURL,root:'/fixture',spawnFn:capped.spawnFn});
  assert.equal(missing.outcome,'inconclusive');assert.equal(missing.archiveSource,undefined);
});

test('actual Ashby bool and unknown status survive as untrusted data, never JD-word inference', () => {
  for(const facts of [{type:'ashby-listing',isListedState:'boolean',isListed:false},{type:'ashby-listing',isListedState:'absent'},{type:'ashby-listing',isListedState:'invalid'}]) {
    const p=archivalPacket();p.result.sourceFacts=facts;
    const evidence=evaluationSourceEvidence(p,p.originalURL);assert.deepEqual(evidence.jobData.sourceFacts,facts);
    assert.equal('open' in evidence,false);assert.equal('listed' in evidence,false);
  }
});

// Compare the real core archive validator with the web evidence validator.
// These have different jobs: core rejects closed/malformed archive evidence;
// web retains a readable JD and sanitizes optional facts for the model to review.
function parityPacket(ats, facts, text = TEXT) {
  const p = ats === 'workday' ? workdayPacket(facts) : packet();
  p.version = 2; p.sourcePostingURL = p.originalURL; p.result.text = text;
  p.chain = { kind: 'direct-known-ats', apiRequestIndex: 0 };
  p.transport.requests[0].location = null;
  if (facts !== undefined) p.result.sourceFacts = facts;
  return p;
}

test('core/web parity: shared Workday and Ashby fact states and field bounds', async () => {
  const { validateArchiveSourcePacket } = await import('../../../read-known-jd.mjs');
  const workday = info => ({ type: 'workday-cxs', canApplyState: 'boolean', jobPostingInfo: { canApply: true, ...info } });
  const cases = [
    ['workday', workday(WORKDAY_INFO), true],
    ...['absent', 'invalid'].map(state => ['workday', { type: 'workday-cxs', canApplyState: state, jobPostingInfo: {} }, true]),
    ['ashby', { type: 'ashby-listing', isListedState: 'boolean', isListed: true }, true],
    ...['absent', 'invalid'].map(state => ['ashby', { type: 'ashby-listing', isListedState: state }, true]),
    ['workday', { type: 'workday-cxs', canApplyState: 'boolean', jobPostingInfo: { canApply: 'true' } }, false],
    ['ashby', { type: 'ashby-listing', isListedState: 'boolean', isListed: 'true' }, false],
    ['ashby', { type: 'ashby-listing', isListedState: 'absent', isListed: true }, false],
  ];
  for (const [field, max] of [['title', 1000], ['jobReqId', 300], ['externalPath', 2048]]) {
    for (const [value, accepted] of [['x'.repeat(max), true], ['x'.repeat(max + 1), false], ['', false], ['x\nunsafe', false]]) {
      cases.push(['workday', workday({ [field]: value }), accepted]);
    }
  }
  for (const [ats, facts, accepted] of cases) {
    const p = parityPacket(ats, facts);
    const core = validateArchiveSourcePacket(p, p.originalURL);
    const web = evaluationSourceEvidence(p, p.originalURL);
    assert.equal(core.ok, accepted, `${ats}: core fact acceptance`);
    assert.equal(web.outcome, 'available', 'invalid optional facts do not erase the readable JD');
    assert.equal(Object.hasOwn(web.jobData, 'sourceFacts'), accepted, `${ats}: web fact acceptance`);
    if (accepted) assert.deepEqual(web.jobData.sourceFacts, core.binding.sourceFacts);
  }
});

test('core/web parity: substantive JD and text-cap boundaries exclude metadata-only content', async () => {
  const { validateArchiveSourcePacket } = await import('../../../read-known-jd.mjs');
  for (const [text, accepted] of [
    ['x'.repeat(199), false], ['x'.repeat(200), true],
    ['Location: Fictional\nWork model: Remote\n\n' + 'x'.repeat(199), false],
    ['Location: Fictional\nWork model: Remote\n\n' + 'x'.repeat(200), true],
    ['Location: ' + 'Fictional '.repeat(40), false],
    ['x'.repeat(19_999), true], ['x'.repeat(20_000), false], [TEXT + '…', false],
  ]) {
    const p = parityPacket('ashby', undefined, text);
    const core = validateArchiveSourcePacket(p, p.originalURL);
    const web = evaluationSourceEvidence(p, p.originalURL);
    assert.equal(core.ok, accepted, `core text length ${text.length}`);
    assert.equal(web.outcome, accepted ? 'available' : 'inconclusive', `web text length ${text.length}`);
  }
});

test('core/web intentional differences: closed facts remain data; extra fields are sanitized', async () => {
  const { validateArchiveSourcePacket } = await import('../../../read-known-jd.mjs');
  for (const [ats, facts] of [
    ['workday', { type: 'workday-cxs', canApplyState: 'boolean', jobPostingInfo: { canApply: false } }],
    ['ashby', { type: 'ashby-listing', isListedState: 'boolean', isListed: false }],
  ]) {
    const p = parityPacket(ats, facts);
    assert.equal(validateArchiveSourcePacket(p, p.originalURL).ok, false, 'closed evidence cannot authorize an archive');
    const web = evaluationSourceEvidence(p, p.originalURL);
    assert.equal(web.outcome, 'available'); assert.deepEqual(web.jobData.sourceFacts, facts);
    assert.equal('open' in web, false); assert.equal('eligible' in web, false);
  }
  for (const [ats, clean] of [
    ['workday', { type: 'workday-cxs', canApplyState: 'boolean', jobPostingInfo: { canApply: true } }],
    ['ashby', { type: 'ashby-listing', isListedState: 'boolean', isListed: true }],
  ]) {
    const extra = { ...clean, unrelated: 'fictional-not-forwarded', ...(ats === 'workday' ? { jobPostingInfo: { ...clean.jobPostingInfo, unrelated: 'fictional-not-forwarded' } } : {}) };
    const p = parityPacket(ats, extra);
    assert.equal(validateArchiveSourcePacket(p, p.originalURL).ok, false, 'core packets have an exact field schema');
    assert.deepEqual(evaluationSourceEvidence(p, p.originalURL).jobData.sourceFacts, clean, 'web emits only whitelisted facts');
  }
  // The actual native status heading is evidence, not substantive JD content.
  // Its isListed colon also matches core metadata, so both measure only the JD.
  for (const [bodyLength, accepted] of [[199, false], [200, true]]) {
    const p = parityPacket('ashby', undefined, 'Not currently listed (isListed: false)\nLocation: Fictional\n\n' + 'x'.repeat(bodyLength));
    assert.equal(validateArchiveSourcePacket(p, p.originalURL).ok, accepted);
    assert.equal(evaluationSourceEvidence(p, p.originalURL).outcome, accepted ? 'available' : 'inconclusive');
  }
});
