#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read Profile
let profile = {
  candidate: {
    full_name: "Venkateswarlu Pambha (Venky)",
    email: "venkateswarlupambha3@gmail.com",
    phone: "+44 75534 09836",
    location: "London, United Kingdom",
    linkedin: "https://linkedin.com/in/venkateswarlu-pambha03",
    portfolio_url: "https://venkateswarlupambha.netlify.app",
    github: "https://github.com/venkateswarlupambha"
  },
  narrative: {
    headline: "MSc CS graduate (Distinction) & AZ-900 Certified IT Support Engineer",
    exit_story: "Hands-on experience in 1st-line IT support, Jira ticketing, Active Directory, and network diagnostics with an MSc in Computer Science (Distinction)."
  },
  compensation: {
    target_range: "£28,000 - £35,000",
    currency: "GBP"
  },
  location: {
    visa_status: "Graduate Route (PSW) visa -- full right to work in the UK (no sponsorship required)"
  }
};

try {
  const profileYaml = fs.readFileSync(path.join(__dirname, 'config/profile.yml'), 'utf8');
  const loaded = yaml.load(profileYaml);
  if (loaded) profile = { ...profile, ...loaded };
} catch (e) {
  console.warn('Could not load profile.yml, using defaults', e.message);
}

// Read Applications Tracker
const appsMdPath = path.join(__dirname, 'data/applications.md');
let applications = [];

if (fs.existsSync(appsMdPath)) {
  const appsContent = fs.readFileSync(appsMdPath, 'utf8');
  const lines = appsContent.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('|---|') || line.includes('| # |')) continue;
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 7) {
      const id = parts[0];
      const date = parts[1];
      const company = parts[2];
      const role = parts[3];
      const score = parseFloat(parts[4]) || 0;
      const status = parts[5];
      const pdfMarker = parts[6];
      const reportMatch = parts[7] ? parts[7].match(/\((.*?)\)/) : null;
      const reportRelPath = reportMatch ? reportMatch[1] : '';
      const notes = parts[8] || '';

      applications.push({
        id,
        date,
        company,
        role,
        score,
        status,
        pdfMarker,
        reportRelPath,
        notes
      });
    }
  }
}

// Read Reports & Assets with clean string parsing
const reportsDir = path.join(__dirname, 'reports');
const outputDir = path.join(__dirname, 'output');

for (const app of applications) {
  let reportData = {
    url: '',
    archetype: 'IT Support & Helpdesk',
    comp: '',
    tldr: '',
    keySkills: ['Jira Ticketing', 'Active Directory & RBAC', 'Network Diagnostics (TCP/IP)', 'SynthView Tool'],
    cultureScreen: 'Pass',
    legitimacy: 'High Confidence'
  };

  const reportFiles = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir) : [];
  const matchingReport = reportFiles.find(f => f.toLowerCase().includes(app.company.toLowerCase()) && f.endsWith('.md'));

  if (matchingReport) {
    const reportText = fs.readFileSync(path.join(reportsDir, matchingReport), 'utf8');
    const urlMatch = reportText.match(/\*\*URL:\*\*\s*(https?:\/\/[^\s]+)/i);
    if (urlMatch) reportData.url = urlMatch[1];

    const compMatch = reportText.match(/advertised_comp:\s*["']?([^"'\n]+)["']?/i) || reportText.match(/\|\s*\*\*Compensation\*\*\s*\|\s*([^|]+)\|/i);
    if (compMatch && compMatch[1] && compMatch[1].trim() !== 'null') reportData.comp = compMatch[1].trim();

    const archetypeMatch = reportText.match(/archetype:\s*["']?([^"'\n]+)["']?/i) || reportText.match(/\*\*Archetype:\*\*\s*([^\n]+)/i);
    if (archetypeMatch) reportData.archetype = archetypeMatch[1].replace(/[*_#]/g, '').trim();

    const tldrMatch = reportText.match(/\|\s*\*\*TL;DR\*\*\s*\|\s*([^|]+)\|/i);
    if (tldrMatch) reportData.tldr = tldrMatch[1].replace(/[*_#]/g, '').trim();
  }

  const pdfFiles = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : [];
  const matchingPdf = pdfFiles.find(f => f.toLowerCase().includes(app.company.toLowerCase()) && f.endsWith('.pdf'));

  app.details = reportData;
  app.pdfFile = matchingPdf ? `output/${matchingPdf}` : null;
  app.jobUrl = reportData.url || '#';

  // Build Tailored Cover Letter
  app.coverLetter = `Dear ${app.company} Hiring Team,

I am writing to express my enthusiastic interest in the ${app.role} role at ${app.company}. With a Master's degree in Computer Science (Distinction) from the University of East London, Microsoft Azure AZ-900 certification, and hands-on experience in 1st-line IT support, Jira ticketing, Active Directory administration, and network troubleshooting, I am confident in my ability to deliver prompt, user-centric technical resolutions for ${app.company}'s team.

In my previous IT support role at MYAC PVT LTD, I managed service desk queues, investigated hardware/software and connectivity incidents, administered user onboarding/offboarding via Active Directory and RBAC, and maintained strict SLAs. Furthermore, my hands-on networking foundation—demonstrated through tools like SynthView (an automated network traffic inspection tool in Go and React) and deep packet analysis (TCP/IP, DNS, DHCP, Wireshark)—enables me to rapidly diagnose underlying system anomalies and escalate with structured technical logs.

I hold unrestricted full UK working rights under the Graduate Route (PSW) visa (no sponsorship required) and am based in London, ready to contribute immediately to ${app.company}. I welcome the opportunity to discuss how my technical troubleshooting foundation and dedication to operational excellence will support your team.

Thank you for your time and consideration.

Warm regards,
Venkateswarlu Pambha (Venky)
${profile.candidate.email} | ${profile.candidate.phone} | ${profile.candidate.location}
${profile.candidate.linkedin}`;

  // Build ATS Field Suggestions
  app.formSuggestions = [
    {
      label: "Why do you want to work at " + app.company + "?",
      field: "why_company",
      answer: `I am deeply inspired by ${app.company}'s high-standard engineering and mission. As an IT Support professional with an MSc in Computer Science (Distinction), I thrive in dynamic environments where IT support directly empowers high-performing teams through frictionless tooling, proactive system maintenance, and rapid issue resolution.`
    },
    {
      label: "Why are you a strong fit for the " + app.role + " position?",
      field: "why_fit",
      answer: `I bring hands-on experience in 1st-line IT support, Jira ticketing, user lifecycle management via Active Directory (RBAC), and network diagnostics (TCP/IP, DNS, DHCP, Wireshark). In addition, I built SynthView (an automated network traffic analysis tool in Go and React), proving my capability to automate workflows and diagnose complex technical issues.`
    },
    {
      label: "Describe your experience with user provisioning & Active Directory / Access Management.",
      field: "ad_experience",
      answer: `At MYAC PVT LTD, I managed user account provisioning, role-based access control (RBAC), password resets, and permission groups in Active Directory. I ensured rapid onboarding/offboarding while enforcing security policies and compliance.`
    },
    {
      label: "What is your experience with network troubleshooting and diagnostics?",
      field: "network_experience",
      answer: `I have extensive hands-on experience diagnosing connectivity issues using TCP/IP, DNS, DHCP, Wireshark, ping, and traceroute. I also developed SynthView, an automated network traffic inspection application in Go and React that streamlined packet validation.`
    },
    {
      label: "What is your UK Work Authorization status?",
      field: "work_auth",
      answer: `I hold a UK Graduate Route (PSW) visa with full, unrestricted right to work in the United Kingdom. No visa sponsorship is required.`
    },
    {
      label: "What are your salary expectations?",
      field: "salary",
      answer: app.details.comp ? `Advertised: ${app.details.comp} (Open to market rate for the role)` : `Target: £28,000 - £35,000 per annum (Open to standard company compensation bands)`
    },
    {
      label: "What is your notice period / availability?",
      field: "notice_period",
      answer: `Immediate availability / 1-2 weeks.`
    }
  ];

  // Follow-up Draft
  app.followupEmail = `Subject: Following up on application: ${app.role} - Venkateswarlu Pambha (Venky)

Hi ${app.company} Recruiting Team,

I hope you are having a productive week.

I recently submitted my application for the ${app.role} position at ${app.company}. I wanted to briefly reiterate my strong interest in joining your team in London. With my hands-on foundation in 1st-line IT support (Jira ticketing, Active Directory, network diagnostics with TCP/IP & SynthView) and an MSc in Computer Science (Distinction), I am eager to help maintain frictionless IT operations for ${app.company}.

I hold full UK working rights under the Graduate Route visa (no sponsorship needed) and would love to connect if there are any additional details or references I can provide.

Thank you again for your time and consideration.

Best regards,
Venkateswarlu Pambha (Venky)
${profile.candidate.email} | ${profile.candidate.phone}`;

  // Prefer a reviewed, report-specific application snapshot when one exists.
  // This keeps the dashboard synchronized with application-answers.mjs instead
  // of showing generic generated suggestions for a role with saved answers.
  const answerSlug = app.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const answerPath = path.join(outputDir, `${answerSlug}-application-answers.json`);
  if (fs.existsSync(answerPath)) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(answerPath, 'utf8'));
      const items = [
        ...(snapshot.freeText || []).map((item, index) => ({ label: item.question, field: `free_${index}`, answer: item.answer, category: 'Written answer' })),
        ...(snapshot.selections || []).map((item, index) => ({ label: item.question, field: `selection_${index}`, answer: item.selection, category: 'Dropdown selection' })),
        ...(snapshot.fieldValues || []).map((item, index) => ({ label: item.field, field: `field_${index}`, answer: item.value, category: 'Personal detail' })),
        ...(snapshot.files || []).map((item, index) => ({ label: item.field, field: `file_${index}`, answer: item.file, category: item.variant || 'File' })),
      ];
      if (items.length) app.formSuggestions = items;
      const cover = (snapshot.freeText || []).find(item => /cover letter|additional information/i.test(item.question));
      if (cover?.answer) app.coverLetter = cover.answer;
      app.applicationAnswerState = snapshot.state || 'draft';
      app.applicationAnswerDate = snapshot.date || '';
    } catch (error) {
      console.warn(`Could not load ${answerPath}: ${error.message}`);
    }
  }
}

// Convert data safely for web script
const appsJsonEscaped = JSON.stringify(applications).replace(/</g, '\\u003c');
const profileJsonEscaped = JSON.stringify(profile).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Venky — Job Command Center</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: {
              50: '#f0fdf4',
              500: '#10b981',
              600: '#059669',
              700: '#047857',
              900: '#064e3b',
            }
          }
        }
      }
    }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    code, pre, .font-mono { font-family: 'JetBrains Mono', monospace; }
    .glass-panel {
      background: rgba(15, 23, 42, 0.9);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .glass-card {
      background: rgba(30, 41, 59, 0.75);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 9999px; }
    button, a, select, input { cursor: pointer; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen antialiased selection:bg-emerald-500 selection:text-slate-950 flex flex-col">

  <!-- Background Gradients -->
  <div class="fixed top-0 left-1/4 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -z-10"></div>
  <div class="fixed top-1/2 right-10 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl pointer-events-none -z-10"></div>

  <!-- Top Header Navigation -->
  <header class="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row items-center justify-between gap-4">

      <div class="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 flex items-center justify-center font-black text-xl shadow-lg shadow-emerald-500/20">
            V
          </div>
          <div>
            <h1 class="text-lg font-black text-white tracking-tight flex items-center gap-2">
              Venky <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono font-bold">IT Support Command Center</span>
            </h1>
            <p class="text-[11px] text-slate-400">Venkateswarlu Pambha • London, UK</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>
            PSW Visa (Full UK Work Rights)
          </span>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <nav class="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800 overflow-x-auto max-w-full custom-scrollbar">
        <button type="button" onclick="switchTab('tracker')" id="nav-tracker" class="nav-tab px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all bg-emerald-500 text-slate-950 shadow-md flex items-center gap-1.5">
          <span>💼</span> Applications Tracker
        </button>
        <button type="button" onclick="switchTab('forms')" id="nav-forms" class="nav-tab px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center gap-1.5">
          <span>📝</span> ATS Form Answers
        </button>
        <button type="button" onclick="switchTab('covers')" id="nav-covers" class="nav-tab px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center gap-1.5">
          <span>✍️</span> Cover Letters
        </button>
        <button type="button" onclick="switchTab('followups')" id="nav-followups" class="nav-tab px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center gap-1.5">
          <span>📅</span> Follow-Up Cadence
        </button>
        <button type="button" onclick="switchTab('scanner')" id="nav-scanner" class="nav-tab px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center gap-1.5">
          <span>🔍</span> 120+ Portal Scanner
        </button>
      </nav>

    </div>
  </header>

  <!-- Main Body Content -->
  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">

    <!-- TAB 1: APPLICATIONS TRACKER -->
    <div id="tab-tracker" class="tab-content space-y-6">

      <!-- Metrics Bar -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="glass-panel p-4 rounded-2xl border-l-4 border-emerald-500 shadow-lg">
          <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Top Match Score</span>
          <div class="text-2xl sm:text-3xl font-extrabold text-white flex items-baseline gap-1.5">
            4.8 <span class="text-xs font-mono text-emerald-400">/ 5.0</span>
          </div>
          <p class="text-[11px] text-slate-400">Anthropic — IT Support</p>
        </div>

        <div class="glass-panel p-4 rounded-2xl border-l-4 border-blue-500 shadow-lg">
          <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total Active Roles</span>
          <div class="text-2xl sm:text-3xl font-extrabold text-white flex items-baseline gap-1.5" id="totalAppsCount">
            ${applications.length} <span class="text-xs font-normal text-blue-400">Roles</span>
          </div>
          <p class="text-[11px] text-slate-400">Avg match: 4.7 / 5.0</p>
        </div>

        <div class="glass-panel p-4 rounded-2xl border-l-4 border-purple-500 shadow-lg">
          <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Tailored CVs Ready</span>
          <div class="text-2xl sm:text-3xl font-extrabold text-white flex items-baseline gap-1.5">
            ${applications.filter(a => a.pdfFile).length} <span class="text-xs font-normal text-purple-400">PDFs</span>
          </div>
          <p class="text-[11px] text-slate-400">ATS keyword matched</p>
        </div>

        <div class="glass-panel p-4 rounded-2xl border-l-4 border-amber-500 shadow-lg">
          <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Jobs Applied</span>
          <div class="text-2xl sm:text-3xl font-extrabold text-white flex items-baseline gap-1.5">
            <span id="appliedJobsCount">—</span> <span class="text-xs font-normal text-amber-400">Applications</span>
          </div>
          <p id="nextFollowupSummary" class="text-[11px] text-slate-400">Loading follow-up schedule…</p>
        </div>
      </div>

      <!-- Controls & Filter Bar -->
      <div class="glass-panel p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
        <div class="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 custom-scrollbar">
          <button type="button" onclick="setFilter('all')" id="btn-filter-all" class="app-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 text-slate-950 transition-all">
            All (<span id="allCount">${applications.length}</span>)
          </button>
          <button type="button" onclick="setFilter('Evaluated')" id="btn-filter-Evaluated" class="app-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all">
            Evaluated (<span id="evaluatedCount">${applications.filter(a => a.status === 'Evaluated').length}</span>)
          </button>
          <button type="button" onclick="setFilter('Applied')" id="btn-filter-Applied" class="app-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all">
            Applied (<span id="appliedCount">0</span>)
          </button>
          <button type="button" onclick="setFilter('Interview')" id="btn-filter-Interview" class="app-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all">
            Interviewing (<span id="interviewCount">0</span>)
          </button>
        </div>

        <div class="flex items-center gap-2 w-full md:w-auto">
          <div class="relative flex-1 md:w-64">
            <input type="text" id="appSearch" oninput="renderApplications()" placeholder="Search company, role or skill..." class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 pl-9 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500">
            <svg class="w-4 h-4 text-slate-500 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>
          <button type="button" onclick="openAddJobModal()" class="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 whitespace-nowrap shadow-lg shadow-emerald-600/20">
            <span>➕</span> Add Role
          </button>
        </div>
      </div>

      <!-- Application Cards Container -->
      <div id="applicationsContainer" class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <!-- Rendered via JS -->
      </div>
    </div>

    <!-- TAB 2: ATS FORM ANSWERS & SUGGESTIONS -->
    <div id="tab-forms" class="tab-content hidden space-y-6">
      <div class="glass-panel p-6 rounded-2xl space-y-2">
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              <span>📝</span> ATS Form Field Auto-Fill Assistant
            </h2>
            <p class="text-xs text-slate-400">Click "Copy" on any question to instantly paste tailored answers into Greenhouse, Lever, or Ashby application forms.</p>
          </div>
          <div class="flex items-center gap-2 w-full sm:w-auto">
            <label class="text-xs text-slate-400 font-semibold whitespace-nowrap">Select Role:</label>
            <select id="formRoleSelect" onchange="renderFormAnswers()" class="bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-emerald-400 font-bold focus:outline-none w-full sm:w-auto">
              ${applications.map(a => `<option value="${a.id}">${a.company} — ${a.role}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Form Fields List -->
      <div id="formAnswersContainer" class="space-y-4">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <!-- TAB 3: COVER LETTERS -->
    <div id="tab-covers" class="tab-content hidden space-y-6">
      <div class="glass-panel p-6 rounded-2xl space-y-2">
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              <span>✍️</span> Tailored Cover Letters
            </h2>
            <p class="text-xs text-slate-400">Customized to each employer's requirements with your MSc Distinction, Jira, Active Directory, and SynthView proof points.</p>
          </div>
          <div class="flex items-center gap-2 w-full sm:w-auto">
            <select id="coverRoleSelect" onchange="renderCoverLetter()" class="bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-emerald-400 font-bold focus:outline-none w-full sm:w-auto">
              ${applications.map(a => `<option value="${a.id}">${a.company} — ${a.role}</option>`).join('')}
            </select>
            <button type="button" onclick="copyCurrentCoverLetter()" class="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center gap-1.5 whitespace-nowrap shadow-lg">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
              Copy Full Letter
            </button>
          </div>
        </div>
      </div>

      <!-- Cover Letter Preview Card -->
      <div class="glass-panel p-6 sm:p-8 rounded-2xl relative shadow-2xl">
        <div id="coverLetterContent" class="text-sm leading-relaxed text-slate-200 whitespace-pre-line font-sans max-w-3xl mx-auto bg-slate-900/80 p-6 sm:p-10 rounded-xl border border-slate-800 shadow-inner">
          <!-- Rendered dynamically -->
        </div>
      </div>
    </div>

    <!-- TAB 4: FOLLOW-UP CADENCE -->
    <div id="tab-followups" class="tab-content hidden space-y-6">
      <div class="glass-panel p-6 rounded-2xl space-y-2">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              <span>📅</span> Follow-Up Cadence & Outreach Tracker
            </h2>
            <p class="text-xs text-slate-400">Rule: Day +7 after applying → First polite follow-up. Day +14 → Final check-in.</p>
          </div>
        </div>
      </div>

      <div id="followupsContainer" class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <!-- TAB 5: 120+ PORTAL SCANNER -->
    <div id="tab-scanner" class="tab-content hidden space-y-6">
      <div class="glass-panel p-6 sm:p-8 rounded-2xl space-y-4">
        <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              <span>🔍</span> 120+ Portal Zero-Token Scanner
            </h2>
            <p class="text-xs text-slate-400">Scans Greenhouse, Lever, and Ashby public API job boards every run with 0 LLM cost.</p>
          </div>
          <button id="runScanButton" type="button" onclick="runPortalScan()" class="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 flex items-center gap-2 shadow-lg shadow-emerald-500/20">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span id="runScanButtonText">Run Scan Now</span>
          </button>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
          <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span class="text-slate-500 block text-[10px] uppercase font-bold">Total Jobs Checked</span>
            <span id="scanJobsFound" class="text-lg font-bold text-white font-mono">—</span>
          </div>
          <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span class="text-slate-500 block text-[10px] uppercase font-bold">Companies Configured</span>
            <span id="scanCompanies" class="text-lg font-bold text-emerald-400 font-mono">—</span>
          </div>
          <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span class="text-slate-500 block text-[10px] uppercase font-bold">New Matches</span>
            <span id="scanNewJobs" class="text-lg font-bold text-blue-400 font-mono">—</span>
          </div>
          <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span class="text-slate-500 block text-[10px] uppercase font-bold">Target Keywords</span>
            <span class="text-lg font-bold text-purple-400 font-mono">IT Support, Helpdesk</span>
          </div>
        </div>
        <div id="scanStatus" class="text-xs rounded-xl bg-slate-900/80 border border-slate-800 p-3 text-slate-300">Loading latest scan status…</div>
      </div>

      <div class="glass-panel p-6 rounded-2xl space-y-4">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-base font-bold text-white">New & Pending Matches</h3>
          <span id="scanLastUpdated" class="text-[10px] text-slate-500 font-mono">—</span>
        </div>
        <div id="scanPendingJobs" class="space-y-2 text-xs text-slate-400">No pending matches.</div>
      </div>

      <!-- Quick Discovery List -->
      <div class="glass-panel p-6 rounded-2xl space-y-4">
        <h3 class="text-base font-bold text-white">Monitored Tech Companies & ATS Endpoints (Sample)</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 text-xs">
          ${['Anthropic', 'PolyAI', 'Palantir', 'Attio', 'Supabase', 'Synthesia', 'Vercel', 'PlanetScale', 'Stripe', 'Retool', 'Linear', 'Mistral AI', 'Ramp', 'Checkly', 'Datadog', 'Snyk', 'Loom', 'Figma', 'Notion', 'Grafana'].map(c => `
            <div class="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 flex items-center justify-between">
              <span class="font-semibold text-slate-300">${c}</span>
              <span class="text-[10px] font-mono text-emerald-400">Active</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

  </main>

  <!-- Add Job Modal -->
  <div id="addJobModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden">
    <div class="glass-panel rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-700">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold text-white">Add Application to Tracker</h3>
        <button type="button" onclick="closeAddJobModal()" class="text-slate-400 hover:text-white text-xl font-bold">&times;</button>
      </div>

      <div class="space-y-3 text-xs">
        <div>
          <label class="block text-slate-400 font-bold mb-1">Company Name</label>
          <input type="text" id="newCompany" placeholder="e.g. Stripe" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500">
        </div>
        <div>
          <label class="block text-slate-400 font-bold mb-1">Job Title</label>
          <input type="text" id="newRole" placeholder="e.g. IT Support Engineer" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500">
        </div>
        <div>
          <label class="block text-slate-400 font-bold mb-1">Job Posting URL</label>
          <input type="text" id="newUrl" placeholder="https://..." class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-400 font-bold mb-1">Location</label>
            <input type="text" id="newLocation" placeholder="London, UK (Hybrid)" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500">
          </div>
          <div>
            <label class="block text-slate-400 font-bold mb-1">Initial Status</label>
            <select id="newStatus" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500">
              <option value="Evaluated">Evaluated / Ready</option>
              <option value="Applied">Applied</option>
              <option value="Interview">Interview</option>
            </select>
          </div>
        </div>
      </div>

      <div class="pt-3 flex items-center justify-end gap-2">
        <button type="button" onclick="closeAddJobModal()" class="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</button>
        <button type="button" onclick="saveNewJob()" class="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950">Save Role</button>
      </div>
    </div>
  </div>

  <!-- Edit Job Modal -->
  <div id="editJobModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden">
    <div class="glass-panel rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-700">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold text-white">Edit Tracker Entry</h3>
        <button type="button" onclick="closeEditJobModal()" class="text-slate-400 hover:text-white text-xl font-bold">&times;</button>
      </div>
      <input type="hidden" id="editId">
      <div class="space-y-3 text-xs">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block text-slate-400 font-bold mb-1">Company</label><input id="editCompany" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2"></div>
          <div><label class="block text-slate-400 font-bold mb-1">Date</label><input type="date" id="editDate" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2"></div>
        </div>
        <div><label class="block text-slate-400 font-bold mb-1">Job title</label><input id="editRole" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2"></div>
        <div><label class="block text-slate-400 font-bold mb-1">Score</label><input id="editScore" placeholder="4.5 or N/A" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2"></div>
        <div><label class="block text-slate-400 font-bold mb-1">Notes, location and URL</label><textarea id="editNotes" rows="4" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 resize-y"></textarea></div>
      </div>
      <div class="pt-3 flex justify-end gap-2">
        <button type="button" onclick="closeEditJobModal()" class="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800">Cancel</button>
        <button type="button" onclick="saveEditedJob()" class="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 text-slate-950">Save Changes</button>
      </div>
    </div>
  </div>

  <!-- Toast Notification -->
  <div id="toast" class="fixed bottom-6 right-6 bg-emerald-500 text-slate-950 font-bold px-4 py-3 rounded-xl shadow-2xl text-xs flex items-center gap-2 transform translate-y-20 opacity-0 transition-all duration-300 z-50 pointer-events-none">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
    <span id="toastMsg">Action completed!</span>
  </div>

  <!-- Client-side Logic Script -->
  <script>
    // State initialization
    let rawApps = ${appsJsonEscaped};
    let profile = ${profileJsonEscaped};
    let activeFilter = 'all';
    let activityData = { appliedCount: 0, applications: [] };

    // Universal copy helper with fallback for local file:///
    function copyToClipboard(text, successMsg) {
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showToast(successMsg || 'Copied to clipboard!');
        }).catch(() => {
          fallbackCopy(text, successMsg);
        });
      } else {
        fallbackCopy(text, successMsg);
      }
    }

    function fallbackCopy(text, successMsg) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(successMsg || 'Copied to clipboard!');
      } catch (err) {
        showToast('Please select and copy manually.');
      }
    }

    // Load persisted status overrides from localStorage
    function getStoredStatuses() {
      try {
        return JSON.parse(localStorage.getItem('venky_job_statuses') || '{}');
      } catch (e) { return {}; }
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not save the change');
      return payload;
    }

    async function saveStatus(id, newStatus) {
      const app = rawApps.find(a => a.id == id);
      const previous = app ? app.status : null;
      if (app) app.status = newStatus;
      updateCounts();
      renderApplications();
      renderFollowups();
      try {
        await api('/api/applications/status', {
          method: 'POST', body: JSON.stringify({ id, status: newStatus })
        });
        localStorage.removeItem('venky_job_statuses');
        await loadActivity();
        showToast('Saved "' + newStatus + '" to the tracker for role #' + id);
        return;
      } catch (error) {
        if (location.protocol !== 'file:') {
          if (app) app.status = previous;
          updateCounts(); renderApplications(); renderFollowups();
          showToast('Save failed: ' + error.message, true);
          return;
        }
      }
      const stored = getStoredStatuses();
      stored[id] = newStatus;
      localStorage.setItem('venky_job_statuses', JSON.stringify(stored));
      showToast('Saved in this browser only. Start the dashboard server for permanent storage.', true);
    }

    // Apply stored statuses
    const saved = getStoredStatuses();
    rawApps.forEach(a => {
      if (saved[a.id]) a.status = saved[a.id];
    });

    // Update Counter Badges
    function updateCounts() {
      let evaluated = 0, applied = 0, interview = 0;
      rawApps.forEach(a => {
        if (a.status === 'Applied') applied++;
        else if (a.status === 'Interview') interview++;
        else evaluated++;
      });
      if (document.getElementById('totalAppsCount')) document.getElementById('totalAppsCount').innerHTML = rawApps.length + ' <span class="text-xs font-normal text-blue-400">Roles</span>';
      if (document.getElementById('allCount')) document.getElementById('allCount').innerText = rawApps.length;
      if (document.getElementById('evaluatedCount')) document.getElementById('evaluatedCount').innerText = evaluated;
      if (document.getElementById('appliedCount')) document.getElementById('appliedCount').innerText = applied;
      if (document.getElementById('interviewCount')) document.getElementById('interviewCount').innerText = interview;
    }

    // Tab Switching
    function switchTab(tab) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.nav-tab').forEach(el => {
        el.className = 'nav-tab px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center gap-1.5';
      });

      const activeContent = document.getElementById('tab-' + tab);
      if (activeContent) activeContent.classList.remove('hidden');

      const activeNav = document.getElementById('nav-' + tab);
      if (activeNav) {
        activeNav.className = 'nav-tab px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all bg-emerald-500 text-slate-950 shadow-md flex items-center gap-1.5';
      }

      if (tab === 'forms') renderFormAnswers();
      if (tab === 'covers') renderCoverLetter();
      if (tab === 'followups') renderFollowups();
      if (tab === 'tracker') renderApplications();
      if (tab === 'scanner') loadScanStatus();
    }

    // Filtering
    function setFilter(filter) {
      activeFilter = filter;
      document.querySelectorAll('.app-filter-btn').forEach(b => {
        b.className = 'app-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all';
      });
      const activeBtn = document.getElementById('btn-filter-' + filter);
      if (activeBtn) {
        activeBtn.className = 'app-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 text-slate-950 transition-all shadow-md';
      }
      renderApplications();
    }

    // Render Applications Cards
    function renderApplications() {
      const q = (document.getElementById('appSearch') ? document.getElementById('appSearch').value : '').toLowerCase();
      const container = document.getElementById('applicationsContainer');
      if (!container) return;

      updateCounts();

      const filtered = rawApps.filter(a => {
        const matchSearch = a.company.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
        let matchFilter = true;
        if (activeFilter !== 'all') {
          matchFilter = a.status === activeFilter;
        }
        return matchSearch && matchFilter;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div class="col-span-2 glass-panel p-8 rounded-2xl text-center text-slate-400 text-xs">No opportunities match the selected filter.</div>';
        return;
      }

      container.innerHTML = filtered.map(app => {
        const scoreColor = app.score >= 4.8 ? 'emerald' : (app.score >= 4.6 ? 'blue' : 'amber');

        return \`
        <div class="glass-card rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-slate-600 transition-all shadow-xl relative" id="app-card-\${app.id}">

          <div class="flex items-start justify-between gap-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-800 text-slate-400">#00\${app.id}</span>
                <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">\${app.details.archetype || 'IT Support'}</span>
              </div>
              <h3 class="text-xl font-extrabold text-white tracking-tight">\${app.company}</h3>
              <p class="text-xs font-semibold text-emerald-400">\${app.role}</p>
            </div>

            <div class="flex flex-col items-end gap-1.5">
              <div class="flex items-center gap-1 px-2.5 py-1 rounded-xl font-mono font-bold text-xs bg-\${scoreColor}-500/10 text-\${scoreColor}-400 border border-\${scoreColor}-500/30">
                ⭐ \${app.score.toFixed(1)} / 5.0
              </div>

              <!-- Interactive Status Picker -->
              <select onchange="saveStatus('\${app.id}', this.value)" class="bg-slate-900 border border-slate-700 text-[11px] rounded-lg px-2 py-1 text-slate-300 font-semibold focus:outline-none focus:border-emerald-500">
                <option value="Evaluated" \${app.status === 'Evaluated' ? 'selected' : ''}>📋 Evaluated</option>
                <option value="Applied" \${app.status === 'Applied' ? 'selected' : ''}>🚀 Applied</option>
                <option value="Interview" \${app.status === 'Interview' ? 'selected' : ''}>🎤 Interview</option>
                <option value="Offer" \${app.status === 'Offer' ? 'selected' : ''}>🎉 Offer</option>
                <option value="Rejected" \${app.status === 'Rejected' ? 'selected' : ''}>❌ Rejected</option>
              </select>
            </div>
          </div>

          <!-- Metadata -->
          <div class="grid grid-cols-2 gap-2 text-[11px] bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
            <div>
              <span class="text-slate-500 block text-[9px] uppercase font-bold">Location</span>
              <span class="text-slate-300 font-medium">\${app.notes.split(';')[0] || 'London, UK'}</span>
            </div>
            <div>
              <span class="text-slate-500 block text-[9px] uppercase font-bold">Compensation</span>
              <span class="text-slate-300 font-medium">\${app.details.comp || 'Competitive UK Rate'}</span>
            </div>
          </div>

          <!-- Match Summary -->
          <p class="text-xs text-slate-300 leading-relaxed bg-slate-900/30 p-2.5 rounded-lg border border-slate-800/40">
            \${app.details.tldr || 'Direct alignment on Jira ticket resolution, hardware/software triage, Active Directory, and network diagnostics.'}
          </p>

          <!-- Action Buttons -->
          <div class="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              \${app.jobUrl && app.jobUrl !== '#' ? \`
              <a href="\${app.jobUrl}" target="_blank" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center gap-1 shadow-md">
                <span>🌐</span> Apply on Board
              </a>\` : ''}

              \${app.pdfFile ? \`
              <a href="\${app.pdfFile}" target="_blank" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1">
                <span>📄</span> CV (PDF)
              </a>\` : ''}
            </div>

            <div class="flex items-center gap-1.5">
              <button type="button" onclick="goToFormAnswers('\${app.id}')" class="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-blue-400 border border-slate-800 flex items-center gap-1" title="View pre-filled ATS answers">
                <span>📝</span> Answers
              </button>
              <button type="button" onclick="goToCoverLetter('\${app.id}')" class="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-purple-400 border border-slate-800 flex items-center gap-1" title="View tailored cover letter">
                <span>✍️</span> Cover Letter
              </button>
              <button type="button" onclick="openEditJobModal('\${app.id}')" class="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-800 flex items-center gap-1" title="Edit tracker details">
                <span>✏️</span> Edit
              </button>
            </div>
          </div>

        </div>
        \`;
      }).join('');
    }

    // Render ATS Form Answers
    function renderFormAnswers() {
      const select = document.getElementById('formRoleSelect');
      const selectedId = select ? select.value : (rawApps[0] ? rawApps[0].id : null);
      const app = rawApps.find(a => a.id == selectedId) || rawApps[0];
      const container = document.getElementById('formAnswersContainer');
      if (!app || !container) return;

      container.innerHTML = app.formSuggestions.map(f => \`
        <div class="glass-panel p-5 rounded-2xl space-y-2 border border-slate-800/90 shadow-lg">
          <div class="flex items-start justify-between gap-4">
            <span class="text-xs font-bold text-emerald-400 flex items-center gap-2">
              <span>❓</span> <span><span class="block text-[9px] uppercase tracking-wider text-slate-500">\${f.category || 'Suggested answer'}</span>\${f.label}</span>
            </span>
            <button type="button" onclick="copyFormAnswer('\${app.id}', '\${f.field}')" class="px-3 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 whitespace-nowrap">
              <svg class="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
              Copy Answer
            </button>
          </div>
          <div class="text-xs text-slate-300 bg-slate-900/80 p-3.5 rounded-xl border border-slate-800 font-sans leading-relaxed whitespace-pre-line" id="ans-\${app.id}-\${f.field}">\${f.answer}</div>
        </div>
      \`).join('');
    }

    function copyFormAnswer(appId, field) {
      const app = rawApps.find(a => a.id == appId);
      if (!app) return;
      const sugg = app.formSuggestions.find(s => s.field === field);
      if (sugg) {
        copyToClipboard(sugg.answer, 'Answer copied for: ' + sugg.label);
      }
    }

    function goToFormAnswers(id) {
      switchTab('forms');
      const select = document.getElementById('formRoleSelect');
      if (select) {
        select.value = id;
        renderFormAnswers();
      }
    }

    // Render Cover Letter
    function renderCoverLetter() {
      const select = document.getElementById('coverRoleSelect');
      const selectedId = select ? select.value : (rawApps[0] ? rawApps[0].id : null);
      const app = rawApps.find(a => a.id == selectedId) || rawApps[0];
      const preview = document.getElementById('coverLetterContent');
      if (app && preview) {
        preview.innerText = app.coverLetter;
      }
    }

    function goToCoverLetter(id) {
      switchTab('covers');
      const select = document.getElementById('coverRoleSelect');
      if (select) {
        select.value = id;
        renderCoverLetter();
      }
    }

    function copyCurrentCoverLetter() {
      const select = document.getElementById('coverRoleSelect');
      const selectedId = select ? select.value : (rawApps[0] ? rawApps[0].id : null);
      const app = rawApps.find(a => a.id == selectedId) || rawApps[0];
      if (app) {
        copyToClipboard(app.coverLetter, 'Cover letter for ' + app.company + ' copied!');
      }
    }

    // Render Follow-Ups
    function renderFollowups() {
      const container = document.getElementById('followupsContainer');
      if (!container) return;

      const applied = activityData.applications || [];
      if (!applied.length) {
        container.innerHTML = '<div class="col-span-2 glass-panel p-8 rounded-2xl text-center text-slate-400">No applications have been marked Applied yet.</div>';
        return;
      }
      container.innerHTML = applied.map(activity => {
        const app = rawApps.find(item => item.id == activity.id) || activity;
        const nextDate = activity.nextFollowupDate ? formatDate(activity.nextFollowupDate) : 'No follow-up scheduled';
        const appliedTime = activity.appliedTime ? new Date(activity.appliedTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : formatDate(activity.appliedDate) + ' (time not recorded)';
        return \`
        <div class="glass-card p-5 rounded-2xl space-y-4 border border-slate-800 shadow-xl">
          <div class="flex items-start justify-between">
            <div>
              <span class="text-[10px] font-mono uppercase font-bold text-slate-400">#00\${app.id} • \${app.status}</span>
              <h3 class="text-lg font-bold text-white">\${app.company}</h3>
              <p class="text-xs text-slate-300">\${app.role}</p>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
              \${activity.urgency === 'overdue' ? '⚠ Follow-Up Overdue' : '⏳ ' + nextDate}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-2 text-[11px]">
            <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3"><span class="block text-[9px] uppercase font-bold text-slate-500">Applied date & time</span><span class="text-slate-200">\${appliedTime}</span></div>
            <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3"><span class="block text-[9px] uppercase font-bold text-slate-500">Next follow-up</span><span class="text-slate-200">\${nextDate}</span><span class="block text-slate-500">Previous follow-ups: \${activity.followupCount || 0}</span></div>
          </div>

          <!-- Ready Email Template -->
          <div class="space-y-1.5">
            <span class="text-[10px] uppercase font-bold text-slate-400">Tailored Follow-Up Email:</span>
            <div class="text-[11px] bg-slate-900 p-3 rounded-xl border border-slate-800 text-slate-300 font-mono whitespace-pre-line leading-relaxed max-h-36 overflow-y-auto custom-scrollbar">
              \${app.followupEmail}
            </div>
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-slate-800">
            <span class="text-[10px] text-slate-500">Cadence: Day +7 / Day +14</span>
            <button type="button" onclick="copyFollowup('\${app.id}')" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5">
              <span>📋</span> Copy Follow-Up Email
            </button>
          </div>
        </div>
        \`;
      }).join('');
    }

    function formatDate(value) {
      if (!value) return 'Not recorded';
      const date = new Date(value + (String(value).length === 10 ? 'T12:00:00' : ''));
      return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    }

    async function loadActivity() {
      try {
        activityData = await api('/api/activity');
        document.getElementById('appliedJobsCount').innerText = activityData.appliedCount || 0;
        const next = (activityData.applications || []).filter(item => item.nextFollowupDate).sort((a, b) => a.nextFollowupDate.localeCompare(b.nextFollowupDate))[0];
        document.getElementById('nextFollowupSummary').innerText = next ? 'Next follow-up: ' + formatDate(next.nextFollowupDate) + ' · ' + next.company : 'No follow-up currently due';
        renderFollowups();
      } catch (error) {
        document.getElementById('nextFollowupSummary').innerText = 'Activity service unavailable';
      }
    }

    function copyFollowup(appId) {
      const app = rawApps.find(a => a.id == appId);
      if (app) {
        copyToClipboard(app.followupEmail, 'Follow-up email copied for ' + app.company + '!');
      }
    }

    // Modal Helpers
    function openAddJobModal() {
      document.getElementById('addJobModal').classList.remove('hidden');
    }

    function closeAddJobModal() {
      document.getElementById('addJobModal').classList.add('hidden');
    }

    function openEditJobModal(id) {
      const app = rawApps.find(a => a.id == id);
      if (!app) return;
      document.getElementById('editId').value = app.id;
      document.getElementById('editCompany').value = app.company;
      document.getElementById('editRole').value = app.role;
      document.getElementById('editDate').value = app.date;
      document.getElementById('editScore').value = app.score ? app.score.toFixed(1) : 'N/A';
      document.getElementById('editNotes').value = app.notes || '';
      document.getElementById('editJobModal').classList.remove('hidden');
    }

    function closeEditJobModal() {
      document.getElementById('editJobModal').classList.add('hidden');
    }

    async function saveEditedJob() {
      const id = document.getElementById('editId').value;
      const app = rawApps.find(a => a.id == id);
      const changes = {
        company: document.getElementById('editCompany').value.trim(),
        role: document.getElementById('editRole').value.trim(),
        date: document.getElementById('editDate').value,
        score: document.getElementById('editScore').value.trim(),
        notes: document.getElementById('editNotes').value.trim()
      };
      if (!changes.company || !changes.role) return showToast('Company and job title are required.', true);
      try {
        await api('/api/applications/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(changes) });
      } catch (error) {
        return showToast('Could not save: ' + error.message, true);
      }
      Object.assign(app, changes, { score: parseFloat(changes.score) || 0 });
      closeEditJobModal();
      renderApplications();
      showToast('Tracker entry #' + id + ' saved permanently.');
    }

    async function saveNewJob() {
      const company = document.getElementById('newCompany').value.trim();
      const role = document.getElementById('newRole').value.trim();
      const url = document.getElementById('newUrl').value.trim();
      const loc = document.getElementById('newLocation').value.trim() || 'London, UK';
      const status = document.getElementById('newStatus').value;

      if (!company || !role) {
        alert('Please provide Company and Job Title');
        return;
      }

      let savedApplication;
      try {
        const result = await api('/api/applications', {
          method: 'POST', body: JSON.stringify({ company, role, url, location: loc, status })
        });
        savedApplication = result.application;
      } catch (error) {
        if (location.protocol !== 'file:') {
          showToast('Could not add role: ' + error.message, true);
          return;
        }
      }
      const newId = String(savedApplication?.id || (Math.max(0, ...rawApps.map(a => Number(a.id) || 0)) + 1));
      const newApp = {
        id: newId,
        date: new Date().toISOString().split('T')[0],
        company,
        role,
        score: 4.5,
        status: status,
        pdfMarker: '—',
        reportRelPath: '',
        notes: loc,
        details: {
          url,
          archetype: 'IT Support & Helpdesk',
          comp: 'Market Rate',
          tldr: 'Direct match for IT support, Jira service desk, and technical administration.',
          matches: []
        },
        jobUrl: url || '#',
        coverLetter: 'Dear ' + company + ' Hiring Team,\\n\\nI am writing to express my strong interest in the ' + role + ' position at ' + company + '. With an MSc in Computer Science (Distinction) and 1st-line IT support experience, I look forward to supporting your team in London.\\n\\nWarm regards,\\nVenkateswarlu Pambha (Venky)',
        formSuggestions: [
          { label: 'Why ' + company + '?', field: 'why_company', answer: 'I am excited about ' + company + ' and want to bring my IT Support background to empower your team.' },
          { label: 'Work Authorization', field: 'work_auth', answer: 'Graduate Route (PSW) Visa -- full right to work in the UK (no sponsorship needed).' }
        ],
        followupEmail: 'Subject: Application Follow-up: ' + role + ' - Venkateswarlu Pambha (Venky)\\n\\nHi ' + company + ' Team,\\n\\nFollowing up on my application for ' + role + '...'
      };

      rawApps.unshift(newApp);
      if (!savedApplication) await saveStatus(newId, status);
      closeAddJobModal();

      // Update selectors
      const formSelect = document.getElementById('formRoleSelect');
      const coverSelect = document.getElementById('coverRoleSelect');
      if (formSelect) {
        const opt = document.createElement('option');
        opt.value = newId;
        opt.innerText = company + ' — ' + role;
        formSelect.prepend(opt);
      }
      if (coverSelect) {
        const opt = document.createElement('option');
        opt.value = newId;
        opt.innerText = company + ' — ' + role;
        coverSelect.prepend(opt);
      }

      renderApplications();
      showToast(savedApplication ? 'Added ' + company + ' permanently to your tracker!' : 'Added in this browser only.');
    }

    function copyPromptText(text) {
      copyToClipboard(text, 'Scan prompt copied! Paste into Antigravity chat.');
    }

    let scanPollTimer = null;

    async function runPortalScan() {
      const button = document.getElementById('runScanButton');
      button.disabled = true;
      try {
        await api('/api/scan', { method: 'POST', body: '{}' });
        showToast('Portal scan started. You can keep using the dashboard.');
        await loadScanStatus();
      } catch (error) {
        showToast(error.message, true);
        await loadScanStatus();
      }
    }

    async function loadScanStatus() {
      try {
        const state = await api('/api/scan');
        renderScanStatus(state);
        clearTimeout(scanPollTimer);
        if (state.running) scanPollTimer = setTimeout(loadScanStatus, 2000);
      } catch (error) {
        document.getElementById('scanStatus').innerText = 'Scanner service unavailable: ' + error.message;
      }
    }

    function renderScanStatus(state) {
      const run = state.latest || {};
      const button = document.getElementById('runScanButton');
      button.disabled = !!state.running;
      document.getElementById('runScanButtonText').innerText = state.running ? 'Scanning…' : 'Run Scan Now';
      document.getElementById('scanJobsFound').innerText = run.found ?? '—';
      document.getElementById('scanCompanies').innerText = run.companies != null ? run.companies + ' + ' + (run.boards || 0) + ' board' : '—';
      document.getElementById('scanNewJobs').innerText = run.new_added ?? '—';
      document.getElementById('scanLastUpdated').innerText = run.timestamp ? 'Last scan: ' + new Date(run.timestamp).toLocaleString() : 'No completed scans';
      const status = document.getElementById('scanStatus');
      if (state.running) {
        status.innerHTML = '<span class="text-amber-400 font-bold">● Scan running</span> — checking London, UK and remote IT Support roles. Results update automatically.';
      } else if (run.timestamp) {
        status.innerHTML = '<span class="text-emerald-400 font-bold">✓ Latest scan completed</span> — ' + (run.filtered_title || 0) + ' title filtered, ' + (run.filtered_location || 0) + ' location filtered, ' + (run.dupes || 0) + ' duplicates, ' + (run.errors || 0) + ' source errors.';
      } else {
        status.innerText = 'No scan has completed yet. Select Run Scan Now.';
      }
      const jobs = state.pending || [];
      document.getElementById('scanPendingJobs').innerHTML = jobs.length ? jobs.map(job =>
        '<div class="bg-slate-900/70 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3"><div><div class="font-bold text-white">' + escapeHtml(job.title) + '</div><div class="text-slate-400">' + escapeHtml(job.company) + '</div></div><a class="text-emerald-400 font-bold" target="_blank" rel="noopener" href="' + encodeURI(job.url) + '">Open role ↗</a></div>'
      ).join('') : '<div class="bg-slate-900/70 border border-slate-800 rounded-xl p-4">No new pending matches from the latest scans.</div>';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      const toastMsg = document.getElementById('toastMsg');
      toastMsg.innerText = msg;
      toast.classList.toggle('bg-red-400', isError);
      toast.classList.toggle('bg-emerald-500', !isError);
      toast.classList.remove('translate-y-20', 'opacity-0');
      setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
      }, 2500);
    }

    // Initial render on page load
    window.addEventListener('DOMContentLoaded', () => {
      renderApplications();
      renderFormAnswers();
      renderCoverLetter();
      renderFollowups();
      loadScanStatus();
      loadActivity();
    });
    renderApplications();
  </script>
</body>
</html>
`;

// Write to root and output/
fs.writeFileSync(path.join(__dirname, 'dashboard.html'), html);
if (fs.existsSync(outputDir)) {
  fs.writeFileSync(path.join(outputDir, 'dashboard.html'), html);
}

console.log('✅ Venky Job Command Center generated successfully: dashboard.html');
