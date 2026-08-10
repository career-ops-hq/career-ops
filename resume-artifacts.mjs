#!/usr/bin/env node

import { dirname, basename, resolve, relative, sep } from 'path';
import { existsSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(ROOT, 'output');
const BUILDER = resolve(ROOT, 'scripts', 'build_resumes.py');

export function isResumeMarkdownArtifactPath(targetPath) {
  if (!targetPath) return false;
  const abs = resolve(targetPath);
  const rel = relative(OUTPUT_DIR, abs);
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..') return false;
  return basename(abs).endsWith('-resume.md');
}

export function brandedResumePdfPath(markdownPath) {
  const abs = resolve(markdownPath);
  if (!abs.endsWith('.md')) {
    throw new Error(`Expected a markdown resume path, got: ${markdownPath}`);
  }
  return abs.slice(0, -3) + '.pdf';
}

export function ensureBrandedResumePdf(markdownPath, options = {}) {
  const absMd = resolve(markdownPath);
  if (!isResumeMarkdownArtifactPath(absMd)) {
    return { rendered: false, skipped: true, reason: 'not-a-resume-markdown-artifact' };
  }
  if (!existsSync(absMd)) {
    throw new Error(`Resume markdown not found: ${absMd}`);
  }
  if (!existsSync(BUILDER)) {
    throw new Error(`Branded resume builder not found: ${BUILDER}`);
  }

  const absPdf = brandedResumePdfPath(absMd);
  const previewDir = options.previewDir
    ? resolve(options.previewDir)
    : resolve('/private/tmp', 'resume-previews', basename(absMd, '.md'));
  const metaOut = options.metaOut ? resolve(options.metaOut) : null;

  const args = [BUILDER, absMd, absPdf, '--preview-dir', previewDir];
  if (metaOut) args.push('--meta-out', metaOut);

  const proc = spawnSync('python3', args, {
    cwd: ROOT,
    env: {
      ...process.env,
      PYTHONPYCACHEPREFIX: process.env.PYTHONPYCACHEPREFIX || '/private/tmp/pycache',
    },
    encoding: 'utf-8',
  });

  if (proc.status !== 0) {
    const detail = [proc.stdout, proc.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Branded resume PDF generation failed for ${basename(absMd)}${detail ? `\n${detail}` : ''}`);
  }

  return {
    rendered: true,
    markdown: absMd,
    pdf: absPdf,
    previewDir,
    metaOut,
    stdout: proc.stdout?.trim() || '',
  };
}

function listResumeMarkdownArtifacts() {
  if (!existsSync(OUTPUT_DIR)) return [];
  return readdirSync(OUTPUT_DIR)
    .filter((name) => name.endsWith('-resume.md'))
    .map((name) => resolve(OUTPUT_DIR, name));
}

async function main() {
  const targets = process.argv.slice(2);
  const files = targets.length > 0 ? targets.map((target) => resolve(target)) : listResumeMarkdownArtifacts();
  const results = [];
  for (const file of files) {
    results.push(ensureBrandedResumePdf(file));
  }
  console.log(JSON.stringify(results, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
