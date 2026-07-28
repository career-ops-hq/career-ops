#!/usr/bin/env node
// Cover letter for Headway - Director, HR Business Partner.
// Strategic HRBP role (not Head of TR). Executive partnership + data-driven HR angle.
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
  company: 'Headway',
  role: 'Director, HR Business Partner',
  team: 'Headway Hiring Team',
};

const paragraphs = [
  `I am applying for the ${addressee.role} role at ${addressee.company}. I have spent 13+ years being the person senior leaders bring into hard conversations because I come with structure, data, and the judgment to tell them what they need to hear. At Wellstar Health System I partner with HR leadership and the C-suite on Total Rewards and Labor Optimization, owning the analytics that turn complex people-program data into decision-ready signal. Before that I was the primary executive partner on a $4.5M, 10-plus institution initiative at Harvard Medical School, where aligning clinical, operational, and leadership stakeholders around a single plan was the job.`,
  `Three things I would bring to the HRBP role. First, trusted-advisor range: I am comfortable in rooms with CPOs, CFOs, and clinical leadership, and I know how to bring evidence without burying the conversation in it. Second, data-driven HR discipline: the Wellstar dashboard suite is a multi-pillar Tableau product (Compensation, Work-Life Services, Benefits, TOC navigation) built for decisions rather than reporting aesthetics, backed by Power BI, Tableau, SQL, BigQuery, and AI-integrated workflow. Third, program leadership at scale: Harvard was a $4.5M, multi-institution, politically sensitive initiative that required executive communication, governance design, and decision frameworks every week.`,
  `I am drawn to Headway because the mission lives at the intersection of mental healthcare access and operational discipline, and because an HRBP role there means the people programs you support directly enable clinicians to reach more patients. I have spent my career building the analytics and governance that make mission-driven organizations faster without losing rigor, and that is the work I want to do next.`,
  `I would welcome a short conversation about the business units you want this partnership to support and the first ninety-day priorities. Thank you for the consideration.`,
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
writeFileSync('output/cover-aaliya-headway-2026-04-14.html', clean);
console.log('Wrote output/cover-aaliya-headway-2026-04-14.html (' + clean.length + ' bytes) -- dash-scrubbed -- HRBP Director framing');
