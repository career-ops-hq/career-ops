#!/usr/bin/env node
// Render CV for Gong.io - Director of People Analytics.
// Tier 1 skills lifted (people analytics stack is the main hook). No Tier 2 (founder).
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
  LOCATION: 'PMP, CSM',
  SECTION_SUMMARY: 'Professional Summary',
  SUMMARY_TEXT: `People analytics and program leader with 13+ years translating workforce, benefits, and operational data into executive decisions. Currently owns the Total Rewards dashboard suite at Wellstar Health System: multi-pillar Tableau analytics (Compensation, Work-Life Services, Benefits, TOC navigation) that HR leadership and the C-suite use for labor optimization. Builds in Power BI, Tableau, SQL, BigQuery, and PowerQuery, with an AI-integrated workflow across Vertex AI, Gemini, OpenAI/Azure OpenAI, GCP, and Cloud Run. Known for choosing the three KPIs leadership will actually act on rather than the thirty that look impressive.`,
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: [
    'People Analytics Leadership',
    'Executive Dashboard Design',
    'Workforce ROI Modeling',
    'Tableau, Power BI, BigQuery, SQL',
    'AI-Integrated Analytics Workflow',
    'Cross-Functional Stakeholder Alignment',
    'Storytelling with Data',
    'Total Rewards & Benefits Domain',
  ].map(t => `<span class="competency-tag">${t}</span>`).join('\n      '),
  SECTION_EXPERIENCE: 'Work Experience',
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">Wellstar Health System</span>
        <span class="job-period">Jan 2025 to Present</span>
      </div>
      <div class="job-role">Technical Program Manager, Total Rewards &amp; People Analytics</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Own the <strong>Total Rewards people analytics suite</strong> in Tableau (Compensation, Work-Life Services, Benefits, and TOC navigation pillars) used by HR leadership and the C-suite to make labor-optimization decisions.</li>
        <li>Build the metric framework that connects benefits and workforce investments to ROI, utilization, and employee experience, turning raw HRIS and payroll data into decision-ready signal.</li>
        <li>Operate across <strong>Power BI, Tableau, SQL, BigQuery, and PowerQuery</strong>, and apply an AI-integrated workflow (Vertex AI, Gemini, OpenAI/Azure OpenAI, prompt engineering) to compress analysis cycles.</li>
        <li>Drive cross-functional alignment with HRIS, Operations, and Engineering to retire data silos and stand up repeatable, audit-ready reporting.</li>
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
        <li>Led a <strong>$4.5M, 10+ institution</strong> academic medicine program, aligning clinical faculty, hospital partners, and internal stakeholders around timelines, governance, and execution.</li>
        <li>Designed operating rhythms, decision frameworks, and reporting artifacts that kept high-visibility, politically sensitive work moving to completion with audit-ready documentation.</li>
        <li>Built the data and reporting backbone for learning operations, curriculum mapping, and fiscal planning.</li>
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
        <li>Shipped <strong>$245K to $2.2M software implementations</strong> for Department of Energy, defense, and regulated-industry clients, owning scope, schedule, risk, and executive comms end to end.</li>
        <li>Acted as primary client contact for status reporting and issue resolution, <strong>increasing customer satisfaction by 25%</strong>.</li>
        <li>Translated technical requirements into practical business decisions and kept engineering, sales, and customer environments aligned.</li>
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
        <li>Directed operations and team performance for a growing wellness business. Built the CRM, scheduling, and service-workflow tooling that drove a <strong>34% CSAT lift</strong> in six months.</li>
        <li>Managed and trained a 17-member team.</li>
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
        <li>Built a five-year roadmap and investment plan contributing to <strong>$14M+ in savings and cost avoidance</strong>; supported 350% portfolio growth (2 to 7 properties).</li>
      </ul>
    </div>
  `,
  SECTION_PROJECTS: 'Selected Analytics Highlights',
  PROJECTS: `
    <div class="project">
      <div class="project-title">Wellstar: Total Rewards People Analytics Suite<span class="project-badge">Tableau, BigQuery, SQL</span></div>
      <div class="project-desc">Multi-pillar executive analytics product (Compensation, Work-Life Services, Benefits, TOC navigation) designed for decision-making, not reporting. Three KPIs leadership acts on, not thirty they ignore.</div>
    </div>
    <div class="project">
      <div class="project-title">AI-Integrated Analytics Workflow<span class="project-badge">Vertex AI, Gemini, GCP</span></div>
      <div class="project-desc">Self-hosted production stack on GCP / Cloud Run using Vertex AI and Gemini 2.5 alongside OpenAI / Azure OpenAI and BigQuery to compress analysis cycles and surface signal faster.</div>
    </div>
    <div class="project">
      <div class="project-title">Harvard Medical School: $4.5M Multi-Institution Program<span class="project-badge">Governance + reporting</span></div>
      <div class="project-desc">Designed the governance cadence, decision frameworks, and data backbone that aligned 10+ institutions through delivery.</div>
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
      <div class="skill-item"><span class="skill-category">Analytics:</span> Tableau, Power BI, SQL, BigQuery, PowerQuery, Excel, ROI modeling, executive dashboards</div>
      <div class="skill-item"><span class="skill-category">AI / ML platform:</span> Google Vertex AI, Gemini 2.5, OpenAI / Azure OpenAI, prompt engineering, AI-integrated workflow</div>
      <div class="skill-item"><span class="skill-category">Cloud / infra:</span> GCP, Cloud Run, Supabase, BigQuery</div>
      <div class="skill-item"><span class="skill-category">Delivery:</span> Jira, Confluence, Asana, Agile, Waterfall</div>
      <div class="skill-item"><span class="skill-category">Domain:</span> People Analytics, Total Rewards, Benefits, Workforce Planning, HR/PEO</div>
    </div>
  `,
};

let html = template;
for (const [k, v] of Object.entries(vars)) {
  html = html.split(`{{${k}}}`).join(v);
}
html = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cv-aaliya-gong-2026-04-14.html', html);
console.log('Wrote output/cv-aaliya-gong-2026-04-14.html (' + html.length + ' bytes) -- dash-scrubbed');
