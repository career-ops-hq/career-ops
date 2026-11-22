#!/usr/bin/env node
// @ts-check
// plugin-audit.mjs — static safety scan for COMMUNITY/registry plugins (run by
// `plugins.mjs add` and by the registry-validate CI). Lives at repo ROOT (not
// under plugins/) on purpose: it must reference forbidden-API names + firewall
// phrases, and root files are not walked by test-all's plugin deny-list/firewall
// greps. Bundled plugins in plugins/ are reviewed in-tree and are NOT subject to
// this scan (apify legitimately uses its own pinned client).
//
// This is a STATIC heuristic, not containment — it raises the bar for an honest
// or lazily-malicious author and gives the reviewer a checklist. A determined
// attacker can obfuscate; the real controls are review + pinning + capability.
//
// Source is read as tokens (lib/js-lexer.mjs), never as text: comments, strings
// and regex literals cannot hide or fake a load, and specifiers and identifiers
// are checked at the value Node reads, after escapes and line continuations.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { lexJs, MAX_RUNS } from './lib/js-lexer.mjs';
import { listTree } from './lib/walk-tree.mjs';

// Built from fragments so the literal API/firewall tokens never appear verbatim
// (keeps this file clean against any future repo-wide grep).
const cp = 'child' + '_process';
const FORBIDDEN_MODULES = new Set([
  cp, 'node:' + cp, 'playwright', 'worker_threads', 'node:worker_threads',
  'vm', 'node:vm', 'node:http', 'node:https', 'node:net', 'node:dns',
  'node:dns/promises', 'node:tls', 'node:dgram', 'http', 'https', 'net', 'dns', 'tls', 'dgram',
  'node:cluster', 'node:v8', 'node:inspector', 'node:repl',
]);
// node: builtins a plugin may use (no egress, no spawn).
const ALLOWED_NODE = new Set([
  'node:crypto', 'node:url', 'node:path', 'node:buffer', 'node:util',
  'node:querystring', 'node:string_decoder', 'node:assert', 'node:events',
  'node:fs', 'node:fs/promises', 'node:os', 'node:zlib', 'node:stream',
]);

// What a computed load warns about. These name loads the audit cannot read.
const computedIssue = (what) => `computed import()/require() ${what} — deprecated: it hides what the plugin loads from this audit and from review, and can load code outside the plugin's integrity-pinned tree. A future release may make it an error unless the plugin declares the need.`;
// Findings the token scan raises, in the order they are reported.
const SCAN_ISSUES = {
  fetch: 'direct global fetch() — use ctx.fetch so the egress allowlist applies',
  xhr: 'XMLHttpRequest/WebSocket egress — use ctx.fetch',
  eval: 'eval/new Function — dynamic code execution is not allowed',
  getBuiltinModule: 'process.getBuiltinModule — loads a node builtin around the import allowlist',
  binding: 'process.binding/dlopen — native escape hatch not allowed',
};
// Reaching the Function constructor, or calling code, by a route that does not
// read as eval( or Function( . Harmless uses look the same, so these warn.
const dynamicIssue = (what) => `${what} — can reach the Function constructor or call code by a route the audit cannot follow; it warns because a harmless use looks the same. A future release may make it an error unless the plugin declares the need.`;
const loaderHookIssue = (what) => `${what} — reaches the module loader's own hooks, which load or run files by a path the audit cannot read`;
// Extensions Node's loader runs as code. An extensionless file runs too: Node
// imports it as a module, and require() loads any extension as CommonJS.
const CODE_EXTS = new Set(['.mjs', '.js', '.cjs', '.mts', '.ts', '.cts']);
// Which files the audit READS is decided in lower case, because macOS and
// Windows resolve EVIL.MJS for ./evil.mjs. Only an exact .json is data: Node
// loads x.JSON through require() as CommonJS code, so it is read like any other.
const isCodeFile = (file) => {
  const ext = path.extname(file);
  const lower = ext.toLowerCase();
  return ext !== '.json' && (CODE_EXTS.has(lower) || lower === '.json' || ext === '');
};
const firewallRe = new RegExp('\\b(' + ['revenue', 'pricing', 'paywall', 'monetiz\\w*', 'moat'].join('|') + ')\\b', 'i');

// --- CLI args ---
const KNOWN_FLAGS = ['--help', '-h'];

const USAGE = `Usage:
  node plugin-audit.mjs <plugin-dir>
  node plugin-audit.mjs --help`;

const isP = (t, v) => t !== undefined && t.t === 'punct' && t.v === v;
const isId = (t, v) => t !== undefined && t.t === 'ident' && t.v === v;
const isStr = (t) => t !== undefined && t.t === 'string';
const isDot = (t) => isP(t, '.') || isP(t, '?.');

/**
 * The property read right after tokens[i]: `.name`, `?.name` or `['name']`.
 * `name` is null for an index the scan cannot read, undefined result for no
 * property access at all.
 */
function memberAfter(T, i) {
  let j = i + 1;
  if (isP(T[j], '?.') && isP(T[j + 1], '[')) j++;
  if (isDot(T[j])) return T[j + 1]?.t === 'ident' ? { name: T[j + 1].v } : { name: null };
  if (isP(T[j], '[')) return isStr(T[j + 1]) && isP(T[j + 2], ']') ? { name: T[j + 1].v } : { name: null };
  return undefined;
}

/** The module specifier of `import <clause> from 'x'`, or undefined. T[i] is `import`. */
function importClauseSpec(T, i) {
  for (let j = i + 1; j < T.length; j++) {
    const t = T[j];
    if (t.t === 'ident') {
      if (t.v === 'from' && isStr(T[j + 1])) return T[j + 1];
      if (t.v === 'import' || t.v === 'export') return undefined;
    } else if (isP(t, '{')) {
      for (j++; j < T.length && !isP(T[j], '}'); j++) if (!(T[j].t === 'ident' || T[j].t === 'string' || isP(T[j], ','))) return undefined;
    } else if (!isP(t, '*') && !isP(t, ',')) return undefined;
  }
  return undefined;
}

/** The module specifier of `export * from 'x'` or `export { a } from 'x'`, or undefined. T[i] is `export`. */
function exportFromSpec(T, i) {
  let j = i + 1;
  if (isId(T[j], 'type')) j++;
  if (isP(T[j], '*')) {
    j++;
    if (isId(T[j], 'as')) j += 2;
  } else if (isP(T[j], '{')) {
    for (j++; j < T.length && !isP(T[j], '}'); j++) if (!(T[j].t === 'ident' || T[j].t === 'string' || isP(T[j], ','))) return undefined;
    j++;
  } else return undefined;
  return isId(T[j], 'from') && isStr(T[j + 1]) ? T[j + 1] : undefined;
}

// Is a `fetch(` call the global? Not when a parameter, a declaration or the
// method definition it sits in names it. This reads just enough structure to
// tell: function, arrow and catch parameters, `const`/`let`/`var`/`function`/
// `class` declarations (scoped to the enclosing block, or the file at the top
// level), and `name(...) {` on one line, which only a method definition is.
// Where it cannot tell it says the name is global, so the cost of a miss is a
// false finding and never a hidden call.
const NOT_A_METHOD = new Set(['if', 'for', 'while', 'switch', 'with', 'catch', 'function', 'do', 'else', 'try', 'finally', 'return', 'typeof', 'new', 'await', 'yield']);
const BEFORE_A_METHOD = new Set(['{', '}', ',', ';', '*']);
function localFetchIndex(T, lineOf) {
  const n = T.length;
  const match = new Int32Array(n).fill(-1);
  const open = { '(': [], '{': [], '[': [] };
  const opener = { ')': '(', '}': '{', ']': '[' };
  for (let k = 0; k < n; k++) {
    const t = T[k];
    if (t.t !== 'punct') continue;
    if (open[t.v]) open[t.v].push(k);
    else if (opener[t.v]) { const o = open[opener[t.v]].pop(); if (o !== undefined) { match[o] = k; match[k] = o; } }
  }
  const cover = new Int32Array(n + 2);
  const shadow = (a, b) => { if (a <= b) { cover[a]++; cover[b + 1]--; } };
  // Hostile nesting must not make this quadratic or overflow the stack, so the
  // work is capped; past the cap every fetch call counts as the global.
  let budget = 40 * n + 1000;
  let gaveUp = false;
  const end = (k) => (k >= 0 ? k : n - 1);

  // The index after an expression that starts at k: stops at a depth-0 , ; ) ] }
  // (and, for an initializer, at a line break).
  const skipExpr = (k, byLine) => {
    const line = k < n ? lineOf(T[k].pos) : 0;
    for (; k < n; k++) {
      if (--budget < 0) { gaveUp = true; return n; }
      const t = T[k];
      if (t.t === 'punct') {
        if (t.v === '(' || t.v === '{' || t.v === '[') { if (match[k] < 0) return n; k = match[k]; continue; }
        if (t.v === ',' || t.v === ';' || t.v === ')' || t.v === ']' || t.v === '}') return k;
      }
      if (byLine && lineOf(t.pos) > line) return k;
    }
    return n;
  };
  // Binding names in the pattern at T[j]; returns the index after it, or n if it is not a pattern.
  const pattern = (j, out, depth = 0) => {
    const t = T[j];
    if (t === undefined || --budget < 0 || depth > 32) { if (budget < 0) gaveUp = true; return n; }
    if (t.t === 'ident') { out.push(j); return j + 1; }
    const close = t.t === 'punct' && (t.v === '{' || t.v === '[') ? match[j] : -1;
    if (close < 0) return n;
    let k = j + 1;
    while (k < close) {
      if (isP(T[k], '...')) { k = pattern(k + 1, out, depth + 1); if (k >= n) return n; }
      else if (t.v === '[') { if (!isP(T[k], ',')) { k = pattern(k, out, depth + 1); if (k >= n) return n; } }
      else if (isP(T[k], '[')) { k = match[k] + 1; if (k <= 0 || !isP(T[k], ':')) return n; k = pattern(k + 1, out, depth + 1); if (k >= n) return n; }
      else if (T[k].t === 'ident' || T[k].t === 'string' || T[k].t === 'num') {
        if (isP(T[k + 1], ':')) { k = pattern(k + 2, out, depth + 1); if (k >= n) return n; }
        else if (T[k].t === 'ident') { out.push(k); k++; }
        else return n;
      } else return n;
      if (isP(T[k], '=')) k = skipExpr(k + 1, false);
      if (isP(T[k], ',')) k++;
      else if (k < close && t.v === '{') return n;
    }
    return close + 1;
  };
  // The binding identifiers in a parameter list whose `(` is at p.
  const params = (p) => {
    const out = [];
    const q = match[p];
    for (let k = p + 1; k < q;) {
      if (isP(T[k], '...')) k++;
      k = pattern(k, out);
      if (k >= n) break;
      if (isP(T[k], '=')) k = skipExpr(k + 1, false);
      if (isP(T[k], ',')) k++;
      else break;
    }
    return out;
  };
  const binds = (idx) => idx.some((k) => T[k].v === 'fetch');
  // The end of an arrow's body, which starts at k.
  const arrowEnd = (k) => (isP(T[k], '{') ? end(match[k]) : skipExpr(k, true) - 1);

  const braces = [];
  const parens = [];
  for (let k = 0; k < n; k++) {
    const t = T[k];
    const prev = T[k - 1];
    if (t.t === 'punct') {
      if (t.v === '{') braces.push(k);
      else if (t.v === '}') braces.pop();
      else if (t.v === '(') {
        parens.push(k);
        const q = match[k];
        if (q < 0) continue;
        const after = T[q + 1];
        let b = k - 1;
        if (isP(T[b], '*')) b--;
        else if (T[b] && T[b].t === 'ident' && T[b].v !== 'function' && !NOT_A_METHOD.has(T[b].v)) { b--; if (isP(T[b], '*')) b--; }
        const isFunction = isId(T[b], 'function') && !isDot(T[b - 1]) && !isP(T[b - 1], '#');
        const name = T[k - 1];
        const isMethod = !isFunction && after && isP(after, '{') && lineOf(T[q].pos) === lineOf(after.pos)
          && name && name.t === 'ident' && !NOT_A_METHOD.has(name.v) && (k === 1 || BEFORE_A_METHOD.has(T[k - 2]?.v) || (T[k - 2]?.t === 'ident' && ['async', 'static', 'get', 'set'].includes(T[k - 2].v)));
        if ((isFunction || isMethod || (isId(prev, 'catch') && isP(T[k - 2], '}') && !isDot(T[k - 2]))) && isP(after, '{')) { if (binds(params(k))) shadow(k, end(match[q + 1])); }
        else if (isP(after, '=>')) { if (binds(params(k))) shadow(k, arrowEnd(q + 2)); }
      } else if (t.v === ')') parens.pop();
      continue;
    }
    if (t.t !== 'ident') continue;
    if (isDot(prev) || isP(prev, '#')) continue;
    if (t.v === 'fetch' && isP(T[k + 1], '=>')) { shadow(k, arrowEnd(k + 2)); continue; }
    if (t.v === 'const' || t.v === 'let' || t.v === 'var') {
      const names = [];
      for (let j = k + 1; j < n;) {
        j = pattern(j, names);
        if (j >= n) break;
        if (isP(T[j], '=')) j = skipExpr(j + 1, true);
        if (isP(T[j], ',')) j++;
        else break;
      }
      if (binds(names)) {
        const inHeader = parens.length > 0 && (braces.length === 0 || parens[parens.length - 1] > braces[braces.length - 1]);
        if (inHeader) { const q = match[parens[parens.length - 1]]; shadow(parens[parens.length - 1], q >= 0 && isP(T[q + 1], '{') ? end(match[q + 1]) : (q >= 0 ? q : n - 1)); }
        else if (braces.length) shadow(braces[braces.length - 1], end(match[braces[braces.length - 1]]));
        else shadow(0, n - 1);
      }
    } else if (t.v === 'function' || t.v === 'class') {
      let j = k + 1;
      if (isP(T[j], '*')) j++;
      // A function or class declaration binds its name in the enclosing scope; an expression only inside itself.
      let b = k - 1;
      if (isId(T[b], 'async')) b--;
      const declaration = b < 0 || isP(T[b], ';') || isP(T[b], '{') || isP(T[b], '}') || isId(T[b], 'export') || isId(T[b], 'default');
      if (declaration && isId(T[j], 'fetch')) {
        if (braces.length) shadow(braces[braces.length - 1], end(match[braces[braces.length - 1]]));
        else shadow(0, n - 1);
      }
    }
  }
  if (gaveUp) cover.fill(0);
  else for (let k = 1; k < cover.length; k++) cover[k] += cover[k - 1];

  // A method definition's own name is not a call.
  const isMethodName = (i) => {
    const open = i + 1;
    const q = match[open];
    if (!isP(T[open], '(') || q < 0 || !isP(T[q + 1], '{') || lineOf(T[q].pos) !== lineOf(T[q + 1].pos)) return false;
    const before = T[i - 1];
    return before === undefined || BEFORE_A_METHOD.has(before.v) || (before.t === 'ident' && ['async', 'static', 'get', 'set'].includes(before.v));
  };
  return (i) => cover[i] === 0 && !isMethodName(i);
}

/**
 * Everything a source file loads, read from tokens: the module specifiers it
 * names (already decoded to the value Node loads), the loads whose target the
 * audit cannot read, and the findings raised by what the tokens say.
 */
function scanLoads(T, lineOf) {
  const specs = [];
  const computed = [];
  const dynamic = [];
  const flags = new Set();
  const hooks = new Set();
  // Is T[i] called, `x(` or `x?.(`? Returns the index of the `(`, or -1.
  const callAt = (i) => (isP(T[i + 1], '(') ? i + 1 : isP(T[i + 1], '?.') && isP(T[i + 2], '(') ? i + 2 : -1);
  let fetchIsGlobal = null;
  const indexes = (x) => x !== undefined && (x.t === 'ident' || x.t === 'string' || x.t === 'tpl' || x.t === 'num' || isP(x, ')') || isP(x, ']'));
  const literalArg = (open) => isStr(T[open + 1]) && (isP(T[open + 2], ',') || isP(T[open + 2], ')'));
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    const prev = T[i - 1];
    const next = T[i + 1];
    if (t.t === 'string') {
      if (t.v === 'getBuiltinModule') flags.add('getBuiltinModule');
      if (t.v === '_load' && isP(prev, '[')) hooks.add('Module._load');
      // x['constructor'], where the bracket indexes a value and does not open an array or a computed key.
      if (t.v === 'constructor' && isP(prev, '[') && indexes(T[i - 2]) && !isId(T[i - 2], 'module')) dynamic.push({ pos: t.pos, what: "['constructor']" });
      continue;
    }
    if (t.t !== 'ident') continue;
    switch (t.v) {
      case 'import':
        if (isP(next, '(')) { if (literalArg(i + 1)) specs.push(T[i + 2]); else computed.push({ pos: t.pos, what: 'specifier' }); }
        else if (isDot(prev) || isP(next, '.')) break; // x.import, import.meta
        else if (isStr(next)) specs.push(next);
        else { const s = importClauseSpec(T, i); if (s) specs.push(s); }
        break;
      case 'export': {
        const s = isDot(prev) ? undefined : exportFromSpec(T, i);
        if (s) specs.push(s);
        break;
      }
      case 'require': {
        const member = memberAfter(T, i);
        if (member && member.name === 'extensions') hooks.add('require.extensions');
        if (isId(prev, 'typeof')) break;
        const open = callAt(i);
        if (open >= 0) { if (literalArg(open)) specs.push(T[open + 1]); else computed.push({ pos: t.pos, what: 'specifier' }); }
        else if (member) { if (member.name === null || member.name === 'call' || member.name === 'apply' || member.name === 'bind') computed.push({ pos: t.pos, what: 'through an alias of require' }); }
        else if (isDot(prev)) { if (isId(T[i - 2], 'module')) computed.push({ pos: t.pos, what: 'through an alias of require' }); }
        else if (isP(next, ':') && (isP(prev, '{') || isP(prev, ','))) break; // an object key
        else computed.push({ pos: t.pos, what: 'through an alias of require' });
        break;
      }
      case 'createRequire': computed.push({ pos: t.pos, what: 'through createRequire()' }); break;
      case 'arguments': if (isP(next, '[')) computed.push({ pos: t.pos, what: 'through arguments[]' }); break;
      case 'module': { const m = memberAfter(T, i); if (m && m.name === 'constructor') hooks.add('module.constructor'); break; }
      case '_load': if (isDot(prev)) hooks.add('Module._load'); break;
      case 'process': { const m = memberAfter(T, i); if (m && (m.name === 'binding' || m.name === 'dlopen')) flags.add('binding'); break; }
      case 'getBuiltinModule': flags.add('getBuiltinModule'); break;
      case 'fetch':
        if (callAt(i) >= 0 && !isDot(prev) && !isP(prev, '#')) {
          fetchIsGlobal ??= localFetchIndex(T, lineOf);
          if (fetchIsGlobal(i)) flags.add('fetch');
        }
        break;
      case 'XMLHttpRequest': case 'WebSocket': flags.add('xhr'); break;
      case 'Function': {
        if (callAt(i) >= 0) { flags.add('eval'); break; }
        if (isDot(prev) || isP(prev, '#') || isId(prev, 'instanceof') || isId(prev, 'typeof') || (isP(next, ':') && (isP(prev, '{') || isP(prev, ',')))) break;
        const m = memberAfter(T, i);
        if (m && m.name === 'prototype') break;
        dynamic.push({ pos: t.pos, what: m && (m.name === 'call' || m.name === 'apply' || m.name === 'bind') ? `Function.${m.name}` : 'Function used as a value' });
        break;
      }
      case 'Reflect': {
        const m = isDot(prev) ? undefined : memberAfter(T, i);
        if (m && (m.name === 'construct' || m.name === 'apply')) dynamic.push({ pos: t.pos, what: `Reflect.${m.name}` });
        break;
      }
      case 'constructor':
        // module.constructor is a finding of its own; x.constructor.name cannot run code.
        if (isDot(prev) && !isId(T[i - 2], 'module') && !(isDot(next) && T[i + 2]?.t === 'ident' && T[i + 2].v === 'name')) dynamic.push({ pos: t.pos, what: '.constructor' });
        break;
      // eval used as a value ((0, eval)(x), const e = eval) is an indirect call.
      case 'eval': if (callAt(i) >= 0 || !(isDot(prev) || (isP(next, ':') && (isP(prev, '{') || isP(prev, ','))))) flags.add('eval'); break;
      default: break;
    }
  }
  return { specs: specs.map((s) => s.v), computed, dynamic, flags, hooks };
}

// Where a relative specifier lands, resolved the way an ES module resolves it
// (a URL, so ./%2e%2e/ is ../ and ./%6eode_modules/ is ./node_modules/): null
// inside the plugin, 'outside' when it leaves the plugin directory, 'unpinned'
// when it goes through a directory the integrity lock never hashes.
const SKIPPED_BY_LOCK = new Set(['node_modules', '.git']);
function relativeReach(fromRel, spec) {
  const dir = path.posix.dirname(fromRel);
  const base = 'file:///plugin/' + (dir === '.' ? '' : dir.split('/').map(encodeURIComponent).join('/') + '/');
  let url;
  try { url = new URL(spec, base); } catch { return 'outside'; }
  if (!url.pathname.startsWith('/plugin/')) return 'outside';
  const decode = (seg) => { try { return decodeURIComponent(seg).toLowerCase(); } catch { return seg.toLowerCase(); } };
  return url.pathname.slice('/plugin/'.length).split('/').some((seg) => SKIPPED_BY_LOCK.has(decode(seg))) ? 'unpinned' : null;
}

// Strings under main, exports and imports are paths Node loads. Bare names in
// imports are packages, and a bare package is already a finding as an import.
function packageJsonTargets(pkg) {
  const out = [];
  const walk = (value, key, isPath) => {
    if (typeof value === 'string') { if (isPath || /^\.{0,2}\//.test(value)) out.push({ key, value }); }
    else if (Array.isArray(value)) value.forEach((v) => walk(v, key, isPath));
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => walk(v, key, isPath));
  };
  if (pkg && typeof pkg === 'object') {
    walk(pkg.main, 'main', true);
    walk(pkg.exports, 'exports', false);
    walk(pkg.imports, 'imports', false);
  }
  return out;
}

// Compiled code the audit cannot read. require() tries .js, .json and .node in
// turn, so a name with no extension (or a directory's index) can land on one.
const NATIVE_EXTS = ['.node', '.wasm'];
const resolvesToNative = (abs) => NATIVE_EXTS.some((ext) => existsSync(abs + ext) || existsSync(path.join(abs, 'index' + ext)));
const NATIVE_TARGET_ISSUE = 'resolves to a native addon or WebAssembly file, compiled code the audit cannot read';

function listCode(dir) {
  const rel = (abs) => path.relative(dir, abs).split(path.sep).join('/');
  // Not walked, but reported: the engine imports whatever the entry reaches,
  // and registry plugins must be dependency-free, so a committed node_modules
  // is code the audit would otherwise never read.
  const nodeModules = [];
  const all = listTree(dir, {
    skip: (e, parent) => {
      if (e.name === 'node_modules') { nodeModules.push(rel(path.join(parent, e.name))); return true; }
      return e.name === '.git';
    },
    // Deliberately walks INTO a nested checkout. This is a deny-list scan over
    // third-party plugin code: a directory that could opt out of the audit by
    // planting a `.git` marker is a place to hide a forbidden import.
    allowNestedCheckouts: true,
    // ...and follows links, for the same reason. `import()` resolves a symlink
    // of either kind, so whatever a link reaches is code the plugin can load:
    // a symlinked file (which the hand-rolled walk this replaced did read) and
    // a symlinked directory (which it did not — a hole this closes). walkTree
    // stops at a link onto its own ancestor, so a loop cannot hang the audit.
    links: 'follow',
  });
  const files = all.filter(isCodeFile).map((abs) => ({ abs, rel: rel(abs) }));
  // A native addon is not code the audit reads, so it is reported by name.
  const natives = all.filter((abs) => path.extname(abs).toLowerCase() === '.node').map(rel);
  // Node reads package.json by exact name, which a case-insensitive filesystem
  // matches in any case.
  const packages = all.filter((abs) => path.basename(abs).toLowerCase() === 'package.json').map((abs) => ({ abs, rel: rel(abs) }));
  return { files, packages, nodeModules, natives };
}

const UNREADABLE_ISSUE = {
  unterminated: 'file could not be fully read — it ends inside a template literal or a comment, which hides everything after it from this audit',
  capped: `file could not be fully read — more than ${MAX_RUNS} readings of "/" (regex or division) or of an HTML-like comment, so the audit cannot tell what it loads`,
};

/**
 * The findings one reading of a file raises, and the warnings it adds.
 * @param {string} rel
 * @param {any[]} tokens
 * @param {(pos: number) => number} lineOf
 * @param {Array<{file:string, line:number, issue:string}>} warnings
 * @param {Set<string>} warned
 * @param {(spec: string) => boolean} nativeFor whether a relative specifier resolves to a native or WebAssembly file
 */
function auditTokens(rel, tokens, lineOf, warnings, warned, nativeFor) {
  const findings = [];
  const { specs, computed, dynamic, flags, hooks } = scanLoads(tokens, lineOf);
  for (const spec of specs) {
    const isRelative = spec.startsWith('./') || spec.startsWith('../');
    const ext = path.extname(spec);
    // Judged on the raw name, never lower-cased: whether an import is safe is
    // what Node does with that exact spelling.
    if (isRelative && ext && ext !== ext.toLowerCase()) findings.push({ file: rel, issue: `relative import "${spec}" uses a non-canonical extension` });
    else if (isRelative && ext && ext !== '.json' && !CODE_EXTS.has(ext)) findings.push({ file: rel, issue: `relative import "${spec}" loads a file type the audit does not read` });
    if (isRelative && nativeFor(spec)) findings.push({ file: rel, issue: `relative import "${spec}" ${NATIVE_TARGET_ISSUE}` });
    const reach = isRelative ? relativeReach(rel, spec) : null;
    if (reach === 'outside') findings.push({ file: rel, issue: `relative import "${spec}" leaves the plugin directory — it reaches code the integrity lock does not pin` });
    else if (reach === 'unpinned') findings.push({ file: rel, issue: `relative import "${spec}" goes through node_modules or .git — the integrity lock does not hash them, so a file that appears there after install would run unnoticed` });
    const isNode = spec.startsWith('node:') || ['crypto', 'url', 'path', 'buffer', 'util', 'fs', 'os', 'zlib', 'stream', 'events', 'assert', 'querystring'].includes(spec);
    if (FORBIDDEN_MODULES.has(spec)) findings.push({ file: rel, issue: `forbidden import "${spec}" — community plugins egress only through ctx.fetch and may not spawn/raw-socket` });
    else if (isNode && !ALLOWED_NODE.has(spec) && !ALLOWED_NODE.has('node:' + spec)) findings.push({ file: rel, issue: `node builtin "${spec}" is not on the plugin allowlist` });
    else if (!isRelative && !isNode) findings.push({ file: rel, issue: `bare-specifier import "${spec}" — registry plugins must be dependency-free (relative + allowlisted node: builtins only)` });
  }
  // Direct egress / code-exec primitives (ctx.fetch / x.fetch are fine).
  for (const flag of ['fetch', 'xhr', 'eval']) if (flags.has(flag)) findings.push({ file: rel, issue: SCAN_ISSUES[flag] });
  for (const [list, describe] of [[computed, computedIssue], [dynamic, dynamicIssue]]) {
    for (const { pos, what } of list) {
      const line = lineOf(pos);
      const issue = describe(what);
      if (!warned.has(`${line}:${issue}`)) { warned.add(`${line}:${issue}`); warnings.push({ file: rel, line, issue }); }
    }
  }
  for (const what of hooks) findings.push({ file: rel, issue: loaderHookIssue(what) });
  for (const flag of ['getBuiltinModule', 'binding']) if (flags.has(flag)) findings.push({ file: rel, issue: SCAN_ISSUES[flag] });
  return findings;
}

/**
 * `warnings` never fail the audit. They name patterns approved plugins still
 * use that the audit cannot see through, so a reviewer and the installing user
 * are told rather than shown a clean result.
 *
 * @param {string} dir absolute plugin directory
 * @returns {{ ok: boolean, findings: Array<{file:string, issue:string}>, warnings: Array<{file:string, line:number, issue:string}> }}
 */
export function auditPlugin(dir) {
  const findings = [];
  const warnings = [];
  const { files, packages, nodeModules, natives } = listCode(dir);
  for (const rel of natives) findings.push({ file: rel, issue: 'native addon (.node) — compiled code the audit cannot read, and no registry plugin needs one' });
  for (const rel of nodeModules) findings.push({ file: rel, issue: 'node_modules directory — registry plugins must be dependency-free, and the audit and integrity lock do not read it' });
  for (const { abs, rel } of packages) {
    let pkg;
    // Node drops a leading byte order mark before it parses a package.json.
    try { pkg = JSON.parse(readFileSync(abs, 'utf8').replace(/^\uFEFF/, '')); } catch {
      findings.push({ file: rel, issue: 'package.json could not be parsed — Node rejects it, and the audit reads main, exports and imports from it' });
      continue;
    }
    for (const { key, value } of packageJsonTargets(pkg)) {
      const ext = path.extname(value);
      if (ext && ext !== '.json' && !CODE_EXTS.has(ext)) findings.push({ file: rel, issue: `package.json "${key}" points at "${value}", a file type the audit does not read` });
      else if (resolvesToNative(path.resolve(path.dirname(abs), value))) findings.push({ file: rel, issue: `package.json "${key}" points at "${value}", which ${NATIVE_TARGET_ISSUE}` });
    }
  }
  for (const { abs, rel } of files) {
    const src = readFileSync(abs, 'utf8');
    // An ES module has no HTML-like comments; any other file might be CommonJS.
    const ext = path.extname(abs).toLowerCase();
    const { runs, capped, lineOf } = lexJs(src, { html: ext !== '.mjs' && ext !== '.mts' });
    // A run that ends inside a template or a comment is not what Node runs: Node
    // rejects the file. Drop such runs unless every run is one.
    const complete = runs.filter((r) => !r.incomplete);
    if (complete.length === 0) findings.push({ file: rel, issue: UNREADABLE_ISSUE.unterminated });
    if (capped) findings.push({ file: rel, issue: UNREADABLE_ISSUE.capped });
    const seen = new Set();
    const warned = new Set();
    // Node decodes percent-escapes in a module specifier, and a path that leaves the plugin is a finding of its own.
    const nativeFor = (spec) => {
      let decoded = spec;
      try { decoded = decodeURIComponent(spec); } catch { /* keep the raw spelling */ }
      const target = path.resolve(dir, path.dirname(rel), decoded);
      return target.startsWith(dir + path.sep) && resolvesToNative(target);
    };
    (complete.length ? complete : runs).forEach((run, index) => {
      // Every run is a reading of the same file, so report what any of them
      // loads, once: the first run as it is, later runs only for what is new.
      for (const f of auditTokens(rel, run.tokens, lineOf, warnings, warned, nativeFor)) {
        if (index === 0 || !seen.has(f.issue)) findings.push(f);
        seen.add(f.issue);
      }
    });
    if (firewallRe.test(src)) findings.push({ file: rel, issue: 'commercial/monetization wording in a shipped community plugin (keep it mission-framed)' });
  }
  return { ok: findings.length === 0, findings, warnings };
}

// CLI: node plugin-audit.mjs <dir>
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE);
  const dir = args.find(a => !a.startsWith('-'));
  if (!dir) { console.error(USAGE); process.exit(2); }
  let result;
  try { result = auditPlugin(path.resolve(dir)); } catch (e) { console.error('audit failed:', e.message); process.exit(2); }
  for (const w of result.warnings) console.log(`⚠ ${w.file}:${w.line}: ${w.issue}`);
  if (result.ok) { console.log('✓ audit clean'); process.exit(0); }
  for (const f of result.findings) console.log(`✗ ${f.file}: ${f.issue}`);
  process.exit(1);
}
