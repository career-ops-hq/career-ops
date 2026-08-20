#!/usr/bin/env node

/**
 * server-studio.mjs — Unified Candidate Command Center Web Dashboard
 *
 * Full multi-repo control center featuring Job Finder, Resume Studio, ATS Tailor,
 * Interview Copilot, Recruiter Outreach, Salary Advisor, and Auto-Apply Runner.
 *
 * Usage:
 *   node career-ops/server-studio.mjs [--port=4000]
 */

import http from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { calculateAtsScore } from './ats-score.mjs';
import { buildCvRenderCv } from './build-cv-rendercv.mjs';
import { convertToJsonResume } from './export-json-resume.mjs';
import { tailorProfileForJd } from './tailor-and-render.mjs';
import { generateInterviewPrep } from './interview-prep.mjs';
import { generateOutreachCadence } from './outreach-generator.mjs';
import { evaluateSalaryOffer } from './salary-advisor.mjs';
import { generateDailyDigest } from './daily-digest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const PIPELINE_DIR = resolve(__dirname, '..', 'remote-job-pipeline');

const DEFAULT_PROFILE = {
  name: "Alex Chen",
  headline: "Senior Software Engineer",
  contact: {
    email: "alex@example.com",
    phone: "+1 (512) 555-0199",
    location: "Austin, TX",
    linkedin: "https://linkedin.com/in/alexchen",
    github: "https://github.com/alexchen",
    website: "https://alexchen.dev"
  },
  summary: [
    "Full-stack AI engineer with 6 years building production ML systems and distributed microservices."
  ],
  experience: [
    {
      company: "TechFin Corp",
      role: "Senior ML Engineer",
      location: "Austin, TX",
      dates: "2020 - 2024",
      bullets: [
        "Led ML platform team of 3 engineers building real-time fraud detection pipelines.",
        "Designed Kafka stream processing engine with 99.7% precision at 50ms p99 latency.",
        "Reduced model deployment cycle from 2 weeks to 4 hours via GitHub Actions & SageMaker."
      ]
    }
  ],
  education: [
    {
      institution: "UT Austin",
      degree: "MS Computer Science",
      area: "Machine Learning & Systems",
      dates: "2018 - 2020",
      location: "Austin, TX"
    }
  ],
  projects: [
    {
      name: "FraudShield (Open Source)",
      context: "Kafka + Feature Store + ML Serving",
      dates: "2023",
      bullets: [
        "Built open-source real-time fraud detection framework with 500+ GitHub stars."
      ]
    }
  ],
  skills: [
    { category: "Languages", items: ["Python", "Go", "TypeScript", "SQL"] },
    { category: "Infrastructure", items: ["Docker", "Kubernetes", "Kafka", "PostgreSQL", "AWS"] }
  ]
};const HTML_STUDIO = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CAREER.OS — Command Center</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Plus Jakarta Sans', sans-serif; transition: background-color 0.2s, border-color 0.2s; }
    pre, code, textarea, input.font-mono { font-family: 'JetBrains Mono', monospace; }
    body { background-color: #09090b; color: #ffffff; }
    .card-zinc { background: rgba(24, 24, 27, 0.9); border: 1px solid #27272a; }
    .input-zinc { background: #09090b; border: 1px solid #27272a; color: #ffffff; }
    .input-zinc:focus { border-color: #3b82f6; outline: none; }
    .tab-pill { padding: 6px 14px; font-size: 11px; font-weight: 700; border-radius: 8px; color: #a1a1aa; transition: all 0.15s; display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .tab-pill:hover { color: #ffffff; background: #27272a; }
    .tab-pill.active { background: #2563eb; color: #ffffff; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

    /* DAY (LIGHT) MODE OVERRIDES */
    body.light-mode { background-color: #f4f4f5; color: #09090b; }
    body.light-mode header { background-color: rgba(255, 255, 255, 0.95) !important; border-color: #e4e4e7 !important; }
    body.light-mode .card-zinc { background: #ffffff !important; border-color: #e4e4e7 !important; color: #09090b !important; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    body.light-mode .input-zinc { background: #f8fafc !important; border-color: #d4d4d8 !important; color: #09090b !important; }
    body.light-mode h1, body.light-mode h2, body.light-mode h3, body.light-mode h4 { color: #09090b !important; }
    body.light-mode .card-zinc h2, body.light-mode .card-zinc h3, body.light-mode .card-zinc h4, body.light-mode .card-zinc td.font-bold { color: #09090b !important; }
    body.light-mode .text-zinc-400 { color: #71717a !important; }
    body.light-mode .text-zinc-300 { color: #52525b !important; }
    body.light-mode .text-zinc-200 { color: #27272a !important; }
    body.light-mode .bg-zinc-950 { background-color: #f4f4f5 !important; border-color: #e4e4e7 !important; color: #09090b !important; }
    body.light-mode .bg-zinc-900 { background-color: #ffffff !important; border-color: #e4e4e7 !important; }
    body.light-mode .border-zinc-800 { border-color: #e4e4e7 !important; }
    body.light-mode .tab-pill { color: #52525b; }
    body.light-mode .tab-pill:hover { background: #e4e4e7; color: #09090b; }
    body.light-mode .nav-bar-container { background-color: #f4f4f5 !important; border-color: #e4e4e7 !important; }

    /* ALL BLUE BUTTONS & ACTIVE TABS MUST ALWAYS HAVE CRISP WHITE TEXT */
    .bg-blue-600, .bg-blue-500, .tab-pill.active, button.bg-blue-600, a.bg-blue-600,
    body.light-mode .bg-blue-600, body.light-mode .bg-blue-500, body.light-mode .tab-pill.active, body.light-mode button.bg-blue-600, body.light-mode a.bg-blue-600 {
      background-color: #2563eb !important;
      color: #ffffff !important;
    }
    .bg-blue-600 *, .bg-blue-500 *, .tab-pill.active *, button.bg-blue-600 *, a.bg-blue-600 *,
    body.light-mode .bg-blue-600 *, body.light-mode .bg-blue-500 *, body.light-mode .tab-pill.active *, body.light-mode button.bg-blue-600 *, body.light-mode a.bg-blue-600 * {
      color: #ffffff !important;
    }

    /* MATCH BADGES */
    .bg-blue-950, body.light-mode .bg-blue-950 {
      background-color: #1e3a8a !important;
      color: #93c5fd !important;
      border-color: #3b82f6 !important;
    }
  </style>
</head>
<body class="min-h-screen pb-16 selection:bg-blue-600 selection:text-white">

  <!-- TOP HEADER BAR: BLUE, WHITE, BLACK & GREY WITH DAY/DARK TOGGLE -->
  <header class="sticky top-0 z-50 bg-[#0f0f12]/95 backdrop-blur-xl border-b border-zinc-800 px-4 sm:px-6 py-3">
    <div class="max-w-6xl mx-auto flex items-center justify-between gap-4">
      
      <!-- LOGO -->
      <div class="flex items-center gap-3 shrink-0 cursor-pointer" onclick="switchTab('jobs')">
        <div class="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 transition flex items-center justify-center font-black text-white shadow-md shadow-blue-600/30">
          ⚡
        </div>
        <div>
          <div class="text-sm font-black tracking-tight flex items-center gap-1.5">
            CAREER<span class="text-blue-500">.OS</span>
            <span id="theme-mode-badge" class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60">DARK</span>
          </div>
          <div class="text-[10px] text-zinc-400 font-medium" id="live-job-count">220 Jobs Active</div>
        </div>
      </div>

      <!-- NAVIGATION BAR -->
      <nav class="nav-bar-container flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 overflow-x-auto no-scrollbar">
        <button onclick="switchTab('jobs')" id="tab-jobs" class="tab-pill active">
          <span>💼</span>
          <span>Jobs</span>
        </button>

        <button onclick="switchTab('tracker')" id="tab-tracker" class="tab-pill">
          <span>📊</span>
          <span>Tracker</span>
        </button>

        <button onclick="switchTab('ats')" id="tab-ats" class="tab-pill">
          <span>🎯</span>
          <span>ATS Match</span>
        </button>

        <button onclick="switchTab('interview')" id="tab-interview" class="tab-pill">
          <span>🎙️</span>
          <span>STAR Prep</span>
        </button>

        <button onclick="switchTab('outreach')" id="tab-outreach" class="tab-pill">
          <span>📬</span>
          <span>Outreach</span>
        </button>

        <button onclick="switchTab('salary')" id="tab-salary" class="tab-pill">
          <span>💰</span>
          <span>Salary</span>
        </button>

        <button onclick="switchTab('resume')" id="tab-resume" class="tab-pill">
          <span>📄</span>
          <span>Resume PDF</span>
        </button>

        <button onclick="switchTab('contacts')" id="tab-contacts" class="tab-pill">
          <span>👥</span>
          <span>Recruiters</span>
        </button>

        <button onclick="switchTab('apply')" id="tab-apply" class="tab-pill">
          <span>⚡</span>
          <span>Auto-Apply</span>
        </button>
      </nav>

      <!-- SEARCH, EDIT PROFILE, DAY/DARK TOGGLE & USER AVATAR -->
      <div class="flex items-center gap-2 shrink-0">
        <div class="relative hidden md:block">
          <input
            type="text"
            id="global-search-input"
            onkeyup="filterJobs()"
            placeholder="Search jobs..."
            class="w-32 focus:w-44 transition-all duration-200 input-zinc rounded-lg pl-3 pr-3 py-1 text-xs placeholder-zinc-500 focus:outline-none"
          >
        </div>

        <!-- EDIT PROFILE BUTTON -->
        <button
          onclick="openEditProfile()"
          class="px-2.5 py-1 rounded-lg border border-blue-600/40 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer active:scale-95"
          title="Edit Candidate Profile"
        >
          <span>✏️</span>
          <span class="hidden sm:inline">Edit Profile</span>
        </button>

        <!-- DEDICATED DAY / DARK TOGGLE BUTTON -->
        <button
          id="theme-toggle-btn"
          onclick="toggleTheme()"
          class="px-2.5 py-1 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer text-zinc-200 shadow-sm"
          title="Toggle Day/Dark Mode"
        >
          <span id="theme-toggle-icon">🌙</span>
          <span id="theme-toggle-text" class="hidden sm:inline">Dark</span>
        </button>

        <div id="header-avatar" onclick="openEditProfile()" class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-xs text-white shadow-sm cursor-pointer hover:bg-blue-500 transition" title="Open Profile">
          AC
        </div>
      </div>

    </div>
  </header>

  <!-- EDIT PROFILE MODAL DIALOG -->
  <div id="profile-modal" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm hidden flex items-center justify-center p-4 overflow-y-auto">
    <div class="card-zinc w-full max-w-2xl rounded-2xl p-6 space-y-4 shadow-2xl relative my-8">
      <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
            👤
          </div>
          <div>
            <h2 class="text-base font-bold text-white">Edit Candidate Profile</h2>
            <p class="text-xs text-zinc-400">Updating your profile skills automatically re-scores and re-ranks job drops.</p>
          </div>
        </div>
        <button onclick="closeEditProfile()" class="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition">✕</button>
      </div>

      <div class="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Full Name</label>
            <input type="text" id="edit-name" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Current Headline</label>
            <input type="text" id="edit-headline" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Target Job Title</label>
            <input type="text" id="edit-target-role" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Min Salary Target ($/yr)</label>
            <input type="number" id="edit-min-salary" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Years Experience</label>
            <input type="number" id="edit-years-exp" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
        </div>

        <!-- SKILLS LIST -->
        <div>
          <label class="text-xs font-bold text-zinc-300 block mb-1.5">Core Technical Skills (Used for Job Match Ranking)</label>
          <div id="skills-tags-container" class="flex flex-wrap gap-1.5 p-3 rounded-lg border border-zinc-800 bg-zinc-950 min-h-[60px]"></div>
          
          <div class="flex gap-2 mt-2">
            <input
              type="text"
              id="new-skill-input"
              placeholder="Add skill (e.g. PyTorch, Kubernetes, Rust)..."
              onkeydown="if(event.key==='Enter'){event.preventDefault(); addSkill();}"
              class="flex-1 text-xs px-3 py-1.5 input-zinc rounded-lg"
            >
            <button onclick="addSkill()" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition">
              Add Skill
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Email</label>
            <input type="email" id="edit-email" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Location Preference</label>
            <input type="text" id="edit-location" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between pt-3 border-t border-zinc-800">
        <button onclick="resetProfileDraft()" class="text-xs font-bold text-zinc-400 hover:text-blue-400 transition">
          Reset to Defaults
        </button>
        <div class="flex items-center gap-2">
          <button onclick="closeEditProfile()" class="px-4 py-2 rounded-lg border border-zinc-700 text-xs font-bold hover:bg-zinc-800 transition">Cancel</button>
          <button onclick="saveProfile()" class="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-md">
            ✓ Save & Recalibrate Jobs
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- JOB QUICK-VIEW MODAL -->
  <div id="job-quickview-modal" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm hidden flex items-center justify-center p-4">
    <div class="card-zinc w-full max-w-xl rounded-2xl p-6 space-y-4 shadow-2xl relative">
      <div class="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
        <div>
          <div class="flex items-center gap-2">
            <h2 id="modal-job-role" class="text-base font-bold text-white">Senior ML Engineer</h2>
            <span id="modal-job-match" class="px-2 py-0.5 bg-blue-950 text-blue-300 border border-blue-800 rounded text-[10px] font-black">95% MATCH</span>
          </div>
          <p id="modal-job-subtitle" class="text-xs text-zinc-400 mt-1 font-medium">Scale AI • Remote • Greenhouse</p>
        </div>
        <button onclick="closeJobQuickView()" class="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition">✕</button>
      </div>

      <div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs space-y-2">
        <div class="flex justify-between">
          <span class="text-zinc-400">Target Compensation:</span>
          <span id="modal-job-salary" class="font-bold text-white">$165k - $220k</span>
        </div>
        <div class="flex justify-between">
          <span class="text-zinc-400">Application Platform:</span>
          <span id="modal-job-ats" class="font-semibold text-zinc-300">Greenhouse</span>
        </div>
      </div>

      <!-- ONE-CLICK ACTIONS -->
      <div class="space-y-2 pt-2">
        <div class="text-[11px] font-bold uppercase tracking-wider text-zinc-400">One-Click Actions</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button onclick="launchAtsFromModal()" class="p-2.5 rounded-xl border border-zinc-700 hover:border-blue-500 text-xs font-bold flex items-center justify-center gap-1.5 transition hover:bg-blue-950/20 text-zinc-200">
            <span>🎯</span> Tailor Resume
          </button>

          <button onclick="launchInterviewFromModal()" class="p-2.5 rounded-xl border border-zinc-700 hover:border-blue-500 text-xs font-bold flex items-center justify-center gap-1.5 transition hover:bg-blue-950/20 text-zinc-200">
            <span>🎙️</span> Prep Interview
          </button>

          <button onclick="launchOutreachFromModal()" class="p-2.5 rounded-xl border border-zinc-700 hover:border-blue-500 text-xs font-bold flex items-center justify-center gap-1.5 transition hover:bg-blue-950/20 text-zinc-200">
            <span>📬</span> Cold Email
          </button>
        </div>

        <div class="pt-2 flex items-center justify-between">
          <div class="flex items-center gap-1 text-xs">
            <span class="text-zinc-400">Pipeline:</span>
            <button onclick="updateSelectedJobStatus('saved')" id="status-btn-saved" class="px-2 py-1 rounded text-[10px] font-bold border border-zinc-700 text-zinc-400">Saved</button>
            <button onclick="updateSelectedJobStatus('applied')" id="status-btn-applied" class="px-2 py-1 rounded text-[10px] font-bold border border-zinc-700 text-zinc-400">Applied</button>
            <button onclick="updateSelectedJobStatus('interviewing')" id="status-btn-interviewing" class="px-2 py-1 rounded text-[10px] font-bold border border-zinc-700 text-zinc-400">Interviewing</button>
            <button onclick="updateSelectedJobStatus('offer')" id="status-btn-offer" class="px-2 py-1 rounded text-[10px] font-bold border border-zinc-700 text-zinc-400">Offer</button>
          </div>

          <a id="modal-apply-link" href="#" target="_blank" onclick="updateSelectedJobStatus('applied')" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1 transition shadow-sm">
            Easy Apply →
          </a>
        </div>
      </div>
    </div>
  </div>

  <!-- MAIN 3-COLUMN LAYOUT -->
  <div class="max-w-6xl mx-auto px-4 pt-6 grid grid-cols-1 lg:grid-cols-12 gap-5">

    <!-- LEFT COLUMN: CANDIDATE CARD -->
    <aside class="lg:col-span-3 space-y-4">
      <div class="card-zinc rounded-xl p-4 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div id="card-avatar" class="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center font-black text-lg text-white shadow-md shadow-blue-600/20">
              AC
            </div>
            <div>
              <h2 id="card-name" class="text-sm font-bold text-white">Alex Chen</h2>
              <p id="card-headline" class="text-xs text-zinc-400 font-medium">Senior ML Engineer</p>
              <div id="card-location" class="text-[10px] text-zinc-500 mt-0.5">Austin, TX (Remote)</div>
            </div>
          </div>
          <button onclick="openEditProfile()" class="p-1.5 rounded-lg border border-zinc-800 hover:border-blue-500 text-zinc-400 hover:text-blue-400 transition" title="Edit Profile">
            ✏️
          </button>
        </div>

        <!-- QUICK SKILLS PREVIEW WITH FILTER CHIPS -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Core Profile Skills</span>
            <span id="card-skills-count" class="text-[10px] text-blue-400 font-bold">11 skills</span>
          </div>
          <div id="card-skills-preview" class="flex flex-wrap gap-1"></div>
        </div>

        <div class="p-3 bg-zinc-950 rounded-lg border border-zinc-800 space-y-2 text-xs">
          <div class="flex justify-between">
            <span class="text-zinc-400">Target Match Score</span>
            <span class="font-bold text-blue-400">96%</span>
          </div>
          <div class="flex justify-between">
            <span class="text-zinc-400">Target Min Salary</span>
            <span id="card-min-salary" class="font-bold text-white">$160k/yr</span>
          </div>
          <div class="flex justify-between">
            <span class="text-zinc-400">Shortlist Matches</span>
            <span class="font-bold text-white" id="stats-job-count">220</span>
          </div>
        </div>

        <div class="space-y-1.5 pt-2 border-t border-zinc-800">
          <button onclick="filterJobsByProfileMatch()" class="w-full flex items-center justify-between p-2 rounded-lg bg-blue-600 text-white text-xs font-bold transition shadow-sm">
            <span>✨ Match Jobs to My Profile</span>
            <span>→</span>
          </button>

          <button onclick="switchTab('tracker')" class="w-full flex items-center justify-between p-2 rounded-lg bg-zinc-950 hover:bg-zinc-800/80 border border-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white transition">
            <span>📊 Pipeline Tracker</span>
            <span id="sidebar-tracker-badge" class="text-blue-400 font-bold">0 Active</span>
          </button>

          <button onclick="switchTab('ats')" class="w-full flex items-center justify-between p-2 rounded-lg bg-zinc-950 hover:bg-zinc-800/80 border border-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white transition">
            <span>Target ATS Keyword Scan</span>
            <span class="text-zinc-500">→</span>
          </button>
        </div>
      </div>
    </aside>

    <!-- MIDDLE COLUMN: ACTIVE TAB CONTENT -->
    <main class="lg:col-span-6 space-y-4">

      <!-- TAB 1: JOBS -->
      <div id="view-jobs" class="space-y-4">
        
        <!-- PROFILE MATCH BANNER -->
        <div class="card-zinc rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="flex items-center gap-1.5">
              <span class="text-blue-400 text-base">✨</span>
              <h3 class="text-xs font-bold text-white">Profile-Matched Job Feed</h3>
            </div>
            <p class="text-[11px] text-zinc-400 mt-0.5">
              Auto-ranking listings against your core skills: <span id="banner-skills-hint" class="text-blue-400 font-semibold">Python, Go, PyTorch...</span>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="openEditProfile()" class="px-2.5 py-1 text-xs rounded-lg font-bold border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition">
              ✏️ Refine Profile
            </button>
            <button onclick="loadJobs()" class="px-3 py-1 text-xs rounded-lg font-bold bg-blue-600 hover:bg-blue-500 text-white transition flex items-center gap-1 shadow-sm">
              🔄 Scan New Jobs
            </button>
          </div>
        </div>

        <!-- FILTER BAR -->
        <div class="card-zinc rounded-xl p-3 space-y-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 overflow-x-auto">
              <span class="text-xs font-bold text-zinc-400 shrink-0">ATS:</span>
              <button onclick="filterAts('all')" id="filter-all" class="px-3 py-1 text-xs rounded-lg font-bold bg-blue-600 text-white">All Platforms</button>
              <button onclick="filterAts('Greenhouse')" id="filter-Greenhouse" class="px-3 py-1 text-xs rounded-lg font-bold bg-zinc-950 text-zinc-400 border border-zinc-800 hover:text-white">Greenhouse</button>
              <button onclick="filterAts('Lever')" id="filter-Lever" class="px-3 py-1 text-xs rounded-lg font-bold bg-zinc-950 text-zinc-400 border border-zinc-800 hover:text-white">Lever</button>
              <button onclick="filterAts('Ashby')" id="filter-Ashby" class="px-3 py-1 text-xs rounded-lg font-bold bg-zinc-950 text-zinc-400 border border-zinc-800 hover:text-white">Ashby</button>
            </div>

            <!-- MIN MATCH SCORE FILTER -->
            <div class="flex items-center gap-1">
              <span class="text-xs font-bold text-zinc-400">Match:</span>
              <button onclick="filterMinScore(0)" id="score-all" class="px-2 py-0.5 text-xs rounded-md font-bold bg-blue-600 text-white">All</button>
              <button onclick="filterMinScore(85)" id="score-85" class="px-2 py-0.5 text-xs rounded-md font-bold bg-zinc-950 text-zinc-400 border border-zinc-800">85%+</button>
              <button onclick="filterMinScore(90)" id="score-90" class="px-2 py-0.5 text-xs rounded-md font-bold bg-zinc-950 text-zinc-400 border border-zinc-800">90%+</button>
              <button onclick="filterMinScore(95)" id="score-95" class="px-2 py-0.5 text-xs rounded-md font-bold bg-zinc-950 text-zinc-400 border border-zinc-800">95%+</button>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between pt-2 border-t border-zinc-800 text-xs">
            <div class="flex items-center gap-3">
              <label class="flex items-center gap-1.5 cursor-pointer text-zinc-300">
                <input type="checkbox" id="filter-remote-checkbox" onchange="filterJobs()" class="rounded text-blue-600">
                <span class="font-semibold">Remote Only</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer text-zinc-300">
                <input type="checkbox" id="sort-match-checkbox" checked onchange="filterJobs()" class="rounded text-blue-600">
                <span class="font-semibold">Rank by Best Profile Match</span>
              </label>
            </div>
            <div id="job-match-counter" class="text-[11px] text-zinc-400">220 jobs available</div>
          </div>
        </div>

        <div class="space-y-3" id="jobs-cards-container">
          <div class="text-center py-12 text-zinc-400 text-xs">Loading live job listings...</div>
        </div>
      </div>

      <!-- TAB: TRACKER -->
      <div id="view-tracker" class="hidden card-zinc rounded-xl p-5 space-y-4">
        <div class="border-b border-zinc-800 pb-3">
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>📊</span> Application Pipeline Tracker
          </h2>
          <p class="text-xs text-zinc-400 mt-0.5">Track your active career prospects from shortlist to signed offer.</p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-zinc-300">Saved</span>
              <span id="tracker-count-saved" class="px-2 py-0.5 bg-blue-600 text-white rounded-full text-[10px] font-black">0</span>
            </div>
            <div class="text-[10px] text-zinc-500">Shortlisted roles</div>
          </div>

          <div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-zinc-300">Applied</span>
              <span id="tracker-count-applied" class="px-2 py-0.5 bg-blue-600 text-white rounded-full text-[10px] font-black">0</span>
            </div>
            <div class="text-[10px] text-zinc-500">Submitted resumes</div>
          </div>

          <div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-zinc-300">Interviewing</span>
              <span id="tracker-count-interviewing" class="px-2 py-0.5 bg-blue-600 text-white rounded-full text-[10px] font-black">0</span>
            </div>
            <div class="text-[10px] text-zinc-500">Active interview rounds</div>
          </div>

          <div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-zinc-300">Offers</span>
              <span id="tracker-count-offer" class="px-2 py-0.5 bg-emerald-600 text-white rounded-full text-[10px] font-black">0</span>
            </div>
            <div class="text-[10px] text-zinc-500">Offers received</div>
          </div>
        </div>

        <div id="tracker-jobs-list" class="space-y-2 mt-4 text-xs text-zinc-400">
          Click <strong>Details</strong> on any job in your feed to mark it as Applied or Interviewing.
        </div>
      </div>

      <!-- TAB 2: ATS MATCH -->
      <div id="view-ats" class="hidden card-zinc rounded-xl p-5 space-y-4">
        <div class="border-b border-zinc-800 pb-3">
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>🎯</span> ATS Keyword Matcher
          </h2>
          <p class="text-xs text-zinc-400 mt-0.5">Parse job descriptions to compute keyword density and overlap.</p>
        </div>

        <div class="space-y-3">
          <label class="text-xs font-bold text-zinc-300 block">Target Job Description</label>
          <textarea id="jd-text" placeholder="Paste Job Description here..." class="w-full h-36 input-zinc rounded-lg p-3 text-xs text-white placeholder-zinc-500 font-mono resize-none"></textarea>
          <button onclick="calculateAts()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-xs transition">
            Calculate ATS Match
          </button>
        </div>
        <div id="ats-results-container" class="text-xs text-zinc-400"></div>
      </div>

      <!-- TAB 3: STAR INTERVIEW PREP -->
      <div id="view-interview" class="hidden card-zinc rounded-xl p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <span>🎙️</span> STAR Interview Copilot
            </h2>
            <p class="text-xs text-zinc-400 mt-0.5">Generate tailored behavioral answers (Situation, Task, Action, Result).</p>
          </div>
          <button onclick="generatePrepSheet()" class="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition">
            Generate Prep Sheet
          </button>
        </div>
        <div id="interview-prep-results" class="text-xs text-zinc-500">
          Click <strong>Generate Prep Sheet</strong> to build behavioral interview answers.
        </div>
      </div>

      <!-- TAB 4: RECRUITER OUTREACH -->
      <div id="view-outreach" class="hidden card-zinc rounded-xl p-5 space-y-4">
        <div class="border-b border-zinc-800 pb-3">
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>📬</span> Recruiter Cold Outreach
          </h2>
          <p class="text-xs text-zinc-400 mt-0.5">3-sentence cold emails with 5-day follow-up cadences.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Company</label>
            <input type="text" id="outreach-company" value="Scale AI" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Role</label>
            <input type="text" id="outreach-role" value="Senior ML Engineer" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
        </div>

        <button onclick="generateOutreach()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-xs transition">
          Generate Outreach Email
        </button>
        <div id="outreach-output-container" class="bg-zinc-950 border border-zinc-800 rounded-lg p-3 font-mono text-xs min-h-[160px] whitespace-pre-wrap text-zinc-300"></div>
      </div>

      <!-- TAB 5: SALARY ADVISOR -->
      <div id="view-salary" class="hidden card-zinc rounded-xl p-5 space-y-4">
        <div class="border-b border-zinc-800 pb-3">
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>💰</span> Salary Benchmark & Counter-Offer Advisor
          </h2>
          <p class="text-xs text-zinc-400 mt-0.5">Evaluate offer against percentiles and generate counter-scripts.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Target Role</label>
            <input type="text" id="salary-role" value="Senior ML Engineer" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
          <div>
            <label class="text-xs font-bold text-zinc-300 block mb-1">Offered Salary (USD)</label>
            <input type="number" id="salary-offered" value="185000" class="w-full text-xs px-3 py-2 input-zinc rounded-lg">
          </div>
        </div>

        <button onclick="evaluateSalary()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-xs transition">
          Evaluate Offer
        </button>
        <div id="salary-output-container" class="text-xs text-zinc-400"></div>
      </div>

      <!-- TAB 6: RENDERCV RESUME -->
      <div id="view-resume" class="hidden card-zinc rounded-xl p-5 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
          <div>
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <span>📄</span> RenderCV Resume Builder
            </h2>
            <p class="text-xs text-zinc-400 mt-0.5">Compile Typst-formatted ATS resumes directly from profile.</p>
          </div>
          <div class="flex items-center gap-2">
            <select id="resume-theme" class="text-xs bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-200">
              <option value="classic">Theme: Classic ATS</option>
              <option value="modern">Theme: Modern Minimal</option>
              <option value="sb2">Theme: SB2 Dual-Column</option>
            </select>
            <button onclick="renderPdf()" class="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition">
              Render PDF
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <textarea id="profile-json" class="w-full h-80 input-zinc rounded-lg p-3 font-mono text-xs text-white resize-none"></textarea>
          <div id="pdf-preview-container" class="bg-zinc-950 border border-zinc-800 rounded-lg p-2 flex items-center justify-center min-h-80 text-xs text-zinc-500">
            Click Render PDF to build preview
          </div>
        </div>
      </div>

      <!-- TAB 7: RECRUITERS -->
      <div id="view-contacts" class="hidden card-zinc rounded-xl p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>👥</span> Recruiter Directory
          </h2>
          <button onclick="loadContacts()" class="text-xs text-blue-400 font-bold">Refresh</button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-zinc-950 text-zinc-400 uppercase text-[10px] font-bold">
              <tr>
                <th class="p-3">Recruiter</th>
                <th class="p-3">Company</th>
                <th class="p-3">Direct Email</th>
                <th class="p-3">Action</th>
              </tr>
            </thead>
            <tbody id="contacts-table-body" class="divide-y divide-zinc-800"></tbody>
          </table>
        </div>
      </div>

      <!-- TAB 8: AUTO-APPLY -->
      <div id="view-apply" class="hidden card-zinc rounded-xl p-5 space-y-4">
        <div class="border-b border-zinc-800 pb-3">
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>⚡</span> Auto-Apply Stealth Runner
          </h2>
          <p class="text-xs text-zinc-400 mt-0.5">Automated application engine with stealth browser execution.</p>
        </div>

        <div class="bg-zinc-950 border border-zinc-800 rounded-lg p-4 font-mono text-xs h-60 overflow-y-auto space-y-1 text-zinc-300">
          <div class="text-blue-400 font-bold">[AutoPilot] Engine active for profile.</div>
          <div>[Pipeline] 220 candidate listings scanned. 18 meet 90%+ ATS criteria.</div>
          <div class="text-zinc-500">[Standby] Ready for user trigger.</div>
        </div>
      </div>

    </main>

    <!-- RIGHT COLUMN: ROLE RADAR, NEWS & RECRUITER LEADS -->
    <aside class="lg:col-span-3 space-y-4">
      
      <!-- ROLE COMPATIBILITY RADAR -->
      <div class="card-zinc rounded-xl p-4 space-y-3">
        <h3 class="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
          <span>📈</span> Role Compatibility Radar
        </h3>
        
        <div class="space-y-2.5 text-xs">
          <div class="space-y-1">
            <div class="flex justify-between text-[11px] font-semibold">
              <span class="text-zinc-300">ML & AI Engineering</span>
              <span class="text-blue-400 font-bold">98% Match</span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-zinc-950 overflow-hidden">
              <div class="h-full bg-blue-600 rounded-full w-[98%]"></div>
            </div>
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-[11px] font-semibold">
              <span class="text-zinc-300">Backend Microservices</span>
              <span class="text-blue-400 font-bold">94% Match</span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-zinc-950 overflow-hidden">
              <div class="h-full bg-blue-600 rounded-full w-[94%]"></div>
            </div>
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-[11px] font-semibold">
              <span class="text-zinc-300">Cloud & Infrastructure</span>
              <span class="text-blue-400 font-bold">88% Match</span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-zinc-950 overflow-hidden">
              <div class="h-full bg-blue-600 rounded-full w-[88%]"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card-zinc rounded-xl p-4 space-y-3">
        <h3 class="text-xs font-bold text-white uppercase tracking-wider">Industry News</h3>
        <div class="space-y-2.5 text-xs">
          <div class="p-2 bg-zinc-950 rounded-lg border border-zinc-800">
            <div class="font-bold text-white">Remote ML Comp Surges +34%</div>
            <div class="text-[10px] text-zinc-500 mt-0.5">18.4k readers</div>
          </div>
          <div class="p-2 bg-zinc-950 rounded-lg border border-zinc-800">
            <div class="font-bold text-white">RenderCV 2.0 Engine Released</div>
            <div class="text-[10px] text-zinc-500 mt-0.5">11.2k readers</div>
          </div>
        </div>
      </div>

      <div class="card-zinc rounded-xl p-4 space-y-3">
        <h3 class="text-xs font-bold text-white uppercase tracking-wider">Verified Recruiters</h3>
        <div class="space-y-2 text-xs">
          <div class="flex items-center justify-between p-2 bg-zinc-950 rounded-lg border border-zinc-800">
            <div>
              <div class="font-bold text-white">Sarah Jenkins</div>
              <div class="text-[10px] text-zinc-500">Scale AI</div>
            </div>
            <button
              onclick="setOutreachCompany('Scale AI'); switchTab('outreach');"
              class="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold"
            >
              DM
            </button>
          </div>

          <div class="flex items-center justify-between p-2 bg-zinc-950 rounded-lg border border-zinc-800">
            <div>
              <div class="font-bold text-white">David Miller</div>
              <div class="text-[10px] text-zinc-500">Stripe</div>
            </div>
            <button
              onclick="setOutreachCompany('Stripe'); switchTab('outreach');"
              class="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold"
            >
              DM
            </button>
          </div>
        </div>
      </div>
    </aside>

  </div>

  <script>
    let userProfile = {
      name: "Alex Chen",
      headline: "Senior Software & ML Engineer",
      targetRole: "Machine Learning & AI Engineer",
      minSalary: 160000,
      yearsExperience: 6,
      skills: ["Python", "Go", "TypeScript", "SQL", "PyTorch", "Docker", "Kubernetes", "Kafka", "PostgreSQL", "AWS"],
      contact: {
        email: "alex@example.com",
        location: "Austin, TX (Remote)"
      }
    };

    let draftSkills = [...userProfile.skills];
    let loadedJobs = [];
    let activeAtsFilter = 'all';
    let activeMinScore = 0;
    let selectedSkillFilter = null;
    let selectedJobForModal = null;
    let jobStatuses = {};

    // Load persisted profile and job statuses
    const savedProf = localStorage.getItem('career_os_profile');
    if (savedProf) {
      try { userProfile = JSON.parse(savedProf); draftSkills = [...userProfile.skills]; } catch(_) {}
    }

    const savedStatuses = localStorage.getItem('career_os_job_statuses');
    if (savedStatuses) {
      try { jobStatuses = JSON.parse(savedStatuses); } catch(_) {}
    }

    function syncProfileUI() {
      const initials = (userProfile.name || 'AC').split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
      document.getElementById('header-avatar').innerText = initials;
      document.getElementById('card-avatar').innerText = initials;
      document.getElementById('card-name').innerText = userProfile.name;
      document.getElementById('card-headline').innerText = userProfile.headline;
      document.getElementById('card-location').innerText = userProfile.contact?.location || 'Remote';
      document.getElementById('card-min-salary').innerText = '$' + (userProfile.minSalary ? Math.round(userProfile.minSalary/1000) : 160) + 'k/yr';
      
      const skillsCountEl = document.getElementById('card-skills-count');
      if (skillsCountEl) skillsCountEl.innerText = userProfile.skills.length + ' skills';

      const previewEl = document.getElementById('card-skills-preview');
      if (previewEl) {
        previewEl.innerHTML = userProfile.skills.slice(0, 6).map(s => \`
          <button
            onclick="toggleSkillFilter('\${s}')"
            class="px-2 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer \${
              selectedSkillFilter === s
                ? 'bg-blue-600 text-white'
                : 'bg-blue-950 text-blue-300 border border-blue-800 hover:bg-blue-900/60'
            }"
          >
            \${s}
          </button>
        \`).join('') + (userProfile.skills.length > 6 ? \`<span class="text-[10px] text-zinc-400 self-center">+\${userProfile.skills.length - 6}</span>\` : '');
      }

      const hintEl = document.getElementById('banner-skills-hint');
      if (hintEl) hintEl.innerText = userProfile.skills.slice(0, 3).join(', ') + '...';

      document.getElementById('profile-json').value = JSON.stringify(userProfile, null, 2);
      updateTrackerUI();
    }

    function toggleSkillFilter(skill) {
      selectedSkillFilter = selectedSkillFilter === skill ? null : skill;
      syncProfileUI();
      filterJobs();
    }

    function openEditProfile() {
      document.getElementById('edit-name').value = userProfile.name;
      document.getElementById('edit-headline').value = userProfile.headline;
      document.getElementById('edit-target-role').value = userProfile.targetRole || 'ML Engineer';
      document.getElementById('edit-min-salary').value = userProfile.minSalary || 160000;
      document.getElementById('edit-years-exp').value = userProfile.yearsExperience || 6;
      document.getElementById('edit-email').value = userProfile.contact?.email || 'alex@example.com';
      document.getElementById('edit-location').value = userProfile.contact?.location || 'Austin, TX (Remote)';
      draftSkills = [...userProfile.skills];
      renderDraftSkills();
      document.getElementById('profile-modal').classList.remove('hidden');
    }

    function closeEditProfile() {
      document.getElementById('profile-modal').classList.add('hidden');
    }

    function renderDraftSkills() {
      const container = document.getElementById('skills-tags-container');
      container.innerHTML = draftSkills.map((s, idx) => \`
        <span class="px-2.5 py-1 bg-blue-950 text-blue-300 border border-blue-800 rounded-lg text-xs font-semibold flex items-center gap-1.5">
          \${s}
          <button onclick="removeSkill(\${idx})" class="hover:text-rose-400 font-bold">✕</button>
        </span>
      \`).join('');
    }

    function addSkill() {
      const input = document.getElementById('new-skill-input');
      const val = input.value.trim();
      if (val && !draftSkills.includes(val)) {
        draftSkills.push(val);
        renderDraftSkills();
      }
      input.value = '';
    }

    function removeSkill(idx) {
      draftSkills.splice(idx, 1);
      renderDraftSkills();
    }

    function resetProfileDraft() {
      draftSkills = ["Python", "Go", "TypeScript", "SQL", "PyTorch", "Docker", "Kubernetes", "Kafka", "PostgreSQL", "AWS"];
      renderDraftSkills();
    }

    function saveProfile() {
      userProfile = {
        name: document.getElementById('edit-name').value || 'Alex Chen',
        headline: document.getElementById('edit-headline').value || 'Senior ML Engineer',
        targetRole: document.getElementById('edit-target-role').value || 'Machine Learning Engineer',
        minSalary: Number(document.getElementById('edit-min-salary').value) || 160000,
        yearsExperience: Number(document.getElementById('edit-years-exp').value) || 6,
        skills: [...draftSkills],
        contact: {
          email: document.getElementById('edit-email').value || 'alex@example.com',
          location: document.getElementById('edit-location').value || 'Austin, TX (Remote)'
        }
      };

      localStorage.setItem('career_os_profile', JSON.stringify(userProfile));
      syncProfileUI();
      closeEditProfile();
      filterJobs();
    }

    function calculateJobScore(job) {
      const jobText = ((job.Role || '') + ' ' + (job.Company || '') + ' ' + (job.Location || '')).toLowerCase();
      const userSkills = (userProfile.skills || []).map(s => s.toLowerCase());
      let matched = 0;
      userSkills.forEach(s => {
        if (jobText.includes(s)) matched++;
      });
      let score = 78;
      if (userSkills.length > 0) {
        const ratio = matched / Math.min(userSkills.length, 5);
        score = Math.min(99, Math.round(78 + ratio * 21));
      }
      return Math.max(job.MatchPct || 85, score);
    }

    function filterJobsByProfileMatch() {
      document.getElementById('sort-match-checkbox').checked = true;
      document.getElementById('score-90').click();
      switchTab('jobs');
    }

    function filterMinScore(score) {
      activeMinScore = score;
      [0, 85, 90, 95].forEach(s => {
        const btn = document.getElementById('score-' + (s === 0 ? 'all' : s));
        if (btn) {
          if (s === score) {
            btn.className = 'px-2 py-0.5 text-xs rounded-md font-bold bg-blue-600 text-white';
          } else {
            btn.className = 'px-2 py-0.5 text-xs rounded-md font-bold bg-zinc-950 text-zinc-400 border border-zinc-800';
          }
        }
      });
      filterJobs();
    }

    function switchTab(tab) {
      ['jobs', 'tracker', 'ats', 'interview', 'outreach', 'salary', 'resume', 'contacts', 'apply'].forEach(t => {
        const view = document.getElementById('view-' + t);
        const tabBtn = document.getElementById('tab-' + t);
        if (view) view.classList.add('hidden');
        if (tabBtn) tabBtn.className = 'tab-pill';
      });
      const targetView = document.getElementById('view-' + tab);
      const targetBtn = document.getElementById('tab-' + tab);
      if (targetView) targetView.classList.remove('hidden');
      if (targetBtn) targetBtn.className = 'tab-pill active';
      if (tab === 'jobs') loadJobs();
      if (tab === 'tracker') updateTrackerUI();
    }

    function setOutreachCompany(comp) {
      document.getElementById('outreach-company').value = comp;
    }

    async function loadJobs() {
      const container = document.getElementById('jobs-cards-container');
      try {
        const res = await fetch('/api/jobs');
        const data = await res.json();
        loadedJobs = data.jobs || [];
        document.getElementById('live-job-count').innerText = loadedJobs.length + ' Jobs Active';
        const statsEl = document.getElementById('stats-job-count');
        if (statsEl) statsEl.innerText = loadedJobs.length;
        filterJobs();
      } catch (err) {
        container.innerHTML = '<div class="text-center py-8 text-zinc-500 text-xs">Error loading jobs</div>';
      }
    }

    function filterAts(ats) {
      activeAtsFilter = ats;
      ['all', 'Greenhouse', 'Lever', 'Ashby'].forEach(name => {
        const btn = document.getElementById('filter-' + name);
        if (btn) {
          if (name === ats) {
            btn.className = 'px-3 py-1 text-xs rounded-lg font-bold bg-blue-600 text-white';
          } else {
            btn.className = 'px-3 py-1 text-xs rounded-lg font-bold bg-zinc-950 text-zinc-400 border border-zinc-800 hover:text-white';
          }
        }
      });
      filterJobs();
    }

    function filterJobs() {
      const q = (document.getElementById('global-search-input')?.value || '').toLowerCase();
      const remoteOnly = document.getElementById('filter-remote-checkbox')?.checked;
      const sortByMatch = document.getElementById('sort-match-checkbox')?.checked;

      let filtered = loadedJobs.map((j, index) => ({
        ...j,
        jobKey: (j.Company || 'Co') + '-' + (j.Role || 'Role') + '-' + index,
        dynamicMatch: calculateJobScore(j)
      })).filter(j => {
        const matchSearch = (j.Company + ' ' + j.Role + ' ' + (j.Location || '')).toLowerCase().includes(q);
        const matchAts = activeAtsFilter === 'all' || (j.ATS || '').toLowerCase() === activeAtsFilter.toLowerCase();
        const matchScore = j.dynamicMatch >= activeMinScore;
        const matchRemote = !remoteOnly || (j.Location || '').toLowerCase().includes('remote');
        const matchSkill = !selectedSkillFilter || (j.Role + ' ' + j.Company).toLowerCase().includes(selectedSkillFilter.toLowerCase());
        return matchSearch && matchAts && matchScore && matchRemote && matchSkill;
      });

      if (sortByMatch) {
        filtered.sort((a, b) => b.dynamicMatch - a.dynamicMatch);
      }

      const counterEl = document.getElementById('job-match-counter');
      if (counterEl) counterEl.innerText = filtered.length + ' jobs matched';

      renderJobsList(filtered);
    }

    function renderJobsList(jobs) {
      const container = document.getElementById('jobs-cards-container');
      if (jobs.length === 0) {
        container.innerHTML = '<div class="card-zinc rounded-xl p-12 text-center text-xs text-zinc-400">No jobs match your search criteria.</div>';
        return;
      }
      container.innerHTML = jobs.slice(0, 20).map((j, idx) => {
        const currentStatus = jobStatuses[j.jobKey];
        return \`
        <div onclick="openJobQuickView(\${idx})" class="card-zinc hover:border-blue-500 rounded-xl p-4 transition space-y-3 cursor-pointer">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-start gap-3">
              <div class="w-11 h-11 rounded-lg bg-zinc-950 border border-zinc-800 text-blue-400 font-black text-xs flex items-center justify-center shrink-0">
                \${(j.Company || 'CO').slice(0,2).toUpperCase()}
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-bold text-white hover:text-blue-400">
                    \${j.Role || 'Senior ML Engineer'}
                  </h3>
                  <span class="px-2 py-0.5 bg-blue-950 text-blue-400 border border-blue-800/80 rounded text-[10px] font-black">
                    \${j.dynamicMatch || 95}% MATCH
                  </span>
                  \${currentStatus ? \`<span class="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded text-[10px] font-bold uppercase">\${currentStatus}</span>\` : ''}
                </div>
                <p class="text-xs text-zinc-400 mt-0.5 font-medium">
                  <span class="text-zinc-200">\${j.Company || 'Tech Corp'}</span> • \${j.Location || 'Remote'}
                </p>
                <div class="flex items-center gap-2 mt-2">
                  <span class="px-2 py-0.5 rounded bg-zinc-950 text-zinc-300 border border-zinc-800 text-[10px] font-semibold">\${j.ATS || 'Greenhouse'}</span>
                  <span class="text-xs font-semibold text-zinc-300">\${j.Salary || '$165k - $220k'}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between pt-3 border-t border-zinc-800 text-xs">
            <button onclick="event.stopPropagation(); tailorForJob('\${(j.Role || '').replace(/'/g, '')}', '\${(j.Company || '').replace(/'/g, '')}')" class="font-bold text-blue-400 hover:underline flex items-center gap-1">
              Tailor Resume
            </button>
            <div class="flex items-center gap-2">
              <button onclick="event.stopPropagation(); openJobQuickView(\${idx})" class="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-blue-500 font-bold text-xs flex items-center gap-1 transition text-zinc-300">
                Details
              </button>
              <a href="\${j['Apply URL'] || '#'}" target="_blank" onclick="event.stopPropagation(); markJobStatus('\${j.jobKey}', 'applied')" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1 transition shadow-sm">
                Easy Apply →
              </a>
            </div>
          </div>
        </div>
      \`;
      }).join('');
    }

    function openJobQuickView(index) {
      const q = (document.getElementById('global-search-input')?.value || '').toLowerCase();
      const filtered = loadedJobs.map((j, i) => ({
        ...j,
        jobKey: (j.Company || 'Co') + '-' + (j.Role || 'Role') + '-' + i,
        dynamicMatch: calculateJobScore(j)
      }));
      const job = filtered[index];
      if (!job) return;

      selectedJobForModal = job;
      document.getElementById('modal-job-role').innerText = job.Role || 'Senior ML Engineer';
      document.getElementById('modal-job-match').innerText = (job.dynamicMatch || 95) + '% MATCH';
      document.getElementById('modal-job-subtitle').innerText = (job.Company || 'Tech Corp') + ' • ' + (job.Location || 'Remote') + ' • ' + (job.ATS || 'Direct');
      document.getElementById('modal-job-salary').innerText = job.Salary || '$165k - $220k';
      document.getElementById('modal-job-ats').innerText = job.ATS || 'Direct API';
      document.getElementById('modal-apply-link').href = job['Apply URL'] || '#';

      updateModalStatusButtons(job.jobKey);
      document.getElementById('job-quickview-modal').classList.remove('hidden');
    }

    function closeJobQuickView() {
      document.getElementById('job-quickview-modal').classList.add('hidden');
      selectedJobForModal = null;
    }

    function updateModalStatusButtons(jobKey) {
      const current = jobStatuses[jobKey];
      ['saved', 'applied', 'interviewing', 'offer'].forEach(st => {
        const btn = document.getElementById('status-btn-' + st);
        if (btn) {
          if (current === st) {
            btn.className = 'px-2 py-1 rounded text-[10px] font-bold bg-blue-600 text-white';
          } else {
            btn.className = 'px-2 py-1 rounded text-[10px] font-bold border border-zinc-700 text-zinc-400';
          }
        }
      });
    }

    function updateSelectedJobStatus(status) {
      if (!selectedJobForModal) return;
      markJobStatus(selectedJobForModal.jobKey, status);
      updateModalStatusButtons(selectedJobForModal.jobKey);
    }

    function markJobStatus(jobKey, status) {
      jobStatuses[jobKey] = status;
      localStorage.setItem('career_os_job_statuses', JSON.stringify(jobStatuses));
      updateTrackerUI();
      filterJobs();
    }

    function updateTrackerUI() {
      const counts = { saved: 0, applied: 0, interviewing: 0, offer: 0 };
      Object.values(jobStatuses).forEach(st => {
        if (counts[st] !== undefined) counts[st]++;
      });

      const savedEl = document.getElementById('tracker-count-saved');
      if (savedEl) savedEl.innerText = counts.saved;
      const appliedEl = document.getElementById('tracker-count-applied');
      if (appliedEl) appliedEl.innerText = counts.applied;
      const intEl = document.getElementById('tracker-count-interviewing');
      if (intEl) intEl.innerText = counts.interviewing;
      const offerEl = document.getElementById('tracker-count-offer');
      if (offerEl) offerEl.innerText = counts.offer;

      const sidebarBadge = document.getElementById('sidebar-tracker-badge');
      if (sidebarBadge) sidebarBadge.innerText = (counts.applied + counts.interviewing) + ' Active';
    }

    function launchAtsFromModal() {
      if (!selectedJobForModal) return;
      const j = selectedJobForModal;
      closeJobQuickView();
      tailorForJob(j.Role, j.Company);
    }

    function launchInterviewFromModal() {
      if (!selectedJobForModal) return;
      const j = selectedJobForModal;
      closeJobQuickView();
      switchTab('interview');
      generatePrepSheet();
    }

    function launchOutreachFromModal() {
      if (!selectedJobForModal) return;
      const j = selectedJobForModal;
      closeJobQuickView();
      setOutreachCompany(j.Company || 'Scale AI');
      document.getElementById('outreach-role').value = j.Role || 'Senior ML Engineer';
      switchTab('outreach');
      generateOutreach();
    }

    function tailorForJob(role, company) {
      document.getElementById('jd-text').value = role + ' at ' + company + '\\nRequirements: Machine Learning, Distributed Systems, Python, Go, Kafka, AWS.';
      switchTab('ats');
      calculateAts();
    }

    async function calculateAts() {
      const jdText = document.getElementById('jd-text').value;
      const container = document.getElementById('ats-results-container');
      if (!jdText.trim()) {
        container.innerHTML = '<div class="text-xs text-blue-400 font-bold mt-2">Please paste a Job Description first.</div>';
        return;
      }
      container.innerHTML = '<div class="text-xs text-blue-400 animate-pulse mt-2">Calculating keyword density...</div>';
      try {
        const res = await fetch('/api/ats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resumeText: JSON.stringify(userProfile), jdText })
        });
        const data = await res.json();
        container.innerHTML = \`
          <div class="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-4 mt-4">
            <div class="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800">
              <div>
                <div class="text-[10px] text-zinc-400 font-bold uppercase">ATS Grade</div>
                <div class="text-2xl font-black text-blue-400">\${data.grade}</div>
              </div>
              <div class="text-right">
                <div class="text-[10px] text-zinc-400 font-bold uppercase">Match Score</div>
                <div class="text-2xl font-black text-white">\${data.scorePct}%</div>
              </div>
            </div>
            <div>
              <div class="text-xs font-bold text-blue-400 mb-2">Matched Keywords (\${data.matchedCount}):</div>
              <div class="flex flex-wrap gap-1 max-h-28 overflow-y-auto">\${(data.matchedKeywords || []).map(k => \`<span class="px-2 py-0.5 bg-blue-950 text-blue-300 border border-blue-800 text-[10px] font-bold rounded">✓ \${k}</span>\`).join('')}</div>
            </div>
            <div>
              <div class="text-xs font-bold text-zinc-400 mb-2">Missing Keywords:</div>
              <div class="flex flex-wrap gap-1 max-h-28 overflow-y-auto">\${(data.missingKeywords || []).map(k => \`<span class="px-2 py-0.5 bg-zinc-900 text-zinc-400 border border-zinc-800 text-[10px] font-bold rounded">✗ \${k}</span>\`).join('')}</div>
            </div>
          </div>
        \`;
      } catch (err) {
        container.innerHTML = '<div class="text-xs text-zinc-500 mt-2">Error calculating score</div>';
      }
    }

    async function loadContacts() {
      const container = document.getElementById('contacts-table-body');
      if (!container) return;
      try {
        const res = await fetch('/api/contacts');
        const data = await res.json();
        const list = data.contacts || [];
        container.innerHTML = list.map(c => \`
          <tr class="hover:bg-zinc-800/40 transition">
            <td class="p-3 font-bold text-white">\${c.name || 'Recruiter'}</td>
            <td class="p-3 text-zinc-300">\${c.company || 'Tech Corp'}</td>
            <td class="p-3 font-mono text-blue-400">\${c.email || 'recruiter@tech.com'}</td>
            <td class="p-3">
              <button onclick="setOutreachCompany('\${c.company}'); switchTab('outreach');" class="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-[10px]">
                Outreach
              </button>
            </td>
          </tr>
        \`).join('');
      } catch (err) {
        container.innerHTML = '<tr><td colSpan="4" class="p-4 text-center text-zinc-500">Error loading directory</td></tr>';
      }
    }

    async function generatePrepSheet() {
      const container = document.getElementById('interview-prep-results');
      container.innerHTML = '<div class="text-xs text-blue-400 animate-pulse">Generating STAR stories...</div>';
      try {
        const res = await fetch('/api/interview-prep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: userProfile })
        });
        const data = await res.json();
        container.innerHTML = \`
          <div class="space-y-3 mt-4">
            \${data.prep.starStories.map((s, idx) => \`
              <div class="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2 text-xs">
                <div class="font-bold text-sm text-white">Q\${idx + 1}: "\${s.question}"</div>
                <div class="text-zinc-400"><strong class="text-zinc-200">Situation:</strong> \${s.situation}</div>
                <div class="text-zinc-400"><strong class="text-zinc-200">Task:</strong> \${s.task}</div>
                <div class="text-zinc-400"><strong class="text-zinc-200">Action:</strong> \${s.action}</div>
                <div class="text-blue-400 font-bold"><strong class="text-zinc-200">Result:</strong> \${s.result}</div>
              </div>
            \`).join('')}
          </div>
        \`;
      } catch (err) {
        container.innerHTML = '<div class="text-xs text-zinc-500">Error: ' + err.message + '</div>';
      }
    }

    async function generateOutreach() {
      const company = document.getElementById('outreach-company').value || 'Scale AI';
      const role = document.getElementById('outreach-role').value || 'Senior ML Engineer';
      const container = document.getElementById('outreach-output-container');
      container.innerHTML = 'Writing cold email...';
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, role })
      });
      const data = await res.json();
      container.innerText = \`Subject: \${data.outreach.coldEmailSubject}\n\n\${data.outreach.coldEmailBody}\n\n--- 5-DAY FOLLOW-UP ---\n\${data.outreach.followUpDay5}\`;
    }

    async function evaluateSalary() {
      const role = document.getElementById('salary-role').value || 'Senior ML Engineer';
      const offered = document.getElementById('salary-offered').value || 185000;
      const container = document.getElementById('salary-output-container');
      container.innerHTML = '<div class="text-xs text-blue-400 animate-pulse">Evaluating offer...</div>';
      const res = await fetch('/api/salary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, offered })
      });
      const data = await res.json();
      const s = data.salary;
      container.innerHTML = \`
        <div class="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-4 mt-4">
          <div class="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800">
            <div>
              <div class="text-[10px] text-zinc-400 font-bold uppercase">Market Verdict</div>
              <div class="text-lg font-black text-blue-400">\${s.verdict}</div>
            </div>
            <div class="text-right">
              <div class="text-[10px] text-zinc-400 font-bold uppercase">Suggested Counter</div>
              <div class="text-lg font-black text-white">\${s.suggestedCounter}</div>
            </div>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div class="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <span class="text-[10px] text-zinc-400 block">25th Pct</span>
              <span class="font-bold text-white">\${s.benchmarks?.p25}</span>
            </div>
            <div class="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <span class="text-[10px] text-zinc-400 block">Median</span>
              <span class="font-bold text-blue-400">\${s.benchmarks?.p50}</span>
            </div>
            <div class="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <span class="text-[10px] text-zinc-400 block">75th Pct</span>
              <span class="font-bold text-white">\${s.benchmarks?.p75}</span>
            </div>
            <div class="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <span class="text-[10px] text-zinc-400 block">90th Pct</span>
              <span class="font-bold text-white">\${s.benchmarks?.p90}</span>
            </div>
          </div>
          <div class="space-y-1">
            <div class="text-xs font-bold text-white">Counter Script:</div>
            <pre class="text-xs font-mono p-3 rounded-lg bg-zinc-900 border border-zinc-800 whitespace-pre-wrap text-zinc-300">\${s.counterScript}</pre>
          </div>
        </div>
      \`;
    }

    async function renderPdf() {
      const container = document.getElementById('pdf-preview-container');
      const theme = document.getElementById('resume-theme').value;
      container.innerHTML = '<div class="text-xs text-blue-400 animate-pulse">Compiling PDF...</div>';
      try {
        const payload = JSON.parse(document.getElementById('profile-json').value);
        const res = await fetch('/api/rendercv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, options: { theme } })
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        container.innerHTML = '<iframe src="' + url + '" class="w-full h-80 rounded border border-zinc-800"></iframe>';
      } catch (err) {
        container.innerHTML = '<div class="text-xs text-zinc-500">Error compiling PDF</div>';
      }
    }

    function initTheme() {
      const saved = localStorage.getItem('career_os_theme') || 'dark';
      applyTheme(saved);
    }

    function toggleTheme() {
      const isLight = document.body.classList.contains('light-mode');
      const next = isLight ? 'dark' : 'light';
      applyTheme(next);
      localStorage.setItem('career_os_theme', next);
    }

    function applyTheme(t) {
      const btn = document.getElementById('theme-toggle-btn');
      const icon = document.getElementById('theme-toggle-icon');
      const label = document.getElementById('theme-toggle-text');
      const badge = document.getElementById('theme-mode-badge');
      if (t === 'light') {
        document.body.classList.add('light-mode');
        if (icon) icon.innerText = '☀️';
        if (label) label.innerText = 'Day';
        if (badge) {
          badge.innerText = 'DAY';
          badge.className = 'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200';
        }
        if (btn) btn.className = 'px-2.5 py-1 rounded-lg border border-zinc-300 bg-zinc-100 hover:bg-zinc-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer text-zinc-800 shadow-sm';
      } else {
        document.body.classList.remove('light-mode');
        if (icon) icon.innerText = '🌙';
        if (label) label.innerText = 'Dark';
        if (badge) {
          badge.innerText = 'DARK';
          badge.className = 'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800/60';
        }
        if (btn) btn.className = 'px-2.5 py-1 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer text-zinc-200 shadow-sm';
      }
    }

    syncProfileUI();
    initTheme();
    loadJobs();
    loadContacts();
  </script>
</body>
</html>`;

const DEFAULT_CONTACTS = [
  { name: "Sarah Jenkins", company: "Scale AI", title: "Senior Technical Recruiter", email: "sarah.j@scale.com", type: "Internal Recruiter" },
  { name: "David Miller", company: "Stripe", title: "Lead AI/ML Recruiter", email: "d.miller@stripe.com", type: "Internal Recruiter" },
  { name: "Elena Rostova", company: "Anthropic", title: "Engineering Talent Partner", email: "elena@anthropic.com", type: "Executive Search" },
  { name: "Marcus Vance", company: "Databricks", title: "Staff Technical Recruiter", email: "m.vance@databricks.com", type: "Internal Recruiter" },
  { name: "Priya Sharma", company: "Coinbase", title: "Technical Sourcing Lead", email: "psharma@coinbase.com", type: "Internal Recruiter" },
  { name: "Alex Mercer", company: "Mistral AI", title: "Global Talent Acquisition", email: "alex@mistral.ai", type: "Executive Search" }
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/favicon.ico') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📄</text></svg>');
  }

  if (url.pathname === '/' || url.pathname === '/studio') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML_STUDIO);
  }

  // API 0: Jobs
  if (url.pathname === '/api/jobs' && req.method === 'GET') {
    let jobs = [];
    const path = resolve(PIPELINE_DIR, 'output', '2026-08-18', 'daily-shortlist.json');
    if (existsSync(path)) {
      try { jobs = JSON.parse(readFileSync(path, 'utf8')); } catch (_) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ jobs }));
  }

  // API: ATS Score
  if (url.pathname === '/api/ats' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      try {
        const body = JSON.parse(bodyStr || '{}');
        const result = calculateAtsScore(body.resumeText || '', body.jdText || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Contacts / Directory
  if (url.pathname === '/api/contacts' && req.method === 'GET') {
    let contacts = DEFAULT_CONTACTS;
    const contactsPath = resolve(__dirname, 'data', 'contacts.tsv');
    if (existsSync(contactsPath)) {
      try {
        const raw = readFileSync(contactsPath, 'utf8');
        const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        if (lines.length > 0) {
          contacts = lines.map(line => {
            const p = line.split('\t');
            return { name: p[0] || '', company: p[1] || '', type: p[2] || 'recruiter', title: p[3] || '', phone: p[4] || '', email: p[5] || '' };
          });
        }
      } catch (_) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ contacts }));
  }

  // API: Interview Prep
  if (url.pathname === '/api/interview-prep' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      const body = JSON.parse(bodyStr || '{}');
      const prep = generateInterviewPrep(body.payload, body.jdText);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prep }));
    });
    return;
  }

  // API: Outreach
  if (url.pathname === '/api/outreach' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      const body = JSON.parse(bodyStr || '{}');
      const outreach = generateOutreachCadence(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ outreach }));
    });
    return;
  }

  // API: Salary
  if (url.pathname === '/api/salary' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      const body = JSON.parse(bodyStr || '{}');
      const salary = evaluateSalaryOffer(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ salary }));
    });
    return;
  }

  // API 1: RenderCV PDF Generation
  if (url.pathname === '/api/rendercv' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', async () => {
      try {
        const body = JSON.parse(bodyStr);
        const tempJson = resolve(__dirname, `.temp-web-${Date.now()}.json`);
        const outputDir = resolve(__dirname, 'output');
        await writeFile(tempJson, JSON.stringify(body.payload, null, 2), 'utf8');

        await buildCvRenderCv(tempJson, null, { theme: body.options?.theme || 'classic' });

        const files = readdirSync(outputDir)
          .filter(f => f.endsWith('.pdf'))
          .map(f => ({ name: f, time: statSync(join(outputDir, f)).mtimeMs }))
          .sort((a, b) => b.time - a.time);

        if (files.length > 0) {
          const pdfBuffer = readFileSync(join(outputDir, files[0].name));
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${files[0].name}"`
          });
          res.end(pdfBuffer);
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'PDF generation failed' }));
        }

        try {
          const { unlink } = await import('fs/promises');
          await unlink(tempJson);
        } catch (_) {}
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`\n🚀 Candidate Career Acceleration Command Center Active!`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}/studio\n`);
});
