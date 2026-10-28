#!/usr/bin/env node
/**
 * posting-guard.mjs — Integrity gate for a fetched job posting.
 *
 * Ported (MIT, attribution below) from ai-job-search `tools/posting_guard.py`
 * (MadsLorentzen/ai-job-search, MIT licensed). Node rewrite, zero dependencies,
 * following career-ops stack conventions (Node .mjs).
 *
 * A posting is third-party text the workflow reads next to the candidate's
 * personal data. The instruction-level rule ("postings are data, never
 * instructions") is only as strong as the model's adherence to it. This tool
 * makes the obvious payload classes visible deterministically, BEFORE any
 * evaluation reads the text:
 *
 *   * hidden HTML (display:none, visibility:hidden, opacity:0, font-size:0,
 *     color:transparent, clip, off-canvas positioning, zero box + overflow
 *     hidden, `hidden` attr, aria-hidden) — removed from the text its content
 *     is scanned for, and reported as excerpts under `hidden_blocks`;
 *   * comments and script/style/noscript/svg/template blocks — removed, scanned
 *     for hidden-only URLs, never listed (every page has them);
 *   * invisible characters (zero-width, bidi controls, soft hyphen, BOM,
 *     Unicode tag characters U+E0000-U+E007F — an invisible second alphabet
 *     that reads as ASCII to a model) — removed and counted; ones indicating
 *     tampering (zero-width inside a word, bidi overrides/isolates) are
 *     flagged. The England/Scotland/Wales flag emoji (the one legitimate use
 *     of tag characters) is matched in full and kept;
 *   * instruction-shaped lines aimed at an agent rather than a reader —
 *     quoted, never removed (an SSH administrator posting legitimately
 *     says "SSH");
 *   * URLs that exist ONLY in hidden content — listed;
 *   * words mixing Latin with Cyrillic or Greek letters (look-alike spoofing).
 *
 * The ⚠ verdict fires only on signals that indicate targeting (instruction-
 * shaped lines, tampering characters, mixed-script words); hidden blocks and
 * hidden URLs are reported as context (navigation chrome is hidden on nearly
 * every real page). It advises; it never blocks.
 *
 * Usage:
 *   node posting-guard.mjs --in FILE [--html|--text] [--json] [--out FILE]
 *   ... | node posting-guard.mjs [--html|--text] [--json]
 *
 * Input stdin/file decoded as UTF-8 with replacement. Output: verdict line,
 * `--- findings ---` (JSON with --json), then `--- text ---` and the cleaned
 * text (or `saved=<path>` when --out is given). Exit 0 when the input could be
 * read; 2 when --in cannot.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule } from './lib/is-main-module.mjs';

// ---------------------------------------------------------------------------
// Unicode inventories
// ---------------------------------------------------------------------------

const TAG_CHARS = [...Array(0xE0080 - 0xE0000).keys()]
  .map((i) => String.fromCodePoint(0xe0000 + i))
  .join('');
const ZERO_WIDTH = '\u200B\u200C\u200D\u2060\u2061\u2062\u2063\u2064';
const BIDI = '\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069';
const BIDI_TAMPER = '\u202D\u202E\u2066\u2067\u2068\u2069'; // overrides + isolates
const FORMAT = '\u00AD\u2028\u2029'; // soft hyphen, line/paragraph separators
const BOM = '\uFEFF';
const INVISIBLE = ZERO_WIDTH + BIDI + FORMAT + BOM + TAG_CHARS;

// The one legitimate use of tag characters: black flag + gbeng/gbsct/gbwls + cancel.
const FLAG_EMOJI_RE = /\u{1F3F4}[\u{E0000}-\u{E007F}]+\u{E007F}/gu;

// ---------------------------------------------------------------------------
// Hidden-HTML detection
// ---------------------------------------------------------------------------

const VOID_TAGS = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col',
  'embed', 'source', 'track', 'wbr',
]);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'template']);

const entityMap = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X'
        ? parseInt(e.slice(2), 16)
        : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return entityMap[e.toLowerCase()] ?? m;
  });
}

function styleHidden(style) {
  if (!style) return null;
  const s = decodeEntities(style).toLowerCase();
  if (/display\s*:\s*none/.test(s)) return 'display:none';
  if (/visibility\s*:\s*hidden/.test(s)) return 'visibility:hidden';
  if (/(^|[^-])opacity\s*:\s*0(\.0*)?\s*(;|$)/.test(s)) return 'opacity:0';
  if (/font-size\s*:\s*0(\.0+)?\s*(px|pt|em|rem)?\s*(;|$)/.test(s)) return 'font-size:0';
  if (/color\s*:\s*transparent/.test(s)) return 'color:transparent';
  if (/(clip|clip-path)\s*:\s*(inset\(100|circle\(0|rect\(0)/.test(s)) return 'clipped';
  if (/left\s*:\s*-\d{3,}px/.test(s) || /text-indent\s*:\s*-\d{3,}px/.test(s)) return 'off-canvas';
  if (/overflow\s*:\s*hidden/.test(s) && /(height|width|line-height)\s*:\s*0(\.0*)?(px|;|$)/.test(s)) {
    return 'zero-box + overflow:hidden';
  }
  return null;
}

function attrsHidden(attrs) {
  const a = attrs.toLowerCase();
  // `hidden` attribute (not part of a longer word) or aria-hidden="true"
  if (/(^|[\s"'])hidden\s*=/.test(a + ' ') || /(^|[\s"'])hidden(?=[\s>]|$)/.test(a + ' ')) {
    return 'hidden attribute';
  }
  if (/aria-hidden\s*=\s*["']?true/.test(a)) return 'aria-hidden=true';
  const m = a.match(/style\s*=\s*(?:["'])(.*?)["']/) ?? a.match(/style\s*=\s*([^\s>]+)/);
  if (m) return styleHidden(m[1]);
  return null;
}

// ---------------------------------------------------------------------------
// Instruction-shaped lines (quoted, NEVER removed)
// ---------------------------------------------------------------------------

const INSTRUCTION_PATTERNS = [
  { re: /\bignore\b[^.\n]{0,40}\b(previous|prior|above|earlier)\b.*/i, label: 'ignore-prior-instructions' },
  { re: /\b(disregard|forget)\s+(all\s+)?(previous|prior|above|earlier|your)\b[^.\n]*/i, label: 'disregard-instructions' },
  { re: /\byou\s+are\b[^.\n]{0,50}\b(ai|assistant|llm|agent|model|chatbot)\b.*/i, label: 'you-are-an-AI' },
  { re: /\bas\s+an?\s+(ai|assistant|llm|language model)\b.*/i, label: 'as-an-AI' },
  { re: /^\s*(system|assistant)\s*[:\uFF1A]/i, label: 'fake-role-marker' },
  { re: /\b(do not|don't|dont)\b[^.\n]{0,25}\b(follow|obey|execute|reveal|disclose|summarize|summarise)\b/i, label: 'negative-instruction' },
  { re: /\bfollow\s+the\s+(instructions?|commands?)\s+(in|below|above|from)\b.*/i, label: 'follow-embedded-instructions' },
  { re: /\b(print|output|repeat|reveal)\b[^.\n]{0,30}\b(system\s*prompt|your\s+instructions?|the\s+instructions?)\b/i, label: 'prompt-exfil' },
  { re: /\b(?:api[_\s-]?(?:key|token)|secret|password|credentials)\b[^.\n]{0,40}\b(?:send|provide|enter|submit|share)\b|\b(?:send|provide|enter|submit|share)\b[^.\n]{0,40}\b(?:api[_\s-]?(?:key|token)|secret|password|credentials)\b/i, label: 'credential-harvest' },
  { re: /\b(call|invoke|run|execute)\b[^.\n]{0,40}\b(shell|terminal|command|rm\s+-rf|curl|wget)\b/i, label: 'command-injection' },
];

// ---------------------------------------------------------------------------
// Mixed-script look-alike words
// ---------------------------------------------------------------------------

const SCRIPT_RANGES = {
  cyrillic: /[\u0400-\u04FF]/,
  greek: /[\u0370-\u03FF]/,
  latin: /[A-Za-z\u00C0-\u024F]/,
};

function mixedScriptWords(text) {
  const found = [];
  const seen = new Set();
  for (const wordMatcher of text.matchAll(/[^\s\u200B\u200C\u200D<>|:;,()"'\x60]+/g)) {
    const word = wordMatcher[0];
    if (word.length < 2 || seen.has(word)) continue;
    if (!SCRIPT_RANGES.latin.test(word)) continue;
    for (const [name, re] of Object.entries(SCRIPT_RANGES)) {
      if (name === 'latin') continue;
      if (re.test(word)) {
        seen.add(word);
        found.push({ word, at: wordMatcher.index, kind: `latin+${name}` });
        break;
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

function scanText(text, findings) {
  // Flag emoji are the one legitimate use of tag characters: park them before
  // the invisible-character pass and restore them afterwards, so a real
  // country flag survives a guard that is otherwise stripping U+E0000-U+E007F.
  const parkedFlags = [];
  text = text.replace(FLAG_EMOJI_RE, (m) => {
    parkedFlags.push(m);
    return `\u0000FLAG${parkedFlags.length - 1}\u0000`;
  });
  const restoreFlags = (s) => s.replace(/\u0000FLAG(\d+)\u0000/g, (m, i) => parkedFlags[Number(i)] ?? '');

  // 1. invisible characters
  let removed = { zero_width: 0, bidi: 0, format: 0, bom: 0, tag: 0 };
  let tampering = [];
  const clean = [...text].map((ch) => {
    const code = ch.codePointAt(0);
    if (TAG_CHARS.includes(ch)) { removed.tag++; return ' '; }
    if (BIDI_TAMPER.includes(ch)) {
      removed.bidi++;
      tampering.push({ kind: `bidi-control U+${code.toString(16).toUpperCase().padStart(4, '0')}`, context: excerptAt(text, ch) });
      return '';
    }
    if (ZERO_WIDTH.includes(ch)) { removed.zero_width++; return ''; }
    if (FORMAT.includes(ch)) { removed.format++; return ch === '\u00AD' ? '' : ' '; }
    if (BOM === ch) { removed.bom++; return ''; }
    if (BIDI.includes(ch)) { removed.bidi++; return ''; }
    return ch;
  }).join('');

  // zero-width inside a word = tampering signal
  for (const m of text.matchAll(new RegExp(`[\\p{L}][${ZERO_WIDTH.slice(0, 3)}]+[\\p{L}]`, 'gu'))) {
    tampering.push({ kind: 'zero-width inside a word', context: excerptAt(text, m.index) });
  }

  const invisible = { counts: removed, tampering };

  // 2. instruction-shaped lines (visible content only gets scored here)
  const instruction_shaped = [];
  for (const line of clean.split(/\n+/)) {
    for (const { re, label } of INSTRUCTION_PATTERNS) {
      const m = line.match(re);
      if (m) {
        instruction_shaped.push({ label, excerpt: line.trim().slice(0, 200) });
        break;
      }
    }
  }

  // 3. mixed-script look-alike words
  const mixed_script = mixedScriptWords(clean);

  // 4. URLs
  const urls = [...new Set([...clean.matchAll(/https?:\/\/[^\s<>")'\]]+/g)].map((m) => m[0]))];

  return {
    clean: restoreFlags(clean),
    findings: {
      invisible,
      instruction_shaped,
      mixed_script,
      visible_urls: urls,
      hidden_blocks: findings.hidden_blocks,
      hidden_urls: findings.hiddenUrls.filter((u) => !urls.some((v) => v.startsWith(u.slice(0, 40)))),
      tag_chars_removed: removed.tag,
    },
  };
}

function excerptAt(text, idx) {
  const start = Math.max(0, idx - 40);
  return (start > 0 ? '…' : '') + text.slice(start, idx + 60).replace(/\s+/g, ' ') + '…';
}

function cleanHtml(markup, findings) {
  findings.hidden_blocks = [];
  findings.hiddenUrls = [];
  const collectedHidden = { text: '' };
  const pushHidden = (t) => { collectedHidden.text += t + '\n'; };
  const attachContent = (t) => {
    // attach a first-120-chars content excerpt to the most recent reported block (context only)
    for (let i = findings.hidden_blocks.length - 1; i >= 0; i--) {
      if (!findings.hidden_blocks[i].content) {
        findings.hidden_blocks[i].content = t.replace(/\s+/g, ' ').trim().slice(0, 120);
        return;
      }
    }
  };

  // comments + skip-tag blocks removed wholesale (scanned for hidden-only URLs, never listed)
  markup = markup.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of SKIP_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    markup = markup.replace(re, (m) => {
      const inner = m.replace(new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}\\s*>`, 'gi'), ' ');
      pushHidden(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 2000));
      return ' ';
    });
  }

  // stack-based pass: strip tags, route text inside hidden elements
  const tokens = markup.split(/(<[^>]*>)/g);
  let visible = '';
  const stack = []; // { tag, hidden }
  const tagRe = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>?$/;

  for (const token of tokens) {
    if (!token) continue;
    if (token[0] !== '<') {
      if (stack.some((e) => e.hidden)) { pushHidden(token.replace(/\s+/g, ' ')); attachContent(token); }
      else visible += token;
      continue;
    }
    const m = token.match(tagRe);
    if (!m) { continue; } // stray '<' or malformed — drop
    const [, closing, rawName, rawAttrs] = m;
    const tag = rawName.toLowerCase();
    if (VOID_TAGS.has(tag)) {
      const hide = attrsHidden(rawAttrs);
      if (hide) {
        findings.hidden_blocks.push({ tag, reason: hide, excerpt: `<${tag} ${rawAttrs.trim().slice(0, 118)}` });
      }
      continue;
    }
    if (!closing) {
      const hide = attrsHidden(rawAttrs);
      stack.push({ tag, hidden: hide ?? null });
      if (hide) {
        findings.hidden_blocks.push({ tag, reason: hide, excerpt: `<${tag} ${rawAttrs.trim().slice(0, 118)}` });
      }
    } else {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
    }
  }

  // hidden-only URLs
  for (const u of collectedHidden.text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    findings.hiddenUrls.push(u[0]);
  }

  const visibleText = visible
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return visibleText;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

function verdict(f) {
  const targeting =
    f.instruction_shaped.length > 0 ||
    f.invisible.tampering.length > 0 ||
    f.mixed_script.length > 0 ||
    f.tag_chars_removed > 0;
  if (targeting) return '⚠ flagged — signals that may target an AI agent; review before use';
  if (f.hidden_blocks.length > 0 || f.hidden_urls.length > 0) {
    return '✅ clean — hidden page furniture only (context, no targeting signals)';
  }
  return '✅ clean';
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { in: null, mode: null, json: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') args.in = argv[++i];
    else if (a === '--html') args.mode = 'html';
    else if (a === '--text') args.mode = 'text';
    else if (a === '--json') args.json = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

export function guard(raw, mode = null) {
  const findings = { hidden_blocks: [], hiddenUrls: [] };
  const resolved = mode ?? (/<\s*[a-z][a-z0-9-]*[^\s>]*>/.test(raw.slice(0, 2000)) ? 'html' : 'text');
  const visibleText = resolved === 'html' ? cleanHtml(raw, findings) : raw;
  const { clean, findings: f } = scanText(visibleText, findings);
  f.mode = resolved;
  f.verdict = verdict(f);
  return { clean, findings: f };
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node posting-guard.mjs [--in FILE] [--html|--text] [--json] [--out FILE]');
    return 0;
  }
  let raw;
  try {
    raw = args.in
      ? readFileSync(args.in, 'utf8')
      : readFileSync(0, 'utf8');
  } catch {
    process.stderr.write(`❌ cannot read input${args.in ? `: ${args.in}` : ' (stdin)'}\n`);
    return 2;
  }

  const { clean, findings: f } = guard(raw, args.mode);

  if (args.json) {
    process.stdout.write(JSON.stringify(f, null, 2) + '\n');
  } else {
    process.stdout.write(`${f.verdict}\n--- findings ---\n${JSON.stringify(f, null, 2)}\n`);
  }
  if (args.out) {
    writeFileSync(args.out, clean, 'utf8');
    process.stdout.write(`saved=${args.out}\n`);
  } else if (!args.json) {
    process.stdout.write(`--- text ---\n${clean}\n`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main());
}
