// Optional integration check: npm --prefix hosted run test:container.
// Requires a locally built worker image, Docker, and a sandbox-compatible host.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { candidate, cvHtml } from './fixtures.mjs';

const image = process.env.HOSTED_TEST_IMAGE || 'hosted-career-worker:local';
const name = `hosted-cv-smoke-${randomUUID()}`;
const cleanups = [];
const t = { after(fn) { cleanups.push(fn); } };

function docker(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Docker test failed (${code}): ${stderr.trim()} ${stdout.trim()}`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const limits = ['--init', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=1g', '--cpus=1', '--shm-size=256m', '--tmpfs=/tmp:rw,nosuid,noexec,size=128m'];
// Native Linux bind mounts preserve the host UID. Match that non-root UID
// rather than making private fixture directories world-writable for Docker.
if (typeof process.getuid === 'function') {
  if (process.getuid() === 0) throw new Error('Run the container smoke test from a non-root host account');
  limits.push(`--user=${process.getuid()}:${process.getgid()}`);
}
const seccomp = process.env.HOSTED_TEST_SECCOMP;
if (seccomp) limits.push(`--security-opt=seccomp=${path.resolve(seccomp)}`);

try {
  const identity = JSON.parse(await docker(['run', '--rm', '--network=none', ...limits, '--entrypoint=node', image, '-e', 'console.log(JSON.stringify({uid:process.getuid(),revision:process.env.HOSTED_ENGINE_REVISION}))']));
  assert.notEqual(identity.uid, 0);
  assert.match(identity.revision, /^[0-9a-f]{40}$/);
  await docker(['network', 'create', '--internal', name]);
  cleanups.push(() => docker(['network', 'rm', name]));
  const htmlFunction = cvHtml.toString();
  const serverCode = `const http=require('node:http');const html=${htmlFunction};http.createServer(async(req,res)=>{if(req.url==='/health'){res.end('ready');return;}let body='';for await(const chunk of req)body+=chunk;const job=JSON.parse(body);if(!job.stream){const name=JSON.stringify(job.messages).includes('Synthetic Beta')?'Synthetic Beta':'Synthetic Alpha';res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:html(name)},finish_reason:'stop'}]}));return;}const text='Synthetic evaluation.\\n---SCORE_SUMMARY---\\nCOMPANY: Example Employer\\nROLE: Software Engineer\\nSCORE: 4.1\\nARCHETYPE: Engineering\\nLEGITIMACY: Proceed with Caution\\n---END_SUMMARY---'.replaceAll('\\\\n','\\n');res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\\n\\ndata: [DONE]\\n\\n');}).listen(9000,'0.0.0.0');`;
  await docker(['run', '-d', '--name', name, '--network', name, ...limits, '--entrypoint=node', image, '-e', serverCode]);
  cleanups.push(() => docker(['rm', '-f', name]));
  await docker(['exec', name, 'node', '-e', "(async()=>{for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:9000/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}process.exitCode=1;})()"]).catch(error => { throw new Error(`Mock model failed to start: ${error.message}`); });
  const roots = [await candidate(t), await candidate(t, 'Synthetic Beta')];
  const run = async (root, job) => {
    const output = await docker(['run', '--rm', '-i', `--network=container:${name}`, ...limits,
      '--mount', `type=bind,source=${root},target=/workspace`,
      '--env=HOSTED_MODEL_BASE_URL=http://127.0.0.1:9000/v1', '--env=HOSTED_MODEL=synthetic-fixture-model', '--env=HOSTED_ALLOW_LOCAL_PROVIDER=1',
      image], JSON.stringify(job));
    const envelope = JSON.parse(output);
    assert.equal(envelope.ok, true);
    return envelope.result;
  };
  const outcomes = await Promise.allSettled(roots.map(async root => {
    const evaluation = await run(root, { operation: 'evaluate', jobId: randomUUID(), postingText: 'Example Employer needs a Python engineer.' });
    const cv = await run(root, { operation: 'tailor', jobId: randomUUID(), evaluationJobId: evaluation.jobId });
    assert.equal(cv.pages, 1);
    assert.equal((await fs.readFile(path.join(root, cv.pdf))).subarray(0, 5).toString(), '%PDF-');
    return { evaluation: evaluation.jobId, tailoring: cv.jobId, pages: cv.pages };
  }));
  for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  console.log(JSON.stringify({ ok: true, image, uid: identity.uid, engineRevision: identity.revision, tenants: outcomes.map(o => o.value) }, null, 2));
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
}
