#!/usr/bin/env node
// Render CV for Hungryroot - Senior Director, Total Rewards and People Operations.
// Triple archetype match (TR + People Ops + Analytics). Tier 1 skills lifted lightly.
// No Tier 2 (founder) disclosure. No em/en dashes.
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
  SUMMARY_TEXT: `Total Rewards and People Operations leader with 13+ years translating benefits, compensation, and workforce data into executive decisions. Currently owns the Total Rewards analytics suite at Wellstar Health System: multi-pillar Tableau dashboards (Compensation, Work-Life Services, Benefits, TOC navigation) that HR leadership and the C-suite use for labor optimization. Led a $4.5M, 10-plus institution program at Harvard Medical School, and delivered $245K to $2.2M regulated-software implementations for Department of Energy and defense clients at DevonWay. Known for connecting people-program spend to measurable business outcomes and for bringing structure to ambiguity.`,
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: [
    'Total Rewards Program Leadership',
    'People Operations & HRIS Partnership',
    'People Analytics & Workforce Insights',
    'Benefits Strategy & Vendor Management',
    'Executive Storytelling with Data',
    'Cross-Functional Program Leadership',
    'Compliance & Audit-Ready Governance',
    'Change Management at Scale',
  ].map(t => `<span class="competency-tag">${t}</span>`).join('\n      '),
  SECTION_EXPERIENCE: 'Work Experience',
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">Wellstar Health System</span>
        <span class="job-period">Jan 2025 to Present</span>
      </div>
      <div class="job-role">Technical Program Manager, Total Rewards</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Own the <strong>Total Rewards analytics and reporting stack</strong>: multi-pillar Tableau dashboards (Compensation, Work-Life Services, Benefits, TOC navigation) used by HR leadership and the C-suite for labor-optimization decisions.</li>
        <li>Connect benefits and workforce investments to <strong>ROI, utilization, and employee experience</strong>, building the metric framework that turns raw HRIS and payroll data into decision-ready signal.</li>
        <li>Partner across HRIS, Operations, and Engineering to retire data silos and stand up <strong>repeatable, audit-ready reporting</strong> for enterprise-scale people programs.</li>
        <li>Operate in Power BI, Tableau, SQL, BigQuery, and PowerQuery; apply AI-integrated workflow (Vertex AI, Gemini, OpenAI/Azure OpenAI) to compress analysis cycles.</li>
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
        <li>Led a <strong>$4.5M, 10+ institution</strong> academic medicine program with clinical faculty, hospital partners, educators, and internal stakeholders aligned around a single delivery plan.</li>
        <li>Designed the operating rhythms, decision frameworks, and communication plans that kept politically sensitive work moving with audit-ready documentation.</li>
        <li>Built the reporting and governance backbone for learning operations, curriculum mapping, and fiscal planning.</li>
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
        <li>Delivered <strong>$245K to $2.2M software implementations</strong> for Department of Energy, defense, and regulated-industry clients. Owned scope, schedule, risk, and executive communication end to end against regulatory deadlines.</li>
        <li><strong>Increased customer satisfaction by 25%</strong> as primary client contact for status reporting and issue resolution.</li>
        <li>Kept cross-functional teams aligned across sales, engineering, and customer environments.</li>
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
        <li>Directed operations, systems, and people programs for a growing wellness business. Managed and trained a 17-member team; improved customer satisfaction by 34% in six months through CRM, scheduling, and service-workflow redesign.</li>
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
        <li>Built a five-year roadmap and investment plan that contributed to <strong>$14M+ in savings and cost avoidance</strong>; supported 350% portfolio growth.</li>
      </ul>
    </div>
  `,
  SECTION_PROJECTS: 'Selected Program Highlights',
  PROJECTS: `
    <div class="project">
      <div class="project-title">Wellstar: Total Rewards Analytics Suite<span class="project-badge">Tableau, BigQuery, SQL</span></div>
      <div class="project-desc">Multi-pillar executive analytics product connecting benefits and workforce spend to ROI. Three KPIs leadership acts on, not thirty they ignore.</div>
    </div>
    <div class="project">
      <div class="project-title">Harvard Medical School: $4.5M Multi-Institution Program<span class="project-badge">Governance + reporting</span></div>
      <div class="project-desc">Governance cadence, decision frameworks, and audit-ready reporting that aligned 10+ institutions through delivery on a politically sensitive academic-medicine initiative.</div>
    </div>
    <div class="project">
      <div class="project-title">DevonWay: Regulated Software Delivery<span class="project-badge">DoE, Defense</span></div>
      <div class="project-desc">Shipped $245K to $2.2M implementations for regulated clients with +25% CSAT. Audit trails, compliance, and precision were non-negotiable.</div>
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
      <div class="skill-item"><span class="skill-category">Domain:</span> Total Rewards, Benefits, People Operations, HRIS, People Analytics, Compliance</div>
    </div>
  `,
};

let html = template;
for (const [k, v] of Object.entries(vars)) {
  html = html.split(`{{${k}}}`).join(v);
}
html = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cv-aaliya-hungryroot-2026-04-14.html', html);
console.log('Wrote output/cv-aaliya-hungryroot-2026-04-14.html (' + html.length + ' bytes) -- dash-scrubbed');
