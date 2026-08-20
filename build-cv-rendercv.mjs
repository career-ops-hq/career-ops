#!/usr/bin/env node

/**
 * build-cv-rendercv.mjs — RenderCV ATS PDF Generator for career-ops
 *
 * Takes a JSON CV payload or Markdown CV file, converts it into RenderCV YAML,
 * and calls RenderCV via python to generate an ATS-optimized PDF.
 *
 * Usage:
 *   node career-ops/build-cv-rendercv.mjs <input.json|cv.md> [output.pdf] [--theme=classic|engineering|sb2]
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname, basename, join, extname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { convertJsonToRenderCvYaml } from './lib/cv-rendercv-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Locations for RenderCV python binary
const PYTHON_VENV_PATH = resolve(__dirname, '..', 'ApplyPilot', 'venv', 'bin', 'rendercv');
const GLOBAL_RENDERCV_PATH = 'rendercv';

function findRenderCvBinary() {
  if (existsSync(PYTHON_VENV_PATH)) {
    return PYTHON_VENV_PATH;
  }
  return GLOBAL_RENDERCV_PATH;
}

/**
 * Basic markdown parser fallback for cv.md files if passed directly
 */
function parseSimpleMarkdownCv(markdownText) {
  const lines = markdownText.split('\n');
  let name = 'Candidate Name';
  const contact = {};
  const summary = [];
  const experience = [];
  const education = [];
  const projects = [];
  const skills = [];

  let currentSection = '';
  let currentEntry = null;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('# CV --') || trimmed.startsWith('# ')) {
      name = trimmed.replace(/^#\s*(CV\s*--\s*)?/, '').trim();
      continue;
    }

    if (trimmed.startsWith('**Email:**')) {
      contact.email = trimmed.replace('**Email:**', '').trim();
      continue;
    }
    if (trimmed.startsWith('**Location:**')) {
      contact.location = trimmed.replace('**Location:**', '').trim();
      continue;
    }
    if (trimmed.startsWith('**LinkedIn:**')) {
      contact.linkedin = trimmed.replace('**LinkedIn:**', '').trim();
      continue;
    }
    if (trimmed.startsWith('**GitHub:**')) {
      contact.github = trimmed.replace('**GitHub:**', '').trim();
      continue;
    }

    if (trimmed.startsWith('## ')) {
      currentSection = trimmed.replace('## ', '').trim().toLowerCase();
      currentEntry = null;
      continue;
    }

    if (currentSection.includes('summary')) {
      summary.push(trimmed);
    } else if (currentSection.includes('experience')) {
      if (trimmed.startsWith('### ')) {
        const parts = trimmed.replace('### ', '').split('--').map(p => p.trim());
        currentEntry = { company: parts[0], location: parts[1] || '', bullets: [] };
        experience.push(currentEntry);
      } else if (trimmed.startsWith('**') && currentEntry && !currentEntry.role) {
        currentEntry.role = trimmed.replace(/\*\*/g, '').trim();
      } else if (/^\d{4}/.test(trimmed) && currentEntry && !currentEntry.dates) {
        currentEntry.dates = trimmed;
      } else if (trimmed.startsWith('- ') && currentEntry) {
        currentEntry.bullets.push(trimmed.slice(2).trim());
      }
    } else if (currentSection.includes('projects')) {
      if (trimmed.startsWith('- **')) {
        const titleMatch = trimmed.match(/- \*\*(.*?)\*\*(.*)/);
        if (titleMatch) {
          projects.push({ name: titleMatch[1], bullets: [titleMatch[2].replace(/^--\s*/, '').trim()] });
        }
      }
    } else if (currentSection.includes('education')) {
      if (trimmed.startsWith('- ')) {
        education.push({ degree: trimmed.slice(2).trim() });
      }
    } else if (currentSection.includes('skills')) {
      if (trimmed.startsWith('- **')) {
        const parts = trimmed.slice(4).split(':**');
        if (parts.length >= 2) {
          skills.push({ category: parts[0].trim(), items: parts[1].split(',').map(s => s.trim()) });
        }
      }
    }
  }

  return {
    name,
    contact,
    summary,
    experience,
    education,
    projects,
    skills
  };
}

export async function buildCvRenderCv(inputPath, outputPath, options = {}) {
  const absoluteInput = resolve(inputPath);
  const rawContent = await readFile(absoluteInput, 'utf8');

  let payload;
  if (absoluteInput.endsWith('.json')) {
    payload = JSON.parse(rawContent);
  } else {
    payload = parseSimpleMarkdownCv(rawContent);
  }

  const theme = options.theme || 'classic';
  const yamlContent = convertJsonToRenderCvYaml(payload, { theme });

  const tempYamlPath = resolve(dirname(absoluteInput), `.temp-rendercv-${Date.now()}.yaml`);
  await writeFile(tempYamlPath, yamlContent, 'utf8');

  const rendercvBin = findRenderCvBinary();
  const outputDir = outputPath ? resolve(dirname(outputPath)) : resolve(__dirname, 'output');
  await mkdir(outputDir, { recursive: true });

  const rendercvArgs = ['render', tempYamlPath, '--output-folder', outputDir, '--dont-generate-png', '--dont-generate-html'];

  const result = spawnSync(rendercvBin, rendercvArgs, {
    encoding: 'utf8',
    shell: false
  });

  if (result.error || result.status !== 0) {
    console.warn(`RenderCV warning/notice: ${result.stderr || result.stdout}`);
  }

  if (!options.keepYaml && existsSync(tempYamlPath)) {
    try {
      const { unlink } = await import('fs/promises');
      await unlink(tempYamlPath);
    } catch (_) {}
  }

  return {
    yamlPath: tempYamlPath,
    outputDir,
    success: result.status === 0
  };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('build-cv-rendercv.mjs')) {
  const args = process.argv.slice(2);
  const inputArg = args[0];
  const outputArg = args[1] && !args[1].startsWith('--') ? args[1] : null;

  if (!inputArg) {
    console.log('Usage: node build-cv-rendercv.mjs <input.json|cv.md> [output.pdf] [--theme=classic|engineering|sb2|modern] [--color=navy]');
    process.exit(1);
  }

  const options = {};
  for (const arg of args) {
    if (arg.startsWith('--theme=')) options.theme = arg.split('=')[1];
    if (arg.startsWith('--font=')) options.font = arg.split('=')[1];
    if (arg.startsWith('--color=')) options.primary_color = arg.split('=')[1];
  }

  buildCvRenderCv(inputArg, outputArg, options)
    .then((res) => {
      console.log(`RenderCV completed: exported PDF to ${res.outputDir}`);
    })
    .catch((err) => {
      console.error(`Error rendering CV with RenderCV:`, err);
      process.exit(1);
    });
}
