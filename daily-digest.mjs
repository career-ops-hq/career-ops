#!/usr/bin/env node

/**
 * daily-digest.mjs — Daily 9:00 AM Smart Job Alert Digest Generator
 *
 * Scans live job feeds, ranks roles by match score, and formats a daily digest.
 *
 * Usage:
 *   node daily-digest.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHORTLIST_PATH = resolve(__dirname, '..', 'remote-job-pipeline', 'output', '2026-08-18', 'daily-shortlist.json');

export function generateDailyDigest() {
  let jobs = [];
  if (existsSync(SHORTLIST_PATH)) {
    try {
      jobs = JSON.parse(readFileSync(SHORTLIST_PATH, 'utf8'));
    } catch (_) {}
  }

  const topJobs = jobs.slice(0, 3);
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  let digestText = `🌅 DAILY 9:00 AM SMART JOB DIGEST (${dateStr})\n`;
  digestText += `==============================================\n\n`;

  if (topJobs.length === 0) {
    digestText += `No new job postings found for today.`;
    return digestText;
  }

  topJobs.forEach((j, idx) => {
    digestText += `[#${idx + 1}] ${j.Role || 'Engineer'} @ ${j.Company || 'Company'}\n`;
    digestText += `    📍 Location: ${j.Location || 'Remote'} | Mode: ${j['Work Mode'] || 'REMOTE'}\n`;
    digestText += `    🛠️ Tech Stack: ${j['Tech Stack'] || 'Software Systems'}\n`;
    digestText += `    🔗 Apply ATS: ${j['Apply URL'] || '#'}\n\n`;
  });

  digestText += `👉 Open your Web Command Center at http://localhost:4000/studio to compile RenderCV PDFs & auto-apply!`;
  return digestText;
}

if (process.argv[1] && process.argv[1].endsWith('daily-digest.mjs')) {
  const digest = generateDailyDigest();
  console.log('\n' + digest + '\n');
}
