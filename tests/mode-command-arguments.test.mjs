/**
 * tests/mode-command-arguments.test.mjs — posting values never reach a shell
 * through the archive and keyword-coverage commands the modes document (#5853).
 *
 * `modes/oferta.md` defines two fixed commands: the agent writes the posting
 * URL, company slug and report path to a JSON file, and the command checks
 * each value and starts `archive-posting.mjs` / `keyword-match.mjs` with every
 * value as its own argv entry, without a shell. This suite pins:
 *
 *   1. Parity — every mode that runs either script carries the canonical
 *      command byte for byte (after list indentation), so a localized copy
 *      cannot drift into a weaker form.
 *   2. No splice form — no mode still shows `archive-posting.mjs <url> ...`,
 *      `keyword-match.mjs reports/...` or a quoted path on a command line.
 *   3. Behaviour — the canonical commands, run through a real shell against
 *      stub scripts, deliver hostile values as single arguments, never
 *      evaluate them, refuse a bad slug, report number or report path before
 *      the script starts, and pass the script's exit code through.
 *
 * Run: node test-all.mjs --only mode-command-arguments
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pass, fail, warn, ROOT, NODE, rmSync, getBash, bashSource } from './helpers.mjs';
import { listTree } from '../lib/walk-tree.mjs';

console.log('\nMode command arguments: posting values stay out of shell text (#5853)');

const LOCALIZED_ARCHIVE = [
  'ar/fursah.md', 'da/oferta.md', 'de/angebot.md', 'es/oferta.md', 'fr/offre.md', 'hi/naukri.md',
  'id/lowongan.md', 'it/annuncio.md', 'ja/kyujin.md', 'ko/gonggo.md', 'nl/vacature.md', 'pl/oferta.md',
  'pt/oferta.md', 'ru/oferta.md', 'tr/is-ilani.md', 'ua/oferta.md', 'zh-TW/oferta.md', 'zh/oferta.md',
];
const LOCALIZED_KEYWORD = [
  'ar/fursah.md', 'da/oferta.md', 'de/angebot.md', 'es/oferta.md', 'fr/offre.md', 'hi/naukri.md',
  'id/lowongan.md', 'it/annuncio.md', 'ja/kyujin.md', 'ko/gonggo.md', 'nl/vacature.md', 'pl/oferta.md',
  'pt/oferta.md', 'ru/oferta.md', 'tr/is-ilani.md', 'ua/oferta.md', 'vi/tuyen-dung.md', 'zh-TW/oferta.md',
  'zh/oferta.md',
];
const SHARED = ['modes/oferta.md', 'modes/pdf.md', 'batch/batch-prompt.md'];
// A file listed here that loses its command fails, instead of silently leaving the check.
const MUST_CARRY = {
  'archive-posting.mjs': [...SHARED, ...LOCALIZED_ARCHIVE.map(f => `modes/${f}`)],
  'keyword-match.mjs': [...SHARED, ...LOCALIZED_KEYWORD.map(f => `modes/${f}`)],
};

const read = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

/** Every ```bash block in `text`, with its list indentation removed. */
function bashBlocks(text) {
  return [...text.matchAll(/^([ \t]*)```bash\n([\s\S]*?)\n\1```[ \t]*$/gm)].map(([, indent, body]) =>
    body.split('\n').map(line => (line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n'));
}

/** The JSON-file command block that starts `script`, or null. */
function commandBlocks(text, script) {
  return bashBlocks(text).filter(b => b.startsWith("node --input-type=module -e '") && b.includes(`"${script}"`));
}

/** Every mode document, plus the batch worker prompt. */
function scannedFiles() {
  const modes = listTree(join(ROOT, 'modes'), { match: /\.md$/ })
    .map(abs => relative(ROOT, abs).split(sep).join('/'));
  return ['batch/batch-prompt.md', ...modes];
}

const canonicalText = read('modes/oferta.md');
const canonical = {};
for (const script of Object.keys(MUST_CARRY)) {
  const found = commandBlocks(canonicalText, script);
  if (found.length === 1) {
    canonical[script] = found[0];
    pass(`modes/oferta.md defines one canonical ${script} command`);
  } else {
    fail(`modes/oferta.md should define exactly one ${script} JSON-file command, found ${found.length}`);
  }
}

if (/`\{company-slug\}` = [^\n]*`\^\[a-z0-9-\]\+\$`/.test(canonicalText)) {
  pass('modes/oferta.md step 1 says the company slug must match ^[a-z0-9-]+$');
} else {
  fail('modes/oferta.md step 1 no longer requires the company slug to match ^[a-z0-9-]+$');
}

// ── 1 + 2. Parity and no splice form ─────────────────────────────────────────

// A script name followed by whitespace and anything but a flag is an argument
// typed into the command line: `archive-posting.mjs <url>`, `keyword-match.mjs "reports/..."`.
const SPLICE = /(?:archive-posting|keyword-match)\.mjs[ \t]+(?!--)\S/;
// `node archive-posting.mjs --company="$(...)"` passes SPLICE (its first argument is a
// flag), so any direct `node` run of either script is refused too. The canonical
// command starts `node --input-type=module` and names the scripts only inside the -e code.
const DIRECT = /\bnode\s+(?:\S*\/)?(?:archive-posting|keyword-match)\.mjs\b/;

/** Why `line` runs either script with posting values in shell text, or null. */
function unsafeCommand(line) {
  if (DIRECT.test(line)) return 'runs archive-posting/keyword-match directly instead of the JSON-file command';
  if (SPLICE.test(line)) return 'types an argument into an archive-posting/keyword-match command line';
  return null;
}

const FIXTURES = [
  ['node archive-posting.mjs --company="$(touch pwned)" https://jobs.example.test', true],
  ['run `node ./keyword-match.mjs --json reports/042-acme-2026-10-25.md`', true],
  ['`archive-posting.mjs <url> --company={company-slug}`', true],
  ['See jds/{filename} for the full archive (archive-posting.mjs --report={num}).', false],
  ['const args = ["archive-posting.mjs", p.url];', false],
  ["node --input-type=module -e '", false],
  ['(printed by the `keyword-match.mjs` command in step 1b)', false],
];
for (const [line, unsafe] of FIXTURES) {
  if (Boolean(unsafeCommand(line)) === unsafe) pass(`${unsafe ? 'flags' : 'allows'}: ${line}`);
  else fail(`unsafeCommand should ${unsafe ? 'flag' : 'allow'}: ${line}`);
}

for (const rel of scannedFiles()) {
  const text = read(rel);
  text.split('\n').forEach((l, i) => {
    const why = unsafeCommand(l);
    if (why) fail(`${rel}:${i + 1} ${why}`);
  });
  for (const script of Object.keys(MUST_CARRY)) {
    if (!canonical[script]) continue;
    const blocks = commandBlocks(text, script);
    const required = MUST_CARRY[script].includes(rel);
    if (required && blocks.length === 0) {
      fail(`${rel} lost its ${script} command (listed in MUST_CARRY)`);
    } else if (blocks.some(b => b !== canonical[script])) {
      fail(`${rel}: its ${script} command differs from modes/oferta.md`);
    } else if (blocks.length) {
      pass(`${rel} carries the canonical ${script} command`);
    }
  }
  // The archive command sits under the JD-archival rule (#2789) that tells the
  // agent to run it, not somewhere above it where "the command below" points elsewhere.
  if (MUST_CARRY['archive-posting.mjs'].includes(rel)) {
    const rule = text.indexOf('#2789');
    const block = text.indexOf('"archive-posting.mjs", p.url');
    if (rule !== -1 && block > rule) pass(`${rel}: archive command follows the JD-archival rule`);
    else fail(`${rel}: archive command is not placed after the JD-archival rule (#2789)`);
  }
}

// check-jd-archive.mjs resolves only the English pointer sentence, so every
// evaluation mode that runs the archive command must instruct exactly that one.
const POINTER = 'See jds/{filename} for the full archive (archive-posting.mjs --report={num}).';
for (const rel of ['modes/oferta.md', ...LOCALIZED_ARCHIVE.map(f => `modes/${f}`)]) {
  if (read(rel).includes(POINTER)) pass(`${rel} instructs the canonical archive pointer sentence`);
  else fail(`${rel} does not instruct the canonical pointer sentence "${POINTER}"`);
}

// ── 3. Behaviour ─────────────────────────────────────────────────────────────

const bash = getBash();
if (!['posix', 'git-bash', 'path'].includes(bashSource())) {
  warn(`behaviour checks skipped: no native bash (${bashSource()})`);
} else if (canonical['archive-posting.mjs'] && canonical['keyword-match.mjs']) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-mode-args-'));
  try {
    for (const script of Object.keys(MUST_CARRY)) {
      // Records the argv it was started with; `exit-7` as the last argument tests exit-code passthrough.
      writeFileSync(join(dir, script), [
        'import { writeFileSync } from "node:fs";',
        'const argv = process.argv.slice(2);',
        `writeFileSync(${JSON.stringify(`argv-${script}.json`)}, JSON.stringify(argv));`,
        'process.exitCode = argv.at(-1) === "exit-7" ? 7 : 0;',
      ].join('\n'));
    }
    const env = { ...process.env, PATH: `${dirname(NODE)}${delimiter}${process.env.PATH ?? ''}` };
    // The documented form passes the JSON file's path as an argument; `< file` on stdin also works.
    const runCommand = (script, values, { stdin = false } = {}) => {
      const argvFile = join(dir, `argv-${script}.json`);
      rmSync(argvFile, { force: true });
      writeFileSync(join(dir, 'args.json'), JSON.stringify(values));
      const command = canonical[script].replace('{json-file}', stdin ? '< args.json' : 'args.json');
      const r = spawnSync(bash, ['-c', command], { cwd: dir, env, encoding: 'utf8' });
      const argv = existsSync(argvFile) ? JSON.parse(readFileSync(argvFile, 'utf8')) : null;
      return { status: r.status, stderr: r.stderr, argv };
    };
    const pwned = () => readdirSync(dir).some(f => f.startsWith('pwned'));

    const hostileUrl = "https://jobs.example.test/role?id=1&src=a b'c\"d$(touch pwned1)`touch pwned2`;touch pwned3|cat $HOME";
    let r = runCommand('archive-posting.mjs', { url: hostileUrl, company: 'acme-co', report: '042' });
    if (r.status === 0 && JSON.stringify(r.argv) === JSON.stringify([hostileUrl, '--company=acme-co', '--report=042']) && !pwned()) {
      pass('archive command passes a URL with spaces, &, quotes, $(), backticks, ; and | as one argument, unevaluated');
    } else {
      fail(`archive command mangled or evaluated the URL: status ${r.status}, argv ${JSON.stringify(r.argv)}, pwned ${pwned()}, stderr ${r.stderr}`);
    }

    r = runCommand('archive-posting.mjs', { url: hostileUrl, company: 'acme-co', report: '042' }, { stdin: true });
    if (r.status === 0 && JSON.stringify(r.argv) === JSON.stringify([hostileUrl, '--company=acme-co', '--report=042']) && !pwned()) {
      pass('archive command reads the same JSON redirected to stdin');
    } else {
      fail(`archive command with the JSON on stdin: status ${r.status}, argv ${JSON.stringify(r.argv)}, stderr ${r.stderr}`);
    }

    r = runCommand('archive-posting.mjs', { url: 'https://jobs.example.test/1' });
    if (r.status === 0 && JSON.stringify(r.argv) === JSON.stringify(['https://jobs.example.test/1'])) {
      pass('archive command without company/report passes the URL alone');
    } else {
      fail(`archive command without company/report: status ${r.status}, argv ${JSON.stringify(r.argv)}`);
    }

    const badArchive = [
      [{ url: 'https://x.test', company: 'Acme Co' }, 'a company slug with uppercase and a space'],
      [{ url: 'https://x.test', company: 'acme;touch pwned4' }, 'a company slug with ; and a space'],
      [{ url: 'https://x.test', company: 'acme$(touch pwned5)' }, 'a company slug with $()'],
      [{ url: 'https://x.test', company: '../acme' }, 'a company slug with a path'],
      [{ url: 'https://x.test', company: '' }, 'an empty company slug'],
      [{ url: 'https://x.test', company: 'acme', report: '4a' }, 'a non-numeric report'],
      [{ url: 'https://x.test', report: '1; touch pwned6' }, 'a report with shell syntax'],
      [{ url: '--pipeline' }, 'a flag in place of the URL'],
      [{ url: 'file:///etc/passwd' }, 'a non-http URL'],
      [{ url: 42 }, 'a non-string URL'],
      [null, 'a JSON null'],
      [[{ url: 'https://x.test' }], 'a JSON array'],
      ['https://x.test', 'a bare JSON string'],
    ];
    for (const [values, label] of badArchive) {
      r = runCommand('archive-posting.mjs', values);
      // Its own fail() message, not an uncaught TypeError that happens to exit 1 too.
      if (r.status === 1 && r.argv === null && !pwned() && r.stderr.startsWith('archive-posting: ')) pass(`archive command refuses ${label} before the script starts`);
      else fail(`archive command did not refuse ${label}: status ${r.status}, argv ${JSON.stringify(r.argv)}, pwned ${pwned()}, stderr ${r.stderr}`);
    }

    const report = 'reports/042-acme-co-2026-10-25.md';
    const hostileCv = "output/cv a&b 'c' \"d\" $(touch pwned7) `touch pwned8`;.html";
    r = runCommand('keyword-match.mjs', { report, cv: hostileCv });
    if (r.status === 0 && JSON.stringify(r.argv) === JSON.stringify([report, '--cv', hostileCv]) && !pwned()) {
      pass('keyword command passes the report and a hostile --cv path as single arguments, unevaluated');
    } else {
      fail(`keyword command mangled or evaluated its paths: status ${r.status}, argv ${JSON.stringify(r.argv)}, pwned ${pwned()}, stderr ${r.stderr}`);
    }

    r = runCommand('keyword-match.mjs', { report, cv: hostileCv }, { stdin: true });
    if (r.status === 0 && JSON.stringify(r.argv) === JSON.stringify([report, '--cv', hostileCv]) && !pwned()) {
      pass('keyword command reads the same JSON redirected to stdin');
    } else {
      fail(`keyword command with the JSON on stdin: status ${r.status}, argv ${JSON.stringify(r.argv)}, stderr ${r.stderr}`);
    }

    const badKeyword = [
      [{ report: 'reports/042-acme;touch pwned9-2026-10-25.md' }, 'a report path with shell syntax'],
      [{ report: 'reports/042-Acme Co-2026-10-25.md' }, 'a report path with an invalid slug'],
      [{ report: '../reports/042-acme-2026-10-25.md' }, 'a report path outside reports/'],
      [{ report: 'reports/042-acme-2026-10-25.md\ntouch pwned10' }, 'a report path with a newline'],
      [{ report: 'reports/42-acme-2026-10-25.md' }, 'a report number that is not zero-padded'],
      [{ report, cv: '--json' }, 'a flag in place of the CV path'],
      [null, 'a JSON null'],
      [[report], 'a JSON array'],
    ];
    for (const [values, label] of badKeyword) {
      r = runCommand('keyword-match.mjs', values);
      // Its own fail() message, not an uncaught TypeError that happens to exit 1 too.
      if (r.status === 1 && r.argv === null && !pwned() && r.stderr.startsWith('keyword-match: ')) pass(`keyword command refuses ${label} before the script starts`);
      else fail(`keyword command did not refuse ${label}: status ${r.status}, argv ${JSON.stringify(r.argv)}, pwned ${pwned()}, stderr ${r.stderr}`);
    }

    r = runCommand('keyword-match.mjs', { report, cv: 'exit-7' });
    if (r.status === 7) pass("keyword command exits with the script's own exit code");
    else fail(`keyword command should pass exit code 7 through, got ${r.status}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
