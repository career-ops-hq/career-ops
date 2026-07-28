#!/usr/bin/env node
// Cover letter for Gong.io - Director of People Analytics.
// Visual design matches cv-template.html. No em/en dashes. No Tier 2 (founder) disclosure.
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
  company: 'Gong.io',
  role: 'Director of People Analytics',
  team: 'Gong.io Hiring Team',
};

const paragraphs = [
  `I am applying for the ${addressee.role} role at ${addressee.company}. People analytics is the work I already do. At Wellstar Health System I own the Total Rewards analytics suite: multi-pillar Tableau dashboards (Compensation, Work-Life Services, Benefits, and a TOC navigation layer) that HR leadership and the C-suite use to make labor-optimization decisions. Your charter to build and lead an analytics function that partners with executive leadership is a direct extension of what I am already delivering.`,
  `My operating belief is that the three KPIs leadership will act on beat the thirty that look impressive. I build for decisions rather than for reporting aesthetics, and I bias toward fewer metrics that map cleanly to business outcomes. The dashboards I ship get used because leaders can see the action they unlock.`,
  `On tooling, I work in Tableau, Power BI, SQL, BigQuery, and PowerQuery, with an AI-integrated workflow across Vertex AI, Gemini, OpenAI/Azure OpenAI, GCP, and Cloud Run. That combination is increasingly the modern stack for people analytics leaders, and it is the one I already use in production.`,
  `Program leadership at scale is the other half of the role. I led a $4.5M, 10-plus institution initiative at Harvard Medical School, where aligning stakeholders and building the data backbone for decisions was the job. I would welcome a short conversation about how Gong is instrumenting its own people function and where this role fits in the next twelve months. Thank you for the consideration.`,
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
writeFileSync('output/cover-aaliya-gong-2026-04-14.html', clean);
console.log('Wrote output/cover-aaliya-gong-2026-04-14.html (' + clean.length + ' bytes) -- dash-scrubbed');
