#!/usr/bin/env node
// Render cv-aaliya-justworks.html - Group PM Internal Tools & Operations
// Tier 1 skills lifted (AI/data tooling), no Tier 2 founder narrative.
// No em dashes or en dashes in output text per candidate request.
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
  SUMMARY_TEXT: `Program leader with 13+ years building internal tools, dashboards, and operational systems that move executives off intuition and onto evidence. Currently runs Total Rewards analytics and labor-optimization tooling at Wellstar Health System, designing the dashboards leadership actually uses to make decisions. Operates a tiered prioritization model (Tier 1 Must-Haves, Tier 2 Differentiators, Tier 3 Optimizers) driven by customer evidence rather than personal preference. AI-integrated workflow across Vertex AI, Gemini, GCP, and BigQuery. Looking to build internal-product and operations tooling at an HR-tech company where domain knowledge and operational discipline compound.`,
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: [
    'Internal Tools & Operations',
    'Tier 1/2/3 Prioritization',
    'Customer-Evidence-Driven Roadmaps',
    'Executive Dashboards & Storytelling',
    'AI-Integrated Workflow',
    'Cross-Functional Program Leadership',
    'HR/PEO Domain (Total Rewards, Benefits)',
    'Stakeholder Alignment at Scale',
  ].map(t => `<span class="competency-tag">${t}</span>`).join('\n      '),
  SECTION_EXPERIENCE: 'Work Experience',
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">Wellstar Health System</span>
        <span class="job-period">Jan 2025 to Present</span>
      </div>
      <div class="job-role">Technical Program Manager, Total Rewards (Internal Tools &amp; Analytics)</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Own the Total Rewards <strong>internal dashboard suite</strong> in Tableau (Compensation, Work-Life Services, Benefits, and a TOC navigation layer) used by HR leadership and the C-suite to make Labor Optimization decisions.</li>
        <li>Translate operational and people-program data (Power BI, Tableau, SQL, BigQuery, PowerQuery) into <strong>executive-ready storytelling</strong> that connects spend to ROI, utilization, and employee experience.</li>
        <li>Drive cross-functional alignment across HRIS, Operations, and Engineering to retire data silos and stand up <strong>repeatable internal reporting</strong>, the same problem space as the Justworks Internal Tools &amp; Operations charter.</li>
        <li>Apply <strong>AI-integrated workflow tooling</strong> (Vertex AI, Gemini, OpenAI/Azure OpenAI, prompt engineering) to accelerate analysis cycles and surface decision-ready signal faster.</li>
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
        <li>Led a <strong>$4.5M, 10+ institution academic medicine program</strong>, building the operating system (governance cadence, decision frameworks, communication plans) that kept high-visibility, politically sensitive work moving to completion.</li>
        <li>Designed roadmaps and decision artifacts that <strong>reduced ambiguity</strong> for clinical faculty, hospital partners, and internal stakeholders. The same discipline a Group PM applies across product squads.</li>
        <li>Built and maintained the operational systems for learning operations, curriculum mapping, and fiscal planning at scale.</li>
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
        <li>Shipped <strong>$245K to $2.2M software implementations</strong> for Department of Energy, defense, and regulated-industry clients, owning scope, schedule, risk, and executive communications end to end.</li>
        <li>Acted as primary client contact for issue resolution and status reporting, <strong>increasing customer satisfaction by 25%</strong>.</li>
        <li>Translated technical requirements into practical product decisions and kept cross-functional teams aligned across sales, development, and customer environments.</li>
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
        <li>Directed operations, internal systems, and team performance for a growing wellness business. Scaled programs and built the CRM, scheduling, and service-workflow tooling that drove a <strong>34% CSAT lift</strong> in six months.</li>
        <li>Managed and trained a 17-member team while running the operational backbone day to day.</li>
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
        <li>Built a five-year roadmap and investment plan that contributed to more than <strong>$14M in savings and cost avoidance</strong>; supported 350% portfolio growth (2 to 7 properties).</li>
      </ul>
    </div>
  `,
  SECTION_PROJECTS: 'Selected Operational Highlights',
  PROJECTS: `
    <div class="project">
      <div class="project-title">Wellstar: Total Rewards Internal Dashboard Suite<span class="project-badge">Tableau, BigQuery, SQL</span></div>
      <div class="project-desc">Multi-pillar internal product (Compensation, Work-Life Services, Benefits, TOC navigation) that surfaces the labor-optimization signals leadership needs. Storytelling-led, executive-first design.</div>
    </div>
    <div class="project">
      <div class="project-title">AI-Integrated Workflow: Vertex AI &amp; Gemini for Analytics Acceleration<span class="project-badge">Personal production stack</span></div>
      <div class="project-desc">Self-hosted production stack on GCP / Cloud Run with Vertex AI and Gemini 2.5 powering analytical workflows. Hands-on with prompt engineering, OpenAI / Azure OpenAI, and BigQuery, applied to compress analysis cycles.</div>
    </div>
    <div class="project">
      <div class="project-title">Harvard Medical School: $4.5M Multi-Institution Program<span class="project-badge">Operational backbone</span></div>
      <div class="project-desc">Designed the governance cadence, decision frameworks, and communications operating system that aligned 10+ institutions through delivery on a politically sensitive academic-medicine initiative.</div>
    </div>
  `,
  SECTION_EDUCATION: 'Education',
  EDUCATION: `
    <div class="edu-item">
      <div class="edu-header">
        <span class="edu-title">Graduate Certificate, Corporate Sustainability and Innovation, <span class="edu-org">Harvard University</span></span>
      </div>
    </div>
    <div class="edu-item">
      <div class="edu-header">
        <span class="edu-title">Master of Public Administration, <span class="edu-org">Augusta University</span></span>
      </div>
    </div>
    <div class="edu-item">
      <div class="edu-header">
        <span class="edu-title">Bachelor of Arts, Philosophy, <span class="edu-org">Paine College</span></span>
      </div>
    </div>
  `,
  SECTION_CERTIFICATIONS: 'Certifications',
  CERTIFICATIONS: `
    <div class="cert-item">
      <span class="cert-title">Project Management Professional (PMP), <span class="cert-org">PMI</span></span>
    </div>
    <div class="cert-item">
      <span class="cert-title">Certified ScrumMaster (CSM), <span class="cert-org">Scrum Alliance</span></span>
    </div>
  `,
  SECTION_SKILLS: 'Skills',
  SKILLS: `
    <div class="skills-grid">
      <div class="skill-item"><span class="skill-category">Data &amp; analytics:</span> Tableau, Power BI, SQL, BigQuery, PowerQuery, Excel, ROI modeling, executive dashboards</div>
      <div class="skill-item"><span class="skill-category">AI / ML platform:</span> Google Vertex AI, Gemini 2.5, OpenAI / Azure OpenAI, prompt engineering, AI-integrated workflow</div>
      <div class="skill-item"><span class="skill-category">Cloud / infra:</span> GCP, Cloud Run, Supabase, Firecrawl, BigQuery</div>
      <div class="skill-item"><span class="skill-category">Delivery &amp; collaboration:</span> Jira, Confluence, Asana, Agile, Waterfall</div>
      <div class="skill-item"><span class="skill-category">Domain:</span> HR / PEO, Total Rewards, Benefits, Labor Optimization, Internal Operations Tooling</div>
    </div>
  `,
};

let html = template;
for (const [k, v] of Object.entries(vars)) {
  html = html.split(`{{${k}}}`).join(v);
}

// Final guard: strip any stray em/en dashes from generated body content.
// Keep the template's CSS/structure intact by only replacing in text nodes (best effort):
// Cheap approach since our content here is ours and clean: global replace on the final HTML.
html = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cv-aaliya-justworks-2026-04-14.html', html);
console.log('Wrote output/cv-aaliya-justworks-2026-04-14.html (' + html.length + ' bytes) -- dash-scrubbed');
