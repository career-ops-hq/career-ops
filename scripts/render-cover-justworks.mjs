#!/usr/bin/env node
// Render cover letter HTML for Justworks Group PM, Internal Tools & Operations.
// Visual design matches cv-template.html (same fonts, gradient, colors).
// Tier 1 skills lifted; no Tier 2 (founder/nuriy) disclosure.
// No em dashes or en dashes in body text per candidate request.
import { readFileSync, writeFileSync } from 'fs';

const cvTemplate = readFileSync('templates/cv-template.html', 'utf8');

// Extract the shared <style> block from the CV template so the cover letter
// uses the same typography/gradient without maintaining a second copy.
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
  company: 'Justworks',
  role: 'Group Product Manager, Internal Tools & Operations',
  team: 'Justworks Hiring Team',
};

// Body paragraphs. No em/en dashes. Short sentences, action verbs.
const paragraphs = [
  `I am applying for the ${addressee.role} role at ${addressee.company}. Internal tools and operations is the work I already do: I own the Total Rewards internal dashboard suite at Wellstar Health System, where HR leadership and the C-suite make labor-optimization decisions against the evidence my team surfaces. Your charter maps cleanly onto what I am already delivering at a large enterprise. This is a logical next step rather than a pivot.`,
  `Three pieces of evidence I would bring to the role. First, a tested prioritization discipline: I operate a Tier 1 / Tier 2 / Tier 3 model (Must-Haves, Strong Differentiators, Conversion Optimizers) driven by customer evidence rather than personal preference, which keeps roadmaps anchored to ICP behavior. Second, HR and PEO domain fluency: Total Rewards analytics at Wellstar gave me real buyer-side exposure to the gaps in current PEO platforms. Third, program leadership at scale: I led a $4.5M, 10-plus institution initiative at Harvard Medical School with audit-grade governance, and I shipped $245K to $2.2M regulated-software implementations at Ideagen DevonWay for Department of Energy and defense clients where precision was non-negotiable.`,
  `My technical range complements the operational side. I build in Tableau, Power BI, SQL, BigQuery, and PowerQuery, and I run AI-integrated workflows across Vertex AI, Gemini, OpenAI/Azure OpenAI, GCP, and Cloud Run. That combination lets me design internal tools that both ship fast and scale cleanly.`,
  `I would welcome a short conversation about the Internal Tools charter, the ICPs you are optimizing for, and where you want this function in twelve months. Thank you for the consideration.`,
];

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${candidate.name} - Cover Letter - ${addressee.company}</title>
${sharedStyles}
<style>
  .cover-body p {
    margin-bottom: 12px;
    font-size: 11.5px;
    line-height: 1.65;
    color: #222;
  }
  .cover-meta {
    font-size: 11px;
    color: #555;
    margin-bottom: 20px;
    line-height: 1.7;
  }
  .cover-sign {
    margin-top: 18px;
    font-size: 11.5px;
    color: #222;
  }
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

// Final dash scrub (safety).
const clean = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cover-aaliya-justworks-2026-04-14.html', clean);
console.log('Wrote output/cover-aaliya-justworks-2026-04-14.html (' + clean.length + ' bytes) -- dash-scrubbed');
