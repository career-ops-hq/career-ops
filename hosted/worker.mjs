import { chromium } from 'playwright';
import { isMainModule } from '../lib/is-main-module.mjs';
import { createEngine } from './engine.mjs';
import { UUID } from './job.mjs';
import { EngineError } from './process.mjs';

export function parseJob(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !UUID.test(value.jobId || '')) throw new EngineError('invalid_job');
  const fields = value.operation === 'evaluate'
    ? ['operation', 'jobId', 'postingText', 'postingUrl']
    : value.operation === 'tailor' ? ['operation', 'jobId', 'evaluationJobId'] : [];
  if (!fields.length || Object.keys(value).some(key => !fields.includes(key))) throw new EngineError('invalid_job');
  if (value.operation === 'evaluate' && (typeof value.postingText !== 'string' || !value.postingText.trim() || Buffer.byteLength(value.postingText) > 200_000 || (value.postingUrl !== undefined && typeof value.postingUrl !== 'string'))) throw new EngineError('invalid_job');
  if (value.operation === 'tailor' && !UUID.test(value.evaluationJobId || '')) throw new EngineError('invalid_job');
  return value;
}

export async function runWorker({ input = process.stdin, env = process.env, write = line => process.stdout.write(line) } = {}) {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of input) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 256_000) throw new EngineError('input_limit');
      chunks.push(Buffer.from(chunk));
    }
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new EngineError('invalid_job'); }
    const { operation, ...job } = parseJob(parsed);
    const engine = createEngine({
      provider: { baseUrl: env.HOSTED_MODEL_BASE_URL, model: env.HOSTED_MODEL, apiKey: env.HOSTED_MODEL_API_KEY },
      engineRevision: env.HOSTED_ENGINE_REVISION,
      timeoutMs: Number(env.HOSTED_TIMEOUT_MS || 120000),
      allowLocalProvider: env.HOSTED_ALLOW_LOCAL_PROVIDER === '1',
      browserExecutable: chromium.executablePath(),
    });
    const result = await engine[operation]({ ...job, workspace: env.HOSTED_WORKSPACE_ROOT || '/workspace', signal: abort.signal });
    write(`${JSON.stringify({ ok: true, result })}\n`);
    return 0;
  } catch (error) {
    write(`${JSON.stringify({ ok: false, error: error instanceof EngineError ? error.code : 'worker_failed' })}\n`);
    return 1;
  } finally {
    process.removeListener('SIGTERM', cancel);
    process.removeListener('SIGINT', cancel);
  }
}

if (isMainModule(import.meta.url)) process.exitCode = await runWorker();
