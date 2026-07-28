#!/usr/bin/env node
// Render CV for Google - Senior Program Manager, Business Systems Transformation, Google Cloud.
// Atlanta-based role. Primary fit: cross-functional program leadership + systems transformation.
// Tier 1 skills lifted. No Tier 2 (founder) disclosure. No em/en dashes.
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
  SUMMARY_TEXT: `Senior program leader with 13+ years running multi-stakeholder business systems transformations where precision, governance, and executive communication were non-negotiable. Currently leads Total Rewards and Labor Optimization internal tooling at Wellstar Health System, owning a multi-pillar Tableau + BigQuery analytics platform used by HR leadership and the C-suite to make labor-optimization decisions. Previously led a $4.5M, 10-plus institution initiative at Harvard Medical School with audit-grade governance, and delivered $245K to $2.2M regulated-software implementations for Department of Energy and defense clients at Ideagen DevonWay. Builds in Power BI, Tableau, SQL, BigQuery, and PowerQuery with an AI-integrated workflow across Google Vertex AI, Gemini, and GCP. PMP, CSM.`,
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: [
    'Business Systems Transformation',
    'Cross-Functional Program Leadership',
    'Executive Stakeholder Partnership',
    'Governance & Audit-Ready Reporting',
    'Change Management at Scale',
    'GCP, Vertex AI, BigQuery Fluency',
    'Data-Driven Decision Support',
    'Regulated & Compliance-Heavy Delivery',
  ].map(t => `<span class="competency-tag">${t}</span>`).join('\n      '),
  SECTION_EXPERIENCE: 'Work Experience',
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">Wellstar Health System</span>
        <span class="job-period">Jan 2025 to Present</span>
      </div>
      <div class="job-role">Technical Program Manager, Total Rewards &amp; Internal Tooling</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Own the <strong>Total Rewards internal analytics platform</strong> (multi-pillar Tableau product backed by BigQuery and SQL) used by HR leadership and the C-suite to make labor-optimization decisions.</li>
        <li>Drive cross-functional alignment across HRIS, Operations, and Engineering to retire data silos and stand up <strong>repeatable, audit-ready internal reporting</strong> at enterprise scale.</li>
        <li>Apply <strong>Google Vertex AI, Gemini, and GCP</strong> in an AI-integrated workflow to compress analysis cycles and surface decision-ready signal faster.</li>
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
        <li>Led a <strong>$4.5M, 10+ institution academic medicine program</strong>. Designed governance cadence, decision frameworks, and communications that aligned clinical faculty, hospital partners, and internal stakeholders around a single delivery plan.</li>
        <li>Built the operating system (cadence, artifacts, escalation paths) that kept politically sensitive work moving with audit-ready documentation. This is what business-systems transformation at scale actually looks like.</li>
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
        <li><strong>Increased customer satisfaction by 25%</strong> as primary executive contact for status reporting and issue resolution.</li>
        <li>Translated technical requirements into business decisions and kept engineering, sales, and customer environments aligned.</li>
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
        <li>Directed operations, systems, and team performance for a growing wellness business. Managed and trained a 17-member team; improved customer satisfaction by 34% in six months through CRM, scheduling, and service-workflow redesign.</li>
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
  SECTION_PROJECTS: 'Selected Program Highlights',
  PROJECTS: `
    <div class="project">
      <div class="project-title">Harvard Medical School: $4.5M Multi-Institution Systems Transformation<span class="project-badge">Governance + reporting</span></div>
      <div class="project-desc">Governance cadence, decision frameworks, and audit-ready reporting that aligned 10+ institutions through delivery on a politically sensitive academic-medicine initiative.</div>
    </div>
    <div class="project">
      <div class="project-title">Wellstar: Total Rewards Internal Tooling Platform<span class="project-badge">Tableau, BigQuery, GCP</span></div>
      <div class="project-desc">Multi-pillar internal analytics product connecting benefits and workforce spend to ROI for executive decision-making.</div>
    </div>
    <div class="project">
      <div class="project-title">DevonWay: Regulated Software Delivery<span class="project-badge">DoE, Defense</span></div>
      <div class="project-desc">$245K to $2.2M implementations with +25% CSAT. Audit trails, compliance, and precision were non-negotiable.</div>
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
      <div class="skill-item"><span class="skill-category">Cloud / infra:</span> Google Cloud Platform (GCP), Cloud Run, BigQuery, Supabase</div>
      <div class="skill-item"><span class="skill-category">AI / ML platform:</span> Google Vertex AI, Gemini 2.5, OpenAI / Azure OpenAI, prompt engineering, AI-integrated workflow</div>
      <div class="skill-item"><span class="skill-category">Analytics:</span> Tableau, Power BI, SQL, BigQuery, PowerQuery, Excel, ROI modeling</div>
      <div class="skill-item"><span class="skill-category">Delivery:</span> Jira, Confluence, Asana, Agile, Waterfall, PMP, CSM</div>
      <div class="skill-item"><span class="skill-category">Domain:</span> Business Systems Transformation, Total Rewards, Regulated Software, Healthcare</div>
    </div>
  `,
};

let html = template;
for (const [k, v] of Object.entries(vars)) {
  html = html.split(`{{${k}}}`).join(v);
}
html = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cv-aaliya-google-2026-04-14.html', html);
console.log('Wrote output/cv-aaliya-google-2026-04-14.html (' + html.length + ' bytes) -- dash-scrubbed');
