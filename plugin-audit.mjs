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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

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

const IMPORT_RE = /\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
const DYN_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
const firewallRe = new RegExp('\\b(' + ['revenue', 'pricing', 'paywall', 'monetiz\\w*', 'moat'].join('|') + ')\\b', 'i');

function collectSpecifiers(src) {
  const specs = [];
  for (const re of [IMPORT_RE, DYN_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

function listMjs(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (/\.(mjs|js|cjs)$/.test(e.name)) out.push({ abs, rel: r });
    }
  };
  walk(dir, '');
  return out;
}

/**
 * @param {string} dir absolute plugin directory
 * @returns {{ ok: boolean, findings: Array<{file:string, issue:string}> }}
 */
export function auditPlugin(dir) {
  const findings = [];
  for (const { abs, rel } of listMjs(dir)) {
    const src = readFileSync(abs, 'utf8');
    for (const spec of collectSpecifiers(src)) {
      const isRelative = spec.startsWith('./') || spec.startsWith('../');
      const isNode = spec.startsWith('node:') || ['crypto', 'url', 'path', 'buffer', 'util', 'fs', 'os', 'zlib', 'stream', 'events', 'assert', 'querystring'].includes(spec);
      if (FORBIDDEN_MODULES.has(spec)) findings.push({ file: rel, issue: `forbidden import "${spec}" — community plugins egress only through ctx.fetch and may not spawn/raw-socket` });
      else if (isNode && !ALLOWED_NODE.has(spec) && !ALLOWED_NODE.has('node:' + spec)) findings.push({ file: rel, issue: `node builtin "${spec}" is not on the plugin allowlist` });
      else if (!isRelative && !isNode) findings.push({ file: rel, issue: `bare-specifier import "${spec}" — registry plugins must be dependency-free (relative + allowlisted node: builtins only)` });
    }
    // Direct egress / code-exec primitives (ctx.fetch / x.fetch are fine).
    if (/(?<![.\w$])fetch\s*\(/.test(src)) findings.push({ file: rel, issue: 'direct global fetch() — use ctx.fetch so the egress allowlist applies' });
    if (/\bXMLHttpRequest\b|\bWebSocket\b/.test(src)) findings.push({ file: rel, issue: 'XMLHttpRequest/WebSocket egress — use ctx.fetch' });
    if (/\beval\s*\(|new\s+Function\s*\(/.test(src)) findings.push({ file: rel, issue: 'eval/new Function — dynamic code execution is not allowed' });
    if (/process\s*\.\s*(binding|dlopen)\b/.test(src)) findings.push({ file: rel, issue: 'process.binding/dlopen — native escape hatch not allowed' });
    if (firewallRe.test(src)) findings.push({ file: rel, issue: 'commercial/monetization wording in a shipped community plugin (keep it mission-framed)' });
  }
  return { ok: findings.length === 0, findings };
}

// CLI: node plugin-audit.mjs <dir>
if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage: node plugin-audit.mjs <plugin-dir>'); process.exit(2); }
  let result;
  try { result = auditPlugin(path.resolve(dir)); } catch (e) { console.error('audit failed:', e.message); process.exit(2); }
  if (result.ok) { console.log('✓ audit clean'); process.exit(0); }
  for (const f of result.findings) console.log(`✗ ${f.file}: ${f.issue}`);
  process.exit(1);
}
