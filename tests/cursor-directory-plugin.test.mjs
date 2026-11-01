// tests/cursor-directory-plugin.test.mjs: the plugin we submit to the Cursor
// Marketplace (cursor-directory/) passes the marketplace's checks.
//
// Cursor is sent a link to the repository and looks for the plugin at its
// root: a plugin.json there, or a .cursor-plugin/marketplace.json that points
// at the plugin folder. The repository root is the whole of career-ops, so the
// root carries only that marketplace.json, pointing at cursor-directory/, the
// thin plugin: the router SKILL.md, a README that says what career-ops runs,
// sends and fetches, the license and the logo. The checks follow the
// validator in github.com/cursor/plugin-template (scripts/validate-template.mjs):
// kebab-case names that match, a source folder that exists with its
// .cursor-plugin/plugin.json, relative paths without "..", resolved from the
// plugin folder, and skills with a name and a description.
//
// Cursor reviews every update by hand. The copies must not drift from their
// sources, and every version in the folder must move with the release:
// release-please bumps plugin.json and the lines marked x-release-please-version,
// and these tests fail the release PR if one is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTree } from '../lib/walk-tree.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'cursor-directory');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const { version } = JSON.parse(read('package.json'));
const KEBAB = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// links: 'reject' throws on a symlink: Cursor reads regular files from the repository.
const files = listTree(DIR, { links: 'reject' })
  .map((path) => ({ path, rel: relative(DIR, path).split(sep).join('/'), st: lstatSync(path) }));
const marketplace = JSON.parse(read('.cursor-plugin/marketplace.json'));
const manifest = JSON.parse(read('cursor-directory/.cursor-plugin/plugin.json'));

// A relative path that stays inside its base: no absolute prefix and no "..".
function isSafeRelative(value) {
  if (typeof value !== 'string' || value === '' || isAbsolute(value) || /^[a-zA-Z]:/.test(value)) return false;
  const normalized = posix.normalize(value.replaceAll('\\', '/'));
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.startsWith('/');
}

test('the root marketplace.json points at one plugin folder that exists', () => {
  assert.match(marketplace.name ?? '', KEBAB, 'marketplace name must be lowercase kebab-case');
  assert.ok(marketplace.owner?.name, 'marketplace owner.name is required');
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length === 1, 'the marketplace lists exactly one plugin');
  const names = marketplace.plugins.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, 'plugin names in the marketplace must be unique');
  const [entry] = marketplace.plugins;
  assert.match(entry.name ?? '', KEBAB, 'plugin name must be lowercase kebab-case');
  assert.ok(isSafeRelative(entry.source), `source "${entry.source}" must be a relative path without ".."`);
  assert.equal(join(ROOT, entry.source), DIR, 'the marketplace source must be ./cursor-directory');
  assert.ok(statSync(join(ROOT, entry.source)).isDirectory(), 'the marketplace source folder is missing');
  assert.equal(entry.name, manifest.name, 'the marketplace entry name must match plugin.json');
  assert.equal(entry.description, manifest.description, 'the marketplace entry and plugin.json describe the plugin in the same words');
});

test('the root .cursor-plugin/ holds only the marketplace, no plugin of its own', () => {
  // A root plugin.json would make Cursor read the whole repository as the plugin.
  assert.ok(!existsSync(join(ROOT, '.cursor-plugin', 'plugin.json')), 'no plugin.json at the root .cursor-plugin/');
  assert.ok(!existsSync(join(ROOT, 'plugin.json')), 'no plugin.json at the repository root');
});

test('plugin.json is valid and names the project, its license and the release version', () => {
  const canon = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(manifest.name, canon.name);
  assert.match(manifest.name, KEBAB, 'name must be lowercase kebab-case');
  assert.equal(manifest.displayName, 'career-ops');
  assert.match(manifest.version ?? '', /^\d+\.\d+\.\d+$/, 'version must be semver');
  assert.equal(manifest.version, version, 'cursor-directory/.cursor-plugin/plugin.json version must match package.json');
  assert.equal(manifest.license, 'MIT');
  assert.ok(manifest.description && manifest.author?.name, 'the manifest needs a description and an author');
  for (const key of ['homepage', 'repository']) assert.match(manifest[key] ?? '', /^https:\/\//, `${key} must be an https URL`);
});

test('every path in the manifest is relative, without "..", and resolves inside the plugin', () => {
  for (const field of ['logo', 'rules', 'skills', 'agents', 'commands', 'hooks', 'mcpServers']) {
    const values = [manifest[field]].flat().filter((v) => v !== undefined)
      .map((v) => (typeof v === 'object' && v ? v.path ?? v.file : v));
    for (const value of values) {
      if (/^https?:\/\//.test(value)) continue;
      assert.ok(isSafeRelative(value), `${field}: "${value}" must be a relative path without ".."`);
      assert.ok(existsSync(join(DIR, value)), `${field}: "${value}" does not exist under cursor-directory/`);
    }
  }
});

test('the logo exists and is a square PNG', () => {
  // Resolved from the plugin folder, as the template's validator does (path.resolve(pluginDir, logo)).
  assert.equal(join(DIR, manifest.logo ?? ''), join(DIR, 'assets', 'logo.png'), 'plugin.json must point `logo` at assets/logo.png');
  const png = readFileSync(join(DIR, manifest.logo));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.equal(width, height, 'the logo must be square');
});

test('the skill and the license are byte-identical copies of the canonical ones', () => {
  assert.equal(read('cursor-directory/skills/career-ops/SKILL.md'), read('.agents/skills/career-ops/SKILL.md'),
    'cursor-directory/skills/career-ops/SKILL.md diverged: copy .agents/skills/career-ops/SKILL.md over it');
  assert.equal(read('cursor-directory/LICENSE'), read('LICENSE'), 'cursor-directory/LICENSE diverged: copy LICENSE over it');
  for (const { path, rel } of files.filter(({ rel }) => rel.endsWith('/SKILL.md'))) {
    assert.match(rel, /^skills\/[a-z0-9-]+\/SKILL\.md$/, `${rel}: skills live at skills/<name>/SKILL.md`);
    const front = readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    assert.equal(front.match(/^name:\s*(.+)$/m)?.[1]?.trim(), rel.split('/')[1], `${rel}: frontmatter name must match its folder`);
    assert.match(front, /^description:\s*\S/m, `${rel}: frontmatter needs a description`);
  }
});

test('only the skill: no hooks, MCP servers, rules, agents or commands', () => {
  for (const key of ['hooks', 'mcpServers', 'rules', 'agents', 'commands', 'lspServers']) {
    assert.equal(manifest[key], undefined, `the thin plugin declares no ${key}`);
  }
  for (const { rel } of files) {
    assert.doesNotMatch(rel, /^(hooks|rules|agents|commands|scripts)\//, `${rel}: the thin plugin carries only the skill`);
    assert.doesNotMatch(rel, /(^|\/)(hooks\.json|mcp\.json|\.mcp\.json)$/, `${rel}: the thin plugin runs no hooks or MCP servers`);
    assert.doesNotMatch(rel, /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|package(-lock)?\.json|\.npmrc)$/, `${rel} does not belong here`);
    assert.match(rel, /(\.md|^\.cursor-plugin\/plugin\.json|^LICENSE|^assets\/logo\.png)$/, `${rel}: only Markdown, the manifest, the license and the logo belong in the thin plugin`);
  }
});

test('every package launcher is pinned to an exact version, and career-ops to this release', () => {
  const launcher = /\b(?:npx|bunx|uvx|pnpm dlx|yarn dlx|pipx run)\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*([^\s`'"]+)/g;
  let careerOps = 0;
  for (const { path, rel } of files) {
    if (rel.endsWith('.png')) continue;
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
  assert.ok(extra.some((f) => f.path === 'cursor-directory/.cursor-plugin/plugin.json' && f.jsonpath === '$.version'),
    'release-please-config.json does not bump cursor-directory/.cursor-plugin/plugin.json');
  for (const rel of ['cursor-directory/skills/career-ops/SKILL.md', 'cursor-directory/README.md']) {
    assert.ok(generic.includes(rel), `release-please-config.json does not bump ${rel}`);
    for (const line of read(rel).split('\n').filter((l) => l.includes(version))) {
      assert.match(line, /x-release-please-version/, `${rel}: a line with ${version} has no x-release-please-version marker`);
    }
  }
});

test('the README says what the plugin runs, sends and fetches, for Cursor', () => {
  const readme = read('cursor-directory/README.md');
  const prose = readme.replace(/```[\s\S]*?```/g, '').replaceAll('<!-- x-release-please-version -->', '');
  assert.ok(prose.split(/\s+/).filter(Boolean).length >= 40, 'the README is under 40 words outside code blocks');
  assert.match(readme, /^## What it runs, sends and fetches$/m, 'the disclosure section is gone from the README');
  for (const fact of ['npm registry', 'GitHub API', 'npm install', 'Chromium', 'portals.yml', 'the model you use in Cursor', 'https://career-ops.org/privacy']) {
    assert.ok(readme.includes(fact), `README no longer mentions ${fact}`);
  }
  assert.doesNotMatch(readme, /\/plugin (?:install|marketplace)|ChatGPT|Codex|Claude/, 'instructions for other platforms do not belong in the Cursor README');
});
