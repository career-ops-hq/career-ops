#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';

const template = readFileSync('templates/cv-template.html', 'utf8');

const shared = {
  LANG: 'en',
  PAGE_WIDTH: '8.5in',
  NAME: 'Aaliya Bashir, MPA',
  EMAIL: 'bashiraaliya@gmail.com',
  LINKEDIN_URL: 'https://linkedin.com/in/aaliya-bashir/',
  LINKEDIN_DISPLAY: 'linkedin.com/in/aaliya-bashir',
  PORTFOLIO_URL: '#',
  PORTFOLIO_DISPLAY: 'Atlanta, GA',
  LOCATION: 'Atlanta, GA',
  SECTION_SUMMARY: 'Professional Summary',
  SECTION_COMPETENCIES: 'Core Competencies',
  SECTION_EXPERIENCE: 'Work Experience',
  SECTION_PROJECTS: 'Selected Highlights',
  SECTION_EDUCATION: 'Education',
  SECTION_CERTIFICATIONS: 'Certifications',
  SECTION_SKILLS: 'Skills',
  EDUCATION: `
    <div class="edu-item"><div class="edu-header"><span class="edu-title">Graduate Certificate, Corporate Sustainability and Innovation, <span class="edu-org">Harvard University</span></span></div></div>
    <div class="edu-item"><div class="edu-header"><span class="edu-title">Master of Public Administration, <span class="edu-org">Augusta University</span></span></div></div>
    <div class="edu-item"><div class="edu-header"><span class="edu-title">Bachelor of Arts, Philosophy, <span class="edu-org">Paine College</span></span></div></div>
  `,
  CERTIFICATIONS: `
    <div class="cert-item"><span class="cert-title">Project Management Professional (PMP), <span class="cert-org">PMI</span></span></div>
    <div class="cert-item"><span class="cert-title">Certified ScrumMaster (CSM), <span class="cert-org">Scrum Alliance</span></span></div>
  `,
  SKILLS: `
    <div class="skills-grid">
      <div class="skill-item"><span class="skill-category">Analytics:</span> Power BI, Tableau, SQL, Excel, PowerQuery, dashboard design, KPI reporting</div>
      <div class="skill-item"><span class="skill-category">Programs:</span> Total Rewards, benefits, HR operations, people programs, workforce planning</div>
      <div class="skill-item"><span class="skill-category">Delivery:</span> stakeholder management, executive storytelling, process improvement, change management</div>
      <div class="skill-item"><span class="skill-category">Tools:</span> Jira, Confluence, Asana, Salesforce, ERP / CRM systems</div>
    </div>
  `,
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">Wellstar Health System</span>
        <span class="job-period">Jan 2025 to Present</span>
      </div>
      <div class="job-role">Technical Program Manager, Total Rewards</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Support enterprise Total Rewards and labor optimization work by turning large workforce datasets into executive-ready dashboards, presentations, and decision support.</li>
        <li>Use Power BI, Tableau, SQL, Excel, and PowerQuery to analyze trends across benefits, compensation, and employee experience and make insights usable for leadership.</li>
        <li>Coordinate across technical, operational, and leadership stakeholders to streamline reporting, reduce data silos, and improve the cadence of decision-making.</li>
        <li>Connect program execution to business outcomes with clear storytelling, structured process design, and repeatable operating rhythms.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Harvard Medical School</span>
        <span class="job-period">Jan 2023 to Jan 2025</span>
      </div>
      <div class="job-role">Program Manager</div>
      <div class="job-location">Remote</div>
      <ul>
        <li>Led a complex, multi-stakeholder initiative with a record-setting $4.5M budget supporting clinical faculty investment and program redesign.</li>
        <li>Aligned 10+ institutions, hospital partners, educators, and internal stakeholders around timelines, governance, communications, and execution milestones.</li>
        <li>Designed operating rhythms, decision frameworks, and communication plans that reduced ambiguity and kept high-visibility work moving to completion.</li>
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
        <li>Managed high-visibility software implementations for Department of Energy, defense, and regulated-industry clients with budgets ranging from $245K to $2.2M.</li>
        <li>Acted as primary client contact for scope, schedule, status reporting, and issue resolution, increasing customer satisfaction by 25%.</li>
        <li>Translated technical requirements into practical business decisions and maintained strong executive communication throughout project lifecycles.</li>
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
        <li>Directed operations, systems, customer experience, and team performance for a growing wellness business, strengthening service delivery and process discipline.</li>
        <li>Managed and trained a 17-member team and improved customer satisfaction by 34% within six months.</li>
        <li>Introduced workflow improvements across CRM, marketing, scheduling, and service operations to support growth.</li>
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
        <li>Developed a five-year roadmap and investment plan that contributed to more than $14M in savings and cost avoidance.</li>
        <li>Helped scale the property portfolio from two to seven properties, supporting 350% growth through disciplined planning and execution.</li>
      </ul>
    </div>
  `,
};

const roles = [
  {
    slug: 'peregrine',
    company: 'Peregrine Technologies',
    role: 'Senior Director, Total Rewards',
    url: 'https://job-boards.greenhouse.io/peregrinetechnologies/jobs/4671594005',
    format: 'letter',
    fit: 'My background in Total Rewards analytics, labor optimization, and executive storytelling fits a build-and-scale environment where compensation, benefits, people operations, HR systems, and workforce analytics must work together.',
    summary: 'Senior total rewards and operations leader with 13+ years turning complex workforce data into executive decisions. Currently supports Total Rewards analytics and labor optimization at Wellstar Health System, building dashboards and operating rhythms that connect benefits, compensation, and employee experience to business outcomes. Brings strong executive storytelling, process design, and cross-functional leadership across analytics-heavy programs.',
    competencies: ['Total Rewards Leadership', 'Executive Storytelling', 'Workforce Analytics', 'Process Design and Improvement', 'Benefits and Compensation Programs', 'SQL, Power BI, Tableau', 'Stakeholder Management', 'Change Leadership'],
    projects: [
      ['Wellstar Total Rewards Analytics', 'Built executive-ready reporting for compensation, benefits, and labor optimization.', 'Power BI, Tableau, SQL'],
      ['HMS Multi-Stakeholder Program', 'Led a $4.5M, 10+ institution initiative with governance and reporting discipline.', 'Program leadership'],
      ['Operations and Service Scaling', 'Improved team performance and service delivery while scaling customer experience processes.', 'Operations'],
    ],
    pdf: 'output/cv-aaliya-bashir-peregrine-2026-04-25.pdf',
    html: '/tmp/cv-peregrine.html',
  },
  {
    slug: 'proshares',
    company: 'ProShares',
    role: 'Director, HR Operations & Total Rewards',
    url: 'https://job-boards.greenhouse.io/proshares/jobs/5857594004',
    format: 'letter',
    fit: 'My background fits a lean HR environment that needs disciplined HR operations, reporting, and total rewards execution across the employee lifecycle.',
    summary: 'HR operations and total rewards leader with 13+ years of experience improving workforce programs, reporting, and operating cadence. At Wellstar Health System, supports Total Rewards analytics and labor optimization by translating benefits and compensation data into leadership-ready insights. Known for building clean processes, partnering across functions, and making complex people data usable for executives.',
    competencies: ['HR Operations', 'Total Rewards', 'Compensation and Benefits', 'Workforce Reporting', 'Executive Communication', 'Process Improvement', 'Power BI and Tableau', 'Cross-Functional Coordination'],
    projects: [
      ['Wellstar Reporting Cadence', 'Helped reduce data silos and improve decision speed across HR and operations.', 'Reporting'],
      ['HMS Program Governance', 'Built operating rhythms and governance for a $4.5M multi-institution initiative.', 'Governance'],
      ['Client Satisfaction Improvement', 'Raised customer satisfaction by 25% through clearer reporting and issue resolution.', 'Delivery'],
    ],
    pdf: 'output/cv-aaliya-bashir-proshares-2026-04-25.pdf',
    html: '/tmp/cv-proshares.html',
  },
  {
    slug: 'formation-bio',
    company: 'Formation Bio',
    role: 'Director, People Operations & Total Rewards',
    url: 'https://job-boards.greenhouse.io/formationbio/jobs/7738920',
    format: 'letter',
    fit: 'My background fits a high-growth, tech-enabled environment that needs strong people operations, clean process, and credible total rewards leadership.',
    summary: 'People operations and total rewards program leader with a background in executive storytelling, workflow design, and data-driven decision support. Currently owns Total Rewards analytics work at Wellstar, where benefits, compensation, and labor optimization reporting are translated into clear next steps for leadership. Brings strong program discipline, stakeholder alignment, and a calm operating style in ambiguous environments.',
    competencies: ['People Operations', 'Total Rewards Programs', 'Workforce Analytics', 'Executive Storytelling', 'Stakeholder Alignment', 'Workflow Design', 'PowerQuery and SQL', 'Change Management'],
    projects: [
      ['Wellstar Total Rewards Analytics', 'Developed reporting that connects workforce investments to outcomes.', 'People analytics'],
      ['Harvard Medical School Program', 'Managed a high-stakes, cross-functional initiative with 10+ stakeholders.', 'Program management'],
      ['Warrior Body Spa Operations', 'Improved team performance and customer experience through process redesign.', 'Operations'],
    ],
    pdf: 'output/cv-aaliya-bashir-formation-bio-2026-04-25.pdf',
    html: '/tmp/cv-formation-bio.html',
  },
  {
    slug: 'iovance',
    company: 'Iovance Biotherapeutics',
    role: 'Senior Director, Total Rewards and Operations',
    url: 'https://job-boards.greenhouse.io/iovancebiotherapeutics/jobs/5157424008',
    format: 'letter',
    fit: 'My background fits a growth environment where total rewards, HR operations, and system improvement need to stay tightly aligned.',
    summary: 'Total rewards and operations leader with 13+ years of experience driving structured, executive-ready people programs. At Wellstar, supports Total Rewards and labor optimization with dashboards, analysis, and cross-functional coordination across benefits, compensation, and workforce planning. Combines rigorous execution, stakeholder management, and strong business storytelling in complex environments.',
    competencies: ['Total Rewards Operations', 'Benefits and Compensation', 'Executive Reporting', 'Workforce Planning', 'Stakeholder Management', 'Process Discipline', 'SQL and Power BI', 'Program Execution'],
    projects: [
      ['Wellstar Operating Rhythm', 'Built repeatable reporting and coordination patterns for leadership visibility.', 'Operating model'],
      ['HMS Budgeted Program', 'Delivered a $4.5M initiative with careful governance and communications.', 'Budget management'],
      ['Client-Facing Delivery', 'Managed complex implementations and resolved issues as the primary client contact.', 'Delivery'],
    ],
    pdf: 'output/cv-aaliya-bashir-iovance-2026-04-25.pdf',
    html: '/tmp/cv-iovance.html',
  },
  {
    slug: 'biomed-realty',
    company: 'BioMed Realty',
    role: 'Director, Total Rewards',
    url: 'https://job-boards.greenhouse.io/biomedrealty/jobs/4665638006',
    format: 'letter',
    fit: 'My background fits a hands-on role that needs compensation expertise, HR systems rigor, and actionable leadership reporting.',
    summary: 'Total rewards leader with deep experience translating data into practical workforce decisions. Currently supports Total Rewards analytics at Wellstar Health System, building dashboards and narrative for compensation, benefits, and labor optimization work. Brings a process-oriented approach, solid executive communication, and a track record of improving reporting, team performance, and operational clarity.',
    competencies: ['Total Rewards', 'Compensation Analytics', 'Benefits Analytics', 'Executive Dashboards', 'Operational Clarity', 'Stakeholder Communication', 'Power BI', 'Workflow Improvement'],
    projects: [
      ['Wellstar Dashboard Suite', 'Turned HR data into leadership-ready reporting for total rewards decisions.', 'Dashboards'],
      ['HMS Multi-Stakeholder Delivery', 'Aligned 10+ institutions around timelines, governance, and communications.', 'Program leadership'],
      ['Business Operations Growth', 'Improved service delivery while scaling systems and team performance.', 'Operations'],
    ],
    pdf: 'output/cv-aaliya-bashir-biomed-realty-2026-04-25.pdf',
    html: '/tmp/cv-biomed-realty.html',
  },
  {
    slug: 'curaleaf',
    company: 'Curaleaf',
    role: 'Vice President, Total Rewards',
    url: 'https://job-boards.greenhouse.io/curaleaf/jobs/8439522002',
    format: 'letter',
    fit: 'My background fits a fast-paced, high-accountability environment that needs executive-facing rewards strategy and strong operating judgment.',
    summary: 'Senior people leader with 13+ years of experience in operations, program management, and total rewards analytics. At Wellstar, supports enterprise Total Rewards and labor optimization with dashboards, leadership storytelling, and cross-functional coordination. Brings the operating discipline, stakeholder maturity, and practical problem-solving needed for a large, regulated, multi-site environment.',
    competencies: ['Total Rewards Strategy', 'People Operations', 'Executive Storytelling', 'Regulated Environments', 'Cross-Functional Leadership', 'Benefits and Compensation', 'SQL and Tableau', 'Process Improvement'],
    projects: [
      ['Wellstar Enterprise Analytics', 'Supports a leadership-facing analytics suite across compensation, benefits, and labor optimization.', 'Enterprise reporting'],
      ['Harvard Medical School Governance', 'Led a large, complex initiative across 10+ institutions and partners.', 'Governance'],
      ['Warrior Body Spa Scaling', 'Managed a 17-person team and improved customer satisfaction through process changes.', 'Scaled operations'],
    ],
    pdf: 'output/cv-aaliya-bashir-curaleaf-2026-04-25.pdf',
    html: '/tmp/cv-curaleaf.html',
  },
  {
    slug: 'nscale',
    company: 'Nscale',
    role: 'Director, People Partnering - AI Infrastructure (US)',
    url: 'https://job-boards.greenhouse.io/nscaleoperationsukltd/jobs/4799818101',
    format: 'letter',
    fit: 'My background fits a distributed, fast-moving technology organization that needs people partnering grounded in data and process.',
    summary: 'People operations and strategic program leader with 13+ years helping teams translate data, process, and stakeholder needs into action. Current work at Wellstar combines executive storytelling, dashboard development, and labor optimization support across benefits and compensation. Well suited to people partnering roles that require structure, clarity, and strong cross-functional execution in a fast-moving environment.',
    competencies: ['People Partnering', 'Executive Storytelling', 'Cross-Functional Execution', 'People Analytics', 'Process Improvement', 'Stakeholder Support', 'Power BI and SQL', 'Change Management'],
    projects: [
      ['Wellstar Leadership Support', 'Turns workforce data into practical decisions for people and business leaders.', 'People analytics'],
      ['HMS Initiative Management', 'Maintained alignment across 10+ institutions and stakeholders.', 'Program management'],
      ['Systems and Service Improvement', 'Implemented workflow improvements that enhanced customer experience and consistency.', 'Operations'],
    ],
    pdf: 'output/cv-aaliya-bashir-nscale-2026-04-25.pdf',
    html: '/tmp/cv-nscale.html',
  },
];

function makeList(items) {
  return items.map(([title, desc, tech]) => `
    <div class="project">
      <div class="project-title">${title}<span class="project-badge">${tech}</span></div>
      <div class="project-desc">${desc}</div>
    </div>
  `).join('\n');
}

function render(role) {
  const vars = {
    ...shared,
    COMPANY: role.company,
    ROLE: role.role,
    URL: role.url,
    SUMMARY_TEXT: role.summary,
    COMPETENCIES: role.competencies.map((c) => `<span class="competency-tag">${c}</span>`).join('\n      '),
    EXPERIENCE: shared.EXPERIENCE,
    PROJECTS: makeList(role.projects),
    PAGE_WIDTH: '8.5in',
  };

  let html = template;
  for (const [key, value] of Object.entries(vars)) {
    html = html.split(`{{${key}}}`).join(value);
  }

  html = html.replace('{{TITLE}}', `${role.company} | ${role.role}`);
  html = html.replace(/{{COMPANY}}/g, role.company);
  html = html.replace(/{{ROLE}}/g, role.role);
  html = html.replace(/{{URL}}/g, role.url);

  const title = `## Application: ${role.company} | ${role.role}`;
  const body = [
    title,
    `**URL:** ${role.url}`,
    `**PDF to upload:** ${role.pdf}`,
    '',
    '### Cover Letter',
    '',
    `Dear Hiring Team,`,
    '',
    `I am writing to apply for the ${role.role} role at ${role.company}. ${role.fit}`,
    '',
    role.summary,
    '',
    'I would welcome the opportunity to contribute this combination of analytics, operations, and executive communication to your team.',
    '',
    'Best,',
    'Aaliya Bashir',
    '',
  ].join('\n');

  return { html, body };
}

mkdirSync('output', { recursive: true });

for (const role of roles) {
  const { html, body } = render(role);
  writeFileSync(role.html, html);
  writeFileSync(`output/apply-${role.slug}.md`, body);

  const result = spawnSync('node', [
    'generate-pdf.mjs',
    role.html,
    role.pdf,
    `--format=${role.format}`,
  ], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('Generated seven tailored resume PDFs and application notes.');
