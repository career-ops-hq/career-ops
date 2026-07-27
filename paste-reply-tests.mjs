#!/usr/bin/env node

/**
 * paste-reply-tests.mjs — regression tests for paste-reply.mjs (#1802).
 *
 * Locks in the manual/no-Gmail input path into reply-watch.mjs's classification
 * pipeline:
 *   1. --file mode normalizes subject/from/body into the exact candidate shape
 *      reply-watch.mjs expects, with signal left null (classification stays
 *      reply-watch.mjs's job).
 *   2. Appending is additive — existing candidates are never clobbered.
 *   3. A missing candidates file is created (with the array wrapper) on first append.
 *   4. --file input with no Subject:/From: headers falls back to whole-file-as-body.
 *   5. --file pointing at a nonexistent path fails loudly (exit 1).
 *   6. message_id values are unique across appends.
 *   7. parseFileInput / normalizeCandidate work correctly as direct unit imports.
 *
 * Provisions a throwaway candidates file via CAREER_OPS_REPLY_CANDIDATES and a
 * temp dir; never touches the repo's real data/reply-candidates.json.
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const CLI = join(ROOT, 'paste-reply.mjs');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runFile(candidatesPath, filePath, extraEnv = {}) {
  return execFileSync(NODE, [CLI, '--file', filePath], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_REPLY_CANDIDATES: candidatesPath, ...extraEnv },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// ---------------------------------------------------------------------------
console.log('1. --file mode normalizes into the exact candidate shape');
{
  const dir = tmp('paste-reply-');
  const candidates = join(dir, 'reply-candidates.json');
  const emailFile = join(dir, 'email.txt');
  writeFileSync(emailFile, [
    'Subject: 恭喜简历通过，杭州赢云贸易有限公司邀您面试',
    'From: recruiter@wingyun.com',
    '',
    '您的首轮面试是AI微信小程序面试。',
    '面试形式：AI微信小程序面试，面试时长：约15~30分钟',
  ].join('\n'));

  runFile(candidates, emailFile);
  const arr = JSON.parse(readFileSync(candidates, 'utf8'));
  check('exactly one candidate written', arr.length === 1, `got ${arr.length}`);
  const cand = arr[0];
  check('has message_id', typeof cand.message_id === 'string' && cand.message_id.length > 0);
  check('from parsed', cand.from === 'recruiter@wingyun.com', cand.from);
  check('subject parsed', cand.subject === '恭喜简历通过，杭州赢云贸易有限公司邀您面试', cand.subject);
  check('body_snippet contains multi-line body', cand.body_snippet.includes('AI微信小程序面试') && cand.body_snippet.includes('15~30分钟'), cand.body_snippet);
  check('signal is null (classification stays reply-watch.mjs job)', cand.signal === null, JSON.stringify(cand.signal));
  check('exactly 5 shape keys', Object.keys(cand).sort().join(',') === 'body_snippet,from,message_id,signal,subject', Object.keys(cand).sort().join(','));
}

// ---------------------------------------------------------------------------
console.log('2. appending is additive — existing candidates are never clobbered');
{
  const dir = tmp('paste-reply-');
  const candidates = join(dir, 'reply-candidates.json');
  const existing = [
    { message_id: 'msg1', from: 'hr@existing.com', subject: 'Existing candidate', body_snippet: 'do not touch me', signal: 'rejection' },
  ];
  writeFileSync(candidates, JSON.stringify(existing, null, 2));

  const emailFile = join(dir, 'email.txt');
  writeFileSync(emailFile, 'Subject: New reply\nFrom: hr@newco.com\n\nThanks for applying.');
  runFile(candidates, emailFile);

  const arr = JSON.parse(readFileSync(candidates, 'utf8'));
  check('two candidates now present', arr.length === 2, `got ${arr.length}`);
  check('original candidate untouched', arr[0].message_id === 'msg1' && arr[0].body_snippet === 'do not touch me');
  check('new candidate appended second', arr[1].subject === 'New reply');
}

// ---------------------------------------------------------------------------
console.log('3. missing candidates file is created (array wrapper) on first append');
{
  const dir = tmp('paste-reply-');
  const candidates = join(dir, 'reply-candidates.json');
  check('candidates file does not exist yet', !existsSync(candidates));

  const emailFile = join(dir, 'email.txt');
  writeFileSync(emailFile, 'Subject: First ever\n\nHello world.');
  runFile(candidates, emailFile);

  check('candidates file created', existsSync(candidates));
  const arr = JSON.parse(readFileSync(candidates, 'utf8'));
  check('is a JSON array with one entry', Array.isArray(arr) && arr.length === 1, JSON.stringify(arr));
}

// ---------------------------------------------------------------------------
console.log('4. --file input with no headers falls back to whole-file-as-body');
{
  const dir = tmp('paste-reply-');
  const candidates = join(dir, 'reply-candidates.json');
  const emailFile = join(dir, 'email.txt');
  writeFileSync(emailFile, 'Just some pasted text with no headers at all.');
  runFile(candidates, emailFile);

  const arr = JSON.parse(readFileSync(candidates, 'utf8'));
  check('subject left blank', arr[0].subject === '', JSON.stringify(arr[0].subject));
  check('whole content becomes body_snippet', arr[0].body_snippet === 'Just some pasted text with no headers at all.', arr[0].body_snippet);
}

// ---------------------------------------------------------------------------
console.log('5. --file pointing at a nonexistent path fails loudly (exit 1)');
{
  const dir = tmp('paste-reply-');
  const candidates = join(dir, 'reply-candidates.json');
  let exit = 0;
  try {
    runFile(candidates, join(dir, 'does-not-exist.txt'));
  } catch (e) {
    exit = e.status;
  }
  check('non-zero exit on missing input file', exit === 1, `exit=${exit}`);
  check('no candidates file created on failure', !existsSync(candidates));
}

// ---------------------------------------------------------------------------
console.log('6. message_id values are unique across appends');
{
  const dir = tmp('paste-reply-');
  const candidates = join(dir, 'reply-candidates.json');
  const emailFile = join(dir, 'email.txt');
  writeFileSync(emailFile, 'Subject: Repeat\n\nSame content each time.');
  runFile(candidates, emailFile);
  runFile(candidates, emailFile);
  runFile(candidates, emailFile);

  const arr = JSON.parse(readFileSync(candidates, 'utf8'));
  const ids = new Set(arr.map((c) => c.message_id));
  check('3 candidates appended', arr.length === 3, `got ${arr.length}`);
  check('all message_ids unique', ids.size === 3, `got ${ids.size} unique of ${arr.length}`);
}

// ---------------------------------------------------------------------------
console.log('7. parseFileInput / normalizeCandidate as direct unit imports');
{
  const mod = await import(pathToFileURL(CLI).href);
  const parsed = mod.parseFileInput('Subject: Hi\nFrom: a@b.com\n\nline one\nline two');
  check('parseFileInput: subject', parsed.subject === 'Hi', parsed.subject);
  check('parseFileInput: from', parsed.from === 'a@b.com', parsed.from);
  check('parseFileInput: body preserves multiple lines', parsed.body === 'line one\nline two', JSON.stringify(parsed.body));

  const noHeaders = mod.parseFileInput('just body text');
  check('parseFileInput: no-header fallback subject blank', noHeaders.subject === '');
  check('parseFileInput: no-header fallback body is full text', noHeaders.body === 'just body text');

  const cand = mod.normalizeCandidate({ subject: 'S', from: 'F', body: 'B' });
  check('normalizeCandidate: signal is null', cand.signal === null);
  check('normalizeCandidate: fields map through', cand.subject === 'S' && cand.from === 'F' && cand.body_snippet === 'B');

  const candNoFrom = mod.normalizeCandidate({ subject: 'S', from: '', body: 'B' });
  check('normalizeCandidate: missing from defaults to empty string, not undefined', candNoFrom.from === '');
}

// ---------------------------------------------------------------------------
console.log('8. interactive (stdin) mode — no --file flag');
{
  const dir = tmp('paste-reply-');
  const candidates = join(dir, 'reply-candidates.json');
  // collectInteractive() prompts Subject → From → multiline body (EOF-terminated).
  // Piped stdin supplies all three in order; execFileSync closes stdin after
  // writing `input`, which readMultilineStdin() reads as EOF.
  const stdin = 'Interview invite from Acme\nrecruiter@acme.com\nWe would like to schedule a call.\nPlease pick a time.\n';
  const out = execFileSync(NODE, [CLI], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_REPLY_CANDIDATES: candidates },
    input: stdin,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const arr = JSON.parse(readFileSync(candidates, 'utf8'));
  check('interactive mode created exactly one candidate', arr.length === 1, `got ${arr.length}`);
  const cand = arr[0];
  check('interactive: subject parsed', cand.subject === 'Interview invite from Acme', cand.subject);
  check('interactive: from parsed', cand.from === 'recruiter@acme.com', cand.from);
  check('interactive: multiline body joined', cand.body_snippet === 'We would like to schedule a call.\nPlease pick a time.', JSON.stringify(cand.body_snippet));
  check('interactive: signal is null', cand.signal === null);
  check('interactive: CLI reports success', out.includes('Appended a new reply candidate'), out);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
