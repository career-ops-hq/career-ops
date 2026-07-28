#!/usr/bin/env node
// Cover letter for Gusto - Head of People Operations.
// No em/en dashes. No Tier 2 (founder) disclosure.
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
  company: 'Gusto',
  role: 'Head of People Operations',
  team: 'Gusto Hiring Team',
};

const paragraphs = [
  `I am applying for the ${addressee.role} role at ${addressee.company}. People Operations at scale through an AI-native transformation is exactly the problem I want to run next. At Wellstar Health System I own the Total Rewards analytics and shared-services reporting stack: a multi-pillar Tableau product backed by BigQuery and SQL that HR leadership and the C-suite use to move routine decisions from meeting-driven to data-driven. I have spent the last year folding Vertex AI, Gemini, OpenAI/Azure OpenAI, and prompt engineering into my daily workflow to compress analysis cycles, which is the same playbook for getting to a world where most Gustie interactions with the People team are self-serve.`,
  `Three pieces of evidence for the charter. First, operational discipline: I led a $4.5M, 10-plus institution program at Harvard Medical School with audit-grade governance and the cadence that keeps politically sensitive work moving to completion. Second, HR / PEO domain fluency: Total Rewards, benefits, HRIS partnership, and shared-services reporting are my everyday vocabulary at Wellstar. Third, cross-functional partnership: I built my career translating between engineering, operations, and leadership audiences, and I am comfortable leading through my managers rather than around them.`,
  `I am drawn to Gusto because the business model is built on giving small employers access to the kind of People infrastructure that only large companies used to afford, and because this role sits at the intersection of operational rigor, AI, and employee experience. Those are the three things that determine whether a People function actually scales. I would welcome a short conversation about the 70-percent-self-serve target and the first ninety-day priorities. Thank you for the consideration.`,
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
writeFileSync('output/cover-aaliya-gusto-2026-04-14.html', clean);
console.log('Wrote output/cover-aaliya-gusto-2026-04-14.html (' + clean.length + ' bytes) -- dash-scrubbed');
