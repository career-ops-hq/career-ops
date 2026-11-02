// tests/antigravity-directory-plugin.test.mjs: the plugin we submit to the
// Antigravity Marketplace (antigravity-directory/) passes its pre-publish checklist.
//
// The marketplace takes a plugin that passes `agy plugin validate --strict`
// with no errors and no warnings and carries a complete plugin.json (name,
// displayName, description, version, logo, suggestedPrompts, author), a README
// and a bundled logo (https://antigravity.google/docs/build-plugins.md,
// "Pre-publish checklist"). agy is not installed in CI, so these tests check
// the same rules in Node; run `agy plugin validate --strict antigravity-directory`
// by hand before each submission. Like the other directory plugins, this is the
// thin plugin: the router SKILL.md, a README that says what career-ops runs,
// sends and fetches, the license and the logo.
//
// The copies must not drift from their sources, and every version in the
// folder must move with the release: release-please bumps plugin.json and the
// lines marked x-release-please-version, and these tests fail the release PR
// if one is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTree } from '../lib/walk-tree.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'antigravity-directory');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const { version } = JSON.parse(read('package.json'));
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_PREFIX = /^(antigravity|gemini|claude|cursor)\b/i;

// links: 'reject' throws on a symlink: the marketplace bundles regular files.
const files = listTree(DIR, { links: 'reject' })
  .map((path) => ({ path, rel: relative(DIR, path).split(sep).join('/'), st: lstatSync(path) }));
const manifest = JSON.parse(read('antigravity-directory/plugin.json'));

function isSafeRelative(value) {
  if (typeof value !== 'string' || value === '' || isAbsolute(value) || /^[a-zA-Z]:/.test(value)) return false;
  const normalized = posix.normalize(value.replaceAll('\\', '/'));
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.startsWith('/');
}

// Width, height and the RGBA pixels of a non-interlaced 8-bit RGBA PNG.
async function decodePng(buf) {
  const { inflateSync } = await import('node:zlib');
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  const [depth, colorType, interlace] = [buf[24], buf[25], buf[28]];
  assert.ok(depth === 8 && colorType === 6 && interlace === 0, 'the logo must be an 8-bit RGBA PNG (it needs an alpha channel for the transparent margin)');
  const idat = [];
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4, px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0, b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y ? px[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      px[y * stride + x] = (line[x] + pred) & 0xff;
    }
  }
  return { width, height, alpha: (x, y) => px[y * stride + x * 4 + 3] };
}

test('the skill and the license are byte-identical copies of the canonical ones', () => {
  assert.equal(read('antigravity-directory/skills/career-ops/SKILL.md'), read('.agents/skills/career-ops/SKILL.md'),
    'antigravity-directory/skills/career-ops/SKILL.md diverged: copy .agents/skills/career-ops/SKILL.md over it');
  assert.equal(read('antigravity-directory/LICENSE'), read('LICENSE'), 'antigravity-directory/LICENSE diverged: copy LICENSE over it');
});

test('one manifest at the plugin root, and every skill folder matches its name', () => {
  const manifests = files.filter(({ rel }) => /(^|\/)plugin\.json$/.test(rel)).map(({ rel }) => rel);
  assert.deepEqual(manifests, ['plugin.json'], 'the only manifest is antigravity-directory/plugin.json');
  const skills = files.filter(({ rel }) => rel.endsWith('/SKILL.md'));
  assert.ok(skills.length >= 1, 'the plugin carries at least one skill');
  for (const { path, rel } of skills) {
    assert.match(rel, /^skills\/[a-z0-9-]+\/SKILL\.md$/, `${rel}: skills live at skills/<name>/SKILL.md`);
    const front = readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    assert.equal(front.match(/^name:\s*(.+)$/m)?.[1]?.trim(), rel.split('/')[1], `${rel}: frontmatter name must match its folder`);
    const description = front.match(/^description:\s*"?(.*?)"?\s*$/m)?.[1] ?? '';
    assert.ok(description.length >= 1 && description.length <= 1024, `${rel}: description must be 1 to 1,024 characters`);
  }
});

test('the manifest has every field the marketplace requires', () => {
  const canon = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(manifest.$schema, 'https://antigravity.google/schemas/v1/plugin.json');
  assert.equal(manifest.name, canon.name);
  assert.match(manifest.name, KEBAB, 'name must be lowercase kebab-case');
  assert.equal(manifest.displayName, 'career-ops');
  for (const key of ['name', 'displayName']) {
    assert.doesNotMatch(manifest[key], RESERVED_PREFIX, `${key} must not lead with Antigravity, Gemini, Claude or Cursor`);
  }
  assert.doesNotMatch(manifest.displayName, /\b(plugin|mcp)$/i, 'displayName drops suffixes like Plugin or MCP');
  assert.match(manifest.version ?? '', /^\d+\.\d+\.\d+$/, 'version must be semver');
  assert.equal(manifest.version, version, 'antigravity-directory/plugin.json version must match package.json');
  const { length } = manifest.description ?? '';
  assert.ok(length >= 120 && length <= 160, `description is ${length} characters; the marketplace recommends 120 to 160`);
  assert.ok(manifest.author?.name, 'author.name is required');
  for (const key of ['homepage', 'repository']) assert.match(manifest[key] ?? '', /^https:\/\//, `${key} must be an https URL`);
  if (manifest.author.url !== undefined) assert.match(manifest.author.url, /^https:\/\//, 'author.url must be an https URL');
  assert.equal(manifest.license, 'MIT');
  for (const k of manifest.keywords ?? []) assert.equal(k, k.toLowerCase(), `keyword "${k}" must be lowercase`);
});

test('up to three suggested prompts, none repeated', () => {
  const prompts = manifest.suggestedPrompts;
  assert.ok(Array.isArray(prompts) && prompts.length >= 1 && prompts.length <= 3, 'suggestedPrompts: 1 to 3 entries');
  for (const p of prompts) assert.ok(typeof p === 'string' && p.trim().length > 0, 'a suggested prompt is empty');
  assert.equal(new Set(prompts).size, prompts.length, 'suggestedPrompts must not repeat');
});

test('the logo is a bundled square PNG of at least 128 px with a transparent margin', async () => {
  assert.ok(isSafeRelative(manifest.logo), `logo "${manifest.logo}" must be a relative path inside the plugin`);
  assert.equal(join(DIR, manifest.logo), join(DIR, 'assets', 'logo.png'), 'plugin.json must point `logo` at assets/logo.png');
  const png = readFileSync(join(DIR, manifest.logo));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const { width, height, alpha } = await decodePng(png);
  assert.equal(width, height, 'the logo must be square');
  assert.ok(width >= 128, `the logo is ${width} px; the marketplace needs at least 128`);
  // About 10% transparent padding: the outer band (8% of the side) must be fully transparent.
  const band = Math.floor(width * 0.08);
  for (let i = 0; i < width; i++) {
    for (let d = 0; d < band; d++) {
      for (const [x, y] of [[i, d], [i, height - 1 - d], [d, i], [width - 1 - d, i]]) {
        assert.equal(alpha(x, y), 0, `the logo is not transparent at (${x}, ${y}); keep about 10% transparent margin`);
      }
    }
  }
  assert.equal(alpha(width >> 1, height >> 1), 255, 'the logo is empty in the middle');
});

test('only the skill: no hooks, MCP servers, agents, rules or scripts', () => {
  for (const key of ['hooks', 'mcpServers', 'agents', 'rules', 'skills']) {
    assert.equal(manifest[key], undefined, `the thin plugin declares no ${key} (skills load from the default skills/ folder)`);
  }
  for (const { rel } of files) {
    assert.doesNotMatch(rel, /^(agents|rules|scripts|hooks|\.antigravity-plugin|\.gemini-plugin|\.claude-plugin|\.cursor-plugin)\//, `${rel}: the thin plugin carries only the skill`);
    assert.doesNotMatch(rel, /(^|\/)(hooks\.json|mcp\.json|\.mcp\.json|AGENTS\.md)$/, `${rel}: the thin plugin runs no hooks, MCP servers or rules`);
    assert.doesNotMatch(rel, /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|package(-lock)?\.json|\.npmrc)$/, `${rel} does not belong here`);
    assert.match(rel, /(\.md|^plugin\.json|^LICENSE|^assets\/logo\.png)$/, `${rel}: only Markdown, the manifest, the license and the logo belong in the thin plugin`);
  }
});

test('every package launcher is pinned to an exact version, and career-ops to this release', () => {
  const launcher = /\b(?:npx|bunx|uvx|pnpm dlx|yarn dlx|pipx run)\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*([^\s`'"]+)/g;
  let careerOps = 0;
  for (const { path, rel } of files.filter(({ rel }) => !rel.endsWith('.png'))) {
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
  assert.ok(extra.some((f) => f.path === 'antigravity-directory/plugin.json' && f.jsonpath === '$.version'),
    'release-please-config.json does not bump antigravity-directory/plugin.json');
  for (const rel of ['antigravity-directory/skills/career-ops/SKILL.md', 'antigravity-directory/README.md']) {
    assert.ok(generic.includes(rel), `release-please-config.json does not bump ${rel}`);
    for (const line of read(rel).split('\n').filter((l) => l.includes(version))) {
      assert.match(line, /x-release-please-version/, `${rel}: a line with ${version} has no x-release-please-version marker`);
    }
  }
});

test('the README says what the plugin runs, sends and fetches, for Antigravity', () => {
  assert.ok(existsSync(join(DIR, 'README.md')), 'the marketplace shows README.md before install');
  const readme = read('antigravity-directory/README.md');
  const prose = readme.replace(/```[\s\S]*?```/g, '').replaceAll('<!-- x-release-please-version -->', '');
  assert.ok(prose.split(/\s+/).filter(Boolean).length >= 40, 'the README is under 40 words outside code blocks');
  assert.match(readme, /^## What it runs, sends and fetches$/m, 'the disclosure section is gone from the README');
  for (const fact of ['npm registry', 'GitHub API', 'npm install', 'Chromium', 'portals.yml', 'the model you use in Antigravity', 'https://career-ops.org/privacy']) {
    assert.ok(readme.includes(fact), `README no longer mentions ${fact}`);
  }
  assert.doesNotMatch(readme, /\/plugin (?:install|marketplace)|ChatGPT|Codex|Claude|Cursor/, 'instructions for other platforms do not belong in the Antigravity README');
});
