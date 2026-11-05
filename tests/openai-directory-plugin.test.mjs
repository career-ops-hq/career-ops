// tests/openai-directory-plugin.test.mjs: the plugin we submit to the OpenAI
// plugin directory (openai-directory/) passes the directory's submission checks.
//
// The OpenAI directory lists one plugin for ChatGPT and Codex. A skills-only
// plugin with `requires_local_executor: true` goes through the standard
// submission as "Desktop only". The portal rejects a submission that breaks
// any of the rules in
// https://developers.openai.com/plugins/deploy/submission-errors.md: one plugin
// root with one manifest, skills with a name and a description, no hooks, MCP
// servers, apps or screenshots, square PNG icons, listing text within its
// limits and a brand color legible on white. Like claude-directory/, this is
// the thin plugin: the router SKILL.md, a README that says what career-ops
// runs, sends and fetches, the license and the icon.
//
// The copies must not drift from their sources, and every version in the
// folder must move with the release: OpenAI asks for a new `version` on every
// submission. release-please bumps plugin.json and the lines marked
// x-release-please-version, and these tests fail the release PR if one is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTree } from '../lib/walk-tree.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'openai-directory');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const { version } = JSON.parse(read('package.json'));

// links: 'reject' throws on a symlink: the ZIP must carry regular files.
const files = listTree(DIR, { links: 'reject' })
  .map((path) => ({ path, rel: relative(DIR, path).split(sep).join('/'), st: lstatSync(path) }));
const manifest = JSON.parse(read('openai-directory/plugin.json'));
const ui = manifest.extensions?.['com.openai']?.interface ?? {};

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the skill and the license are byte-identical copies of the canonical ones', () => {
  assert.equal(read('openai-directory/skills/career-ops/SKILL.md'), read('.agents/skills/career-ops/SKILL.md'),
    'openai-directory/skills/career-ops/SKILL.md diverged: copy .agents/skills/career-ops/SKILL.md over it');
  assert.equal(read('openai-directory/LICENSE'), read('LICENSE'), 'openai-directory/LICENSE diverged: copy LICENSE over it');
});

test('one plugin root with one manifest, and every skill has a name and a short description', () => {
  const manifests = files.filter(({ rel }) => /(^|\/)plugin\.json$/.test(rel)).map(({ rel }) => rel);
  assert.deepEqual(manifests, ['plugin.json'], 'the only manifest is openai-directory/plugin.json');
  assert.ok(!files.some(({ rel }) => /(^|\/)\.(claude|codex)-plugin\//.test(rel)), 'no second manifest folder in the OpenAI plugin');
  const skills = files.filter(({ rel }) => rel.endsWith('/SKILL.md'));
  assert.ok(skills.length >= 1, 'the plugin carries at least one skill');
  for (const { path, rel } of skills) {
    assert.match(rel, /^skills\/[a-z0-9-]+\/SKILL\.md$/, `${rel}: skills live at skills/<name>/SKILL.md`);
    const front = readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    const name = front.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = front.match(/^description:\s*"?(.*?)"?\s*$/m)?.[1];
    assert.equal(name, rel.split('/')[1], `${rel}: frontmatter name must match its folder`);
    assert.ok(description && description.length <= 1024, `${rel}: description missing or over 1,024 characters`);
  }
});

test('the manifest names the project, its license and the release version', () => {
  const canon = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(manifest.name, canon.name);
  assert.match(manifest.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'name must be kebab-case');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'version must be semver');
  assert.equal(manifest.version, version, 'openai-directory/plugin.json version must match package.json');
  assert.equal(manifest.license, 'MIT');
  assert.ok(manifest.description && manifest.description.length <= 1024, 'description missing or over 1,024 characters');
  assert.ok(manifest.author?.name, 'the manifest names its author');
  assert.equal(manifest.extensions?.['com.openai']?.requires_local_executor, true, 'a skills-only plugin that runs scripts needs a local executor');
});

test('the listing text stays inside the directory limits', () => {
  assert.equal(ui.displayName, 'career-ops');
  assert.ok(ui.displayName.length <= 30, 'displayName over 30 characters');
  assert.ok(ui.shortDescription && ui.shortDescription.length <= 30, 'shortDescription missing or over 30 characters');
  assert.ok(ui.longDescription && ui.longDescription.length <= 4000, 'longDescription missing or over 4,000 characters');
  assert.ok(ui.developerName && ui.category, 'developerName and category are required');

  assert.ok(Array.isArray(ui.capabilities) && ui.capabilities.length >= 1 && ui.capabilities.length <= 20, 'capabilities: 1 to 20 entries');
  for (const c of ui.capabilities) assert.ok(c.length <= 120, `capability over 120 characters: ${c}`);

  assert.ok(Array.isArray(ui.defaultPrompt) && ui.defaultPrompt.length >= 1 && ui.defaultPrompt.length <= 3, 'defaultPrompt: 1 to 3 entries');
  for (const p of ui.defaultPrompt) assert.ok(p.length <= 128, `defaultPrompt over 128 characters: ${p}`);
  assert.equal(new Set(ui.defaultPrompt).size, ui.defaultPrompt.length, 'defaultPrompt entries must not repeat');

  for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    assert.match(ui[key] ?? '', /^https:\/\//, `${key} must be an https URL`);
  }
  // The privacy link opens the README section that says what leaves the machine.
  assert.ok(ui.privacyPolicyURL.endsWith('/openai-directory/README.md#what-it-runs-sends-and-fetches'));
  assert.match(read('openai-directory/README.md'), /^## What it runs, sends and fetches$/m, 'the privacy anchor is gone from the README');
});

test('the brand color is legible on white', () => {
  assert.match(ui.brandColor ?? '', /^#[0-9A-Fa-f]{6}$/, 'brandColor must be a #RRGGBB hex color');
  const ratio = contrast(ui.brandColor, '#FFFFFF');
  assert.ok(ratio >= 2, `brandColor ${ui.brandColor} has ${ratio.toFixed(2)}:1 against white; the directory needs 2:1`);
});

test('the icons are square PNGs the directory accepts, declared with ./ paths', () => {
  for (const key of ['composerIcon', 'logo']) {
    const rel = ui[key] ?? '';
    assert.match(rel, /^\.\/[^\s]+\.png$/, `${key} must be a ./ path to a PNG`);
    const png = readFileSync(join(DIR, rel));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', `${key} is not a PNG`);
    const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.equal(width, height, `${key} must be square`);
    assert.ok(width >= 48, `${key} is ${width} px; the directory needs at least 48`);
    assert.ok(png.length <= 5 * 1024 * 1024, `${key} is over 5 MiB`);
  }
});

test('no hooks, MCP servers, apps or screenshots', () => {
  for (const key of ['hooks', 'mcpServers', 'apps', 'lspServers']) assert.equal(manifest[key], undefined, `the thin plugin declares no ${key}`);
  assert.equal(ui.screenshots, undefined, 'interface.screenshots is rejected');
  for (const { rel } of files) {
    assert.doesNotMatch(rel, /(^|\/)(hooks\/|hooks\.json$|\.mcp\.json$|\.app\.json$)/, `${rel} is rejected by the directory`);
    assert.doesNotMatch(rel, /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|package(-lock)?\.json|\.npmrc)$/, `${rel} does not belong here`);
    assert.match(rel, /(\.md|^plugin\.json|^LICENSE|^assets\/[\w-]+\.png)$/, `${rel}: only Markdown, the manifest, the license and the icons belong in the thin plugin`);
  }
});

test('every package launcher in the files the plugin runs is pinned, and career-ops to this release', () => {
  // The listing text in plugin.json names the command without a version on purpose:
  // it describes the flow to a reader; the skill is what runs it.
  const launcher = /\b(?:npx|bunx|uvx|pnpm dlx|yarn dlx|pipx run)\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*([^\s`'"]+)/g;
  let careerOps = 0;
  for (const { path, rel } of files.filter(({ rel }) => rel.endsWith('.md'))) {
    for (const [, pkg] of readFileSync(path, 'utf8').matchAll(launcher)) {
      assert.match(pkg, /^(?:@[\w.-]+\/)?[\w.-]+(?:@|==)\d+\.\d+\.\d+$/, `${rel}: "${pkg}" is not pinned to an exact version`);
      if (pkg.startsWith('@santifer/career-ops@')) {
        careerOps++;
        assert.equal(pkg, `@santifer/career-ops@${version}`, `${rel}: the init command must pin the current release`);
      }
    }
  }
  assert.ok(careerOps >= 3, 'the skill (twice) and the README name the pinned init command');
});

test('every line that carries the release version is marked for release-please', () => {
  const config = JSON.parse(read('release-please-config.json'));
  const extra = config.packages['.']['extra-files'];
  const generic = extra.filter((f) => f.type === 'generic').map((f) => f.path);
  assert.ok(extra.some((f) => f.path === 'openai-directory/plugin.json' && f.jsonpath === '$.version'),
    'release-please-config.json does not bump openai-directory/plugin.json');
  for (const rel of ['openai-directory/skills/career-ops/SKILL.md', 'openai-directory/README.md']) {
    assert.ok(generic.includes(rel), `release-please-config.json does not bump ${rel}`);
    for (const line of read(rel).split('\n').filter((l) => l.includes(version))) {
      assert.match(line, /x-release-please-version/, `${rel}: a line with ${version} has no x-release-please-version marker`);
    }
  }
});

test('the README is long enough and says what the plugin runs, sends and fetches', () => {
  const readme = read('openai-directory/README.md');
  const prose = readme.replace(/```[\s\S]*?```/g, '').replaceAll('<!-- x-release-please-version -->', '');
  assert.ok(prose.split(/\s+/).filter(Boolean).length >= 40, 'the README is under 40 words outside code blocks');
  for (const fact of ['npm registry', 'GitHub API', 'npm install', 'Chromium', 'portals.yml', 'ChatGPT or Codex', 'https://career-ops.org/privacy']) {
    assert.ok(readme.includes(fact), `README no longer mentions ${fact}`);
  }
  assert.doesNotMatch(readme, /\/plugin (?:install|marketplace)/, 'Claude /plugin instructions do not belong in the OpenAI README');
});
