// tests/ollama-eval-endpoint.test.mjs — ollama-eval must call the native
// /api/chat endpoint and send generation params where that endpoint reads them.
//
// The request was POSTed to the OpenAI-compatible /v1/chat/completions route,
// which ignores the `options` object and has no num_ctx equivalent, so NEITHER
// temperature: 0.4 NOR num_ctx: 32768 reached the model — every eval ran at the
// server default temperature and a 2048-token context that silently truncated
// the prompt. This drives the real CLI against a mock Ollama that captures the
// request, asserting the endpoint and the params, and that the native response
// shape ({message:{content}}) is parsed.
import { createServer } from 'http';
import { execFile } from 'child_process';
import { join } from 'path';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

console.log('\nollama-eval.mjs — calls native /api/chat with options (temperature + num_ctx)');

const captured = { path: null, body: null };
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    captured.path = req.url;
    try { captured.body = JSON.parse(raw); } catch { captured.body = null; }
    // Native /api/chat shape (NOT OpenAI choices[]).
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: 'test',
      message: { role: 'assistant', content: 'Evaluation.\nVERDICT: 4/5 — solid fit' },
      done: true,
      prompt_eval_count: 1234,
      eval_count: 56,
    }));
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const done = new Promise((resolve) => {
  execFile(
    NODE,
    [join(ROOT, 'ollama-eval.mjs'), '--url', `http://127.0.0.1:${port}`, '--no-save', 'Some job description text.'],
    { timeout: 30000 },
    (err, stdout, stderr) => resolve({ err, stdout, stderr }),
  );
});
const { stdout, stderr } = await done;
server.close();

if (captured.path === '/api/chat') pass('POSTs to the native /api/chat endpoint');
else fail(`expected /api/chat, got ${captured.path}`);

const opts = captured.body?.options ?? {};
if (opts.num_ctx === 32768) pass('sends options.num_ctx = 32768');
else fail(`options.num_ctx missing/wrong: ${JSON.stringify(opts)}`);
if (opts.temperature === 0.4) pass('sends options.temperature = 0.4');
else fail(`options.temperature missing/wrong: ${JSON.stringify(opts)}`);

if (/VERDICT:\s*4\/5/.test(stdout + stderr)) pass('parses the native {message:{content}} response');
else fail(`native response not parsed. tail: ${(stdout + stderr).trim().split('\n').pop()}`);
