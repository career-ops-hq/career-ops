#!/usr/bin/env node
// Cover letter for Human Interest - Senior Technical Program Manager (Money Movement).
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
  company: 'Human Interest',
  role: 'Senior Technical Program Manager',
  team: 'Human Interest Hiring Team',
};

const paragraphs = [
  `I am applying for the ${addressee.role} role at ${addressee.company}. I run regulated-delivery programs for a living. My current title at Wellstar Health System is Technical Program Manager, Total Rewards, where I own the analytics stack that the C-suite uses to make labor-optimization decisions. Before that I shipped $245K to $2.2M software implementations for Department of Energy and defense clients at Ideagen DevonWay, where audit trails and precision were non-negotiable. Money Movement is the same operating discipline applied to a domain that matters even more: the retirement security of SMB employees.`,
  `Three reasons I would land quickly on your team. First, regulated delivery is a muscle: at DevonWay I owned scope, schedule, risk, and executive communication end to end against regulatory deadlines, which increased customer satisfaction by 25%. Second, benefits and retirement is adjacent to work I already do: Total Rewards at Wellstar means I speak fluently about employer benefits economics, vendor management, and the decisions that determine whether employees ever get access to a 401(k). Third, multi-stakeholder program leadership: I led a $4.5M, 10-plus institution initiative at Harvard Medical School, which means I know how to align clinical, operational, and leadership constituencies around a single delivery plan.`,
  `On the technical side, I operate across Power BI, Tableau, SQL, BigQuery, and PowerQuery, with an AI-integrated workflow across Vertex AI, Gemini, OpenAI/Azure OpenAI, GCP, and Cloud Run. That toolkit is increasingly what a modern TPM needs to keep pace with engineering counterparts.`,
  `I would welcome a short conversation about the Money Movement roadmap and where a Senior TPM could add velocity in the first ninety days. Thank you for the consideration.`,
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
writeFileSync('output/cover-aaliya-humaninterest-2026-04-14.html', clean);
console.log('Wrote output/cover-aaliya-humaninterest-2026-04-14.html (' + clean.length + ' bytes) -- dash-scrubbed');
