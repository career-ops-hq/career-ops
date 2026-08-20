#!/usr/bin/env node

/**
 * career-ops-cli.mjs — Master Unified Command Line Interface
 *
 * Usage:
 *   node career-ops-cli.mjs <command>
 *
 * Commands:
 *   studio      Launch Web Command Center Dashboard (http://localhost:4000/studio)
 *   sync        Sync application statuses across ApplyPilot and tracker.tsv
 *   digest      Print daily 9 AM job alert digest
 *   analytics   Show application conversion metrics & response rates
 *   batch-match Rank live jobs by candidate match score
 *   test        Run complete ecosystem unit test suite
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const command = process.argv[2] || 'help';

switch (command) {
  case 'studio':
    console.log('🚀 Launching Web Command Center Dashboard on http://localhost:4000/studio...');
    execSync('node server-studio.mjs', { cwd: __dirname, stdio: 'inherit' });
    break;

  case 'sync':
    console.log('🔄 Syncing application statuses...');
    execSync('node sync-application-tracker.mjs', { cwd: __dirname, stdio: 'inherit' });
    break;

  case 'digest':
    console.log('🌅 Generating Daily Job Digest...');
    execSync('node daily-digest.mjs', { cwd: __dirname, stdio: 'inherit' });
    break;

  case 'analytics':
    console.log('📊 Application Funnel Analytics...');
    execSync('node analytics.mjs', { cwd: __dirname, stdio: 'inherit' });
    break;

  case 'batch-match':
    console.log('🔍 Bulk Ranking Jobs...');
    execSync('node batch-match.mjs', { cwd: __dirname, stdio: 'inherit' });
    break;

  case 'test':
    console.log('🧪 Running Complete Ecosystem Test Suite...');
    execSync('node tests/cv-rendercv.test.mjs && node tests/addons.test.mjs && node tests/gaps.test.mjs && node tests/candidate-suite.test.mjs', { cwd: __dirname, stdio: 'inherit' });
    break;

  default:
    console.log(`
🤖 Career-Ops Ecosystem Master CLI

Usage:
  node career-ops-cli.mjs <command>

Commands:
  studio      Launch Web Command Center Dashboard (http://localhost:4000/studio)
  sync        Sync application statuses across ApplyPilot and tracker.tsv
  digest      Print daily 9 AM job alert digest
  analytics   Show application conversion metrics & response rates
  batch-match Rank live jobs by candidate match score
  test        Run complete ecosystem unit test suite
`);
    break;
}
