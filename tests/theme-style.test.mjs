// tests/theme-style.test.mjs — unit coverage for the dynamic PDF theming helper
// (#1837): token parsing, style-block building/sanitizing, HTML injection, and a
// guard that the shipped templates actually read the variables with defaults.
import { pass, fail, ROOT } from './helpers.mjs';
import { join, relative } from 'path';
import { pathToFileURL } from 'url';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\ntheme-style.mjs (dynamic PDF theming, #1837)');

try {
  const {
    styleTokensFrom, readStyleTokens, buildThemeStyleBlock, injectThemeStyle,
  } = await import(pathToFileURL(join(ROOT, 'theme-style.mjs')).href);

  // styleTokensFrom: recognized keys → css vars; ignore unknown/non-string/missing
  const t = styleTokensFrom({ accent_color: '#2563eb', secondary_color: '#111827', tag_color: '#0e7490', tag_bg: '#ecfeff', tag_border: '#a5f3fc', font_family: 'Outfit, sans-serif', font_size: '10pt', margin: '0.5in', job_break_inside: 'avoid', project_break_inside: 'avoid', nope: 'x', font_weight: 700 });
  if (t['--accent-color'] === '#2563eb' && t['--secondary-color'] === '#111827'
      && t['--tag-color'] === '#0e7490' && t['--tag-bg'] === '#ecfeff' && t['--tag-border'] === '#a5f3fc'
      && t['--font-family'] === 'Outfit, sans-serif' && t['--font-size'] === '10pt' && t['--page-margin'] === '0.5in'
      && t['--job-break-inside'] === 'avoid' && t['--project-break-inside'] === 'avoid'
      && !('--font-weight' in t) && Object.keys(t).length === 10) {
    pass('styleTokensFrom maps the 10 recognized keys and ignores unknown/non-string');
  } else {
    fail(`styleTokensFrom => ${JSON.stringify(t)}`);
  }
  if (Object.keys(styleTokensFrom(null)).length === 0 && Object.keys(styleTokensFrom('x')).length === 0 && Object.keys(styleTokensFrom([])).length === 0) {
    pass('styleTokensFrom returns {} for null/non-object/array');
  } else {
    fail('styleTokensFrom should return {} for null/non-object/array');
  }

  // readStyleTokens: from a profile file; missing file → {}
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-theme-'));
  try {
    const p = join(dir, 'profile.yml');
    writeFileSync(p, 'candidate:\n  full_name: X\nstyle:\n  accent_color: "#ff0000"\n');
    const rt = readStyleTokens(p);
    if (rt['--accent-color'] === '#ff0000' && Object.keys(rt).length === 1) pass('readStyleTokens reads the style block from a profile file');
    else fail(`readStyleTokens => ${JSON.stringify(rt)}`);
    if (Object.keys(readStyleTokens(join(dir, 'nope.yml'))).length === 0) pass('readStyleTokens returns {} for a missing profile');
    else fail('readStyleTokens should return {} for a missing profile');
    // profile without a style block
    const p2 = join(dir, 'nostyle.yml'); writeFileSync(p2, 'candidate:\n  full_name: X\n');
    if (Object.keys(readStyleTokens(p2)).length === 0) pass('readStyleTokens returns {} when there is no style block');
    else fail('readStyleTokens should return {} without a style block');
    // secondary_color round-trips through readStyleTokens the same way accent_color does
    const p3 = join(dir, 'secondary.yml');
    writeFileSync(p3, 'candidate:\n  full_name: X\nstyle:\n  secondary_color: "#111827"\n');
    const rt3 = readStyleTokens(p3);
    if (rt3['--secondary-color'] === '#111827' && Object.keys(rt3).length === 1) pass('readStyleTokens reads secondary_color from a profile file');
    else fail(`readStyleTokens secondary_color => ${JSON.stringify(rt3)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // buildThemeStyleBlock: empty → ''; builds :root; sanitizes control chars
  if (buildThemeStyleBlock({}) === '' && buildThemeStyleBlock(null) === '') pass('buildThemeStyleBlock returns "" for no tokens');
  else fail('buildThemeStyleBlock should return "" for no tokens');
  const block = buildThemeStyleBlock({ '--accent-color': '#2563eb', '--font-size': '10pt' });
  if (block.includes('id="career-ops-dynamic-theme"') && block.includes(':root {') && block.includes('--accent-color: #2563eb;') && block.includes('--font-size: 10pt;')) {
    pass('buildThemeStyleBlock emits a :root block with the declarations');
  } else {
    fail(`buildThemeStyleBlock => ${block}`);
  }
  // a value trying to break out of the rule / tag is dropped
  const evil = buildThemeStyleBlock({ '--accent-color': 'red; } body{display:none} <script>', '--font-size': '10pt' });
  if (!evil.includes('<script>') && !evil.includes('display:none') && evil.includes('--font-size: 10pt;') && !evil.includes('--accent-color')) {
    pass('buildThemeStyleBlock drops values containing CSS/HTML control chars (injection-safe)');
  } else {
    fail(`buildThemeStyleBlock injection => ${evil}`);
  }

  // injectThemeStyle: no-op without tokens; inserts before </head>; prepends when no head
  const html = '<html><head><style>body{}</style></head><body>x</body></html>';
  if (injectThemeStyle(html, {}) === html) pass('injectThemeStyle is a no-op with no tokens (byte-identical)');
  else fail('injectThemeStyle should be a no-op with no tokens');
  const injected = injectThemeStyle(html, { '--accent-color': '#2563eb' });
  if (injected.includes('career-ops-dynamic-theme') && injected.indexOf('career-ops-dynamic-theme') < injected.indexOf('</head>') && injected.indexOf('career-ops-dynamic-theme') > injected.indexOf('<style>')) {
    pass('injectThemeStyle inserts the theme block before </head>, after the template style');
  } else {
    fail(`injectThemeStyle head => ${injected}`);
  }
  const noHead = injectThemeStyle('<div>x</div>', { '--accent-color': '#2563eb' });
  if (noHead.startsWith('<style id="career-ops-dynamic-theme"')) pass('injectThemeStyle prepends the block when there is no </head>');
  else fail(`injectThemeStyle no-head => ${noHead}`);

  // secondary_color round-trips through buildThemeStyleBlock/injectThemeStyle
  // the same way accent_color does (the CV template's second, previously
  // un-themed hardcoded color — see issue for the "purple can't be
  // recolored via style:" bug this token fixes).
  const secondaryBlock = buildThemeStyleBlock({ '--secondary-color': '#111827' });
  if (secondaryBlock.includes('id="career-ops-dynamic-theme"') && secondaryBlock.includes('--secondary-color: #111827;')) {
    pass('buildThemeStyleBlock emits a :root block for --secondary-color');
  } else {
    fail(`buildThemeStyleBlock secondary_color => ${secondaryBlock}`);
  }
  const secondaryInjected = injectThemeStyle(html, { '--secondary-color': '#111827' });
  if (secondaryInjected.includes('--secondary-color: #111827;') && secondaryInjected.indexOf('career-ops-dynamic-theme') < secondaryInjected.indexOf('</head>')) {
    pass('injectThemeStyle inserts a --secondary-color override before </head>');
  } else {
    fail(`injectThemeStyle secondary_color => ${secondaryInjected}`);
  }

  // Template guard: shipped templates read the vars with :root defaults, no circular refs
  for (const tpl of ['templates/cv-template.html', 'templates/cover-letter-template.html']) {
    const src = readFileSync(join(ROOT, tpl), 'utf-8');
    const hasRoot = /:root\s*\{[^}]*--accent-color:[^}]*--font-family:[^}]*--font-size:[^}]*--page-margin:/s.test(src);
    const usesVars = src.includes('var(--accent-color)') && src.includes('var(--font-family)') && src.includes('var(--font-size)') && src.includes('var(--page-margin)');
    const circular = /--(accent-color|font-family|font-size|page-margin):\s*var\(/.test(src);
    if (hasRoot && usesVars && !circular) pass(`${tpl} declares :root theme defaults and reads them via var() (no circular refs)`);
    else fail(`${tpl}: hasRoot=${hasRoot} usesVars=${usesVars} circular=${circular}`);
  }

  // Template guard (this fix): cv-template.html's second, previously hardcoded
  // color (hsl(270, 70%, 45%), used for company/institution names and the
  // header gradient's second stop) is now themeable via --secondary-color,
  // with no leftover hardcoded occurrences and no circular var() default.
  // Chinese Minimal has its own palette and per-surface fallbacks, covered by
  // zh-minimal-theme.test.mjs instead of this standard-template default guard.
  for (const tpl of ['templates/cv-template.html', 'templates/resume-template.html']) {
    const src = readFileSync(join(ROOT, tpl), 'utf-8');
    const hasRoot = /:root\s*\{[^}]*--secondary-color:\s*hsl\(270, 70%, 45%\);/s.test(src);
    const usesVar = src.includes('var(--secondary-color)');
    const leftoverHardcoded = (src.match(/hsl\(270, 70%, 45%\)/g) || []).length > 1; // exactly one: the :root default
    const circular = /--secondary-color:\s*var\(/.test(src);
    if (hasRoot && usesVar && !leftoverHardcoded && !circular) {
      pass(`${tpl} declares a --secondary-color :root default and reads it via var() everywhere (no leftover hardcoded purple)`);
    } else {
      fail(`${tpl}: hasRoot=${hasRoot} usesVar=${usesVar} leftoverHardcoded=${leftoverHardcoded} circular=${circular}`);
    }
  }

  // Template contract (#3242 for roles, and the sibling token for projects):
  // every shipped template keeps ITS OWN current pagination behavior as the
  // effective default, so an opt-in token changes nobody's layout. For roles,
  // resume-template.html and templates/ats/cv-template.ats.html have always
  // kept a role whole (avoid) and the rest let a role flow across a page break
  // (auto, per #1145). For projects, every template currently lets an entry
  // split, so the effective default is auto everywhere.
  //
  // Both places that carry a default are pinned: the :root token default, which
  // is what actually resolves in the templates that declare one, and the rule's
  // var() fallback, the only default in the templates that don't. The modern and
  // legacy properties are checked separately with a property boundary, so
  // `page-break-inside:` can never satisfy the `break-inside:` check, and the
  // legacy alias must come first: declared last it wins the cascade and turns
  // any keyword it does not accept (avoid-page) into auto. A token may be
  // declared on :root only. On body or anything inside it, a declaration would
  // beat the profile override, which arrives as a later :root block; :root-only
  // also keeps a single place to read the default.
  //
  // Parameterized over the tokens rather than copied per token: the subtle parts
  // (legacy-first ordering, :root-only, alias rejection, exact match on the root
  // declaration) must not drift between two tokens making the same promise about
  // different entries.
  {
    const { listTemplates } = await import(pathToFileURL(join(ROOT, 'cv-templates.mjs')).href);

    // Innermost `selector { body }` rules of every <style> block, with
    // comments stripped (they hold braces and token names) and {{PLACEHOLDER}}s
    // neutralized as template-page-breaks.test.mjs does, since a placeholder's
    // braces would hide its whole rule. An @media wrapper yields its inner rules.
    const cssRules = (src) => [...[...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
      .map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\{[^{}]*\}\}/g, 'PLACEHOLDER')
      .matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector, body]) => ({ selector: selector.trim(), body }));
    // CSS property names are ASCII case-insensitive.
    const declRe = (prop) => new RegExp(`(?:^|[\\s;{])${prop}\\s*:\\s*([^;}]+)`, 'gi');
    const declValues = (body, prop) => [...body.matchAll(declRe(prop))].map((m) => m[1].replace(/\s+/g, ' ').trim());
    const declIndex = (body, prop) => body.search(declRe(prop));
    // A rule targets `.cls` when the subject compound of any selector in its
    // list carries the class: `.job`, `div.job`, `.job:last-child`,
    // `:is(.job, .x)`, but not `.job li` or `.job-company`.
    const selectorList = (sel) => sel.split(/,(?![^()]*\))/).map((s) => s.trim());
    const subject = (s) => s.replace(/\([^()]*\)/g, (m) => m.replace(/[\s>+~]/g, '')).split(/\s*[\s>+~]\s*/).pop();
    const targets = (sel, cls) => selectorList(sel).some((s) => new RegExp(`\\.${cls}(?![\\w-])`).test(subject(s)));

    const ROOT_DECLARED = {
      'templates/cv-template.html': true,
      'templates/cv-template.compact.html': true,
      'templates/cv-template.executive.html': true,
      'templates/cv-template.jake.html': true,
      'templates/cv-template.leadership.html': true,
      'templates/cv-template.modern.html': true,
      'templates/cv-template.zh-minimal.html': false,
      'templates/resume-template.html': false,
      'templates/ats/cv-template.ats.html': true,
    };
    // [effective default, declared on :root]
    const withDefaults = (defaults) => Object.fromEntries(
      Object.entries(ROOT_DECLARED).map(([tpl, root]) => [tpl, [defaults[tpl], root]]));
    const ALL_AUTO = Object.fromEntries(Object.keys(ROOT_DECLARED).map((t) => [t, 'auto']));

    const TOKENS = [
      {
        key: 'job_break_inside', cssVar: '--job-break-inside', cls: 'job', label: '#3242',
        expected: withDefaults({
          ...ALL_AUTO,
          'templates/resume-template.html': 'avoid',
          'templates/ats/cv-template.ats.html': 'avoid',
        }),
      },
      {
        key: 'project_break_inside', cssVar: '--project-break-inside', cls: 'project',
        label: 'project opt-in',
        // resume-template.html has always kept a project whole (it grouped
        // .project with .edu-item under break-inside: avoid); every other
        // template lets one split.
        expected: withDefaults({ ...ALL_AUTO, 'templates/resume-template.html': 'avoid' }),
      },
    ];

    for (const tok of TOKENS) {
      for (const v of ['avoid', 'auto']) {
        const block = buildThemeStyleBlock(styleTokensFrom({ [tok.key]: v }));
        if (block.includes(`${tok.cssVar}: ${v};`)) pass(`${tok.key}: ${v} reaches the injected :root block`);
        else fail(`${tok.key}: ${v} => ${block}`);
      }

      // A new template must declare its default here, or the opt-in would ship
      // dead in it (template-page-breaks.test.mjs discovers templates the same way).
      const discovered = listTemplates('cv').filter((t) => t.format === 'html')
        .map((t) => relative(ROOT, t.path).replace(/\\/g, '/'));
      const unlisted = discovered.filter((t) => !(t in tok.expected));
      if (discovered.length && !unlisted.length) pass(`all ${discovered.length} discovered HTML CV templates have a declared ${tok.key} default`);
      else fail(`templates with no declared ${tok.key} default: ${unlisted.join(', ') || '(none discovered)'}`);

      for (const [tpl, [value, declaresRoot]] of Object.entries(tok.expected)) {
        const rules = cssRules(readFileSync(join(ROOT, tpl), 'utf-8'));
        const owned = rules.filter((r) => targets(r.selector, tok.cls));
        const want = `var(${tok.cssVar}, ${value})`;
        const modern = owned.flatMap((r) => declValues(r.body, 'break-inside'));
        const legacy = owned.flatMap((r) => declValues(r.body, 'page-break-inside'));
        const aliases = owned.flatMap((r) => [...declValues(r.body, '-webkit-column-break-inside'), ...declValues(r.body, 'all')]);
        const legacyFirst = owned.every((r) => {
          const legacyAt = declIndex(r.body, 'page-break-inside');
          const modernAt = declIndex(r.body, 'break-inside');
          return legacyAt === -1 || modernAt === -1 || legacyAt < modernAt;
        });
        const tokenDecls = rules.flatMap((r) => declValues(r.body, tok.cssVar).map((v) => `${r.selector} => ${v}`));
        const readsToken = (vals) => vals.length > 0 && vals.every((v) => v.replace(/\s/g, '') === want.replace(/\s/g, ''));
        // Exact rather than `every`: a :root block the parse lost must fail, not pass on an empty list.
        const rootDefaultOk = JSON.stringify(tokenDecls) === JSON.stringify(declaresRoot ? [`:root => ${value}`] : []);
        if (readsToken(modern) && readsToken(legacy) && !aliases.length && legacyFirst && rootDefaultOk) {
          pass(`${tpl}: .${tok.cls} page-break-inside then break-inside read ${tok.cssVar} with its own default (${value})${declaresRoot ? ', matching its :root default' : ''}`);
        } else {
          fail(`${tpl}: ${tok.label} contract broken (want ${want}, legacy alias first, token on :root only as ${value}) => break-inside=${JSON.stringify(modern)} page-break-inside=${JSON.stringify(legacy)} aliases=${JSON.stringify(aliases)} legacyFirst=${legacyFirst} token=${JSON.stringify(tokenDecls)}`);
        }
      }
    }
  }

  // Regression: localized CJK font stacks must honor the profile
  // --font-family override while keeping their curated fallbacks active after it.
  {
    const tplSrc = readFileSync(join(ROOT, 'templates/cv-template.html'), 'utf-8');

    const jaBody = tplSrc.match(/html\[lang="ja"\]\s+body\s*\{[^}]*\}/s)?.[0] || '';
    const jaHeadings = tplSrc.match(/html\[lang="ja"\]\s+\.header h1,[\s\S]*?\{[^}]*\}/)?.[0] || '';
    const zhBody = tplSrc.match(/html\[lang="zh-CN"\]\s+body,[\s\S]*?\{[^}]*\}/)?.[0] || '';
    const zhHeadings = tplSrc.match(/html\[lang="zh-CN"\]\s+\.header h1,[\s\S]*?\{[^}]*\}/)?.[0] || '';
    const hasActiveFallback = (src, firstFace) => src.includes(`font-family: var(--font-family), '${firstFace}'`)
      && /font-family:[^;]*sans-serif;/.test(src);

    const jaBodyCount = (tplSrc.match(/html\[lang="ja"\]\s+body\s*\{/g) || []).length;
    const zhCnBodyCount = (tplSrc.match(/html\[lang="zh-CN"\]\s+body/g) || []).length;
    const zhBodyCount = (tplSrc.match(/html\[lang="zh"\]\s+body/g) || []).length;

    if (hasActiveFallback(jaBody, 'Hiragino Sans') && hasActiveFallback(jaHeadings, 'Hiragino Sans')
        && hasActiveFallback(zhBody, 'PingFang SC') && hasActiveFallback(zhHeadings, 'PingFang SC')
        && jaBodyCount === 1 && zhCnBodyCount === 1 && zhBodyCount === 1) {
      pass('Japanese and Simplified Chinese font stacks keep CJK fallbacks after --font-family');
    } else {
      fail(`CJK font regression: jaBody=${hasActiveFallback(jaBody, 'Hiragino Sans')} jaHeadings=${hasActiveFallback(jaHeadings, 'Hiragino Sans')} zhBody=${hasActiveFallback(zhBody, 'PingFang SC')} zhHeadings=${hasActiveFallback(zhHeadings, 'PingFang SC')} jaCount=${jaBodyCount} zhCNCount=${zhCnBodyCount} zhCount=${zhBodyCount}`);
    }
  }

  // Regression: the Korean locale must honor profile.style.font_family on the
  // body and the prominent heading/contact surfaces. A duplicate selector or a
  // fixed-only stack silently defeats the dynamic theme block.
  {
    const koSrc = readFileSync(join(ROOT, 'templates/cv-template.html'), 'utf-8');
    const koBody = koSrc.match(/html\[lang="ko"\]\s+body\s*\{[^}]*\}/s)?.[0] || '';
    const koHeadings = koSrc.match(/html\[lang="ko"\]\s+\.header h1,[\s\S]*?\{[^}]*\}/)?.[0] || '';
    const hasActiveFallback = (src) => src.includes("font-family: var(--font-family), 'Apple SD Gothic Neo'")
      && /font-family:[^;]*sans-serif;/.test(src);
    const hasDuplicateBodySelector = /html\[lang="ko"\]\s+body\s*,\s*html\[lang="ko"\]\s+body\s*\{/.test(koSrc);
    if (hasActiveFallback(koBody) && hasActiveFallback(koHeadings) && !hasDuplicateBodySelector) {
      pass('Korean font stacks keep CJK fallbacks after --font-family without duplicate selector');
    } else {
      fail(`Korean theme contract: body=${hasActiveFallback(koBody)} headings=${hasActiveFallback(koHeadings)} duplicate=${hasDuplicateBodySelector}`);
    }
  }

  // Regression (#3154 + CodeRabbit review on #3525): the Traditional Chinese
  // block was the last CJK block on a fixed-only stack, with duplicated `body`
  // and `.skill-category` selectors. It now uses the ATS-template idiom —
  // `var(--font-family)` first (profile override / Latin :root default), then
  // the curated TC faces in the font list, then `sans-serif`. The faces must
  // NOT sit in `var(--font-family, …)`'s fallback slot: :root always defines
  // --font-family, so that slot never resolves and the TC stack would be dead.
  {
    const src = readFileSync(join(ROOT, 'templates/cv-template.html'), 'utf-8');
    const body = src.match(/html\[lang="zh-TW"\]\s+body[^{]*\{[^}]*\}/s)?.[0] || '';
    const headings = src.match(/html\[lang="zh-TW"\]\s+\.header h1,[\s\S]*?\{[^}]*\}/)?.[0] || '';
    // token first, then the TC faces, terminal sans-serif — not the dead-slot form
    const wants = (s) => /font-family:\s*var\(--font-family\),\s*'PingFang TC'[\s\S]*'Source Han Sans TC',\s*sans-serif;/.test(s);
    const deadSlot = /html\[lang="zh-TW"\][\s\S]*?font-family:\s*var\(--font-family,\s*'/.test(src);
    const dupBody = /html\[lang="zh-TW"\]\s+body\s*,\s*html\[lang="zh-TW"\]\s+body\b/.test(src);
    const dupSkillCat = /html\[lang="zh-TW"\]\s+\.skill-category,\s*html\[lang="zh-TW"\]\s+\.skill-category\s*\{/.test(src);
    const bodyCount = (src.match(/html\[lang="zh-TW"\]\s+body\b/g) || []).length;
    if (wants(body) && wants(headings) && !deadSlot && !dupBody && !dupSkillCat && bodyCount === 1) {
      pass('Traditional Chinese block leads with var(--font-family), keeps the TC fallback faces, no duplicate selectors');
    } else {
      fail(`Traditional Chinese theme contract: body=${wants(body)} headings=${wants(headings)} deadSlot=${deadSlot} dupBody=${dupBody} dupSkillCat=${dupSkillCat} bodyCount=${bodyCount}`);
    }
  }

  // Regression (post-review, #1837): injectPrintPageCss's @page rule used to
  // hardcode `margin: 0.6in`, which — injected last, right before </head> — won
  // the CSS cascade over the template's own `@page { margin: var(--page-margin) }`
  // and the theme override, silently making style.margin ineffective. Compose
  // the two injectors exactly as renderHtmlToPdf does and assert the page-setup
  // rule now reads the SAME variable (with 0.6in only as the final fallback), so
  // a --page-margin override earlier in <head> is what actually wins.
  {
    const { injectPrintPageCss } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
    const tplSrc = readFileSync(join(ROOT, 'templates/cv-template.html'), 'utf-8');
    const withOverride = injectPrintPageCss(injectThemeStyle(tplSrc, { '--page-margin': '0.5in' }), 'a4');
    const rootDefaultIdx = withOverride.indexOf('--page-margin: 0.6in');   // template's own :root default
    const overrideIdx = withOverride.indexOf('career-ops-dynamic-theme'); // the profile's style.margin override
    const pageSetupIdx = withOverride.indexOf('career-ops-page-setup');   // injectPrintPageCss's @page rule
    const pageSetupUsesVar = /@page \{ size: A4; margin: var\(--page-margin, 0\.6in\); \}/.test(withOverride);
    if (rootDefaultIdx !== -1 && rootDefaultIdx < overrideIdx && overrideIdx < pageSetupIdx && pageSetupUsesVar) {
      pass('injectPrintPageCss reads --page-margin instead of hardcoding it, so style.margin wins the cascade (#1837 review)');
    } else {
      fail(`page-margin cascade order/value wrong: root=${rootDefaultIdx} override=${overrideIdx} pageSetup=${pageSetupIdx} usesVar=${pageSetupUsesVar}`);
    }
  }
  // The competency-tag palette was three hardcoded literals, so a profile could
  // recolor the accents and then had nowhere to go for the tags — and a template
  // edit is reverted by every `update-system.mjs apply`. Two things must hold: the
  // template still READS each token (an unreferenced var makes an override inert),
  // and each :root default is byte-identical to the literal it replaced (or every
  // existing CV silently changes color).
  {
    const DEFAULTS = {
      '--tag-color':  'hsl(187, 74%, 28%)',
      '--tag-bg':     'hsl(187, 40%, 95%)',
      '--tag-border': 'hsl(187, 40%, 88%)',
    };
    // every template that carried these literals, not just the default one — a token
    // the resume/zh templates don't read is a style: key that silently does nothing there
    const TEMPLATES = ['templates/cv-template.html', 'templates/cv-template.zh-minimal.html', 'templates/resume-template.html'];
    for (const tpl of TEMPLATES) {
    const tplSrc = readFileSync(join(ROOT, tpl), 'utf-8');
    const wrongDefault = Object.entries(DEFAULTS).filter(([v, d]) => !tplSrc.includes(`${v}: ${d};`));
    const unreferenced = Object.keys(DEFAULTS).filter(v => !tplSrc.includes(`var(${v})`));
    const selfReferential = Object.keys(DEFAULTS).filter(v => tplSrc.includes(`${v}: var(${v})`));
    const strays = tplSrc.split('\n')
      .filter(l => /hsl\(187, 74%, 28%\)|hsl\(187, 40%, (?:95|88)%\)/.test(l) && !/^\s*--tag-/.test(l));
    if (!wrongDefault.length && !unreferenced.length && !selfReferential.length && !strays.length) {
      pass(`${tpl}: tag tokens keep the exact colors they replaced, are read, and leave no literal behind`);
    } else {
      fail(`${tpl} tag tokens: wrongDefault=${JSON.stringify(wrongDefault)} unreferenced=${unreferenced} selfRef=${selfReferential} strays=${JSON.stringify(strays)}`);
    }
    }
  }

} catch (e) {
  fail(`theme-style tests crashed: ${e.message}`);
}
