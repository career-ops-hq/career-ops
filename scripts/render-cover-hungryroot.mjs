#!/usr/bin/env node
// Cover letter for Hungryroot - Senior Director, Total Rewards and People Operations.
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
  company: 'Hungryroot',
  role: 'Senior Director, Total Rewards and People Operations',
  team: 'Hungryroot Hiring Team',
};

const paragraphs = [
  `I am applying for the ${addressee.role} role at ${addressee.company}. Total Rewards and People Operations is my exact lane. I own the Total Rewards analytics suite at Wellstar Health System, where HR leadership and the C-suite make labor-optimization decisions against the metrics my team delivers. I lead with outcomes rather than outputs, and the work I ship is measured by the decisions it unlocks.`,
  `Three pieces of evidence. First, analytics and executive storytelling: the Wellstar dashboard suite is a multi-pillar Tableau product covering Compensation, Work-Life Services, Benefits, and TOC navigation, built in Power BI, Tableau, SQL, and BigQuery with an AI-integrated workflow across Vertex AI and Gemini. Second, program leadership at scale: I led a $4.5M, 10-plus institution initiative at Harvard Medical School with audit-grade governance, which is the same operating muscle Hungryroot needs as it prepares for public-market readiness. Third, regulated delivery: I shipped $245K to $2.2M software implementations for Department of Energy and defense clients at Ideagen DevonWay, where compliance and audit trails were non-negotiable.`,
  `Where I would want to add velocity early is on the HRIS and People Analytics integration. Dayforce is new to me, but the work of building an HRIS that supports real compensation decisions and employee-experience measurement is not. Scaling compensation philosophy, job architecture, and equity design to public-company standards is a job I would grow into, and I would be honest about what I need to learn versus what I can execute on day one.`,
  `I would welcome a short conversation about the people-operations roadmap through IPO readiness and where this role fits. Thank you for the consideration.`,
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
writeFileSync('output/cover-aaliya-hungryroot-2026-04-14.html', clean);
console.log('Wrote output/cover-aaliya-hungryroot-2026-04-14.html (' + clean.length + ' bytes) -- dash-scrubbed');
