// tests/verdict-lead-block.test.mjs: the `## Verdict (lead)` block is part of the
// report contract, in every evaluation mode and in the batch worker prompt.
//
// Moved out of test-all.mjs: new tests belong in their own auto-discovered
// file, not as a section of the harness (CONTRIBUTING.md, tests/README.md).
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, warn, ROOT } from './helpers.mjs';

console.log('\nVerdict (lead) block across evaluation modes');

function readFile(path) {
  const fullPath = join(ROOT, path);
  let content = readFileSync(fullPath, 'utf-8');
  if (content.trim().startsWith('..') && content.trim().split('\n').length === 1) {
    const target = join(dirname(fullPath), content.trim());
    if (existsSync(target)) {
      content = readFileSync(target, 'utf-8');
    }
  }
  return content;
}

// The heading shape the report parser recognizes. web/src/lib/report-sections.mjs
// (imported by web/src/components/report-view.tsx) splits a body on /^##\s+(.*)$/
// and promotes a heading ending in `(lead)` or `(verdict)`, so `##` must be
// followed by whitespace, any kind but a newline, as `\s` reads it there.
// `##Verdict (lead)` and `### Verdict (lead)` are not sections at all, and a
// guard that accepted them would pass on a heading the web view never promotes.
const LEAD_HEADING = /^##[^\S\n]+[^\n]*\((?:lead|verdict)\)[^\S\n]*$/gmi;
const leadHeadings = (text) => {
  LEAD_HEADING.lastIndex = 0;
  return [...text.matchAll(LEAD_HEADING)];
};

// The guard itself: it must accept every `(lead)`/`(verdict)` heading the parser
// promotes and reject what the parser does not read as a heading. A bare
// `## Verdict` is promoted by the parser and rejected here on purpose, because
// the marker is the contract.
//
// web/ is not in update-system.mjs's SYSTEM_PATHS but tests/ is, so this file
// reaches checkouts with no web/ at all, where a static import would fail the
// whole file (#1675 / #1677). Only this check needs the parser, so only this
// check is skipped; a parser missing under a present web/ is a move and fails.
const WEB_REPORT_SECTIONS = join(ROOT, 'web', 'src', 'lib', 'report-sections.mjs');
if (!existsSync(join(ROOT, 'web', 'src'))) {
  warn('web/ not present in this checkout, skipping the lead-heading parser check');
} else if (!existsSync(WEB_REPORT_SECTIONS)) {
  fail('web/ exists but web/src/lib/report-sections.mjs is missing, so the lead-heading parser check cannot run (moved?)');
} else {
  const { splitSections, isVerdictHeading } = await import(pathToFileURL(WEB_REPORT_SECTIONS).href);
  const accepted = ['## Verdict (lead)', '## Veredicto (lead)', '## 结论 (lead)', '##\tVeredicto (lead)', '##\u00a0Verdict (lead)'];
  const rejected = ['##Verdict (lead)', '### Verdict (lead)', '#Verdict (lead)', 'Verdict (lead)'];
  const parserPromotes = (line) =>
    splitSections(`${line}\nbody`).sections.some((sec) => isVerdictHeading(sec.heading));
  const wrong = [
    ...accepted.filter((l) => leadHeadings(l).length !== 1 || !parserPromotes(l)),
    ...rejected.filter((l) => leadHeadings(l).length !== 0 || parserPromotes(l)),
  ];
  if (wrong.length > 0) {
    fail(`lead-heading guard disagrees with the report parser on: ${wrong.map((l) => JSON.stringify(l)).join(', ')}`);
  } else {
    pass(`lead-heading guard matches the report parser on ${accepted.length} accepted and ${rejected.length} rejected headings`);
  }
}

// ── Verdict (lead) block presence across evaluation modes ──
// The lead block is a report-contract element, so the contract guard has to
// assert it. It cannot join REQUIRED_HEADINGS in test-all.mjs's localized
// oferta.md parity check. That list matches literal substrings, the heading
// noun is translated per locale, and every translated mode quotes the English
// form in prose as an example of the convention, so a
// literal `## Verdict (lead)` entry would pass on zh, zh-TW and ru whether or
// not those files carry a block. The `(lead)` marker is the language-invariant
// part, and it is what cleanHeading in web/src/lib/report-sections.mjs reads,
// so this matches the marker on a heading line. A heading line is not by
// itself proof of a real block: every one of these files also illustrates the
// block inside a fenced example, and those examples carry heading lines too.
// What separates the template from documentation about it is the window. The
// template is the one place where `## G)` is followed by `## Risk Summary`,
// so the lead heading is required inside that run. Anchoring the run on the
// LAST of each marker does not work: modes/tr/is-ilani.md puts its template
// first and its prose second, so its last `## G)` and last `## Risk Summary`
// sit ~140 lines apart and swallow the document.
// Keyed on the report skeleton instead of the filename: a locale whose
// evaluation mode is not named oferta.md (tr/is-ilani.md, ja/kyujin.md,
// ar/fursah.md) is invisible to the oferta.md walk in test-all.mjs. A file
// still at the pre-Block-G shape has no Block G for the lead block to follow,
// so it drops out by carrying no `## H)` and no `## Risk Summary`, with no
// allowlist to maintain.
{
  const modeFiles = ['modes/oferta.md'];
  for (const d of readdirSync(join(ROOT, 'modes'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(ROOT, 'modes', d.name))) {
      if (f.endsWith('.md')) modeFiles.push(`modes/${d.name}/${f}`);
    }
  }
  const skeleton = modeFiles.map(f => [f, readFile(f)])
    .filter(([, t]) => t.includes('## H)') && t.includes('## Risk Summary'));
  const names = skeleton.map(([f]) => f);
  if (names.length < 8 || !names.includes('modes/oferta.md') || !names.includes('modes/tr/is-ilani.md')) {
    fail(`verdict-lead walk found ${names.length} full-skeleton modes (${names.join(', ')}) — expected ≥8 incl. modes/oferta.md and modes/tr/is-ilani.md; the check would be blind`);
  } else {
    const gaps = [];
    for (const [f, t] of skeleton) {
      const g = t.indexOf('## G)');
      const rs = g < 0 ? -1 : t.indexOf('## Risk Summary', g);
      if (g < 0 || rs < 0) { gaps.push(`${f} (no \`## G)\` → \`## Risk Summary\` run)`); continue; }
      const hits = leadHeadings(t).map(m => m.index);
      if (!hits.some(i => g < i && i < rs)) {
        gaps.push(`${f} (no \`(lead)\` heading between G) and Risk Summary)`);
      }
    }
    if (gaps.length > 0) {
      fail(`evaluation modes missing the lead verdict block: ${gaps.join('; ')}`);
    } else {
      pass(`Verdict (lead) block present and positioned in all ${names.length} full-skeleton evaluation modes`);
    }
  }

  // batch/batch-prompt.md carries the same contract in a different shape and so
  // falls outside the walk above: headless workers get a bulleted list of the
  // blocks to emit, not a fenced report template, and the file lives outside
  // modes/. It is the only report producer a user never watches, so a missing
  // entry here costs a whole batch of reports. Assert the same ordering on the
  // list it actually emits from.
  {
    const emitted = readFile('batch/batch-prompt.md');
    const g = emitted.indexOf('- `## G) Posting Legitimacy`');
    const lead = g < 0 ? -1 : emitted.indexOf('- `## Verdict (lead)`', g);
    const rs = lead < 0 ? -1 : emitted.indexOf('- `## Risk Summary`', lead);
    if (g >= 0 && lead > g && rs > lead) {
      pass('batch workers emit `## Verdict (lead)` between Block G and Risk Summary');
    } else {
      fail('batch/batch-prompt.md emitted-block list has no `## Verdict (lead)` entry between Block G and `## Risk Summary`, so batch reports would carry no lead block');
    }
  }
}
