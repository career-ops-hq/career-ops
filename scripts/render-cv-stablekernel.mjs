#!/usr/bin/env node
// Render CV for Stable Kernel - Modernization Practice Lead.
// Atlanta-based consultancy. Consulting practice leadership at AI + enterprise software intersection.
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
  SUMMARY_TEXT: `Senior program and modernization leader with 13+ years running business-systems transformations at the intersection of enterprise software, AI, and executive decision-making. Currently owns the Total Rewards analytics platform at Wellstar Health System: a multi-pillar Tableau and BigQuery product that HR leadership and the C-suite use to make labor-optimization decisions. Previously led a $4.5M, 10-plus institution initiative at Harvard Medical School and delivered $245K to $2.2M regulated-software implementations for Department of Energy and defense clients. Operates a production AI-integrated workflow across Google Vertex AI, Gemini 2.5, OpenAI/Azure OpenAI, GCP, and Cloud Run. Known for turning complex modernization engagements into decision-ready roadmaps and for giving senior stakeholders the evidence and the structure to act.`,
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: [
    'Modernization & Digital Transformation',
    'AI Strategy & Enterprise Architecture',
    'Consulting Practice Scaling',
    'Cross-Functional Program Leadership',
    'Executive Stakeholder Partnership',
    'Thought Leadership & Public Speaking',
    'GCP, Vertex AI, Cloud Run Fluency',
    'Regulated & Compliance-Heavy Delivery',
  ].map(t => `<span class="competency-tag">${t}</span>`).join('\n      '),
  SECTION_EXPERIENCE: 'Work Experience',
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">Wellstar Health System</span>
        <span class="job-period">Jan 2025 to Present</span>
      </div>
      <div class="job-role">Technical Program Manager, Total Rewards &amp; Modernization</div>
      <div class="job-location">Atlanta, GA</div>
      <ul>
        <li>Own the <strong>Total Rewards analytics modernization platform</strong> (multi-pillar Tableau product backed by BigQuery and SQL) used by HR leadership and the C-suite for labor-optimization decisions.</li>
        <li>Drive cross-functional alignment across HRIS, Operations, and Engineering to retire legacy reporting and stand up <strong>repeatable, audit-ready internal reporting</strong>.</li>
        <li>Apply <strong>Google Vertex AI, Gemini 2.5, OpenAI/Azure OpenAI, GCP, and Cloud Run</strong> in a production AI-integrated workflow. Have hands-on experience with the modernization toolchain clients typically need.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Harvard Medical School</span>
        <span class="job-period">Jan 2023 to Jan 2025</span>
      </div>
      <div class="job-role">Program Manager, Multi-Institution Modernization Initiative</div>
      <div class="job-location">Remote</div>
      <ul>
        <li>Led a <strong>$4.5M, 10+ institution academic medicine program</strong>. Designed governance, decision frameworks, and communications that kept politically sensitive cross-institutional work moving to completion.</li>
        <li>Built the operating model that translated strategic intent into delivery cadence, artifacts, and escalation paths. The exact consulting-practice discipline clients pay for.</li>
      </ul>
    </div>

    <div class="job">
      <div class="job-header">
        <span class="job-company">Ideagen DevonWay</span>
        <span class="job-period">Nov 2022 to Jan 2024</span>
      </div>
      <div class="job-role">Technical Project Manager, Enterprise Modernization</div>
      <div class="job-location">Remote</div>
      <ul>
        <li>Delivered <strong>$245K to $2.2M enterprise software implementations</strong> for Department of Energy, defense, and regulated-industry clients. Owned scope, schedule, risk, and executive communication end to end.</li>
        <li><strong>Increased customer satisfaction by 25%</strong> as primary executive contact for status reporting and issue resolution.</li>
        <li>Translated technical and architectural requirements into practical business decisions for client leadership.</li>
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
        <li>Directed operations, systems, and team performance for a growing wellness business. Managed and trained a 17-member team; improved CSAT by 34% in six months.</li>
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
        <li>Built a five-year roadmap contributing to <strong>$14M+ in savings and cost avoidance</strong>.</li>
      </ul>
    </div>
  `,
  SECTION_PROJECTS: 'Selected Modernization Highlights',
  PROJECTS: `
    <div class="project">
      <div class="project-title">Harvard Medical School: $4.5M Multi-Institution Modernization<span class="project-badge">Governance + delivery</span></div>
      <div class="project-desc">Consulting-grade operating model (cadence, artifacts, escalation) that aligned 10+ institutions through delivery on a politically sensitive initiative.</div>
    </div>
    <div class="project">
      <div class="project-title">AI-Integrated Workflow on GCP<span class="project-badge">Vertex AI, Gemini, Cloud Run</span></div>
      <div class="project-desc">Production AI stack (Vertex AI, Gemini 2.5, OpenAI/Azure OpenAI, BigQuery) applied to compress analysis cycles. Hands-on understanding of the modernization toolchain.</div>
    </div>
    <div class="project">
      <div class="project-title">DevonWay: Enterprise Regulated Delivery<span class="project-badge">DoE, Defense</span></div>
      <div class="project-desc">$245K to $2.2M implementations with +25% CSAT. The operating discipline that consulting practices sell.</div>
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
      <div class="skill-item"><span class="skill-category">AI / ML platform:</span> Google Vertex AI, Gemini 2.5, OpenAI / Azure OpenAI, prompt engineering, AI-integrated workflow</div>
      <div class="skill-item"><span class="skill-category">Cloud / infra:</span> GCP, Cloud Run, BigQuery, Supabase, Firecrawl</div>
      <div class="skill-item"><span class="skill-category">Analytics:</span> Tableau, Power BI, SQL, BigQuery, PowerQuery, Excel, ROI modeling</div>
      <div class="skill-item"><span class="skill-category">Consulting / delivery:</span> Jira, Confluence, Asana, Agile, Waterfall, PMP, CSM</div>
      <div class="skill-item"><span class="skill-category">Domain:</span> Enterprise Modernization, Digital Transformation, Regulated Software, Healthcare</div>
    </div>
  `,
};

let html = template;
for (const [k, v] of Object.entries(vars)) {
  html = html.split(`{{${k}}}`).join(v);
}
html = html.replace(/\u2014/g, ',').replace(/\u2013/g, '-');

writeFileSync('output/cv-aaliya-stablekernel-2026-04-14.html', html);
console.log('Wrote output/cv-aaliya-stablekernel-2026-04-14.html (' + html.length + ' bytes) -- dash-scrubbed');
