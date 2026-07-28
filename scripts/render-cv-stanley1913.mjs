#!/usr/bin/env node
// Render CV for Stanley 1913 - HR Director, Business Partnership (Brand & Product).
// Seattle HQ (hybrid per public posting). Consumer products context.
// Tier 1 only. No em/en dashes.
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
  SUMMARY_TEXT: `Strategic HR and program leader with 13+ years partnering with senior executives on the people programs, analytics, and decisions that shape a business. Currently owns Total Rewards analytics at Wellstar Health System: a multi-pillar Tableau platform that HR leadership and the C-suite use for labor-optimization decisions. Led a $4.5M, 10-plus institution program at Harvard Medical School with audit-grade governance. Known for bringing data, structure, and hard conversations into executive partnerships, for turning culture-centric programs into measurable outcomes, and for building the trusted-advisor relationships that let senior leaders make better calls.`,
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: [
    'Executive Partnership & Trusted Advisor',
    'Data-Driven HR Decisions',
    'Total Rewards & Benefits Fluency',
    'People Analytics & Workforce Insights',
    'Culture-Centric Program Leadership',
    'Cross-Functional Stakeholder Alignment',
    'Change Management at Scale',
    'Consumer Brand & Operations Context',
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
        <li>Partner with HR leadership and the C-suite on Total Rewards and Labor Optimization strategy, owning the analytics that turn people-program data into decision-ready signal.</li>
        <li>Translate operational data (Power BI, Tableau, SQL, BigQuery, PowerQuery) into <strong>executive-ready storytelling</strong> that connects benefits and workforce investment to ROI, utilization, and employee experience.</li>
        <li>Serve as <strong>trusted advisor</strong> across HRIS, Operations, and leadership, translating business questions into actionable analysis.</li>
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
        <li>Partnered with senior executives across <strong>10+ institutions</strong> on a $4.5M program. Executive alignment and governance design were the job.</li>
        <li>Built the operating rhythms and decision frameworks that kept politically sensitive work moving with audit-ready documentation.</li>
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
        <li>Primary executive contact on <strong>$245K to $2.2M regulated software implementations</strong>. <strong>+25% CSAT</strong> through trusted-advisor positioning and clear-eyed communication.</li>
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
        <li>Directed operations, people programs, and performance management for a growing consumer-facing wellness business. Managed and trained a 17-member team; improved CSAT by 34% in six months through CRM, scheduling, and service-workflow redesign.</li>
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
  SECTION_PROJECTS: 'Selected Partnership Highlights',
  PROJECTS: `
    <div class="project">
      <div class="project-title">Harvard Medical School: Multi-Institution Executive Alignment<span class="project-badge">$4.5M program</span></div>
      <div class="project-desc">Governance and decision frameworks that kept 10+ institutions aligned through a politically sensitive academic-medicine initiative.</div>
    </div>
    <div class="project">
      <div class="project-title">Wellstar: Total Rewards Executive Analytics<span class="project-badge">Trusted advisor</span></div>
      <div class="project-desc">Multi-pillar Tableau dashboard suite for HR leadership and C-suite. Three KPIs leadership acts on, not thirty they ignore.</div>
    </div>
    <div class="project">
      <div class="project-title">Warrior Body Spa: Culture-Centric Operations<span class="project-badge">17-person team</span></div>
      <div class="project-desc">Consumer-facing operations leadership; 34% CSAT improvement in six months through process, systems, and people-program redesign.</div>
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
      <div class="skill-item"><span class="skill-category">HR / People:</span> HRBP partnership, Total Rewards, Benefits, People Analytics, Change Management, Culture</div>
      <div class="skill-item"><span class="skill-category">Analytics:</span> Tableau, Power BI, SQL, BigQuery, PowerQuery, Excel, ROI modeling</div>
      <div class="skill-item"><span class="skill-category">Delivery:</span> Jira, Confluence, Asana, Agile, Waterfall, PMP, CSM</div>
      <div class="skill-item"><span class="skill-category">Domain:</span> Consumer products, Healthcare, Regulated delivery, Executive partnership</div>
    </div>
  `,
};

let html = template;
for (const [k, v] of Object.entries(vars)) {
  html = html.split(`{{${k}}}`).join(v);
}
html = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cv-aaliya-stanley1913-2026-04-14.html', html);
console.log('Wrote output/cv-aaliya-stanley1913-2026-04-14.html (' + html.length + ' bytes) -- dash-scrubbed');
