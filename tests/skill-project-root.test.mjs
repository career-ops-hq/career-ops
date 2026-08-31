import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { fail, pass, rmSync, ROOT, run } from './helpers.mjs';

console.log('\nSkill project-root resolution (#3332)');

const entrypoints = [
  '.agents',
  '.antigravitycli',
  '.claude',
  '.cursor',
  '.grok',
  '.kimi',
  '.opencode',
  '.qwen',
].map(dir => join(dir, 'skills', 'career-ops', 'SKILL.md'));

function findProjectRoot(skillPath) {
  let current = dirname(skillPath);
  while (true) {
    if (existsSync(join(current, 'AGENTS.md')) && existsSync(join(current, 'modes'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function gitIndexMode(relativePath, repoRoot = ROOT) {
  const output = run('git', ['ls-files', '-s', '--', relativePath], { cwd: repoRoot });
  const match = output?.match(/^(\d{6})\s+\S+\s+\d+\t/);
  return match?.[1] || null;
}

function hasRoutingRule(text) {
  return text.includes('Resolve every path in this router') &&
    text.includes("never against the process's current working directory");
}

function isRegularFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isInsideRoot(root, target) {
  const relativeTarget = relative(resolve(root), resolve(target));

  return relativeTarget === '' ||
    (relativeTarget !== '..' &&
      !relativeTarget.startsWith(`..${sep}`) &&
      !isAbsolute(relativeTarget));
}

function readSkillEntrypoint(skillPath, relativePath, repoRoot = ROOT) {
  if (!isRegularFile(skillPath)) {
    return { path: skillPath, text: '' };
  }

  const text = readFileSync(skillPath, 'utf8');
  if (gitIndexMode(relativePath, repoRoot) !== '120000' || hasRoutingRule(text)) {
    return { path: skillPath, text };
  }

  const pointer = text.trim();
  if (!pointer || /\r?\n/.test(pointer)) return { path: skillPath, text };

  const target = resolve(dirname(skillPath), pointer);
  if (!isInsideRoot(repoRoot, target) || !isRegularFile(target)) {
    return { path: skillPath, text };
  }
  return { path: target, text: readFileSync(target, 'utf8') };
}

const failures = [];
for (const relativePath of entrypoints) {
  const skillPath = join(ROOT, relativePath);
  if (!isRegularFile(skillPath)) {
    failures.push(`${relativePath}: missing entrypoint`);
    continue;
  }
  const entrypoint = readSkillEntrypoint(skillPath, relativePath);
  const resolvedRoot = findProjectRoot(entrypoint.path);

  if (resolve(resolvedRoot || '') !== resolve(ROOT)) {
    failures.push(`${relativePath}: resolved ${resolvedRoot || '(none)'}`);
  }
  if (!hasRoutingRule(entrypoint.text)) {
    failures.push(`${relativePath}: missing cwd-independent routing rule`);
  }
}

if (failures.length === 0) {
  pass('all CLI skill entrypoints resolve modes/ from the checkout root, not cwd');
} else {
  fail(failures.join(' | '));
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-ops-materialized-symlink-'));
const fixtureTarget = join(fixtureRoot, '.agents', 'skills', 'career-ops', 'SKILL.md');
const fixturePointer = join(fixtureRoot, '.claude', 'skills', 'career-ops', 'SKILL.md');
const fixtureTargetRelative = '.agents/skills/career-ops/SKILL.md';
const fixturePointerRelative = '.claude/skills/career-ops/SKILL.md';
const pointerTarget = '../../../.agents/skills/career-ops/SKILL.md';

try {
  mkdirSync(dirname(fixtureTarget), { recursive: true });
  mkdirSync(dirname(fixturePointer), { recursive: true });
  mkdirSync(join(fixtureRoot, 'modes'));
  writeFileSync(join(fixtureRoot, 'AGENTS.md'), '# fixture\n');
  writeFileSync(fixtureTarget, 'Resolve every path in this router\nnever against the process\'s current working directory\n');

  run('git', ['init', '--quiet'], { cwd: fixtureRoot });
  writeFileSync(fixturePointer, pointerTarget);
  run('git', ['add', '-f', '--', fixtureTargetRelative], { cwd: fixtureRoot });
  const pointerBlob = run('git', ['hash-object', '-w', '--stdin'], {
    cwd: fixtureRoot,
    input: pointerTarget,
  });
  run('git', ['update-index', '--add', '--cacheinfo', `120000,${pointerBlob},${fixturePointerRelative}`], { cwd: fixtureRoot });

  const materialized = readSkillEntrypoint(fixturePointer, fixturePointerRelative, fixtureRoot);
  if (gitIndexMode(fixturePointerRelative, fixtureRoot) !== '120000') {
    fail('fixture did not preserve the Git symlink index mode');
  } else if (materialized.path !== fixtureTarget ||
      findProjectRoot(materialized.path) !== fixtureRoot ||
      !hasRoutingRule(materialized.text)) {
    fail('materialized symlink pointer was not resolved through the Git index mode');
  } else {
    pass('materialized symlink pointers resolve through Git mode 120000');
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
