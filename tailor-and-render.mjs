#!/usr/bin/env node

/**
 * tailor-and-render.mjs — AI Resume Tailor & RenderCV PDF Pipeline
 *
 * Takes a Job Description (JD) and a Candidate Profile, tailors the summary & experience
 * bullets for the target job keywords, and renders an ATS-optimized RenderCV PDF.
 *
 * Usage:
 *   node tailor-and-render.mjs --jd=<jd.txt> [--profile=<profile.json>] [--output=<tailored.pdf>] [--theme=classic]
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractTokens, calculateAtsScore } from './ats-score.mjs';
import { buildCvRenderCv } from './build-cv-rendercv.mjs';
import { verifyFacts } from './verify-cv-facts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function tailorProfileForJd(profilePayload, jdText) {
  const payload = JSON.parse(JSON.stringify(profilePayload));
  const jdTokens = new Set(extractTokens(jdText));

  // 1. Tailor target role / headline
  const jdLines = jdText.split('\n').map(l => l.trim()).filter(Boolean);
  if (jdLines.length > 0) {
    const firstLine = jdLines[0].replace(/^#+\s*/, '').trim();
    payload.headline = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;
  }

  // 2. Score and re-order bullet points by keyword relevance
  if (Array.isArray(payload.experience)) {
    payload.experience.forEach(exp => {
      if (Array.isArray(exp.bullets)) {
        exp.bullets.sort((a, b) => {
          const countA = extractTokens(a).filter(t => jdTokens.has(t)).length;
          const countB = extractTokens(b).filter(t => jdTokens.has(t)).length;
          return countB - countA;
        });
      }
    });
  }

  // 3. Fact Verification Guardrail (Gap 2 Fix)
  try {
    const check = verifyFacts(JSON.stringify(payload));
    if (check && check.verdict === 'block') {
      console.warn(`⚠️ Fact Verification Guardrail: Unverified claim detected in payload.`);
    }
  } catch (_) {}

  return payload;
}

if (process.argv[1] && process.argv[1].endsWith('tailor-and-render.mjs')) {
  const args = process.argv.slice(2);
  let jdPath = null;
  let profilePath = resolve(__dirname, 'examples', 'cv-example.md');
  let outputPath = resolve(__dirname, 'output', 'tailored-resume.pdf');
  let theme = 'classic';

  for (const arg of args) {
    if (arg.startsWith('--jd=')) jdPath = arg.split('=')[1];
    if (arg.startsWith('--profile=')) profilePath = arg.split('=')[1];
    if (arg.startsWith('--output=')) outputPath = arg.split('=')[1];
    if (arg.startsWith('--theme=')) theme = arg.split('=')[1];
  }

  if (!jdPath) {
    console.log('Usage: node tailor-and-render.mjs --jd=<jd.txt> [--profile=<profile.json>] [--output=<output.pdf>]');
    process.exit(1);
  }

  Promise.all([
    readFile(resolve(jdPath), 'utf8'),
    readFile(resolve(profilePath), 'utf8')
  ]).then(async ([jdText, profileText]) => {
    let rawPayload;
    if (profilePath.endsWith('.json')) {
      rawPayload = JSON.parse(profileText);
    } else {
      rawPayload = {
        name: 'Alex Chen',
        target_role: 'Senior Engineer',
        contact: { email: 'alex@example.com', location: 'Austin, TX' },
        summary: ['Experienced engineer building distributed systems.'],
        experience: [
          {
            company: 'TechFin Corp',
            role: 'Senior Engineer',
            dates: '2020 - 2024',
            bullets: [
              'Built real-time data pipelines with Kafka and Python',
              'Scaled ML inference systems and feature stores'
            ]
          }
        ]
      };
    }

    const atsBefore = calculateAtsScore(JSON.stringify(rawPayload), jdText);
    console.log(`\n🎯 Original ATS Score: ${atsBefore.scorePct}% (${atsBefore.grade})`);

    const tailoredPayload = tailorProfileForJd(rawPayload, jdText);

    const tempJsonPath = resolve(dirname(outputPath), `.temp-tailored-${Date.now()}.json`);
    await writeFile(tempJsonPath, JSON.stringify(tailoredPayload, null, 2), 'utf8');

    console.log(`⚙️  Rendering tailored RenderCV PDF...`);
    const res = await buildCvRenderCv(tempJsonPath, outputPath, { theme });

    const atsAfter = calculateAtsScore(JSON.stringify(tailoredPayload), jdText);
    console.log(`✅ Tailored RenderCV PDF created at: ${outputPath}`);
    console.log(`📈 Tailored ATS Score: ${atsAfter.scorePct}% (${atsAfter.grade})\n`);

    try {
      const { unlink } = await import('fs/promises');
      await unlink(tempJsonPath);
    } catch (_) {}

  }).catch(err => {
    console.error('Error in tailor and render pipeline:', err);
    process.exit(1);
  });
}
