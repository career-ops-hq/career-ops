#!/usr/bin/env node
/**
 * generate-master-cvs.mjs — Build 5 ATS-tuned master CV lane sets from cv.md + report corpus.
 *
 *   node generate-master-cvs.mjs
 *
 * Lane sets (see modes/_profile.md):
 *   L1 ai-product-manager | L2 solutions-consultant | L3 startup-ops | L4 strategy-mid | general
 * Output: output/master cv/{lane}/
 *   cv.json, cv.md, cv.html, cv.pdf, keywords.tsv
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'node:child_process';
import { humanizeCvPayload } from './cv-humanize.mjs';
import { injectPinnedExperience } from './cv-pinned-experience.mjs';
import { styleTokensFrom, injectThemeStyle } from './theme-style.mjs';

import { getCareerOpsRoot } from './path-resolver.mjs';

const DATA_ROOT = getCareerOpsRoot();
const REPORTS = join(DATA_ROOT, 'reports');
const OUT_BASE = join(DATA_ROOT, 'output', 'master cv');

const BASE_CANDIDATE = {
  name: 'Shivanand Shah',
  phone: '+91-9873724226',
  email: 'career.shivanand@gmail.com',
  linkedin: { url: 'linkedin.com/in/shivashah', display: 'linkedin.com/in/shivashah' },
  portfolio: { url: 'https://sigmaxlabs.in', display: 'sigmaxlabs.in' },
  location: 'Gurugram, Delhi-NCR, India',
};

const ARCHETYPE_FILTERS = {
  'ai-product-manager': /\b(ai product|llm|genai|generative|agent|rag|mcp|model|mlops|prompt|workflow automation|creative engine)\b/i,
  'solutions-consultant': /\b(solutions?\s+(architect|consultant|engineer)|pre-?sales|transformation|client|stakeholder|gxP|regulated|life sciences|pharma|consulting)\b/i,
  'startup-ops': /\b(startup|founder|operations|gtm|go-to-market|sales|revenue|customer|partnerships|growth|vendor|p&l|business development)\b/i,
  'strategy-mid': /\b(strateg|cases?\s*study|consultant|analyst|excel|powerpoint|framework|market (sizing|analysis)|problem solving|presentation)\b/i,
};
const LANES = Object.keys(ARCHETYPE_FILTERS); // the 4 lane sets
const ARCH_LABEL = { 'ai-product-manager': 'L1', 'solutions-consultant': 'L2', 'startup-ops': 'L3', 'strategy-mid': 'L4' };

/** Per-lane visual identity injected into each lane's cv.json `style:` block so
 *  generate_cv_pdf.py (reportlab) renders distinct accents. Color-only, so ATS
 *  keyword extraction is untouched. */
const LANE_STYLES = {
  'ai-product-manager': { accent_color: '#0b6e8f', secondary_color: '#7b2e8e' }, // teal -> purple (default fine)
  'solutions-consultant': { accent_color: '#1f6fb2', secondary_color: '#374151' }, // blue -> slate
  'startup-ops': { accent_color: '#b45309', secondary_color: '#78350f' }, // amber -> deep amber
  'strategy-mid': { accent_color: '#4f46e5', secondary_color: '#312e81' }, // indigo -> deep indigo
  general: { accent_color: '#334155', secondary_color: '#0f172a' }, // slate -> ink
};

// Every headline leads with the moat (regulated-industry delivery) or, for the
// founder lane, the thing being founded. GenAI evaluation and human-in-the-loop
// are TOOLS and sit in Skills -- advertising them in the headline contradicted
// the competency spine directly beneath it. Enforced by verify-cv-style.mjs, so
// do not reintroduce a demoted skill here. See modes/_custom.md.
const LANE_HEADLINES = {
  'ai-product-manager': 'AI Product Manager | GxP-regulated delivery | hands-on LLM agents',
  'solutions-consultant': 'Solutions Consultant | GxP-regulated delivery | AI transformation',
  'startup-ops': 'Founder, AI-ops consultancy | two shipped ventures | GxP delivery background',
  'strategy-mid': 'Strategy consultant | GxP-regulated delivery | ex-Deloitte USI (IIM Rohtak)',
  general: 'Product & solutions | regulated-industry delivery | hands-on AI automation',
};

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Mine JD keyword lines from evaluation reports. */
export function mineKeywordsFromReports() {
  const buckets = Object.fromEntries([...LANES, 'general'].map((k) => [k, new Map()]));
  if (!existsSync(REPORTS)) return buckets;

  for (const file of readdirSync(REPORTS)) {
    if (!/^\d{3}-/.test(file) || file.includes('RESERVED')) continue;
    const text = readFileSync(join(REPORTS, file), 'utf-8');
    const blocks = [];
    const kwMirror = text.match(/\*\*JD keywords to mirror\*\*[^\n]*\n([^\n#]+)/i);
    if (kwMirror) blocks.push(kwMirror[1]);
    const kwExtract = text.match(/## Keywords extracted\n+([^\n#]+)/i);
    if (kwExtract) blocks.push(kwExtract[1]);
    if (!blocks.length) continue;

    for (const block of blocks) {
      for (const raw of block.split(/[,;|]/)) {
        const term = raw.trim().replace(/\*+/g, '');
        if (!term || term.length < 3 || term.length > 60) continue;
        const key = term.toLowerCase();
        for (const [arch, filter] of Object.entries(ARCHETYPE_FILTERS)) {
          if (filter.test(term) || filter.test(file)) {
            buckets[arch].set(key, (buckets[arch].get(key) || 0) + 1);
          }
        }
        buckets.general.set(key, (buckets.general.get(key) || 0) + 1);
      }
    }
  }
  return buckets;
}

function topKeywords(map, n = 28) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function baseExperience() {
  return [
    {
      company: 'SigmaX Labs',
      role: 'Founder & AI Solutions Consultant',
      location: 'Gurugram, India',
      dates: 'Nov 2025 -- Present',
      bullets: [],
    },
    {
      company: 'The Goodtime Co.',
      role: 'Co-founder',
      location: 'Delhi-NCR, India',
      dates: 'May 2025 -- Oct 2025',
      bullets: [],
    },
    {
      company: 'Deloitte USI',
      role: 'Consultant',
      location: 'Gurugram, India',
      dates: 'Sep 2022 -- Oct 2024',
      bullets: [],
    },
    {
      company: 'Synergy Teletech Pvt Ltd',
      role: 'Field Executive',
      location: 'India',
      dates: 'Jun 2017 -- Jun 2019',
      bullets: ['Led IoT integration across 50+ refuelling trucks, 25% SLA improvement'],
    },
    {
      company: 'InstaCure',
      role: 'Business Associate',
      location: 'India',
      dates: 'May 2016 -- May 2017',
      bullets: ['Health-tech startup; regional sales operations, 30% vendor base growth'],
    },
  ];
}

function buildPayload(archetype, mined) {
  const kw = topKeywords(mined[archetype]);
  const exp = baseExperience();

  // One line, <= 20 words, no metric stacking — a peer review flagged the
  // previous 60-word data dump as the first thing a reader hit. Per
  // modes/_custom.md "Summary — one line, no metric stacking". The keyword
  // tail that used to be appended here is deliberately gone: a list labelled
  // "Core themes from recent target roles" advertises itself as machine-written.
  const summaries = {
    'ai-product-manager':
      'AI product manager - GxP delivery discipline, hands-on LLM agents.',
    'solutions-consultant':
      'AI solutions consultant designing and shipping automation for regulated industries.',
    'startup-ops':
      'Founder of two ventures - one events business, one AI automation agency.',
    'strategy-mid':
      'Structured problem-solving backed by regulated-industry delivery experience.',
    general:
      'AI product manager and solutions consultant, grounded in GxP-regulated delivery.',
  };

  // PM lanes carry the full PM spine — that is what target JDs and ATS keyword
  // screens look for. Tool names stay in the Skills block: a competencies line
  // reading "Proficient in n8n..." advertises a tool list where a recruiter
  // expects a job description. "Outcome Measurement", never "A/B testing" —
  // see modes/_custom.md "Competencies — PM spine, tools in Skills".
  const competencies = {
    'ai-product-manager': [
      'Product Discovery & User Research',
      'Requirements, PRDs & User Stories',
      'Product Roadmapping & Prioritisation',
      'Agile/Scrum & Cross-functional Delivery',
      'Stakeholder Management & Alignment',
      'Product Analytics, KPIs & Outcome Measurement',
      'Product Lifecycle Ownership',
      'GxP-regulated Product Delivery',
    ],
    'solutions-consultant': [
      'Stakeholder Management & Alignment',
      'Client Discovery & Scoping',
      'Requirements, PRDs & User Stories',
      'Pre-Sales Solution Design',
      'Workshop Facilitation',
      'Solutions Architecture & Integration',
      'Agile Product Delivery',
      'GxP-regulated Delivery',
    ],
    'startup-ops': [
      'Startup Operations',
      'Founder-Track Execution',
      'Go-To-Market Planning',
      'Vendor Coordination',
      'Engagement Design',
      'Limited Budgeting & Monetisation',
      'Revenue Responsibility',
      'Cross-functional Leadership',
      'AI Tooling & Automation',
      'Metric-Driven Reporting',
    ],
    'strategy-mid': [
      'Structured Problem-Solving',
      'Market & Competitor Analysis',
      'Client / Stakeholder Storytelling',
      'Data & KPI Thinking',
      'Slide & Deliverable Discipline',
      'Regulated-Industry Workflows',
      'Agile Delivery',
      'Workshop Facilitation',
      'Strategic Roadmapping',
      'MBA Problem-Solving Frameworks',
    ],
    general: [
      'Product Management',
      'Solutions Consulting',
      'Agile Delivery',
      'Stakeholder Management',
      'LLM Workflow Automation',
      'GxP / Compliance',
      'Data & Analytics',
      'Cross-functional Execution',
      'Technical Feasibility',
      'B2B SaaS',
    ],
  };

  const sigmaBullets = {
    'ai-product-manager': [
      'Founded SigmaX Labs after an events venture exposed that ops-heavy businesses still run on spreadsheets and WhatsApp groups; now ships fixed-scope AI automation sprints for Indian SMEs',
      'Built Hermes-Router, a Node/Express model router over OpenRouter with cost/quality routing and fallback chains',
      'Designed Basilica intake-to-reporting prototype (n8n + Google Sheets + Telegram) for an interior design firm, from brief to approved workflow spec',
      'Shipped kbcompress.com (client-side image compression for Indian exam portal upload limits)',
      'Scoped RRM Mobility operations-agent specification: Hindi voice agent for fleet coordination (proposal stage)',
    ],
    'solutions-consultant': [
      'Run SigmaX Labs: client discovery, solution scoping, and fixed-scope automation delivery for SMEs',
      'Basilica engagement: workshops, requirements capture, and working prototype replacing manual spreadsheet handoffs',
      'RRM Mobility: proposed ops-agent and LinkedIn analytics approach for EV fleet operations (proposal stage)',
      'Built sigmaxlabs.in and kbcompress.com as proof-of-delivery samples for prospects',
      'Hermes-Router: internal routing layer reused across client automations and agent tooling',
    ],
    'startup-ops': [
      'Founded and run an AI-ops automation consultancy: end-to-end pipeline from discovery to shipped automation sprints',
      'Ran the founding playbook: product positioning, pricing, client acquisition, and delivery in a single-operator model',
      'Shipped kbcompress.com and sigmaxlabs.in as product-market signals for a solo founder',
      'Built Hermes-Router (OpenRouter model routing) internally',
    ],
    'strategy-mid': [
      'Founded an AI-ops consultancy and held every strategy role: market scoping, offer design, client sales narrative',
      'Produced strategy-to-ship deliverables: proposals, CLIENT-READY scoping docs, and decision-ready prototypes',
    ],
    general: [
      'Founded and run an AI-ops automation consultancy serving Indian SMEs',
      'Built Hermes-Router (model router), kbcompress.com, and sigmaxlabs.in',
      'Basilica: n8n + Google Sheets + Telegram intake-to-reporting prototype (built, pending go-live)',
      'RRM Mobility: LinkedIn automation and operations-agent specification (proposal stage)',
    ],
  };

  // Goodtime is dormant and past tense. No capital language, and never any
  // claim about profitability in either direction — see modes/_custom.md
  // "The Goodtime Co. — the guard".
  const goodtimeBullets = {
    'startup-ops': [
      'Co-founded and ran an experiential events venture with one full-time and one part-time co-founder, handling every operations function between the two of us; launched the first flagship event 5 Jul 2025 (venture now dormant)',
      'Ran the business on spreadsheets, WhatsApp groups and cold confirmations; built spreadsheet automation and Google Sheets scripting to cut the manual handoff work -- the capability later sold to clients',
    ],
    general: [
      'Co-founded and ran an experiential events venture May--Oct 2025 (one full-time, one part-time co-founder, all ops handled between the two); ran it on spreadsheets, WhatsApp groups and cold confirmations, and automated the manual handoffs; first flagship event 5 Jul 2025 (now dormant)',
    ],
  };

  // The NMT bullet is present in EVERY lane and is never trimmed — it anchors
  // the Deloitte tenure and the GxP moat. Wording is precision-controlled: the
  // client was GxP-regulated, he did not perform validation. So "a GxP-
  // regulated client depended on" and "validation-ready", never "GxP-compliant"
  // or "validated". See modes/_custom.md "NMT — the GxP precision rule".
  const deloitteBullets = {
    'ai-product-manager': [
      'Drove Agile development of a bilingual Donor Engagement Portal; 25% faster release cycles; 18% client retention via 20+ features from user feedback',
      'Delivered SPARK analytics MVP for real-time clinical and regulatory KPIs; $500K projected cost savings',
      'Owned migration of the Network Modelling Tool, a system a GxP-regulated client depended on for supply operations -- designed the architecture and phased cutover that kept it running through day one',
      'Improved CI/CD pipelines, cutting deployment time 40%; redesigned reporting modules for 35% better data accuracy',
      'Applause Award, 2023',
    ],
    'solutions-consultant': [
      'Delivered system architecture, analytics, and agile product work for US life-sciences clients on US standards from Gurgaon',
      'Translated donor and clinical stakeholder feedback into shipped portal features (20+ releases)',
      'SPARK analytics MVP: real-time KPI visibility for regulated clinical teams; $500K projected savings',
      'Network Modelling Tool migration for a GxP-regulated client: owned architecture, integration, and validation-ready phased cutover planning that preserved supply continuity on day one',
      'Applause Award, 2023',
    ],
    'startup-ops': [
      'Delivered on US-client standards and hours from Gurgaon; 18% retention lift and 25% faster release cycles on the Donor Portal',
      'Owned the KPI and reporting story (SPARK analytics MVP, $500K projected savings) an operator reads',
      'Network Modelling Tool cutover for a GxP-regulated client: owned the architecture and phased cutover that preserved supply continuity on day one',
    ],
    'strategy-mid': [
      'Structured, evidence-driven delivery in a GxP-regulated life-sciences environment; translated stakeholder feedback into shipped features',
      'SPARK analytics MVP: KPI visibility for regulated clinical teams; $500K projected cost savings',
      'Network Modelling Tool migration for a GxP-regulated client: architecture, integration, and validation-ready phased cutover planning',
    ],
    general: [
      'Owned migration and integration of the Network Modelling Tool, a system a GxP-regulated client depended on for supply operations, with a phased cutover preserving day-one continuity',
      'Drove Agile development of a bilingual Donor Engagement Portal; 25% faster release cycles; 18% client retention improvement via 20+ features shipped from user feedback',
      'Delivered the SPARK analytics MVP for real-time clinical and regulatory KPIs -- $500K projected cost savings',
      'Optimised CI/CD pipelines, cutting deployment time 40%; redesigned reporting modules for 35% better data accuracy',
      'Applause Award, 2023',
    ],
  };

  exp[0].bullets = sigmaBullets[archetype] || sigmaBullets.general;
  exp[1].bullets = goodtimeBullets[archetype] || goodtimeBullets.general;
  exp[2].bullets = deloitteBullets[archetype] || deloitteBullets.general;

  // Every lane's skills block must carry a GxP/regulated line — it is the
  // differentiator, and a lane without it reads as a generic AI candidate.
  // See modes/_custom.md "GxP / regulated line — mandatory in every lane".
  const skillSets = {
    'ai-product-manager': [
      { category: 'AI / automation', items: ['LLM agents', 'RAG', 'MCP', 'prompt engineering', 'OpenRouter', 'n8n', 'model evaluation and routing', 'human-in-the-loop', 'workflow automation'] },
      { category: 'Product', items: ['product discovery and user research', 'requirements and PRDs', 'user stories', 'roadmapping', 'backlog prioritisation', 'Agile/Scrum', 'product analytics and outcome measurement'] },
      { category: 'Regulated', items: ['GxP', 'validation and audit-ready workflows', 'data integrity', 'risk management'] },
      { category: 'Technical', items: ['Node/Express', 'Python', 'Supabase', 'Vercel', 'API integration', 'Google Workspace automation'] },
    ],
    'solutions-consultant': [
      { category: 'Consulting', items: ['client discovery', 'solution scoping', 'workshops', 'requirements and PRDs', 'user stories', 'stakeholder management', 'pre-sales support'] },
      { category: 'Regulated', items: ['GxP', 'life sciences', 'validation-ready workflows', 'data integrity', 'risk management'] },
      { category: 'Delivery', items: ['Agile/Scrum', 'cross-functional execution', 'analytics MVP delivery', 'CI/CD improvement', 'solution architecture', 'API integration'] },
    ],
    'startup-ops': [
      { category: 'Operating', items: ['go-to-market', 'vendor management', 'monetisation design', 'budgeting basics', 'team coordination', 'event operations'] },
      { category: 'AI / automation', items: ['n8n', 'LLM agent design', 'API integration', 'workflow automation', 'prompt engineering'] },
      { category: 'Regulated', items: ['GxP', 'regulated-industry delivery', 'data integrity', 'risk management'] },
      { category: 'Foundation', items: ['MBA (IIM Rohtak)', 'Deloitte USI discipline', 'stakeholder management', 'cross-functional execution'] },
    ],
    'strategy-mid': [
      { category: 'Strategy', items: ['structured problem-solving', 'market sizing', 'competitor analysis', 'strategic roadmapping', 'slide discipline', 'deliverable quality'] },
      { category: 'Regulated', items: ['GxP', 'life sciences', 'regulated-industry workflows', 'data integrity'] },
      { category: 'Foundation', items: ['MBA (IIM Rohtak)', 'data & KPI thinking', 'agile delivery', 'workshop facilitation'] },
    ],
    general: [
      { category: 'AI/automation', items: ['n8n', 'LLM agent design', 'RAG', 'MCP', 'prompt engineering', 'OpenRouter', 'API integration'] },
      { category: 'Product', items: ['discovery and user research', 'requirements and PRDs', 'user stories', 'roadmapping', 'backlog prioritisation', 'Agile/Scrum delivery', 'product analytics and outcome measurement', 'stakeholder management'] },
      { category: 'Regulated', items: ['GxP', 'validation and audit-ready workflows', 'data integrity', 'risk management'] },
      { category: 'Technical', items: ['Node/Express (hands-on)', 'Python (working fluency)', 'Supabase', 'Vercel'] },
    ],
  };

  const CLEARSTATE_URL = 'https://quilt-cuckoo-1da.notion.site/ClearState-Case-Study-30921d15774880c7b862e0c8e08eefca';

  const projects = {
    'ai-product-manager': [
      { name: 'Hermes-Router', badge: 'Model routing', tech: 'Node/Express, OpenRouter', description: 'Task-classification layer routing prompts to the cheapest capable model; React dashboard for routing decisions' },
      { name: 'kbcompress.com', badge: 'Shipped', tech: 'Next.js, Vercel', description: 'Client-side image compression to exact KB targets for Indian exam portal uploads' },
      { name: 'ClearState', badge: 'Case study', url: CLEARSTATE_URL, tech: 'Cloudflare Workers, Granite 4.0', description: 'Governance-aware executive reporting: position isolation, governance gating before AI access, constrained rewrite' },
    ],
    'solutions-consultant': [
      { name: 'SPARK Analytics MVP', badge: 'Deloitte / GxP', tech: 'Analytics', description: 'Real-time clinical and regulatory KPI dashboard; $500K projected cost savings' },
      { name: 'Donor Engagement Portal', badge: 'Agile delivery', tech: 'Bilingual product', description: '20+ features from user feedback; 25% faster releases; 18% retention lift' },
      { name: 'kbcompress.com', badge: 'Shipped', tech: 'Web app', description: 'Free image compression tool for Indian exam portal upload limits' },
      { name: 'ClearState', badge: 'Case study', url: CLEARSTATE_URL, tech: 'Cloudflare Workers, Granite 4.0', description: 'Governance-aware reporting prototype; the first shipped build under SigmaX Labs (Feb 2026)' },
    ],
    'startup-ops': [
      { name: 'ClearState', badge: 'Case study', url: CLEARSTATE_URL, tech: 'Cloudflare Workers', description: 'Governance-aware executive reporting prototype (position isolation, governance gating); first shipped build under SigmaX Labs, Feb 2026 -- three months after the company was founded in Nov 2025' },
      { name: 'kbcompress.com', badge: 'Shipped', tech: 'Web app', description: 'Free image compression tool for Indian exam portal upload limits' },
      { name: 'Hermes-Router', badge: 'SigmaX tool', tech: 'Node/Express', description: 'Model router over OpenRouter for client automations' },
    ],
    'strategy-mid': [
      { name: 'SPARK Analytics MVP', badge: 'Deloitte / GxP', tech: 'Analytics', description: 'Real-time clinical and regulatory KPI dashboard; $500K projected cost savings' },
      { name: 'ClearState', badge: 'Case study: strategy-to-ship', url: CLEARSTATE_URL, tech: 'Governance prototype', description: 'From positioning to shipped prototype in ~1 month; the first shipped build under SigmaX Labs (Feb 2026)' },
    ],
    general: [
      { name: 'Hermes-Router', badge: 'SigmaX', tech: 'Node/Express', description: 'Model router over OpenRouter for client automations' },
      { name: 'SPARK Analytics MVP', badge: 'Deloitte', tech: 'Regulated analytics', description: '$500K projected cost savings from real-time KPI visibility' },
      { name: 'kbcompress.com', badge: 'Shipped', tech: 'Web app', description: 'Free image compression tool for exam portal upload limits' },
      { name: 'ClearState', badge: 'Case study', url: CLEARSTATE_URL, tech: 'Cloudflare Workers', description: 'Governance-aware executive reporting prototype; the first shipped build under SigmaX Labs (Feb 2026)' },
    ],
  };

  // No keyword tail here. See the note above `summaries`: appending mined
  // report keywords to a CV summary reads as machine-written and costs more
  // credibility than the keywords win. The mined keywords still reach
  // keywords.tsv per lane, which is where an evaluator can use them.
  const summary = summaries[archetype];

  return {
    lang: 'en',
    page_format: 'a4',
    candidate: BASE_CANDIDATE,
    headline: LANE_HEADLINES[archetype] || LANE_HEADLINES.general,
    style: LANE_STYLES[archetype] || LANE_STYLES.general,
    summary,
    competencies: competencies[archetype],
    experience: exp,
    projects: projects[archetype],
    education: [
      { title: 'MBA', org: 'Indian Institute of Management Rohtak', year: '2020 -- 2022' },
      { title: 'B.Tech (Biotechnology)', org: 'Delhi Technological University -- formerly Delhi College of Engineering', year: '2012 -- 2016' },
    ],
    certifications: [
      { title: 'IBM AI Product Manager Professional Certificate', org: 'IBM', year: '2026' },
      { title: 'AI Fluency Framework & Foundations', org: 'Anthropic', year: '2026' },
      { title: 'AI for Marketers', org: 'HubSpot Academy', year: '2026' },
    ],
    skills: skillSets[archetype],
  };
}

function payloadToMarkdown(payload) {
  const lines = [`# CV -- ${payload.candidate.name}`, ...(payload.headline ? [`*${payload.headline}*`] : []), '', payload.summary, '', '## Work Experience'];
  for (const job of payload.experience) {
    lines.push('', `### ${job.company}`, `**${job.role}** | ${job.dates}`, ...(job.bullets || []).map((b) => `- ${b}`));
  }
  if (payload.projects?.length) {
    lines.push('', '## Projects and Case Studies');
    for (const p of payload.projects) lines.push(`- **${p.name}** (${p.badge || p.tech}): ${p.description}`);
  }
  lines.push('', '## Education');
  for (const e of payload.education) lines.push(`- ${e.title}, ${e.org} (${e.year})`);
  lines.push('', '## Certifications');
  for (const c of payload.certifications) lines.push(`- ${c.title}, ${c.org} (${c.year})`);
  lines.push('', '## Skills');
  for (const s of payload.skills || []) {
    const items = Array.isArray(s.items) ? s.items : String(s.items ?? '').split(/,\s*/).filter(Boolean);
    lines.push(`- **${s.category}:** ${items.join(', ')}`);
  }
  return lines.join('\n') + '\n';
}

function writeKeywordsTsv(path, mined, arch) {
  const rows = [...mined[arch].entries()].sort((a, b) => b[1] - a[1]);
  const lines = ['keyword\treport_hits', ...rows.map(([k, n]) => `${k}\t${n}`)];
  writeFileSync(path, lines.join('\n') + '\n');
}

async function renderSet(slug, payload, mined) {
  const dir = join(OUT_BASE, slug);
  mkdirSync(dir, { recursive: true });

  let { payload: pinned } = injectPinnedExperience(payload);
  // Pre-built master sets are already one-page dense — skip cv.md backfill to avoid duplicate bullets.
  const { payload: final } = humanizeCvPayload(pinned);

  const jsonPath = join(dir, 'cv.json');
  const mdPath = join(dir, 'cv.md');
  const htmlPath = join(dir, 'cv.html');
  const pdfPath = join(dir, 'cv.pdf');
  const kwPath = join(dir, 'keywords.tsv');

  writeFileSync(jsonPath, JSON.stringify(final, null, 2) + '\n');
  writeFileSync(mdPath, payloadToMarkdown(final));
  writeKeywordsTsv(kwPath, mined, slug);

  const html = spawnSync(process.execPath, ['build-cv-html.mjs', jsonPath, htmlPath], { cwd: DATA_ROOT, encoding: 'utf-8' });
  if (html.status !== 0) throw new Error(`build-cv-html failed for ${slug}: ${html.stderr || html.stdout}`);
  if (final.style) {
    // Mirror the lane accent into the HTML artifact (the PDF already reads the
    // same tokens via generate_cv_pdf.py), so preview == print.
    let themed = injectThemeStyle(readFileSync(htmlPath, 'utf-8'), styleTokensFrom(final.style));
    themed = themed.replace(
      '</head>',
      '<style id="career-ops-master-lane">.header-lane{font-size:10.5px;line-height:1.4;color:var(--accent-color,#0b6e8f);margin:2px 0 6px;font-weight:600}</style>\n</head>',
    );
    writeFileSync(htmlPath, themed);
  }
  if (final.headline) {
    // Header line under the name, matching the PDF renderer's headline slot.
    const htmlText = readFileSync(htmlPath, 'utf-8');
    const tagged = htmlText.includes('<div class="header-lane">')
      ? htmlText
      : htmlText.replace('  <div class="header-gradient"></div>', `  <div class="header-lane">${escapeHtml(final.headline)}</div>\n    <div class="header-gradient"></div>`);
    writeFileSync(htmlPath, tagged);
  }

  const pdf = spawnSync(process.execPath, ['generate-pdf.mjs', jsonPath, pdfPath, '--format=a4', '--max-pages=1'], {
    cwd: DATA_ROOT,
    encoding: 'utf-8',
  });
  if (pdf.status !== 0) throw new Error(`generate-pdf failed for ${slug}: ${pdf.stderr || pdf.stdout}`);

  console.log(`✅ ${slug}: ${pdfPath}`);
  return dir;
}

async function main() {
  const mined = mineKeywordsFromReports();
  const sets = [...LANES, 'general'];
  console.log(`Mining: ${[...mined.general.keys()].length} unique keywords from reports`);
  for (const slug of sets) {
    const payload = buildPayload(slug, mined);
    await renderSet(slug, payload, mined);
  }
  console.log(`\nDone — ${sets.length} master CV lane sets in ${OUT_BASE}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
