#!/usr/bin/env node
// Render CV for Headway - Director, HR Business Partner.
// Strategic HRBP role requiring 12+ years HR/HR-adjacent; executive partnership focus.
// Tier 1 skills lifted lightly. No Tier 2 (founder) disclosure. No em/en dashes.
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
  SUMMARY_TEXT: `Strategic HR partner and program leader with 13+ years aligning people programs to business outcomes through executive partnership, data-driven decisions, and governance at scale. Currently owns Total Rewards analytics at Wellstar Health System: multi-pillar Tableau dashboards (Compensation, Work-Life Services, Benefits, TOC navigation) that HR leadership and the C-suite use to make labor-optimization decisions. Led a $4.5M, 10-plus institution program at Harvard Medical School where aligning executive, clinical, and operational constituencies around a single delivery plan was the job. Known for bringing structure to ambiguity and for building the trusted-partner relationships that let leaders make better calls.`,
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: [
    'Executive Partnership & Trusted Advisor',
    'Data-Driven HR Decisions',
    'Total Rewards & Benefits Fluency',
    'People Analytics & Workforce Insights',
    'Cross-Functional Program Leadership',
    'Change Management at Scale',
    'Culture & Stakeholder Alignment',
    'Governance & Audit-Ready Reporting',
  ].map(t => `<span class="competency-tag">${t}</span>`).join('\n      '),
  SECTION_EXPERIENCE: 'Work Experience',
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">Wellstar Health System</span>
        <span class="job-period">Jan 2025 to Present</span>
      </div>
      <div class="job-role">Technical Program Manager, Total Rewards (HR Business Partner adjacent)</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Partner with HR leadership and the C-suite on <strong>Total Rewards and Labor Optimization</strong> strategy, turning complex people-program data into executive-ready dashboards and decisions.</li>
        <li>Own the analytics layer that connects benefits and workforce investments to <strong>ROI, utilization, and employee experience</strong> for a large healthcare system.</li>
        <li>Serve as a <strong>trusted advisor</strong> across HRIS, Operations, and leadership, translating business questions into actionable analysis and concrete recommendations.</li>
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
        <li>Partnered with clinical faculty, hospital executives, and internal leadership on a <strong>$4.5M, 10+ institution</strong> academic medicine initiative.</li>
        <li>Designed the operating rhythms, decision frameworks, and governance that aligned senior stakeholders around timelines, accountability, and politically sensitive priorities. Executive partnership was the job.</li>
        <li>Built the reporting backbone that gave leaders the evidence and the structure to act.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Ideagen DevonWay</span>
        <span class="job-period">Nov 2022 to Jan 2024</span>
      </div>
      <div class="job-role">Technical Project Manager, Client Partnership</div>
      <div class="job-location">Remote</div>
      <ul>
        <li>Acted as primary executive contact on <strong>$245K to $2.2M implementations</strong> for Department of Energy, defense, and regulated-industry clients.</li>
        <li><strong>Increased customer satisfaction by 25%</strong> through the trusted-advisor positioning and clear-eyed communication that kept client leadership informed and aligned.</li>
        <li>Translated technical requirements into practical business decisions for client executives.</li>
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
        <li>Directed operations, people programs, and performance management for a growing wellness business. Managed and trained a 17-member team; improved customer satisfaction by 34% in six months.</li>
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
        <li>Built a five-year roadmap and investment plan that contributed to <strong>$14M+ in savings and cost avoidance</strong>.</li>
      </ul>
    </div>
  `,
  SECTION_PROJECTS: 'Selected Partnership Highlights',
  PROJECTS: `
    <div class="project">
      <div class="project-title">Harvard Medical School: $4.5M Multi-Institution Partnership<span class="project-badge">Executive alignment</span></div>
      <div class="project-desc">Designed governance and decision frameworks that kept clinical faculty, hospital executives, and internal stakeholders aligned through delivery on a politically sensitive initiative.</div>
    </div>
    <div class="project">
      <div class="project-title">Wellstar: Total Rewards Executive Analytics<span class="project-badge">Trusted advisor</span></div>
      <div class="project-desc">Multi-pillar Tableau dashboard suite for HR leadership and C-suite. Three KPIs leadership acts on, not thirty they ignore.</div>
    </div>
    <div class="project">
      <div class="project-title">DevonWay: Regulated Client Partnership<span class="project-badge">+25% CSAT</span></div>
      <div class="project-desc">Primary executive contact on DoE and defense implementations. Clear-eyed communication in high-stakes, compliance-heavy environments.</div>
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
      <div class="skill-item"><span class="skill-category">HR / People:</span> Total Rewards, Benefits, People Analytics, HRIS partnership, Change Management, Executive Partnership</div>
      <div class="skill-item"><span class="skill-category">Analytics:</span> Tableau, Power BI, SQL, BigQuery, PowerQuery, Excel, ROI modeling, executive dashboards</div>
      <div class="skill-item"><span class="skill-category">AI / ML platform:</span> Google Vertex AI, Gemini 2.5, OpenAI / Azure OpenAI, prompt engineering, AI-integrated workflow</div>
      <div class="skill-item"><span class="skill-category">Cloud / infra:</span> GCP, Cloud Run, BigQuery</div>
      <div class="skill-item"><span class="skill-category">Delivery:</span> Jira, Confluence, Asana, Agile, Waterfall</div>
    </div>
  `,
};

let html = template;
for (const [k, v] of Object.entries(vars)) {
  html = html.split(`{{${k}}}`).join(v);
}
html = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cv-aaliya-headway-2026-04-14.html', html);
console.log('Wrote output/cv-aaliya-headway-2026-04-14.html (' + html.length + ' bytes) -- dash-scrubbed -- HRBP Director framing');
