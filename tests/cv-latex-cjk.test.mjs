// tests/cv-latex-cjk.test.mjs — end-to-end proof that the CJK template-selection
// + generation pipeline wires together correctly (#3554 review gap, Scott-Emberson).
//
// The other CJK coverage in this PR (test-all.mjs's "20a" section) checks two things
// in isolation: that templates/cv-template.cjk.tex, read as a static file, contains
// fontspec/xeCJK/\setCJKmainfont; and that validateLatexContent() makes the right
// call against hand-built .tex strings. Neither of those actually runs
// build-cv-latex.mjs --template=cjk with a real CJK payload, so neither proves the
// template-selection flag and the generator are actually wired together for a real
// user — a bug in resolveTemplate()'s --template=cjk plumbing, or in how
// build-cv-latex.mjs escapes CJK text, would pass both existing checks and still
// break this path end to end.
//
// Follows the run()/pass()/fail() convention tests/cv-latex-bullet-bold.test.mjs
// uses for the same builder (build-cv-latex.mjs has no exports to unit test
// directly — CLI end-to-end is the only way in).
import { pass, fail, ROOT, NODE, run, lastRunFailure } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nbuild-cv-latex --template=cjk — end-to-end CJK generation (#3554)');

// A realistic Chinese CV payload — name, education, experience, projects, skills
// all carry real CJK content, not a single isolated probe string.
const PAYLOAD = {
  name: '张伟 Test Candidate',
  contact_line: 'Toronto, ON | test@example.com',
  email: { url: 'test@example.com', display: 'test@example.com' },
  linkedin: { url: 'https://linkedin.com/in/test', display: 'linkedin.com/in/test' },
  github: { url: 'https://github.com/test', display: 'github.com/test' },
  education: [{
    institution: '示例大学 (Sample University)',
    location: 'Toronto, ON',
    degree: '计算机科学硕士学位 (Master of Computer Science)',
    dates: '2023 - 2025',
    coursework: ['数据结构', '算法设计'],
  }],
  experience: [{
    company: '示例公司',
    role: '软件工程师',
    location: 'Remote',
    dates: '2022 - Present',
    bullets: ['设计并交付了多个内部工具，提升团队效率 20%'],
  }],
  projects: [{
    name: '示例项目',
    context: 'React, Node.js',
    dates: '2024',
    bullets: ['构建了一个交互式数据分析平台'],
  }],
  awards: [{ title: '优秀毕业生奖', org: '示例大学', year: '2024' }],
  skills: [{ category: '语言', items: '中文，英语' }],
};

const dir = mkdtempSync(join(tmpdir(), 'cv-latex-cjk-'));
try {
  const input = join(dir, 'cjk.json');
  const output = join(dir, 'cjk.tex');
  writeFileSync(input, JSON.stringify(PAYLOAD), 'utf-8');

  if (run(NODE, [join(ROOT, 'build-cv-latex.mjs'), input, output, '--template=cjk']) === null) {
    const f = lastRunFailure();
    fail(`build-cv-latex.mjs --template=cjk crashed (exit ${f?.status}) - ${(f?.stderr || '').trim().split('\n').pop()}`);
  } else if (!existsSync(output)) {
    fail('build-cv-latex.mjs --template=cjk exited 0 but wrote no output file');
  } else {
    const tex = readFileSync(output, 'utf-8');

    // 1. The CJK preamble actually made it into the GENERATED file, not just the
    // static template on disk — proof --template=cjk actually resolved to
    // cv-template.cjk.tex rather than silently falling back to the base template.
    const preambleChecks = [
      ['generated .tex loads fontspec', '\\usepackage{fontspec}'],
      ['generated .tex loads xeCJK', '\\usepackage{xeCJK}'],
      ['generated .tex sets a CJK main font', '\\setCJKmainfont{'],
    ];
    for (const [what, needle] of preambleChecks) {
      tex.includes(needle) ? pass(what) : fail(`${what} — expected to find ${JSON.stringify(needle)} in the generated .tex`);
    }

    // 2. Real Chinese content survived generation unmangled — not dropped, not
    // double-escaped, not corrupted by escapeLatex (which must leave CJK glyphs
    // alone; they are not LaTeX special characters).
    const contentChecks = [
      ['candidate name', '张伟'],
      ['institution name', '示例大学'],
      ['degree name', '计算机科学硕士学位'],
      ['coursework line', '数据结构'],
      ['experience company', '示例公司'],
      ['experience role', '软件工程师'],
      ['experience bullet', '设计并交付了多个内部工具'],
      ['project name', '示例项目'],
      ['project bullet', '构建了一个交互式数据分析平台'],
      ['award title', '优秀毕业生奖'],
      ['skills category', '语言'],
      ['skills items', '中文，英语'],
    ];
    for (const [what, needle] of contentChecks) {
      tex.includes(needle) ? pass(`${what} survives generation unmangled`) : fail(`${what} did not survive generation — expected to find ${JSON.stringify(needle)} in the .tex`);
    }

    // 3. Close the loop with the validator: the actual file this pipeline just
    // produced, fed through validateLatexContent() with engine='tectonic', must
    // validate clean — proof generation and validation agree end to end, not
    // just in isolation against hand-built fixtures.
    const { validateLatexContent } = await import(new URL('../generate-latex.mjs', import.meta.url).href);
    const { issues } = validateLatexContent(tex, false, 'tectonic');
    if (issues.length === 0) {
      pass('generated CJK .tex validates clean under validateLatexContent(engine=tectonic)');
    } else {
      fail(`generated CJK .tex was unexpectedly flagged by the validator: ${JSON.stringify(issues)}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
