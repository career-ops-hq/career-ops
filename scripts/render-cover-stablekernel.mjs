#!/usr/bin/env node
// Cover letter for Stable Kernel - Modernization Practice Lead.
// Tier 1 only (no founder/nuriy disclosure). No em/en dashes.
import { readFileSync, writeFileSync } from 'fs';

const cvTemplate = readFileSync('templates/cv-template.html', 'utf8');
const styleMatch = cvTemplate.match(/<style>[\s\S]*?<\/style>/);
const sharedStyles = styleMatch ? styleMatch[0] : '';

const candidate = {
  name: 'Aaliya Bashir, MPA',
  email: 'bashiraaliya@gmail.com',
  linkedinUrl: 'https://linkedin.com/in/aaliya-bashir/',
  linkedinDisplay: 'linkedin.com/in/aaliya-bashir',
  location: 'Atlanta, GA',
  credentials: 'PMP, CSM',
  date: 'April 14, 2026',
};

const addressee = {
  company: 'Stable Kernel',
  role: 'Modernization Practice Lead',
  team: 'Stable Kernel Hiring Team',
};

const paragraphs = [
  `I am applying for the ${addressee.role} role at ${addressee.company}. Modernization at the intersection of AI and enterprise software is where I already live. At Wellstar Health System I own the Total Rewards analytics modernization platform, a multi-pillar Tableau and BigQuery product that HR leadership and the C-suite use to make labor-optimization decisions. I apply Google Vertex AI, Gemini 2.5, OpenAI/Azure OpenAI, GCP, and Cloud Run in a production AI-integrated workflow, which means the toolchain Stable Kernel's clients are modernizing into is the one I am hands-on with every day.`,
  `Three things I would bring to the Practice Lead charter. First, consulting-grade delivery discipline: I led a $4.5M, 10-plus institution program at Harvard Medical School with audit-grade governance and the cadence that kept politically sensitive work moving. Before that I shipped $245K to $2.2M regulated software implementations for Department of Energy and defense clients at Ideagen DevonWay, which is operating experience most practice leads do not have. Second, AI and enterprise architecture fluency: I build daily in the Vertex AI, Gemini, and GCP stack that clients increasingly want a modernization partner to speak natively. Third, executive partnership: I translate complex technical detail into the clear-eyed narrative that gets senior stakeholders to act.`,
  `Atlanta is home, and I want to do this next chapter of my career where modernization is the product, AI is the accelerant, and my program-leadership muscle gets aimed at a portfolio of clients rather than a single internal stakeholder. I would welcome a short conversation about the practice backlog and where a new Practice Lead could move the needle early. Thank you for the consideration.`,
];

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${candidate.name} - Cover Letter - ${addressee.company}</title>
${sharedStyles}
<style>
  .cover-body p { margin-bottom: 12px; font-size: 11.5px; line-height: 1.65; color: #222; }
  .cover-meta { font-size: 11px; color: #555; margin-bottom: 20px; line-height: 1.7; }
  .cover-sign { margin-top: 18px; font-size: 11.5px; color: #222; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>${candidate.name}</h1>
    <div class="header-gradient"></div>
    <div class="contact-row">
      <span>${candidate.email}</span>
      <span class="separator">|</span>
      <a href="${candidate.linkedinUrl}">${candidate.linkedinDisplay}</a>
      <span class="separator">|</span>
      <span>${candidate.location}</span>
      <span class="separator">|</span>
      <span>${candidate.credentials}</span>
    </div>
  </div>
  <div class="section cover-meta">
    <div>${candidate.date}</div>
    <div>${addressee.team}</div>
    <div>Re: ${addressee.role}</div>
  </div>
  <div class="section cover-body">
    <p>Dear ${addressee.team},</p>
    ${paragraphs.map(p => `<p>${p}</p>`).join('\n    ')}
    <p class="cover-sign">Sincerely,<br>${candidate.name}</p>
  </div>
</div>
</body>
</html>`;

const clean = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');
writeFileSync('output/cover-aaliya-stablekernel-2026-04-14.html', clean);
console.log('Wrote output/cover-aaliya-stablekernel-2026-04-14.html (' + clean.length + ' bytes) -- dash-scrubbed');
