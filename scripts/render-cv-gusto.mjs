#!/usr/bin/env node
// Render CV for Gusto - Head of People Operations.
// Remote. HR SaaS (like Justworks parallel). AI-native transformation emphasized.
// Tier 1 skills lifted heavily. No Tier 2 (founder) disclosure. No em/en dashes.
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
  LOCATION: 'PMP, CSM',
  SECTION_SUMMARY: 'Professional Summary',
  SUMMARY_TEXT: `People Operations and program leader with 13+ years building the governance, analytics, and AI-integrated workflow that make People functions operate with rigor at scale. Currently owns the Total Rewards analytics stack at Wellstar Health System: multi-pillar Tableau dashboards (Compensation, Work-Life Services, Benefits, TOC navigation) used by HR leadership and the C-suite for labor-optimization decisions. Led a $4.5M, 10-plus institution program at Harvard Medical School with audit-grade governance. Operates a production AI workflow across Google Vertex AI, Gemini 2.5, OpenAI/Azure OpenAI, GCP, Cloud Run, and BigQuery. Builds for the world where most employee interactions with the People team are self-serve.`,
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: [
    'People Operations Leadership',
    'Shared Services & Employee Experience',
    'AI-Native HR Transformation',
    'HRIS Partnership & Data Governance',
    'Executive Storytelling with Data',
    'Compliance & Audit-Ready Reporting',
    'Cross-Functional Program Leadership',
    'HR/PEO/Benefits Domain Fluency',
  ].map(t => `<span class="competency-tag">${t}</span>`).join('\n      '),
  SECTION_EXPERIENCE: 'Work Experience',
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">Wellstar Health System</span>
        <span class="job-period">Jan 2025 to Present</span>
      </div>
      <div class="job-role">Technical Program Manager, Total Rewards &amp; People Operations</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Own the <strong>Total Rewards analytics and shared-services reporting stack</strong>: multi-pillar Tableau product (Compensation, Work-Life Services, Benefits, TOC navigation) used by HR leadership and the C-suite for labor-optimization decisions.</li>
        <li>Partner across HRIS, Operations, and Engineering to retire data silos and stand up <strong>repeatable, audit-ready reporting</strong> at enterprise scale.</li>
        <li>Apply <strong>AI-integrated workflow tooling</strong> (Vertex AI, Gemini 2.5, OpenAI/Azure OpenAI, prompt engineering) to compress analysis cycles and move routine work toward self-service.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Harvard Medical School</span>
        <span class="job-period">Jan 2023 to Jan 2025</span>
      </div>
      <div class="job-role">Program Manager, Multi-Stakeholder Initiative</div>
      <div class="job-location">Remote</div>
      <ul>
        <li>Led a <strong>$4.5M, 10+ institution</strong> academic medicine program, aligning faculty, hospital partners, and internal stakeholders around a single delivery plan.</li>
        <li>Designed the operating rhythms, decision frameworks, and governance that kept politically sensitive work moving with audit-ready documentation.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Ideagen DevonWay</span>
        <span class="job-period">Nov 2022 to Jan 2024</span>
      </div>
      <div class="job-role">Technical Project Manager</div>
      <div class="job-location">Remote</div>
      <ul>
        <li>Delivered <strong>$245K to $2.2M software implementations</strong> for Department of Energy, defense, and regulated-industry clients. <strong>+25% CSAT</strong> as primary executive contact.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Warrior Body Spa</span>
        <span class="job-period">2014 to 2022</span>
      </div>
      <div class="job-role">Director of Operations</div>
      <div class="job-location">Tucker, GA</div>
      <ul>
        <li>Directed operations, systems, and people programs; managed a 17-member team; improved CSAT by 34% in six months through CRM, scheduling, and service-workflow redesign.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">KSW Real Estate</span>
        <span class="job-period">Earlier Experience</span>
      </div>
      <div class="job-role">Project Manager, Real Estate Operations</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Built a five-year roadmap contributing to <strong>$14M+ in savings and cost avoidance</strong>; supported 350% portfolio growth.</li>
      </ul>
    </div>
  `,
  SECTION_PROJECTS: 'Selected People Ops Highlights',
  PROJECTS: `
    <div class="project">
      <div class="project-title">Wellstar: Total Rewards &amp; Shared Services Analytics<span class="project-badge">Tableau, BigQuery, SQL</span></div>
      <div class="project-desc">Multi-pillar executive analytics product that shifts routine decisions from meeting-driven to data-driven. Three KPIs leadership acts on, not thirty they ignore.</div>
    </div>
    <div class="project">
      <div class="project-title">AI-Integrated People Workflow<span class="project-badge">Vertex AI, Gemini, GCP</span></div>
      <div class="project-desc">Self-hosted production AI stack applied to compress analysis cycles and move routine People-team interactions toward self-service.</div>
    </div>
    <div class="project">
      <div class="project-title">Harvard Medical School: $4.5M Multi-Institution Program<span class="project-badge">Governance + compliance</span></div>
      <div class="project-desc">Governance cadence, decision frameworks, and audit-ready reporting across 10+ institutions.</div>
    </div>
  `,
  SECTION_EDUCATION: 'Education',
  EDUCATION: `
    <div class="edu-item"><div class="edu-header"><span class="edu-title">Graduate Certificate, Corporate Sustainability and Innovation, <span class="edu-org">Harvard University</span></span></div></div>
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
      <div class="skill-item"><span class="skill-category">HR / People:</span> Total Rewards, Benefits, People Analytics, HRIS partnership, Shared Services, Compliance</div>
      <div class="skill-item"><span class="skill-category">AI / ML platform:</span> Google Vertex AI, Gemini 2.5, OpenAI / Azure OpenAI, prompt engineering, AI-integrated workflow</div>
      <div class="skill-item"><span class="skill-category">Analytics:</span> Tableau, Power BI, SQL, BigQuery, PowerQuery, Excel, ROI modeling</div>
      <div class="skill-item"><span class="skill-category">Cloud / infra:</span> GCP, Cloud Run, BigQuery, Supabase</div>
      <div class="skill-item"><span class="skill-category">Delivery:</span> Jira, Confluence, Asana, Agile, Waterfall, PMP, CSM</div>
    </div>
  `,
};

let html = template;
for (const [k, v] of Object.entries(vars)) {
  html = html.split(`{{${k}}}`).join(v);
}
html = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cv-aaliya-gusto-2026-04-14.html', html);
console.log('Wrote output/cv-aaliya-gusto-2026-04-14.html (' + html.length + ' bytes) -- dash-scrubbed');
