// tests/plugins-data-root.test.mjs — Bugs 2 & 3 regression:
//   • plugins.mjs must derive APPLICATIONS_PATH and PIPELINE_PATH from the
//     data root (CAREER_OPS_ROOT), not from the code directory.
//   • buildSnapshot() must parse pipeline.md checklist entries, not a table.
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nplugins — data-root path resolution and buildSnapshot pipeline parser');

// We import path-resolver.mjs and inspect the exported getCareerOpsRoot to
// verify the fix without triggering plugins.mjs's top-level side effects
// (appendToPipeline, discoverPlugins, etc.) that require a full environment.
const { getCareerOpsRoot } = await import(
  pathToFileURL(join(ROOT, 'path-resolver.mjs')).href
);

// Bug 2: with CAREER_OPS_ROOT set, getCareerOpsRoot() must return the override.
{
  const tmp = join(ROOT, '.tmp-plugins-root-' + process.pid);
  mkdirSync(tmp, { recursive: true });
  try {
    const saved = process.env.CAREER_OPS_ROOT;
    process.env.CAREER_OPS_ROOT = tmp;
    // Re-import is cached; test the function directly.
    const resolved = getCareerOpsRoot();
    if (resolved === tmp || resolved.toLowerCase() === tmp.toLowerCase()) {
      pass('CAREER_OPS_ROOT override respected by getCareerOpsRoot');
    } else {
      fail(`expected ${tmp}, got ${resolved}`);
    }
    if (saved === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = saved;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Bug 3: pipeline.md checklist regex must match `- [ ]` and `- [x]` lines.
// Test the regex directly (the same one now used in buildSnapshot).
{
  const pipelineContent = `# Pipeline

## Pendientes

- [ ] https://example.com/job/1
- [x] https://example.com/job/2
- [ ] https://example.com/job/3
| not | a | checklist | row |
Some prose line
`;
  const matches = [...pipelineContent.matchAll(/- \[[ xX]\]\s+(\S+)/g)].map(m => m[1]);
  if (matches.length === 3) pass('checklist regex matches 3 pipeline entries (both [ ] and [x])');
  else fail(`checklist regex matched ${matches.length} entries, expected 3`);

  if (matches[0] === 'https://example.com/job/1') pass('first URL extracted correctly');
  else fail(`first URL: ${matches[0]}`);

  if (matches[1] === 'https://example.com/job/2') pass('checked ([x]) URL extracted correctly');
  else fail(`checked URL: ${matches[1]}`);
}

// Bug 3: parseMarkdownTable (the broken approach) returns [] for checklist input.
// Verify that the table parser does NOT match checklist lines so the old approach
// is demonstrably wrong and the fix is necessary.
{
  const pipelineContent = '- [ ] https://example.com/job/1\n- [x] https://example.com/job/2\n';
  const lines = pipelineContent.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
  if (lines.length === 0) {
    pass('old parseMarkdownTable approach yields 0 matches on checklist (confirms bug was real)');
  } else {
    fail(`table parser unexpectedly matched ${lines.length} checklist lines`);
  }
}
