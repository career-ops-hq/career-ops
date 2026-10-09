import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadBindings, transform } from 'next/dist/build/swc/index.js';
import { COST_META } from '../../src/lib/explore-cost.ts';
import { offerProvenance } from '../../src/lib/explore-state.mjs';

await loadBindings();
const require = createRequire(import.meta.url);
const placeholder = ({ children }) => children ?? null;
const icon = () => React.createElement('span');
const common = {
  'lucide-react': new Proxy({}, { get: () => icon }),
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
  'next/navigation': { usePathname: () => '/explore' },
  '@/lib/cn': { cn: (...values) => values.filter(Boolean).join(' ') },
  '@/lib/fonts': { instrumentSerif: { className: 'serif' } },
  '@/lib/explore-cost': { COST_META }, '@/lib/explore-state.mjs': { offerProvenance },
  '@/components/jobs/job-store': { JobsProvider: placeholder, useJobs: () => ({ jobs: [], startJob() {} }) },
  './explore-provider': { useExplore: () => ({ added: new Set(), adding: new Set(), addToPipeline() {} }) },
};
async function load(path, dependencies = {}) {
  const { code } = await transform(fs.readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8'), {
    filename: path, jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => dependencies[id] ?? common[id] ??
    (id.startsWith('@/components/') ? new Proxy({}, { get: () => placeholder }) : require(id)), module, module.exports);
  return module.exports;
}
const nav = await load('lib/nav-items.ts');
const { CostBadge } = await load('components/cost/cost-badge.tsx');
const { AppShell } = await load('components/app-shell.tsx', { '@/lib/nav-items': nav });
const { MobileNav } = await load('components/mobile-nav.tsx', { '@/lib/nav-items': nav });
const { ExploreModeToggle } = await load('components/explore/explore-mode-toggle.tsx', { '@/components/cost/cost-badge': { CostBadge } });
const { DiscoveryCard } = await load('components/explore/discovery-card.tsx');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const offer = { url: 'https://example.test/job', company: 'Acme', title: 'Assistant', location: 'Lisboa', postedAt: '', verification: 'unconfirmed' };
const card = render(DiscoveryCard, { offer, inPipeline: false });

test('mapped contrast surfaces retain readable theme-aware text and non-color cues', async t => {
  await t.test('desktop and mobile Novo chips avoid dark-brand on doubled soft background', () => {
    for (const Component of [AppShell, MobileNav]) {
      const chip = render(Component, {}).match(/<span[^>]*>Novo<\/span>/)?.[0];
      assert.ok(chip);
      assert.doesNotMatch(chip, /text-brand-text/);
      assert.match(chip, /text-foreground/);
      assert.match(chip, /border-brand\/30/);
    }
  });
  await t.test('both selected search modes have foreground and a non-color cue', () => {
    for (const mode of ['scan', 'ai']) {
      const selected = render(ExploreModeToggle, { mode, onChange() {}, cliConfigured: true }).match(/<button[^>]*aria-pressed="true"[^>]*>/)?.[0];
      assert.ok(selected);
      assert.doesNotMatch(selected, /\btext-brand\b/);
      assert.match(selected, /text-foreground/);
      assert.match(selected, /\bunderline\b/);
    }
  });
  await t.test('free cost badge uses a darker green while retaining its dark-theme color', () => {
    assert.match(render(CostBadge, { kind: 'free-network', size: 'xs' }), /data-tone="free".*Sem custo/);
    const css = fs.readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
    const free = css.match(/\.co-cost\[data-tone="free"\]\{[^}]*\}/)?.[0];
    assert.doesNotMatch(free, /color:hsl\(162 91% 24%\)/);
    assert.match(free, /color:hsl\(162 91% 20%\)/);
    assert.match(css, /html\.dark \.co-cost\[data-tone="free"\]\{color:hsl\(158 64% 60%\)/);
  });
  await t.test('unconfirmed badge does not pair light amber text with a soft amber background', () => {
    const badge = card.match(/<span[^>]*title="Encontrada na web pública[^>]*>[\s\S]*?por confirmar<\/span>/)?.[0];
    assert.ok(badge);
    assert.doesNotMatch(badge, /text-amber-600|dark:text-amber-300/);
    assert.match(badge, /bg-amber-500\/10.*text-foreground/);
  });
  await t.test('evaluation action avoids raw brand text and retains its border cue', () => {
    const action = card.match(/<button[^>]*>Avaliar[\s\S]*?<\/button>/)?.[0];
    assert.ok(action);
    assert.doesNotMatch(action, /\btext-brand\b/);
    assert.match(action, /text-foreground/);
    assert.match(action, /border-brand\/30/);
    assert.match(action, /font-medium/);
  });
});
