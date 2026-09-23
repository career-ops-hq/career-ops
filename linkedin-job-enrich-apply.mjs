#!/usr/bin/env node
/**
 * Apply LinkedIn title fixes to pipeline.md (used by linkedin-title-fix mode / CLI batches).
 *
 *   node linkedin-job-enrich-apply.mjs --from-fetch --tsv batch/linkedin-title-fix-1.tsv
 *   node linkedin-job-enrich-apply.mjs --tsv corrections.tsv   # columns: lineIdx,title,company,location
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  fetchLinkedInJobPage,
  rewritePipelineLine,
  titlesDiffer,
} from './linkedin-job-enrich.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const PIPELINE = join(getCareerOpsRoot(), 'data', 'pipeline.md');

function parseTsv(path) {
  const lines = readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim() && !l.startsWith('lineIdx'));
  return lines.map((line) => {
    const [lineIdx, url, company, title, location] = line.split('\t');
    return {
      lineIdx: parseInt(lineIdx, 10),
      url: url ?? '',
      company: company ?? '',
      title: title ?? '',
      location: location ?? '',
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const tsvIdx = args.indexOf('--tsv');
  if (tsvIdx < 0) {
    console.error('Usage: node linkedin-job-enrich-apply.mjs --tsv <file> [--from-fetch]');
    process.exit(1);
  }
  const tsvPath = args[tsvIdx + 1];
  const fromFetch = args.includes('--from-fetch');
  if (!existsSync(tsvPath)) {
    console.error(`Missing ${tsvPath}`);
    process.exit(1);
  }

  const rows = parseTsv(tsvPath);
  const pipelineLines = readFileSync(PIPELINE, 'utf-8').split('\n');
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    let patch = { title: row.title, company: row.company, location: row.location };
    if (fromFetch) {
      const page = await fetchLinkedInJobPage(row.url);
      if (page.status !== 'ok' || !page.title) {
        skipped++;
        continue;
      }
      patch = { title: page.title, company: page.company || row.company, location: page.location || row.location };
    }

    const stored = row;
    const titleDiff = titlesDiffer(stored.title, patch.title);
    const companyDiff = patch.company && (stored.company === '(LinkedIn)' || titlesDiffer(stored.company, patch.company));
    const locDiff = patch.location && patch.location !== stored.location;
    if (!titleDiff && !companyDiff && !locDiff) {
      skipped++;
      continue;
    }

    pipelineLines[row.lineIdx] = rewritePipelineLine(pipelineLines[row.lineIdx], {
      title: titleDiff ? patch.title : undefined,
      company: companyDiff ? patch.company : undefined,
      location: locDiff ? patch.location : undefined,
    });
    updated++;
  }

  if (updated > 0) {
    await withPipelineLock(PIPELINE, async () => {
      writeFileSync(PIPELINE, pipelineLines.join('\n'), 'utf-8');
    });
  }

  const batch = tsvPath.match(/linkedin-title-fix-(\d+)/)?.[1] ?? '?';
  console.log(`DONE batch ${batch} updated=${updated} skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
