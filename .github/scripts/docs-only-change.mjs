#!/usr/bin/env node
// docs-only-change: does this CI run's change touch nothing but documentation? (#6402)
//
// .github/workflows/test.yml reads the answer to skip the jobs a prose edit
// cannot affect. Every doubt answers "no", because "no" only costs runner time
// and a wrong "yes" takes checks away from code: an unknown file type, an empty
// diff, a checkout that is not the merge commit we expect and any git error all
// keep today's full run. So this script never exits non-zero over a diff it
// could not read, and it reports a failure to decide as docs_only=false.
//
// Env: GITHUB_OUTPUT (the step's output file; absent when run by hand)

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isMainModule } from '../../lib/is-main-module.mjs';

// Root files only: batch/README.md and modes/README.md change what agents and
// the updater read, so a nested README is not prose here. AGENTS.md, CLAUDE.md,
// modes/** and templates/** are left out for the same reason.
const ROOT_DOC = /^(?:README[^/]*\.md|CONTRIBUTING\.md|GOVERNANCE\.md|CODE_OF_CONDUCT\.md|SECURITY\.md|SUPPORT\.md|SIGNATURES\.md)$/;

// By extension and not `docs/**`, because docs/ also holds code: the
// docs/recipes/ parsers are .mjs with HTML fixtures. A type this list does not
// name (docs/hired-count.json is data) gets the full run.
const DOCS_TREE = /^docs\/.+\.(?:md|svg|png|jpe?g|gif)$/;

export function isDocsPath(path) {
  return ROOT_DOC.test(path) || DOCS_TREE.test(path);
}

/** An empty list is not "only docs": nothing to compare is a reason to run everything. */
export function isDocsOnly(files) {
  return files.length > 0 && files.every(isDocsPath);
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Files that differ between two commits.
 *
 * --no-renames lists both sides of a move. Without it, moving a script into
 * docs/ reports only the docs/ path and the deletion of the script goes unseen.
 * -z keeps git from quoting a path with non-ASCII bytes, which would fail the
 * patterns above for a translated doc.
 */
export function changedFiles(base, head, cwd) {
  return git(['diff', '--name-only', '--no-renames', '-z', base, head, '--'], cwd)
    .split('\0')
    .filter(Boolean);
}

/**
 * The answer for a pull_request checkout, which is GitHub's test merge of the PR
 * into its base (needs fetch-depth: 2 for the parents to be on disk). Comparing
 * with the first parent gives exactly what the PR would change. Comparing with
 * event.pull_request.base.sha would also list whatever landed on the base since
 * that event was built.
 *
 * Never throws: failing to decide is reported as not docs-only.
 *
 * @returns {{ docsOnly: boolean, reason: string }}
 */
export function classifyCheckout(cwd = process.cwd()) {
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD^2'], cwd);
  } catch {
    // With a single parent, HEAD^1 is one commit of the PR, not its base.
    return { docsOnly: false, reason: 'HEAD is not a merge commit, so its base is unknown' };
  }
  try {
    const files = changedFiles('HEAD^1', 'HEAD', cwd);
    if (isDocsOnly(files)) return { docsOnly: true, reason: `${files.length} docs file(s) changed` };
    const other = files.find((file) => !isDocsPath(file));
    // The name comes from the PR, so it is quoted: a raw name could start a
    // line with a `::` workflow command.
    return { docsOnly: false, reason: other ? `${JSON.stringify(other)} is not a docs file` : 'the diff is empty' };
  } catch (err) {
    return { docsOnly: false, reason: `could not read the diff: ${err.message.split('\n')[0]}` };
  }
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node .github/scripts/docs-only-change.mjs\n\n'
      + 'Run from a pull_request merge checkout. Prints why, and writes docs_only=true|false to $GITHUB_OUTPUT.');
    return;
  }
  const { docsOnly, reason } = classifyCheckout();
  console.log(`docs_only=${docsOnly}: ${reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`);
}

if (isMainModule(import.meta.url)) main();
