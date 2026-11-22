// tests/claude-directory-plugin.test.mjs — the plugin we submit to the Claude
// plugin directory (claude-directory/) passes the directory's checks.
//
// The directory validates a plugin folder against its pre-submission checklist
// (https://claude.com/docs/plugins/pre-submission-checklist). The repository
// root is too big for it: thousands of files, files over 256 KiB, a hook that
// runs `npm install`. Every one of those holds each new version for a human
// reviewer. claude-directory/ is the thin plugin instead: the router SKILL.md,
// a README that says what career-ops runs, sends and fetches, and the license.
// The skill's "Skill installed without career-ops" branch installs the rest
// with the user's yes.
//
// The copies must not drift from their sources, and every version in the
// folder must move with the release: release-please bumps the lines marked
// x-release-please-version, and these tests fail the release PR if one is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTree } from '../lib/walk-tree.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'claude-directory');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const { version } = JSON.parse(read('package.json'));

// links: 'reject' throws on a symlink: the directory needs regular files for everything the plugin loads.
const files = listTree(DIR, { links: 'reject' })
  .map((path) => ({ path, rel: relative(DIR, path).split(sep).join('/'), st: lstatSync(path) }));

test('the skill and the license are byte-identical copies of the canonical ones', () => {
  assert.equal(read('claude-directory/skills/career-ops/SKILL.md'), read('.agents/skills/career-ops/SKILL.md'),
    'claude-directory/skills/career-ops/SKILL.md diverged: copy .agents/skills/career-ops/SKILL.md over it');
  assert.equal(read('claude-directory/LICENSE'), read('LICENSE'), 'claude-directory/LICENSE diverged: copy LICENSE over it');
});

test('the manifest names the project, its license and the release version', () => {
  const manifest = JSON.parse(read('claude-directory/.claude-plugin/plugin.json'));
  const canon = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(manifest.name, canon.name);
  assert.equal(manifest.version, version, 'claude-directory/.claude-plugin/plugin.json version must match package.json');
  assert.equal(manifest.license, 'MIT');
  assert.ok(manifest.description && manifest.author?.name, 'the directory warns without description and author');
  for (const key of ['hooks', 'mcpServers', 'lspServers']) assert.equal(manifest[key], undefined, `the thin plugin declares no ${key}`);
  // Listing fields. The portal reads the icon only on the first save or submission, so it must be declared, not just present.
  assert.equal(manifest.displayName, 'career-ops');
  assert.equal(join(DIR, manifest.icon ?? ''), join(DIR, '.claude-plugin', 'icon.png'), 'plugin.json must point `icon` at .claude-plugin/icon.png');
  for (const key of ['homepage', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl']) assert.match(manifest[key] ?? '', /^https:\/\//, `${key} must be an https URL`);
});

test('every package launcher is pinned to an exact version, and career-ops to this release', () => {
  const launcher = /\b(?:npx|bunx|uvx|pnpm dlx|yarn dlx|pipx run)\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*([^\s`'"]+)/g;
  let careerOps = 0;
  for (const { path, rel } of files) {
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
  assert.ok(extra.some((f) => f.path === 'claude-directory/.claude-plugin/plugin.json' && f.jsonpath === '$.version'));
  for (const rel of ['claude-directory/skills/career-ops/SKILL.md', 'claude-directory/README.md', '.agents/skills/career-ops/SKILL.md']) {
    assert.ok(generic.includes(rel), `release-please-config.json does not bump ${rel}`);
    for (const line of read(rel).split('\n').filter((l) => l.includes(version))) {
      assert.match(line, /x-release-please-version/, `${rel}: a line with ${version} has no x-release-please-version marker`);
    }
  }
});

test('the folder stays inside the limits that would hold a version for a reviewer', () => {
  assert.ok(files.length <= 512, `${files.length} files; the directory holds more than 512`);
  for (const { rel, st } of files) {
    assert.ok(st.size < 256 * 1024, `${rel} is ${st.size} bytes; files over 256 KiB are held`);
    assert.match(rel, /(\.md|\.json|^LICENSE|^\.claude-plugin\/icon\.png)$/, `${rel}: only Markdown, JSON, the license and the icon belong in the thin plugin`);
    assert.doesNotMatch(rel, /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|package(-lock)?\.json|\.npmrc|\.mcp\.json)$/, `${rel} does not belong here`);
  }
  assert.ok(!files.some(({ rel }) => rel.startsWith('hooks/')), 'the thin plugin runs no hooks');
});

test('the listing icon is a square PNG the directory accepts', () => {
  // The portal takes the icon only once, when the plugin is first saved or submitted:
  // a later change does not reach the listing. Rendered from web/src/app/icon.svg.
  const png = readFileSync(join(DIR, '.claude-plugin', 'icon.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.equal(width, height, 'the icon must be square');
  assert.ok(width >= 512 && width <= 2048, `the icon is ${width} px; the directory takes 512 to 2048`);
  assert.ok(png.length < 2 * 1024 * 1024, 'the icon must be under 2 MB');
});

test('the README is long enough and says what the plugin runs, sends and fetches', () => {
  const readme = read('claude-directory/README.md');
  const prose = readme.replace(/```[\s\S]*?```/g, '').replaceAll('<!-- x-release-please-version -->', '');
  assert.ok(prose.split(/\s+/).filter(Boolean).length >= 40, 'the directory blocks a README under 40 words outside code blocks');
  for (const fact of ['npm registry', 'GitHub API', 'npm install', 'Chromium', 'portals.yml', 'https://career-ops.org/privacy']) {
    assert.ok(readme.includes(fact), `README no longer mentions ${fact}`);
  }
});
