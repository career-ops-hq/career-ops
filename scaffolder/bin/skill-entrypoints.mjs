// Shared CLI skill entrypoint bootstrap — used by npx init and update-system.
// Ensures every supported CLI gets .*/skills/career-ops/SKILL.md even when the
// cloned release predates a CLI (e.g. Grok on v1.13.0). Materializes pointer
// files to canonical content on filesystems without symlink support.
import { readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const CANONICAL_SKILL_PATH = '.agents/skills/career-ops/SKILL.md';

export const SKILL_ENTRYPOINTS = [
  {
    path: '.claude/skills/career-ops/SKILL.md',
    pointer: '../../../.agents/skills/career-ops/SKILL.md',
  },
  {
    path: '.opencode/skills/career-ops/SKILL.md',
    pointer: '../../../.agents/skills/career-ops/SKILL.md',
  },
  {
    path: '.qwen/skills/career-ops/SKILL.md',
    pointer: '../../../.agents/skills/career-ops/SKILL.md',
  },
  {
    path: '.antigravitycli/skills/career-ops/SKILL.md',
    pointer: '../../../.agents/skills/career-ops/SKILL.md',
  },
  {
    path: '.grok/skills/career-ops/SKILL.md',
    pointer: '../../../.agents/skills/career-ops/SKILL.md',
  },
];

function repoPath(root, path) {
  return join(root, ...path.split('/'));
}

function readCanonical(root) {
  const canonicalPath = repoPath(root, CANONICAL_SKILL_PATH);
  if (!existsSync(canonicalPath)) return null;
  try {
    return readFileSync(canonicalPath, 'utf-8');
  } catch {
    return null;
  }
}

export function materializeSkillEntrypoints(root) {
  const canonicalContent = readCanonical(root);
  if (canonicalContent === null) return [];

  const materialized = [];
  for (const entry of SKILL_ENTRYPOINTS) {
    const entryPath = repoPath(root, entry.path);
    if (!existsSync(entryPath)) continue;

    let stat = null;
    try {
      stat = lstatSync(entryPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (!stat.isFile()) continue;

    try {
      const content = readFileSync(entryPath, 'utf-8').trim();
      if (content !== entry.pointer) continue;
      writeFileSync(entryPath, canonicalContent);
    } catch {
      continue;
    }
    materialized.push(entry.path);
  }

  return materialized;
}

export function ensureSkillEntrypoints(root) {
  const canonicalContent = readCanonical(root);
  if (canonicalContent === null) return [];

  const touched = [];
  for (const entry of SKILL_ENTRYPOINTS) {
    const entryPath = repoPath(root, entry.path);

    if (!existsSync(entryPath)) {
      try {
        mkdirSync(dirname(entryPath), { recursive: true });
        writeFileSync(entryPath, entry.pointer);
        touched.push(entry.path);
      } catch {
        continue;
      }
    }

    let stat = null;
    try {
      stat = lstatSync(entryPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (!stat.isFile()) continue;

    try {
      const content = readFileSync(entryPath, 'utf-8').trim();
      if (content !== entry.pointer) continue;
      writeFileSync(entryPath, canonicalContent);
      if (!touched.includes(entry.path)) touched.push(entry.path);
    } catch {
      continue;
    }
  }

  return touched;
}