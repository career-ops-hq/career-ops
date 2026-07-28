#!/usr/bin/env node
// Render CV for Flock Safety - Staff AI Systems Engineer.
// TIER 2 DISCLOSURE ACTIVE: nuriy founder/CEO + production AI stack front-and-center.
// Per candidate greenlight 2026-04-14 for this role only.
// No em/en dashes.
import { readFileSync, writeFileSync } from 'fs';

const template = readFileSync('templates/cv-template.html', 'utf8');

const vars = {
  LANG: 'en',
  PAGE_WIDTH: '8.5in',
  NAME: 'Aaliya Bashir, MPA',
  EMAIL: 'bashiraaliya@gmail.com',
  LINKEDIN_URL: 'https://linkedin.com/in/aaliya-bashir/',
  LINKEDIN_DISPLAY: 'linkedin.com/in/aaliya-bashir',
  PORTFOLIO_URL: '#',
  PORTFOLIO_DISPLAY: 'Atlanta, GA',
  LOCATION: 'Founder & CEO, nuriy',
  SECTION_SUMMARY: 'Professional Summary',
  SUMMARY_TEXT: `Founder-operator running production AI infrastructure for nuriy (third-party verification platform for the $300B+ jewelry industry, 14K+ waitlist, $500K pre-seed target). Builds and operates a GCP-native production system on Cloud Run, with an Audit Orchestrator architecture handling auth, rate limiting, caching, scraping, scoring, and immutable persistence. Hands-on across Google Vertex AI, Gemini 2.5, OpenAI/Azure OpenAI, BigQuery, and Supabase, plus a self-hosted OpenClaw gateway for prompt management. Climatebase Fellow and RightShift Cohort 3 alumna. Bringing that builder-operator energy to a Staff AI Systems Engineer seat at Flock Safety, where the problems are at AI systems scale rather than solo-founder scope.`,
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: [
    'Production AI Systems on GCP',
    'Vertex AI, Gemini, OpenAI/Azure OpenAI',
    'Cloud Run, BigQuery, Supabase Architecture',
    'Self-Hosted AI Gateway (OpenClaw)',
    'LP/MILP, Simplex, Gurobi, Alteryx',
    'Tiered Prioritization (T1/T2/T3)',
    'Customer-Evidence-Driven Roadmaps',
    'Regulated & Compliance-Heavy Delivery',
  ].map(t => `<span class="competency-tag">${t}</span>`).join('\n      '),
  SECTION_EXPERIENCE: 'Work Experience',
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">nuriy</span>
        <span class="job-period">2025 to Present</span>
      </div>
      <div class="job-role">Founder &amp; CEO</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Build and operate <strong>third-party verification infrastructure</strong> for the $300B+ jewelry industry. Patent-pending nuriyScore algorithm, 14K+ waitlist, $500K pre-seed target, production launch April 2026.</li>
        <li>Architect and run a <strong>GCP-native production system on Cloud Run</strong>: Audit Orchestrator handling auth, rate limiting, caching, scraping, scoring, and immutable persistence.</li>
        <li>Operate an <strong>AI-integrated workflow</strong> across Google Vertex AI, Gemini 2.5, OpenAI/Azure OpenAI, Supabase, BigQuery, and Firecrawl. Self-host an OpenClaw gateway for prompt management and rate limiting.</li>
        <li>Design and enforce a <strong>tiered prioritization framework (T1 Must-Haves, T2 Differentiators, T3 Optimizers)</strong> driven by customer evidence rather than personal preference.</li>
        <li>Selected as <strong>Climatebase Fellow</strong> (1 of 15,000+ applicants) and <strong>RightShift Cohort 3 alumna</strong>. Investor-ready 18-month financial projections.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Wellstar Health System</span>
        <span class="job-period">Jan 2025 to Present</span>
      </div>
      <div class="job-role">Technical Program Manager, Total Rewards &amp; Analytics (concurrent)</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Own the Total Rewards analytics suite in <strong>Tableau, BigQuery, SQL, Power BI, and PowerQuery</strong>. Multi-pillar executive product used by HR leadership and the C-suite for labor-optimization decisions.</li>
        <li>Apply the same AI-integrated workflow from nuriy (Vertex AI, Gemini, prompt engineering) to compress analysis cycles.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Harvard Medical School</span>
        <span class="job-period">Jan 2023 to Jan 2025</span>
      </div>
      <div class="job-role">Program Manager, Multi-Institution Initiative</div>
      <div class="job-location">Remote</div>
      <ul>
        <li>Led a <strong>$4.5M, 10+ institution</strong> academic medicine program. Designed governance, decision frameworks, and audit-ready documentation for politically sensitive cross-stakeholder work.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Ideagen DevonWay</span>
        <span class="job-period">Nov 2022 to Jan 2024</span>
      </div>
      <div class="job-role">Technical Project Manager, Regulated Software</div>
      <div class="job-location">Remote</div>
      <ul>
        <li>Delivered <strong>$245K to $2.2M implementations</strong> for Department of Energy, defense, and regulated-industry clients. +25% CSAT.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Earlier</span>
        <span class="job-period">Pre-2022</span>
      </div>
      <div class="job-role">Director of Operations / Project Manager</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li><strong>10+ years as a business owner</strong> prior to RightShift and nuriy. Directed operations, 17-member teams, and five-year strategic roadmaps contributing to $14M+ in savings. The systems-builder foundation for nuriy.</li>
      </ul>
    </div>
  `,
  SECTION_PROJECTS: 'Selected Technical Projects',
  PROJECTS: `
    <div class="project">
      <div class="project-title">nuriy Production System<span class="project-badge">GCP, Cloud Run, Vertex AI</span></div>
      <div class="project-desc">GCP-native architecture with Audit Orchestrator as centerpiece: auth, rate limiting, caching, scraping, scoring, immutable persistence. Vertex AI + Gemini 2.5 + OpenAI/Azure OpenAI integrated for scoring workflow. Self-hosted OpenClaw AI gateway.</div>
    </div>
    <div class="project">
      <div class="project-title">Tiered Prioritization Framework<span class="project-badge">Product engineering</span></div>
      <div class="project-desc">T1 Must-Haves / T2 Differentiators / T3 Conversion Optimizers driven by customer evidence and ICP-specific behavior. Operating discipline that scales beyond personal preference.</div>
    </div>
    <div class="project">
      <div class="project-title">Wellstar Analytics Platform<span class="project-badge">Tableau, BigQuery, SQL</span></div>
      <div class="project-desc">Multi-pillar executive analytics product connecting workforce spend to ROI. Built for decisions rather than reporting aesthetics.</div>
    </div>
  `,
  SECTION_EDUCATION: 'Education',
  EDUCATION: `
    <div class="edu-item"><div class="edu-header"><span class="edu-title">Graduate Certificate, Corporate Sustainability and Innovation, <span class="edu-org">Harvard University</span></span></div></div>
    <div class="edu-item"><div class="edu-header"><span class="edu-title">Climatebase Fellow (1 of 15,000+ applicants), <span class="edu-org">Climatebase</span></span></div></div>
    <div class="edu-item"><div class="edu-header"><span class="edu-title">RightShift Cohort 3 Alumna (8-week accelerator), <span class="edu-org">RightShift</span></span></div></div>
    <div class="edu-item"><div class="edu-header"><span class="edu-title">Master of Public Administration, <span class="edu-org">Augusta University</span></span></div></div>
    <div class="edu-item"><div class="edu-header"><span class="edu-title">Bachelor of Arts, Philosophy, <span class="edu-org">Paine College</span></span></div></div>
  `,
  SECTION_CERTIFICATIONS: 'Certifications',
  CERTIFICATIONS: `
    <div class="cert-item"><span class="cert-title">Project Management Professional (PMP), <span class="cert-org">PMI</span></span></div>
    <div class="cert-item"><span class="cert-title">Certified ScrumMaster (CSM), <span class="cert-org">Scrum Alliance</span></span></div>
  `,
  SECTION_SKILLS: 'Skills',
  SKILLS: `
    <div class="skills-grid">
      <div class="skill-item"><span class="skill-category">AI / ML platform:</span> Google Vertex AI, Gemini 2.5, OpenAI / Azure OpenAI, prompt engineering, OpenClaw self-hosted gateway</div>
      <div class="skill-item"><span class="skill-category">Cloud / infra:</span> GCP, Cloud Run, BigQuery, Supabase, Firecrawl, Tailscale / VPN</div>
      <div class="skill-item"><span class="skill-category">Optimization / OR:</span> Gurobi, Alteryx, MILP, Simplex, Excel Solver, scenario modeling</div>
      <div class="skill-item"><span class="skill-category">Analytics:</span> Tableau, Power BI, SQL, BigQuery, PowerQuery, ROI modeling</div>
      <div class="skill-item"><span class="skill-category">Operating discipline:</span> T1/T2/T3 prioritization, customer-evidence-driven roadmaps, PMP, CSM, Agile, Waterfall</div>
    </div>
  `,
};

let html = template;
for (const [k, v] of Object.entries(vars)) {
  html = html.split(`{{${k}}}`).join(v);
}
html = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cv-aaliya-flocksafety-2026-04-14.html', html);
console.log('Wrote output/cv-aaliya-flocksafety-2026-04-14.html (' + html.length + ' bytes) -- Tier 2 disclosure, dash-scrubbed');
