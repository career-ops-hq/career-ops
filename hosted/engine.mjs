import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runProcess, EngineError } from './process.mjs';
import { parseScoreSummary, normalizedTrackerScore } from '../lib/tracker-addition.mjs';
import { detectColumns, resolveColumns, parseTrackerRow, parseMarkdownLinks } from '../tracker-parse.mjs';

const CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = value => createHash('sha256').update(value).digest('hex');

async function exists(p) {
  try { await fs.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

// This validates filesystem layout, not OS isolation. Only use in a trusted
// supervisor or a container whose only writable mount is this private workspace.
async function preflight(workspace) {
  if (!path.isAbsolute(workspace)) throw new EngineError('invalid_workspace');
  const root = await fs.realpath(workspace);
  const relative = path.relative(CODE, root);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new EngineError('workspace_inside_engine');
  }
  // No workspace symlinks, executable configuration or dotenv overrides.
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new EngineError('workspace_symlink');
      if (item.name === '.env' || item.name.startsWith('.env.') ||
          ['.career-ops-data', 'plugins.local', 'opencode.json'].includes(item.name)) {
        throw new EngineError('workspace_configuration_forbidden');
      }
      if (item.isDirectory()) await walk(path.join(dir, item.name));
    }
  }
  await walk(root);
  if (await exists(path.join(CODE, '.env'))) throw new EngineError('engine_dotenv_forbidden');
  if (!(await fs.readFile(path.join(root, 'cv.md'), 'utf8')).trim()) throw new EngineError('cv_required');
  if (!(await exists(path.join(root, 'data', 'applications.md')))) throw new EngineError('tracker_required');
  const tracker = await fs.readFile(path.join(root, 'data', 'applications.md'), 'utf8');
  if (!detectColumns(tracker.split(/\r?\n/))) throw new EngineError('invalid_tracker');
  return root;
}

function providerConfig(provider, allowLocalProvider) {
  if (!provider || typeof provider.model !== 'string' || !provider.model.trim()) throw new EngineError('model_required');
  let url;
  try { url = new URL(provider.baseUrl); } catch { throw new EngineError('invalid_provider'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(allowLocalProvider && local && url.protocol === 'http:'))) {
    throw new EngineError('invalid_provider');
  }
  if (!local && (typeof provider.apiKey !== 'string' || !provider.apiKey)) throw new EngineError('api_key_required');
  return { baseUrl: url.href.replace(/\/$/, ''), model: provider.model, apiKey: provider.apiKey || '' };
}

async function childEnv(root, home, provider) {
  await fs.mkdir(home, { recursive: true });
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'LANG', 'TZ']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return Object.assign(env, {
    HOME: home, USERPROFILE: home, TMP: home, TEMP: home, TMPDIR: home,
    APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home,
    CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: CODE,
    CAREER_OPS_PROFILE: path.join(root, 'config', 'profile.yml'),
    CAREER_OPS_TRACKER: path.join(root, 'data', 'applications.md'),
    CAREER_OPS_ADDITIONS: path.join(root, 'batch', 'tracker-additions'),
    OPENAI_BASE_URL: provider.baseUrl, OPENAI_MODEL: provider.model,
    OPENAI_API_KEY: provider.apiKey, CAREER_OPS_MAX_TOKENS: '8192',
    OPENAI_TIMEOUT_MS: '90000', CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '10000',
  });
}

async function readRows(root) {
  const lines = (await fs.readFile(path.join(root, 'data', 'applications.md'), 'utf8')).split(/\r?\n/);
  const columns = resolveColumns(lines);
  return lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
}

/** Trusted worker API: workspace and provider come from the supervisor, not HTTP input. */
export function createEngine({ provider, engineRevision, allowLocalProvider = false, timeoutMs = 120_000 } = {}) {
  if (!/^[0-9a-f]{40}$/.test(engineRevision || '')) throw new EngineError('engine_revision_required');
  const configured = providerConfig(provider, allowLocalProvider);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000) throw new EngineError('invalid_timeout');

  return {
    async evaluate({ workspace, jobId, postingText, postingUrl = '', signal }) {
      try {
      if (!UUID.test(jobId || '')) throw new EngineError('invalid_job_id');
      if (typeof postingText !== 'string' || !postingText.trim() || Buffer.byteLength(postingText) > 200_000) {
        throw new EngineError('invalid_posting');
      }
      if (postingUrl) {
        let url;
        try { url = new URL(postingUrl); } catch { throw new EngineError('invalid_posting_url'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /[\r\n\t]/.test(postingUrl)) {
          throw new EngineError('invalid_posting_url');
        }
      }
      if (signal?.aborted) throw new EngineError('cancelled');
      const root = await preflight(workspace);
      const state = path.join(root, '.hosted');
      await fs.mkdir(state, { recursive: true });
      const lock = path.join(state, 'mutation.lock');
      try { await fs.mkdir(lock); } catch (e) {
        if (e.code === 'EEXIST') throw new EngineError('workspace_busy'); throw e;
      }
      try {
        const profile = {};
        for (const file of ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'modes/_custom.md']) {
          profile[file] = await exists(path.join(root, file)) ? await fs.readFile(path.join(root, file), 'utf8') : null;
        }
        const version = JSON.parse(await fs.readFile(path.join(CODE, 'package.json'), 'utf8')).version;
        const fingerprint = sha(JSON.stringify({ postingText, postingUrl, profile, version, engineRevision, model: configured.model, endpoint: configured.baseUrl }));
        const jobDir = path.join(state, jobId);
        const receipt = path.join(jobDir, 'result.json');
        if (await exists(receipt)) {
          const saved = JSON.parse(await fs.readFile(receipt, 'utf8'));
          if (saved.fingerprint !== fingerprint) throw new EngineError('idempotency_conflict');
          await fs.access(path.join(root, saved.result.report));
          return { ...saved.result, replayed: true };
        }
        // A partial run may already have incurred model cost or written files.
        // Fail closed; recovery belongs to the durable supervisor, not blind retry.
        if (await exists(jobDir)) throw new EngineError('job_needs_recovery');
        await fs.mkdir(jobDir);
        await fs.writeFile(path.join(jobDir, 'input.json'), JSON.stringify({ fingerprint }), { flag: 'wx' });
        const home = path.join(jobDir, 'home');
        const env = await childEnv(root, home, configured);
        const jd = path.join(jobDir, 'posting.txt');
        await fs.writeFile(jd, postingText, { flag: 'wx' });
        const additionsDir = env.CAREER_OPS_ADDITIONS;
        await fs.mkdir(additionsDir, { recursive: true });
        if ((await fs.readdir(additionsDir)).some(f => f.endsWith('.tsv'))) throw new EngineError('pending_tracker_additions');
        const reportsDir = path.join(root, 'reports');
        await fs.mkdir(reportsDir, { recursive: true });
        const before = new Set(await fs.readdir(reportsDir));
        const deadline = Date.now() + timeoutMs;
        const run = (script, args) => {
          if (Date.now() >= deadline) throw new EngineError('timed_out');
          return runProcess({ script: path.join(CODE, script), args, cwd: root, env, signal, timeoutMs: deadline - Date.now() });
        };
        const args = ['--file', jd, ...(postingUrl ? ['--posting-url', postingUrl] : [])];
        const evaluated = await run('openai-eval.mjs', args);
        const summary = parseScoreSummary(evaluated.stdout);
        if (!summary?.company || !summary.role || summary.company.toLowerCase() === 'unknown' ||
            summary.role.toLowerCase() === 'unknown' || normalizedTrackerScore(summary.score) === 'N/A') {
          throw new EngineError('invalid_evaluation');
        }
        const created = (await fs.readdir(reportsDir)).filter(f => !before.has(f) && /^\d+-[a-z0-9-]+\.md$/.test(f));
        if (created.length !== 1) throw new EngineError('report_not_created');
        const report = path.join('reports', created[0]);
        await run('merge-tracker.mjs', []);
        const row = (await readRows(root)).find(row => parseMarkdownLinks(row.report)
          .some(link => path.resolve(root, 'data', link.target) === path.join(root, report)));
        if (!row) throw new EngineError('tracker_not_merged');
        const result = {
          jobId, report: report.split(path.sep).join('/'), reportNumber: row.num,
          company: row.company, role: row.role, score: row.score,
          engineVersion: version, engineRevision, model: configured.model, replayed: false,
          scope: 'pasted-text evaluation; no live posting or company research',
        };
        await fs.writeFile(receipt, JSON.stringify({ fingerprint, result }), { flag: 'wx' });
        return result;
      } finally { await fs.rmdir(lock); }
      } catch (error) {
        if (error instanceof EngineError) throw error;
        throw new EngineError('workspace_io_failed');
      }
    },
  };
}
