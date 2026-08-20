#!/usr/bin/env node

/**
 * outreach-generator.mjs — Recruiter Cold Outreach & Follow-Up Cadence
 *
 * Generates high-converting 3-sentence recruiter emails, LinkedIn connection notes,
 * and 5-day / 14-day follow-up messages.
 *
 * Usage:
 *   node outreach-generator.mjs --company="Acme Corp" --role="Senior ML Engineer" [--recruiter="Jane"]
 */

import { resolve } from 'path';

export function generateOutreachCadence(options = {}) {
  const recruiter = options.recruiter || 'Hiring Manager';
  const company = options.company || 'Acme Corp';
  const role = options.role || 'Senior Software Engineer';
  const candidateName = options.candidateName || 'Alex Chen';

  const coldEmailSubject = `Application for ${role} — ${candidateName}`;
  const coldEmailBody = `Hi ${recruiter},

I recently applied for the ${role} position at ${company}. With 6+ years building real-time data pipelines and scalable microservices, I am very interested in your team's engineering work.

I would love to learn more about the role and share how my background aligns with ${company}'s goals. Are you open to a brief 10-minute chat this week?

Best regards,
${candidateName}`;

  const linkedinNote = `Hi ${recruiter}, I applied for the ${role} role at ${company}. I've spent 6 years building high-throughput systems and would love to connect!`;

  const followUpDay5 = `Hi ${recruiter},

Following up on my application for the ${role} role at ${company}. I know your inbox is busy, but I remain very interested in joining your team.

Please let me know if you need any additional details from my end!

Best,
${candidateName}`;

  const followUpDay14 = `Hi ${recruiter},

Checking in one last time regarding the ${role} opportunity at ${company}. I am actively interviewing and would love to know if ${company} is still evaluating candidates for this position.

Thanks again for your time,
${candidateName}`;

  return {
    recruiter,
    company,
    role,
    coldEmailSubject,
    coldEmailBody,
    linkedinNote,
    followUpDay5,
    followUpDay14
  };
}

if (process.argv[1] && process.argv[1].endsWith('outreach-generator.mjs')) {
  const args = process.argv.slice(2);
  const opts = {};
  for (const arg of args) {
    if (arg.startsWith('--recruiter=')) opts.recruiter = arg.split('=')[1];
    if (arg.startsWith('--company=')) opts.company = arg.split('=')[1];
    if (arg.startsWith('--role=')) opts.role = arg.split('=')[1];
  }

  const cadence = generateOutreachCadence(opts);
  console.log('\n📬 RECRUITER OUTREACH & FOLLOW-UP CADENCE');
  console.log(`===========================================`);
  console.log(`Target: ${cadence.recruiter} @ ${cadence.company} (${cadence.role})\n`);
  console.log(`✉️  COLD EMAIL TEMPLATE:`);
  console.log(`Subject: ${cadence.coldEmailSubject}\n`);
  console.log(cadence.coldEmailBody);
  console.log(`\n💬 LINKEDIN CONNECTION NOTE (300 CHARS MAX):\n${cadence.linkedinNote}`);
  console.log(`\n📅 DAY 5 FOLLOW-UP:\n${cadence.followUpDay5}`);
  console.log(`\n📅 DAY 14 FINAL CHECK-IN:\n${cadence.followUpDay14}`);
}
