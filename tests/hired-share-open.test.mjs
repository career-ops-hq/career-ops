// tests/hired-share-open.test.mjs — `hired-share --open` on Windows must hand
// `start` the whole prefilled issue URL (#6994).
//
// The opener runs `cmd /c start "" <url>`, and cmd ends a command at every
// unescaped `&`. The issue URL joins its fields with `&`, so `start` got only
// the template, cmd ran `title=…` and `role=…` as commands of their own, and
// openInBrowser() reported that no browser opened although one had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildIssueUrl, escapeForCmd, openInBrowser } from '../hired-share.mjs';

const answers = { role: 'Staff Engineer', companyType: 'Startup', story: 'Two weeks & one offer', anonymity: 'count' };

test('escapeForCmd puts a caret before each cmd operator and leaves the rest alone', () => {
  assert.equal(escapeForCmd('https://example.com/new?a=1&b=2'), 'https://example.com/new?a=1^&b=2');
  assert.equal(escapeForCmd('https://example.com/x?q=a|b<c>d^e(f)'), 'https://example.com/x?q=a^|b^<c^>d^^e^(f^)');
  assert.equal(escapeForCmd('https://example.com/x?q=100%25'), 'https://example.com/x?q=100%25');
});

test('cmd hands start every field of the prefilled issue URL', { skip: process.platform !== 'win32' && 'cmd /c start is the Windows opener' }, () => {
  const url = buildIssueUrl(answers);
  assert.match(url, /&role=.*&anonymity=/, 'the fixture must carry several fields');
  let echoed = '';
  // `echo` in place of `start`: cmd parses the line the same way, and no browser opens.
  const opened = openInBrowser(url, (cmd, args, options) => {
    echoed = execFileSync(cmd, args.map((a) => (a === 'start' ? 'echo' : a)), { ...options, stdio: 'pipe', encoding: 'utf8' });
  });
  assert.equal(opened, true, 'cmd must exit 0: no piece of the URL may run as a command');
  assert.equal(echoed.trim(), `"" ${url}`);
});
