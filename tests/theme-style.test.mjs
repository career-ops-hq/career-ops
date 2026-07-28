// tests/theme-style.test.mjs — unit coverage for the dynamic PDF theming helper
// (#1837): token parsing, style-block building/sanitizing, HTML injection, and a
// guard that the shipped templates actually read the variables with defaults.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\ntheme-style.mjs (dynamic PDF theming, #1837)');

try {
  const {
    styleTokensFrom, readStyleTokens, buildThemeStyleBlock, injectThemeStyle,
  } = await import(pathToFileURL(join(ROOT, 'theme-style.mjs')).href);

  // styleTokensFrom: recognized keys → css vars; ignore unknown/non-string/missing
  const t = styleTokensFrom({ accent_color: '#2563eb', font_family: 'Outfit, sans-serif', font_size: '10pt', margin: '0.5in', nope: 'x', font_weight: 700 });
  if (t['--accent-color'] === '#2563eb' && t['--font-family'] === 'Outfit, sans-serif' && t['--font-size'] === '10pt' && t['--page-margin'] === '0.5in'
      && !('--font-weight' in t) && Object.keys(t).length === 4) {
    pass('styleTokensFrom maps the 4 recognized keys and ignores unknown/non-string');
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

  // Template guard: shipped templates read the vars with :root defaults, no circular refs
  for (const tpl of ['templates/cv-template.html', 'templates/cover-letter-template.html']) {
    const src = readFileSync(join(ROOT, tpl), 'utf-8');
    const hasRoot = /:root\s*\{[^}]*--accent-color:[^}]*--font-family:[^}]*--font-size:[^}]*--page-margin:/s.test(src);
    const usesVars = src.includes('var(--accent-color)') && src.includes('var(--font-family)') && src.includes('var(--font-size)') && src.includes('var(--page-margin)');
    const circular = /--(accent-color|font-family|font-size|page-margin):\s*var\(/.test(src);
    if (hasRoot && usesVars && !circular) pass(`${tpl} declares :root theme defaults and reads them via var() (no circular refs)`);
    else fail(`${tpl}: hasRoot=${hasRoot} usesVars=${usesVars} circular=${circular}`);
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
} catch (e) {
  fail(`theme-style tests crashed: ${e.message}`);
}
