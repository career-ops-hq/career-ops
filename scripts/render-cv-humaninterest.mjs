#!/usr/bin/env node
// One-off: render cv-aaliya-humaninterest.html from template + tailored content
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
  LOCATION: 'PMP · CSM',
  SECTION_SUMMARY: 'Professional Summary',
  SUMMARY_TEXT: `Senior Technical Program Manager with 13+ years running multi-stakeholder programs where precision, compliance, and executive communication were non-negotiable. Currently leads Total Rewards and labor optimization analytics at Wellstar Health System — building dashboards and executive storytelling that connect benefits and people-program investments to business outcomes. Previously delivered $245K–$2.2M regulated-software implementations for Department of Energy and defense clients, and managed a $4.5M multi-institution initiative at Harvard Medical School. PMP, CSM. Looking for Senior TPM roles at financial platforms where benefits, retirement security, and operational trust converge.`,
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: [
    'Senior Technical Program Management',
    'Regulated Software Delivery',
    'Money Movement / Payments (adjacent)',
    'Executive Storytelling with Data',
    'Cross-Functional Engineering Partnership',
    'Benefits & Retirement Domain',
    'Risk, Audit, and Compliance',
    'Agile + Waterfall at Scale',
  ].map(t => `<span class="competency-tag">${t}</span>`).join('\n      '),
  SECTION_EXPERIENCE: 'Work Experience',
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">Wellstar Health System</span>
        <span class="job-period">Jan 2025 – Present</span>
      </div>
      <div class="job-role">Technical Program Manager — Total Rewards</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Run enterprise Total Rewards and Labor Optimization programs, translating complex people-program data into executive-ready dashboards, briefings, and decisions for C-suite stakeholders.</li>
        <li>Build Power BI, Tableau, and SQL analytics that connect benefits and workforce investments to ROI, utilization, and employee experience — the same measurement discipline required for trust-critical platforms.</li>
        <li>Coordinate across engineering, HRIS, operations, and leadership audiences, reducing data silos and standing up repeatable reporting that audit-proofs executive decisions.</li>
        <li>Serve as the connector between technical, operational, and leadership teams — translating business questions into actionable analysis and concrete next-step recommendations.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Harvard Medical School</span>
        <span class="job-period">Jan 2023 – Jan 2025</span>
      </div>
      <div class="job-role">Program Manager</div>
      <div class="job-location">Remote</div>
      <ul>
        <li>Led a multi-stakeholder academic medicine program with a record-setting <strong>$4.5M budget</strong>, aligning 10+ institutions, hospital partners, educators, and internal stakeholders around timelines, governance, and execution.</li>
        <li>Designed operating rhythms, decision frameworks, and communication plans that reduced ambiguity and kept high-visibility, politically sensitive work moving to completion.</li>
        <li>Strengthened systems and workflows related to learning operations, curriculum mapping, and fiscal planning — with audit-ready documentation for every major decision.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Ideagen DevonWay</span>
        <span class="job-period">Nov 2022 – Jan 2024</span>
      </div>
      <div class="job-role">Technical Project Manager</div>
      <div class="job-location">Remote</div>
      <ul>
        <li>Managed high-visibility software implementations for <strong>Department of Energy, defense, and regulated-industry clients</strong> with budgets of <strong>$245K to $2.2M</strong> — where precision, audit trails, and compliance were non-negotiable (the same operating conditions as money movement and 401(k) platforms).</li>
        <li>Acted as primary client contact for scope, schedule, status reporting, and issue resolution, <strong>increasing customer satisfaction by 25%</strong>.</li>
        <li>Kept cross-functional teams aligned across sales, development, and customer environments to ship complex solutions on time against regulatory deadlines.</li>
        <li>Translated technical requirements into practical business decisions and maintained strong executive communication throughout the project lifecycle.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Warrior Body Spa</span>
        <span class="job-period">2014 – 2022</span>
      </div>
      <div class="job-role">Director of Operations</div>
      <div class="job-location">Tucker, GA</div>
      <ul>
        <li>Directed operations, systems, and team performance for a growing wellness business — scaling programs and strengthening service delivery with automation and process redesign.</li>
        <li>Managed and trained a 17-member team and improved customer satisfaction by 34% within six months.</li>
        <li>Introduced process improvements across CRM, scheduling, and service workflows to support growth and a consistent end-to-end experience.</li>
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
        <li>Developed a five-year roadmap and investment plan that contributed to more than <strong>$14M in savings and cost avoidance</strong>.</li>
        <li>Scaled the property portfolio from two to seven properties, supporting 350% growth through disciplined planning and execution.</li>
      </ul>
    </div>
  `,
  SECTION_PROJECTS: 'Selected Program Highlights',
  PROJECTS: `
    <div class="project">
      <div class="project-title">Harvard Medical School — Clinical Faculty Investment Redesign<span class="project-badge">$4.5M program</span></div>
      <div class="project-desc">Led a politically sensitive, multi-institution academic medicine initiative. Designed governance cadence, decision frameworks, and stakeholder communications that kept 10+ hospital and academic partners aligned through delivery.</div>
    </div>
    <div class="project">
      <div class="project-title">Ideagen DevonWay — DoE &amp; Defense Implementations<span class="project-badge">Regulated delivery</span></div>
      <div class="project-desc">Shipped $245K–$2.2M software implementations against audit, compliance, and regulatory deadlines. +25% customer satisfaction by owning scope, schedule, risk, and executive communication end-to-end.</div>
    </div>
    <div class="project">
      <div class="project-title">Wellstar — Total Rewards &amp; Labor Optimization Analytics<span class="project-badge">Current</span></div>
      <div class="project-desc">Built executive dashboards connecting benefits and workforce spend to ROI. Power BI, Tableau, SQL, and PowerQuery surface decision-ready signal across a large enterprise healthcare system.</div>
    </div>
  `,
  SECTION_EDUCATION: 'Education',
  EDUCATION: `
    <div class="edu-item">
      <div class="edu-header">
        <span class="edu-title">Graduate Certificate, Corporate Sustainability and Innovation — <span class="edu-org">Harvard University</span></span>
      </div>
    </div>
    <div class="edu-item">
      <div class="edu-header">
        <span class="edu-title">Master of Public Administration — <span class="edu-org">Augusta University</span></span>
      </div>
    </div>
    <div class="edu-item">
      <div class="edu-header">
        <span class="edu-title">Bachelor of Arts, Philosophy — <span class="edu-org">Paine College</span></span>
      </div>
    </div>
  `,
  SECTION_CERTIFICATIONS: 'Certifications',
  CERTIFICATIONS: `
    <div class="cert-item">
      <span class="cert-title">Project Management Professional (PMP) — <span class="cert-org">PMI</span></span>
    </div>
    <div class="cert-item">
      <span class="cert-title">Certified ScrumMaster (CSM) — <span class="cert-org">Scrum Alliance</span></span>
    </div>
  `,
  SECTION_SKILLS: 'Skills',
  SKILLS: `
    <div class="skills-grid">
      <div class="skill-item"><span class="skill-category">Analytics:</span> Power BI, Tableau, SQL, Excel, PowerQuery</div>
      <div class="skill-item"><span class="skill-category">Delivery:</span> Jira, Confluence, Asana, Agile, Waterfall</div>
      <div class="skill-item"><span class="skill-category">Systems:</span> Salesforce, ERP/CRM, HRIS-adjacent Total Rewards tooling</div>
      <div class="skill-item"><span class="skill-category">Communication:</span> PowerPoint, Visio, executive storytelling</div>
      <div class="skill-item"><span class="skill-category">Domains:</span> Total Rewards, Benefits, Retirement-adjacent, Regulated Software (DoE/Defense), Healthcare</div>
    </div>
  `,
};

let html = template;
for (const [k, v] of Object.entries(vars)) {
  html = html.split(`{{${k}}}`).join(v);
}

// Scrub em and en dashes from final output per candidate preference.
html = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cv-aaliya-humaninterest-2026-04-14.html', html);
console.log('Wrote output/cv-aaliya-humaninterest-2026-04-14.html (' + html.length + ' bytes) -- dash-scrubbed');
