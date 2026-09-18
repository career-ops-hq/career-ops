// tests/ollama-eval.test.mjs — the context window follows OLLAMA_NUM_CTX, and the response
// is read as a stream.
//
// Two defects this locks down:
//
//   #3920  num_ctx and the prompt budget were hardcoded to 32768, so a model with a bigger
//          window could not use it. The A-G prompt overshot the resulting budget on every
//          real JD and left under 4k tokens to generate a report that runs 10-12k.
//
//   #3921  stream:false meant Ollama sent no response headers until generation finished, and
//          undici aborts at its own 300s headersTimeout — a deadline OLLAMA_TIMEOUT_MS does
//          not control. Any run over five minutes died as a bare "fetch failed".
//
// Each case drives the real CLI against a mock Ollama that captures the request and replies
// with newline-delimited JSON, the shape the native /api/chat streaming endpoint produces.
import { createServer } from 'http';
import { execFile } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync, NODE, ROOT } from './helpers.mjs';

console.log('\nollama-eval.mjs — OLLAMA_NUM_CTX drives the window, and the response streams');

/**
 * Run ollama-eval against a mock Ollama and return the captured request.
 *
 * @param {object}   opts
 * @param {object}   opts.env       - Extra environment for the child process.
 * @param {boolean} [opts.trailingNewline=true] - End the NDJSON body with a newline.
 * @param {boolean} [opts.cleanCwd=false] - Run from a temp dir so the repo's .env is not read.
 * @returns {Promise<{body: object|null, stdout: string, stderr: string}>}
 */
async function run({ env = {}, trailingNewline = true, cleanCwd = false }) {
  const captured = { body: null };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { captured.body = JSON.parse(raw); } catch { captured.body = null; }
      // Native /api/chat with stream:true emits one JSON object per line: content chunks
      // with done:false, then a final done:true carrying the token counts.
      const chunks = [
        { model: 'test', message: { role: 'assistant', content: 'Evaluation.\n' }, done: false },
        { model: 'test', message: { role: 'assistant', content: 'VERDICT: 4/5 ' }, done: false },
        { model: 'test', message: { role: 'assistant', content: '— solid fit' }, done: false },
        {
          model: 'test', message: { role: 'assistant', content: '' }, done: true,
          done_reason: 'stop', prompt_eval_count: 1234, eval_count: 56,
        },
      ];
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      const body = chunks.map((c) => JSON.stringify(c)).join('\n');
      res.end(trailingNewline ? `${body}\n` : body);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  // dotenv reads .env from the child's cwd and does not override values already in the
  // environment. A temp cwd is therefore the only way to observe the unset default on a
  // machine whose repo .env sets OLLAMA_NUM_CTX. The script resolves its own modes/ and
  // cv.md from its file location, so it runs correctly from anywhere.
  const cwd = cleanCwd ? mkdtempSync(join(tmpdir(), 'ollama-eval-test-')) : ROOT;
  const childEnv = { ...process.env, ...env };
  if (env.OLLAMA_NUM_CTX === undefined) delete childEnv.OLLAMA_NUM_CTX;

  try {
    const { stdout, stderr } = await new Promise((resolve) => {
      execFile(
        NODE,
        [join(ROOT, 'ollama-eval.mjs'), '--url', `http://127.0.0.1:${port}`, '--no-save',
         'Some job description text.'],
        { timeout: 30000, cwd, env: childEnv },
        (err, out, errOut) => resolve({ stdout: out ?? '', stderr: errOut ?? '' }),
      );
    });
    return { body: captured.body, stdout, stderr };
  } finally {
    server.close();
    if (cleanCwd) rmSync(cwd, { recursive: true, force: true });
  }
}

// --- #3921: the request streams -------------------------------------------------------
const streamed = await run({ env: { OLLAMA_NUM_CTX: '65536' } });

if (streamed.body?.stream === true) pass('sends stream: true, so headers arrive with the first token');
else fail(`expected stream: true, got ${JSON.stringify(streamed.body?.stream)}`);

const all = streamed.stdout + streamed.stderr;
if (/Evaluation\.[\s\S]*VERDICT:\s*4\/5\s*—\s*solid fit/.test(all)) {
  pass('accumulates every NDJSON content chunk in order');
} else {
  fail(`streamed chunks not reassembled. tail: ${all.trim().split('\n').slice(-2).join(' | ')}`);
}

// prompt_eval_count / eval_count arrive on the done:true chunk, not on a single JSON body.
// Had they not been read, the accumulator would still hold 0 and the footer would print
// "(zero-token by design)" for this step instead of the counts.
if (/evaluation:\s+1\.2k prompt \/ 0\.1k completion/.test(all)) {
  pass('reads prompt_eval_count / eval_count off the done:true chunk');
} else {
  fail(`token counts missing from the footer. tail: ${all.trim().split('\n').slice(-4).join(' | ')}`);
}

// --- #3920: the window follows the environment ----------------------------------------
if (streamed.body?.options?.num_ctx === 65536) pass('OLLAMA_NUM_CTX=65536 reaches options.num_ctx');
else fail(`expected num_ctx 65536, got ${JSON.stringify(streamed.body?.options)}`);

const dflt = await run({ env: {}, cleanCwd: true });
if (dflt.body?.options?.num_ctx === 32768) pass('unset OLLAMA_NUM_CTX keeps the 32768 default');
else fail(`expected the 32768 default, got ${JSON.stringify(dflt.body?.options)}`);

// --- regression: a final line with no trailing newline --------------------------------
// The first cut of the streaming parser only flushed on '\n', so a body ending mid-line was
// dropped and the run failed with "Ollama returned an empty response". Ollama terminates
// every chunk with a newline, which is exactly why live runs never surfaced it.
const noNewline = await run({ env: { OLLAMA_NUM_CTX: '32768' }, trailingNewline: false });
const tailAll = noNewline.stdout + noNewline.stderr;
if (/VERDICT:\s*4\/5/.test(tailAll)) pass('flushes a final chunk that has no trailing newline');
else fail(`unterminated final line dropped. tail: ${tailAll.trim().split('\n').slice(-2).join(' | ')}`);
