#!/usr/bin/env node
// Cover letter for Google - Sr Program Manager, Business Systems Transformation, Google Cloud.
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
  company: 'Google',
  role: 'Senior Program Manager, Business Systems Transformation, Google Cloud',
  team: 'Google Cloud Hiring Team',
};

const paragraphs = [
  `I am applying for the ${addressee.role} role. Business systems transformation at scale has been my job for 13+ years. At Wellstar Health System I own the Total Rewards internal analytics platform, a multi-pillar Tableau and BigQuery product that HR leadership and the C-suite use to make labor-optimization decisions. Before that I led a $4.5M, 10-plus institution initiative at Harvard Medical School where aligning clinical faculty, hospital partners, and internal leadership around a single delivery plan was the job. I also shipped $245K to $2.2M regulated-software implementations for Department of Energy and defense clients at Ideagen DevonWay, where audit trails and precision were non-negotiable.`,
  `Three things I would bring to the team. First, governance discipline at scale: the operating cadence, decision frameworks, and communication plans that keep politically sensitive, cross-functional work moving. Second, native GCP and Vertex AI fluency: I operate Google Cloud, Vertex AI, Gemini 2.5, BigQuery, and Cloud Run in my current analytics workflow, which means the internal tooling conversations Google Cloud Sr PMs live in are already my vocabulary. Third, executive communication: I translate complex technical and operational detail into the clear-eyed narrative that gets leadership to act.`,
  `Atlanta is home, Google Cloud is where the interesting business-systems work is happening inside the company, and I want to do this next chapter of my career on a team where the systems I help transform power products the world actually uses. I would welcome a short conversation about the transformation backlog and where a Senior PM could move the needle early. Thank you for the consideration.`,
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
writeFileSync('output/cover-aaliya-google-2026-04-14.html', clean);
console.log('Wrote output/cover-aaliya-google-2026-04-14.html (' + clean.length + ' bytes) -- dash-scrubbed');
