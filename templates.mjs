#!/usr/bin/env node
// @ts-check
// templates.mjs — list, add and remove community template packs (#5951, #1778).
// The analog of plugins.mjs. A registered pack installs at its pinned SHA after
// validate-template-pack.mjs passes; templates.lock records what came from where.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';
import { loadRegistry } from './lib/templates-registry.mjs';
import { installPack, installedPacks, removePack } from './lib/templates-install.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHA_RE = /^[0-9a-f]{40}$/;
const USAGE = 'Usage: node templates.mjs [list | available | add <id|owner/repo> [--sha <commit> --confirm] [--force] | remove <id> [--force]]';

/**
 * Split args into positionals and known flags. An unknown flag is an error
 * rather than being dropped: `--sha=<commit>` silently ignored would install a
 * registered pack at the wrong commit's expectations.
 * @returns {{positional: string[], flags: Set<string>, sha: string|null}|{error: string}}
 */
function parseArgs(args, allowed) {
  const positional = [];
  const flags = new Set();
  let sha = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--sha' && allowed.includes('--sha')) {
      const v = args[i + 1];
      if (!SHA_RE.test(v || '')) return { error: '--sha needs a 40-hex commit as the next argument.' };
      sha = v;
      i++;
    } else if (a.startsWith('-')) {
      if (!allowed.includes(a)) return { error: `unknown option ${a}` };
      flags.add(a);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags, sha };
}

function cmdList(root, log) {
  const packs = installedPacks(root);
  if (!packs.length) { log.log('No template packs installed.'); return 0; }
  for (const p of packs) {
    const flag = p.modified.length ? `  ⚠️ ${p.modified.length} file(s) changed since install` : '';
    log.log(`${p.id.padEnd(20)} v${p.version}  ${String(p.sha).slice(0, 10)}  ${p.source}  ${p.files.length} file(s)${flag}`);
  }
  return 0;
}

function cmdAvailable(root, log) {
  const reg = loadRegistry(root).packs;
  if (!reg.length) { log.log('No packs in the registry yet.'); return 0; }
  const have = new Set(installedPacks(root).map((p) => p.id));
  for (const e of reg) {
    log.log(`${e.id.padEnd(20)} v${e.version}  ${e.themes} theme(s)  ${e.kind.join('+')}  ats=${e.ats}  ${e.sha.slice(0, 10)}${have.has(e.id) ? '  ✓ installed' : ''}`);
  }
  return 0;
}

async function cmdAdd(root, args, { clone, log }) {
  const parsed = parseArgs(args, ['--sha', '--confirm', '--force']);
  if ('error' in parsed) { log.error(`${parsed.error}\n${USAGE}`); return 2; }
  const { positional, flags, sha } = parsed;
  const target = positional[0];
  if (!target || positional.length > 1) { log.error(USAGE); return 2; }
  const registered = loadRegistry(root).packs.find((p) => p.id === target || p.name === target);
  let result;
  if (registered) {
    if (sha) { log.error('--sha applies to an unregistered owner/repo; a registered pack installs at its pinned commit.'); return 2; }
    result = installPack(root, { entry: registered, clone, force: flags.has('--force') });
  } else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target) || target.startsWith('https://')) {
    if (!sha || !flags.has('--confirm')) {
      log.error(`"${target}" is not in the registry. To install it as unverified, pass --sha <40-hex commit> --confirm after reading its templates.`);
      return 2;
    }
    const repoUrl = target.startsWith('https://') ? target : `https://github.com/${target}`;
    result = installPack(root, { repoUrl, sha, clone, force: flags.has('--force') });
  } else {
    log.error(`No registered pack "${target}". Run \`node templates.mjs available\`.`);
    return 1;
  }
  log.log(`✓ installed ${result.id} v${result.version} (${result.source}, ${result.sha.slice(0, 10)}): ${result.files.length} file(s) in templates/${result.id}/`);
  return 0;
}

function cmdRemove(root, args, { log }) {
  const parsed = parseArgs(args, ['--force']);
  if ('error' in parsed) { log.error(`${parsed.error}\n${USAGE}`); return 2; }
  const id = parsed.positional[0];
  if (!id || parsed.positional.length > 1) { log.error(USAGE); return 2; }
  const res = removePack(root, id, { force: parsed.flags.has('--force') });
  log.log(`✓ removed ${res.id}: ${res.removed.length} file(s)`);
  return 0;
}

/**
 * Run one command against `root` and return the exit code. `clone` and `log`
 * are injectable so tests can drive the same path the CLI takes, without the
 * network.
 */
export async function runCommand(root, cmd, args, { clone = null, log = console } = {}) {
  switch (cmd) {
    case 'list': case undefined: return cmdList(root, log);
    case 'available': return cmdAvailable(root, log);
    case 'add': {
      const cloneFn = clone || (await import('./plugin-install.mjs')).safeClone;
      return cmdAdd(root, args, { clone: cloneFn, log });
    }
    case 'remove': return cmdRemove(root, args, { log });
    default: log.error(USAGE); return 2;
  }
}

if (isMainModule(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === '--help' || cmd === '-h') { process.stdout.write(`${USAGE}\n`); process.exit(0); }
  try {
    process.exit(await runCommand(ROOT, cmd, rest));
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
