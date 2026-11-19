import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseScoreSummary, normalizedTrackerScore } from '../lib/tracker-addition.mjs';
import { resolveColumns, parseTrackerRow, parseMarkdownLinks } from '../tracker-parse.mjs';
import { loadYaml } from '../lib/yaml-document.mjs';
import { EngineError } from './process.mjs';
import { UUID, contained, exists, sha, childEnv, providerConfig, verifiedReceipt, withJob } from './job.mjs';

async function readRows(root) {
  const lines = (await fs.readFile(path.join(root, 'data', 'applications.md'), 'utf8')).split(/\r?\n/);
  return lines.map(line => parseTrackerRow(line, resolveColumns(lines))).filter(Boolean);
}

function postingInput(postingText, postingUrl) {
  if (typeof postingText !== 'string' || !postingText.trim() || Buffer.byteLength(postingText) > 200_000) throw new EngineError('invalid_posting');
  if (typeof postingUrl !== 'string') throw new EngineError('invalid_posting_url');
  if (postingUrl) {
    let url;
    try { url = new URL(postingUrl); } catch { throw new EngineError('invalid_posting_url'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\r\n\t]/.test(postingUrl)) throw new EngineError('invalid_posting_url');
  }
}

/** Trusted worker API. All configuration/workspace paths are supervisor-owned. */
export function createEngine({ provider, engineRevision, browserExecutable, allowLocalProvider = false, timeoutMs = 120_000 } = {}) {
  if (!/^[0-9a-f]{40}$/.test(engineRevision || '')) throw new EngineError('engine_revision_required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000) throw new EngineError('invalid_timeout');
  if (browserExecutable != null && (typeof browserExecutable !== 'string' || !path.isAbsolute(browserExecutable))) throw new EngineError('invalid_browser_executable');
  const config = { provider: providerConfig(provider, allowLocalProvider), engineRevision, timeoutMs };
  return {
    async evaluate({ workspace, jobId, postingText, postingUrl = '', signal }) {
      if (!UUID.test(jobId || '')) throw new EngineError('invalid_job_id');
      postingInput(postingText, postingUrl);
      return withJob({ workspace, jobId, operation: 'evaluate', input: { postingText, postingUrl }, config, signal }, async ({ root, dir, env, run }) => {
        const jd = path.join(dir, 'posting.txt');
        await fs.writeFile(jd, postingText, { flag: 'wx' });
        await fs.mkdir(env.CAREER_OPS_ADDITIONS, { recursive: true });
        if ((await fs.readdir(env.CAREER_OPS_ADDITIONS)).some(f => f.endsWith('.tsv'))) throw new EngineError('pending_tracker_additions');
        const reportsDir = path.join(root, 'reports');
        await fs.mkdir(reportsDir, { recursive: true });
        const before = new Set(await fs.readdir(reportsDir));
        const evaluated = await run('openai-eval.mjs', ['--file', jd, ...(postingUrl ? ['--posting-url', postingUrl] : [])]);
        const summary = parseScoreSummary(evaluated.stdout);
        if (!summary?.company || !summary.role || summary.company.toLowerCase() === 'unknown' || summary.role.toLowerCase() === 'unknown' || normalizedTrackerScore(summary.score) === 'N/A') throw new EngineError('invalid_evaluation');
        const created = (await fs.readdir(reportsDir)).filter(f => !before.has(f) && /^\d+-[a-z0-9-]+\.md$/.test(f));
        if (created.length !== 1) throw new EngineError('report_not_created');
        const report = `reports/${created[0]}`;
        await run('merge-tracker.mjs', []);
        const row = (await readRows(root)).find(row => parseMarkdownLinks(row.report).some(link => path.resolve(root, 'data', link.target) === path.join(root, report)));
        if (!row) throw new EngineError('tracker_not_merged');
        return {
          result: { report, reportNumber: Number(created[0].match(/^\d+/)[0]), applicationNumber: row.num, company: row.company, role: row.role, score: row.score, scope: 'pasted-text evaluation; no live posting or company research' },
          artifactPaths: [report, `.hosted/${jobId}/posting.txt`],
        };
      });
    },

    async tailor({ workspace, jobId, evaluationJobId, signal }) {
      if (!UUID.test(evaluationJobId || '')) throw new EngineError('invalid_evaluation_job_id');
      return withJob({ workspace, jobId, operation: 'tailor', input: { evaluationJobId }, config, signal }, async ({ root, dir, env, run, sources, contextHash }) => {
        const evaluation = await verifiedReceipt(root, evaluationJobId);
        if (evaluation.operation !== 'evaluate') throw new EngineError('invalid_evaluation_job');
        if (evaluation.contextHash !== contextHash) throw new EngineError('evaluation_stale');
        const source = evaluation.result;
        // Resolve from a verified evaluation, never a client-supplied report path.
        const reportPath = contained(root, source.report);
        const matching = (await readRows(root)).filter(row => parseMarkdownLinks(row.report).some(link => path.resolve(root, 'data', link.target) === reportPath));
        if (matching.length !== 1) throw new EngineError('evaluation_not_in_tracker');
        if (!sources['config/cv-facts.json']) throw new EngineError('fact_config_required');
        if (!browserExecutable || !(await exists(browserExecutable))) throw new EngineError('browser_required');
        // Photo asset ingestion/containment is not implemented for hosted jobs.
        // Do not let a profile grant Chromium access to an arbitrary local file.
        const profile = loadYaml(sources['config/profile.yml'] || '');
        if (profile?.candidate?.photo) throw new EngineError('profile_photo_not_supported');

        // One fresh staging workspace per job prevents old output reuse and keeps
        // unvalidated HTML away from application artifacts.
        const stage = path.join(dir, 'stage');
        await fs.mkdir(stage);
        for (const [file, content] of Object.entries(sources)) {
          if (content == null) continue;
          const target = contained(stage, file);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, content, { flag: 'wx' });
        }
        const report = path.join(stage, 'reports', path.basename(source.report));
        await fs.mkdir(path.dirname(report));
        await fs.copyFile(reportPath, report);
        const jd = path.join(stage, 'posting.txt');
        await fs.copyFile(path.join(root, '.hosted', evaluationJobId, 'posting.txt'), jd);
        const stageEnv = await childEnv(stage, path.join(dir, 'model-home'), config.provider);
        await run('openai-tailor.mjs', ['--jd', jd, '--report', report], { runRoot: stage, runEnv: stageEnv, failureCode: 'tailoring_failed' });
        const output = path.join(stage, 'output');
        const files = (await fs.readdir(output)).filter(f => f.endsWith('.html'));
        if (files.length !== 1) throw new EngineError('tailored_html_missing');
        const stagedHtml = path.join(output, files[0]);
        const rawHtml = await fs.readFile(stagedHtml, 'utf8');
        if (!/<html\b/i.test(rawHtml) || !/<\/html>\s*$/i.test(rawHtml) || Buffer.byteLength(rawHtml) > 1_000_000) throw new EngineError('invalid_cv_html');
        const checked = await run('verify-cv-facts.mjs', [stagedHtml, '--json'], { runRoot: stage, runEnv: { ...stageEnv, OPENAI_API_KEY: '' }, failureCode: 'cv_facts_failed' });
        const facts = JSON.parse(checked.stdout);
        if (facts.verdict !== 'pass' || facts.configMissing) throw new EngineError('cv_facts_failed');
        // New paths per job; failed strict rendering cannot return a stale PDF.
        const htmlRelative = `output/hosted/${jobId}/cv.html`, pdfRelative = `output/hosted/${jobId}/cv.pdf`;
        const html = contained(root, htmlRelative), pdf = contained(root, pdfRelative);
        await fs.mkdir(path.dirname(html), { recursive: true });
        await fs.copyFile(stagedHtml, html, fs.constants.COPYFILE_EXCL);
        // Chromium puts Unix sockets under TMPDIR; the nested workspace/job
        // home can exceed sockaddr_un's path limit. Use a short private temp
        // directory, while HOME and candidate files stay workspace-scoped.
        const tempParent = await fs.realpath(process.platform === 'win32' ? os.tmpdir() : '/tmp');
        const browserTemp = await fs.mkdtemp(path.join(tempParent, 'hc-'));
        let rendered;
        try {
          await fs.chmod(browserTemp, 0o700);
          const renderEnv = { ...env, OPENAI_API_KEY: '', PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: browserExecutable, TMPDIR: browserTemp, TMP: browserTemp, TEMP: browserTemp };
          rendered = await run('hosted/render.mjs', [html, pdf, '--kind=cv', `--report=${source.reportNumber}`, '--strict-fact-check', '--strict-pages', '--max-pages=2'], { runEnv: renderEnv, failureCode: 'cv_render_failed' });
        } finally {
          // Verify the exact private target before recursive cleanup on Windows
          // as well as Unix. Never follow a replaced directory/symlink.
          if (path.dirname(browserTemp) !== tempParent || !path.basename(browserTemp).startsWith('hc-') || await fs.realpath(browserTemp) !== browserTemp) throw new EngineError('unsafe_temp_cleanup');
          await fs.rm(browserTemp, { recursive: true, force: true });
        }
        const bytes = await fs.readFile(pdf);
        if (bytes.length < 100 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new EngineError('invalid_pdf');
        const metadata = JSON.parse(rendered.stdout.match(/^HOSTED_RENDER_RESULT=(.+)$/m)?.[1] || '{}');
        const pages = metadata.pageCount;
        if (!Number.isInteger(pages) || pages < 1 || pages > 2) throw new EngineError('invalid_pdf_pages');
        // The upstream manifest's documented positional schema is
        // report, pdf, html, format, date, kind. Verify before marking ready.
        const index = await fs.readFile(path.join(root, 'data', 'pdf-index.tsv'), 'utf8');
        const indexed = index.split(/\r?\n/).some(line => {
          const fields = line.split('\t');
          return Number(fields[0]) === source.reportNumber && fields[1] === pdfRelative && fields[2] === htmlRelative && fields[5] === 'cv';
        });
        if (!indexed) throw new EngineError('pdf_not_indexed');
        await run('mark-pdf-ready.mjs', [String(source.reportNumber), '--json']);
        const row = (await readRows(root)).find(row => row.num === matching[0].num);
        if (row?.pdf !== '✅') throw new EngineError('pdf_not_marked_ready');
        return { result: { evaluationJobId, report: source.report, reportNumber: source.reportNumber, html: htmlRelative, pdf: pdfRelative, pages, pdfSha256: sha(bytes), browserVersion: metadata.browserVersion, validation: 'strict facts, section order, chronology, locked sections and page budget' }, artifactPaths: [source.report, htmlRelative, pdfRelative] };
      });
    },
  };
}
