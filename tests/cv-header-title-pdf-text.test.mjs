// The CV headline (the {{TITLE_BLOCK}} slot, styled by .header-title) is the
// line an ATS scores the target role against, so it has to survive the PDF
// text layer as whole words. Wide letter-spacing splits it into separate glyph
// runs: on the leadership template at 0.12em, "DATA ANALYST & BI ENGINEER"
// extracted as "D ATA A N A LY S T & B I E N G I N E E R".
//
// modes/pdf.md records the class under "what the lint cannot catch" and names
// the oracle: "Catching those needs a rendered PDF and a text extractor; this
// project extracts with `pdftotext -layout`." So that is the measurement here,
// on the builder's own output, rather than a re-implementation of the
// extractor's word-break heuristic — a heuristic copied into the test would
// disagree with the tool users actually run.
//
// A CSS ceiling cannot stand in for it: 0.12em fragments in the leadership
// template's sans stack while the executive template's serif stack extracts
// clean at 0.14em, so the same tracking value is safe in one template and not
// the other. The outcome per template is the only general rule.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { listTree } from '../lib/walk-tree.mjs';
import { pass, fail, warn, QUICK, NODE, ROOT, toolUnavailable } from './helpers.mjs';

console.log('\nCV templates — the headline survives the PDF text layer');

// A four-word headline is enough to show a broken word boundary. The words a
// tokeniser has to find are what the assertion checks; a template that renames
// or drops the slot renders no headline and is reported as such.
const HEADLINE = 'Data Analyst & BI Engineer';
const HEADLINE_WORDS = ['DATA', 'ANALYST', 'ENGINEER'];
const PAYLOAD = {
  candidate: { name: 'Alex Rivera', title: HEADLINE, email: 'alex@example.com' },
  summary: 'Summary text.',
};

// A headline is intact when each of its words appears whole in the extracted
// text. Adjacent elements run together in the text layer, so the words are
// searched as substrings: the fragmenting this test exists for splits one word
// into several ("D ATA A N A LY S T"), which leaves no run of the whole word
// anywhere, while the neighbouring name and contact line stay whole.
function headlineIntact(text) {
  const flat = text.toUpperCase();
  return HEADLINE_WORDS.every((word) => flat.includes(word));
}

// Locate pdftotext. Absent, the check reports itself as unavailable rather than
// passing: a skip that reads as coverage is the failure this suite avoids.
function findPdftotext() {
  const candidates = [
    process.env.PDFTOTEXT,
    // The preinstalled tool bundle used by this workspace and the CI images
    // that carry poppler.
    join(dirname(NODE), '..', 'preinstalled-tools', 'production', 'bin', 'pdftotext'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-v'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try the next one; -v exits 0 on poppler, so a throw means it is not here
    }
  }
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return 'pdftotext';
  } catch {
    return null;
  }
}

// Every template that ships the slot build-cv-html.mjs fills with the headline.
// A template with the CSS but no slot renders no headline, and one with the slot
// but no CSS renders it unstyled; either way there is nothing to break.
const templates = listTree(join(ROOT, 'templates'), { match: /\.html$/ })
  .filter((file) => {
    const src = readFileSync(file, 'utf8');
    return src.includes('{{TITLE_BLOCK}}') && /\.header-title\s*\{/.test(src);
  });

if (templates.length === 0) fail('no template renders a .header-title headline');

const pdftotext = QUICK ? null : findPdftotext();

// Rendering costs a build plus a Chromium page per template, so --quick skips
// it. What was skipped is reported, the way the suite's other browser checks
// report it.
if (QUICK) {
  warn(`headline PDF check skipped under --quick (${templates.length} templates carry a headline)`);
} else if (!pdftotext) {
  toolUnavailable('pdftotext', `headline PDF check skipped: pdftotext is not installed (${templates.length} templates carry a headline)`);
} else {
  const workDir = mkdtempSync(join(tmpdir(), 'career-ops-headline-'));
  let browser;
  try {
    const { chromium } = await import('playwright');
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      toolUnavailable('browser', `headline PDF check skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
    }
    if (browser) {
      const payloadPath = join(workDir, 'payload.json');
      writeFileSync(payloadPath, JSON.stringify(PAYLOAD));
      for (const [i, file] of templates.entries()) {
        const rel = file.slice(ROOT.length + 1);
        const htmlPath = join(workDir, `cv-${i}.html`);
        const pdfPath = join(workDir, `cv-${i}.pdf`);
        try {
          // The builder under test, not a re-implementation of its template
          // filling: the headline it writes is the one an ATS reads.
          execFileSync(NODE, [join(ROOT, 'build-cv-html.mjs'), payloadPath, htmlPath, file], { cwd: ROOT, stdio: 'pipe' });
        } catch (e) {
          fail(`${rel}: could not be rendered with a headline (${String(e.stderr || e.message).split('\n')[0]})`);
          continue;
        }
        const html = readFileSync(htmlPath, 'utf8');
        // A template's tracking is judged under two conditions, because which
        // faces a machine has decides the glyph advances: the template's own
        // stack, and a sans fallback for the hosts (CI included) that lack the
        // named faces. The leadership template fragments at 0.12em under both;
        // the executive template's serif stack survives 0.14em on a Mac while
        // the same value fragments under its fallback — the failure CI caught
        // after a local run passed.
        for (const [condition, override] of [
          ['own fonts', null],
          ['sans fallback', `body { font-family: "Liberation Sans", Arial, 'DejaVu Sans', sans-serif !important; }`],
        ]) {
          const page = await browser.newPage();
          try {
            await page.setContent(override ? html.replace('</style>', `${override}\n  </style>`) : html);
            writeFileSync(pdfPath, Buffer.from(await page.pdf({ format: 'Letter', printBackground: true })));
          } finally {
            await page.close();
          }
          let text;
          try {
            text = execFileSync(pdftotext, ['-layout', pdfPath, '-'], { encoding: 'utf8' });
          } catch (e) {
            fail(`${rel} (${condition}): pdftotext could not read the rendered PDF (${String(e.stderr || e.message).split('\n')[0]})`);
            continue;
          }
          if (headlineIntact(text)) {
            pass(`${rel} keeps the headline whole in the PDF text layer (${condition})`);
          } else {
            const line = text.split('\n').find((l) => /DATA|ANALYST|ENGINEER/i.test(l)) ?? text.slice(0, 80);
            fail(`${rel} fragments the headline in the PDF text layer (${condition}): ${JSON.stringify(line.trim())}`);
          }
        }
      }
    }
  } finally {
    await browser?.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}
