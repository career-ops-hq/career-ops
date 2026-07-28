#!/usr/bin/env node
/**
 * theme-style.mjs — dynamic CV/cover-letter theming from config/profile.yml (#1837)
 *
 * Users declare a `style:` block in config/profile.yml:
 *
 *   style:
 *     accent_color: "#2563eb"
 *     font_family:  "Outfit, Inter, sans-serif"
 *     font_size:    "10pt"
 *     margin:       "0.5in"
 *
 * These are injected as CSS custom properties into the rendered HTML before it
 * hits the PDF pipeline. The templates read them via `var(--x, <default>)`, so a
 * profile with no `style:` block produces byte-identical output — this only ever
 * *overrides* the template defaults, never changes the baseline.
 *
 * Pure + dependency-light (js-yaml only) so it's unit-testable without Playwright.
 */
import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';

// Recognized style tokens → the CSS custom property each maps to. Anything not
// listed here is ignored, so a typo or an unrelated `style:` key is inert.
export const STYLE_VAR_MAP = {
  accent_color: '--accent-color',
  font_family:  '--font-family',
  font_size:    '--font-size',
  margin:       '--page-margin',
};

/**
 * Read the recognized `style:` tokens from a profile file into a
 * { '--css-var': 'value' } map. Missing file / absent block / bad YAML → {}.
 * @param {string} [profilePath]
 * @returns {Record<string,string>}
 */
export function readStyleTokens(profilePath = 'config/profile.yml') {
  try {
    if (!existsSync(profilePath)) return {};
    const raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    return styleTokensFrom(raw?.style);
  } catch {
    return {};
  }
}

/**
 * Map a parsed `style:` object to { '--css-var': value }, keeping only the
 * recognized string tokens. Exported for tests.
 * @param {unknown} style
 * @returns {Record<string,string>}
 */
export function styleTokensFrom(style) {
  const out = {};
  if (!style || typeof style !== 'object' || Array.isArray(style)) return out;
  for (const [key, cssVar] of Object.entries(STYLE_VAR_MAP)) {
    const v = style[key];
    if (typeof v === 'string' && v.trim()) out[cssVar] = v.trim();
  }
  return out;
}

/**
 * Build a `<style>` block declaring the custom properties on :root, or '' when
 * there is nothing to declare. Values containing CSS/HTML control characters
 * (`; { } < >`) are dropped — a custom-property value can't legitimately contain
 * them, and allowing them would let a profile break out of the rule or the tag.
 * @param {Record<string,string>} tokens
 * @returns {string}
 */
export function buildThemeStyleBlock(tokens) {
  const decls = Object.entries(tokens || {})
    .filter(([, v]) => typeof v === 'string' && v.trim() && !/[;{}<>]/.test(v))
    .map(([cssVar, v]) => `${cssVar}: ${v.trim()};`)
    .join(' ');
  if (!decls) return '';
  return `<style id="career-ops-dynamic-theme">:root { ${decls} }</style>`;
}

/**
 * Inject the theme block into an HTML string so it overrides the template's own
 * :root defaults (later declaration wins for custom properties). Inserted just
 * before </head>, or prepended when there is no head. A no-op when there are no
 * tokens, so callers can pass it unconditionally.
 * @param {string} html
 * @param {Record<string,string>} tokens
 * @returns {string}
 */
export function injectThemeStyle(html, tokens) {
  const block = buildThemeStyleBlock(tokens);
  if (!block) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}\n</head>`);
  return `${block}\n${html}`;
}
