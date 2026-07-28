#!/usr/bin/env node
// Cover letter for Flock Safety - Staff AI Systems Engineer.
// TIER 2 DISCLOSURE: nuriy founder + production AI stack.
// No em/en dashes.
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
  credentials: 'Founder & CEO, nuriy',
  date: 'April 14, 2026',
};

const addressee = {
  company: 'Flock Safety',
  role: 'Staff AI Systems Engineer',
  team: 'Flock Safety Hiring Team',
};

const paragraphs = [
  `I am applying for the ${addressee.role} role at ${addressee.company}. I am building nuriy, a third-party verification platform for the $300B+ jewelry industry, with a patent-pending scoring algorithm, 14K+ waitlist, and production launch next month. That means I spend my days operating a GCP-native production system on Cloud Run with an Audit Orchestrator handling auth, rate limiting, caching, scraping, scoring, and immutable persistence, integrated with Google Vertex AI, Gemini 2.5, OpenAI and Azure OpenAI, BigQuery, and Supabase, with a self-hosted OpenClaw gateway for prompt and rate management. I want to apply that builder-operator energy inside a team where AI systems scale is the work, rather than wearing every hat at once as a solo founder.`,
  `What I bring beyond the typical AI engineering resume. First, founder-operator judgment: I have owned architecture, reliability, data governance, and customer evidence on a single production system I am answerable for. Second, a tested operating discipline: my T1/T2/T3 prioritization framework (Must-Haves, Differentiators, Optimizers) is driven by customer behavior rather than personal preference, which is the habit most ICs do not develop until ten years in. Third, optimization fluency: I work hands-on with Gurobi, MILP, Simplex, Alteryx, and Excel Solver, and I run production AI workflows daily.`,
  `Flock Safety is building at the intersection of public safety, computer vision, and AI systems reliability, which is exactly the problem surface where careful engineering changes real outcomes. Atlanta is home, your mission is one I respect, and the kind of systems thinking I have built at nuriy is what a Staff seat on your AI team should unlock. I would welcome a short conversation about what the team needs in the next six months. I am also happy to talk through my nuriy stack and the specific reliability choices I have made so far if that would be useful context. Thank you for the consideration.`,
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
writeFileSync('output/cover-aaliya-flocksafety-2026-04-14.html', clean);
console.log('Wrote output/cover-aaliya-flocksafety-2026-04-14.html (' + clean.length + ' bytes) -- Tier 2 disclosure, dash-scrubbed');
