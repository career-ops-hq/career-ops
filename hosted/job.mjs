import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { detectColumns } from '../tracker-parse.mjs';
import { runProcess, EngineError } from './process.mjs';

export const CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SOURCES = ['cv.md', 'config/profile.yml', 'config/cv-facts.json', 'modes/_profile.md', 'modes/_custom.md', 'article-digest.md', 'voice-dna.md'];
export const sha = value => createHash('sha256').update(value).digest('hex');

export async function exists(p) {
  try { await fs.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

export function contained(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')) throw new EngineError('invalid_artifact_path');
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new EngineError('invalid_artifact_path');
  return resolved;
}

// A layout check, not OS isolation. Only call in a trusted supervisor/container.
async function preflight(workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new EngineError('invalid_workspace');
  const root = await fs.realpath(workspace);
  const relative = path.relative(CODE, root);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new EngineError('workspace_inside_engine');
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new EngineError('workspace_symlink');
      if (item.name === '.env' || item.name.startsWith('.env.') || ['.career-ops-data', 'plugins.local', 'opencode.json'].includes(item.name)) throw new EngineError('workspace_configuration_forbidden');
      if (item.isDirectory()) await walk(path.join(dir, item.name));
    }
  }
  await walk(root);
  if (await exists(path.join(CODE, '.env'))) throw new EngineError('engine_dotenv_forbidden');
  if (!(await fs.readFile(path.join(root, 'cv.md'), 'utf8')).trim()) throw new EngineError('cv_required');
  if (!(await exists(path.join(root, 'data', 'applications.md')))) throw new EngineError('tracker_required');
  if (!detectColumns((await fs.readFile(path.join(root, 'data', 'applications.md'), 'utf8')).split(/\r?\n/))) throw new EngineError('invalid_tracker');
  return root;
}

export async function childEnv(root, home, provider) {
  await fs.mkdir(home, { recursive: true });
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'LANG', 'TZ']) if (process.env[name]) env[name] = process.env[name];
  return Object.assign(env, {
    HOME: home, USERPROFILE: home, TMP: home, TEMP: home, TMPDIR: home,
    APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home,
    CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: CODE,
    CAREER_OPS_PROFILE: path.join(root, 'config', 'profile.yml'),
    CAREER_OPS_TRACKER: path.join(root, 'data', 'applications.md'),
    CAREER_OPS_ADDITIONS: path.join(root, 'batch', 'tracker-additions'),
    OPENAI_BASE_URL: provider.baseUrl, OPENAI_MODEL: provider.model, OPENAI_API_KEY: provider.apiKey,
    CAREER_OPS_MAX_TOKENS: '8192', OPENAI_TIMEOUT_MS: '90000', CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '10000',
  });
}

export function providerConfig(provider, allowLocalProvider) {
  if (!provider || typeof provider.model !== 'string' || !provider.model.trim()) throw new EngineError('model_required');
  let url;
  try { url = new URL(provider.baseUrl); } catch { throw new EngineError('invalid_provider'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(allowLocalProvider && local && url.protocol === 'http:'))) throw new EngineError('invalid_provider');
  if (!local && (typeof provider.apiKey !== 'string' || !provider.apiKey)) throw new EngineError('api_key_required');
  return { baseUrl: url.href.replace(/\/$/, ''), model: provider.model, apiKey: provider.apiKey || '' };
}

export async function verifiedReceipt(root, jobId) {
  if (!UUID.test(jobId || '')) throw new EngineError('invalid_job_id');
  const receipt = path.join(root, '.hosted', jobId, 'result.json');
  if (!(await exists(receipt))) throw new EngineError('evaluation_not_found');
  const saved = JSON.parse(await fs.readFile(receipt, 'utf8'));
  if (saved.schema !== 2 || !Array.isArray(saved.artifacts)) throw new EngineError('job_needs_recovery');
  for (const artifact of saved.artifacts) {
    const target = contained(root, artifact.path);
    if (!(await exists(target)) || sha(await fs.readFile(target)) !== artifact.sha256) throw new EngineError('artifact_changed');
  }
  return saved;
}

// One local lock, deadline and receipt implementation for every operation.
// Durable fencing and atomic snapshot publication still belong to the supervisor.
export async function withJob({ workspace, jobId, operation, input, config, signal }, task) {
  try {
    if (!UUID.test(jobId || '')) throw new EngineError('invalid_job_id');
    if (signal?.aborted) throw new EngineError('cancelled');
    const root = await preflight(workspace);
    const state = path.join(root, '.hosted');
    await fs.mkdir(state, { recursive: true });
    const lock = path.join(state, 'mutation.lock');
    try { await fs.mkdir(lock); } catch (e) { if (e.code === 'EEXIST') throw new EngineError('workspace_busy'); throw e; }
    try {
      const sources = {};
      for (const file of SOURCES) sources[file] = await exists(path.join(root, file)) ? await fs.readFile(path.join(root, file), 'utf8') : null;
      const contextHash = sha(JSON.stringify(sources));
      const version = JSON.parse(await fs.readFile(path.join(CODE, 'package.json'), 'utf8')).version;
      const fingerprint = sha(JSON.stringify({ schema: 2, operation, input, contextHash, version, engineRevision: config.engineRevision, model: config.provider.model, endpoint: config.provider.baseUrl }));
      const dir = path.join(state, jobId), receipt = path.join(dir, 'result.json');
      if (await exists(receipt)) {
        const saved = await verifiedReceipt(root, jobId);
        if (saved.fingerprint !== fingerprint) throw new EngineError('idempotency_conflict');
        return { ...saved.result, replayed: true };
      }
      if (await exists(dir)) throw new EngineError('job_needs_recovery');
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'input.json'), JSON.stringify({ fingerprint, operation }), { flag: 'wx' });
      const env = await childEnv(root, path.join(dir, 'home'), config.provider);
      const deadline = Date.now() + config.timeoutMs;
      const run = async (script, args, { runRoot = root, runEnv = env, failureCode } = {}) => {
        if (Date.now() >= deadline) throw new EngineError('timed_out');
        try {
          return await runProcess({ script: path.join(CODE, script), args, cwd: runRoot, env: runEnv, signal, timeoutMs: deadline - Date.now() });
        } catch (error) {
          if (failureCode && error.code === 'engine_failed') throw new EngineError(failureCode);
          throw error;
        }
      };
      const { result, artifactPaths } = await task({ root, dir, env, run, sources, contextHash });
      if (signal?.aborted) throw new EngineError('cancelled');
      const artifacts = [];
      for (const relative of artifactPaths) artifacts.push({ path: relative, sha256: sha(await fs.readFile(contained(root, relative))) });
      const complete = { ...result, jobId, engineVersion: version, engineRevision: config.engineRevision, model: config.provider.model, replayed: false };
      // Rename prevents a partially written JSON file being mistaken for success.
      const temporary = path.join(dir, 'result.pending.json');
      await fs.writeFile(temporary, JSON.stringify({ schema: 2, operation, fingerprint, contextHash, artifacts, result: complete }), { flag: 'wx' });
      await fs.rename(temporary, receipt);
      return complete;
    } finally { await fs.rmdir(lock); }
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError('workspace_io_failed');
  }
}
