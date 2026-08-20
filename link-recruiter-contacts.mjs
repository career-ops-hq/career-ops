#!/usr/bin/env node

/**
 * link-recruiter-contacts.mjs — Link remote-job-pipeline recruiters into career-ops contacts
 *
 * Reads recruiter intelligence contacts from remote-job-pipeline and merges them
 * cleanly into career-ops/data/contacts.tsv and output/contacts.vcf.
 *
 * Usage:
 *   node link-recruiter-contacts.mjs [--vcf]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_CONTACTS = resolve(__dirname, '..', 'remote-job-pipeline', 'data', 'contacts.tsv');
const CAREER_OPS_CONTACTS = resolve(__dirname, 'data', 'contacts.tsv');
const OUTPUT_VCF = resolve(__dirname, 'output', 'contacts.vcf');

export function mergeContacts(pipelineContent, existingContent) {
  const existingLines = (existingContent || '').split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const newLines = (pipelineContent || '').split('\n').filter(l => l.trim() && !l.startsWith('#'));

  const seen = new Set();
  const resultLines = ['# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker#\tnotes'];

  for (const line of existingLines) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const key = `${parts[0].toLowerCase().trim()}::${parts[1].toLowerCase().trim()}`;
      seen.add(key);
      resultLines.push(line);
    }
  }

  let mergedCount = 0;
  for (const line of newLines) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const key = `${parts[0].toLowerCase().trim()}::${parts[1].toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        resultLines.push(line);
        mergedCount++;
      }
    }
  }

  return { content: resultLines.join('\n'), mergedCount };
}

if (process.argv[1] && process.argv[1].endsWith('link-recruiter-contacts.mjs')) {
  let pipelineData = '';
  let careerOpsData = '';

  if (existsSync(PIPELINE_CONTACTS)) {
    pipelineData = readFileSync(PIPELINE_CONTACTS, 'utf8');
  }

  if (existsSync(CAREER_OPS_CONTACTS)) {
    careerOpsData = readFileSync(CAREER_OPS_CONTACTS, 'utf8');
  }

  const { content, mergedCount } = mergeContacts(pipelineData, careerOpsData);
  mkdirSync(dirname(CAREER_OPS_CONTACTS), { recursive: true });
  writeFileSync(CAREER_OPS_CONTACTS, content, 'utf8');

  console.log(`✅ Recruiter Contact Linker completed.`);
  console.log(`📊 Merged ${mergedCount} new recruiter contact(s) into data/contacts.tsv`);
}
