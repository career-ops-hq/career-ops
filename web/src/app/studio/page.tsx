"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Search,
  Zap,
  Target,
  Mic,
  Send,
  DollarSign,
  FileText,
  Users,
  Bot,
  CheckCircle2,
  XCircle,
  Copy,
  ChevronRight,
  Bookmark,
  Heart,
  Sliders,
  RefreshCw,
  CheckCheck,
  Sun,
  Moon,
  ArrowUpRight,
  User,
  Edit3,
  X,
  Sparkles,
  Filter,
  Check,
  Download,
  Settings,
  TrendingUp,
  Briefcase,
  Layers,
  MapPin,
  Clock,
  Eye,
  CheckSquare,
  BarChart2,
  ExternalLink,
  ChevronDown
} from "lucide-react";

const INITIAL_PROFILE = {
  name: "Alex Chen",
  headline: "Senior Software & ML Engineer",
  targetRole: "Machine Learning & AI Engineer",
  yearsExperience: 6,
  minSalary: 160000,
  remoteOnly: true,
  contact: {
    email: "alex@example.com",
    phone: "+1 (512) 555-0199",
    location: "Austin, TX (Remote)",
    linkedin: "https://linkedin.com/in/alexchen",
    github: "https://github.com/alexchen",
    website: "https://alexchen.dev"
  },
  skills: [
    "Python",
    "Go",
    "TypeScript",
    "SQL",
    "PyTorch",
    "Docker",
    "Kubernetes",
    "Kafka",
    "PostgreSQL",
    "AWS",
    "Distributed Systems"
  ],
  summary: [
    "Full-stack AI engineer with 6 years building production ML systems and high-throughput microservices."
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
  ]
};

export default function EnhancedJobStudio() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState<"jobs" | "tracker" | "ats" | "interview" | "outreach" | "salary" | "resume" | "contacts" | "apply">("jobs");
  
  // Profile State
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState(INITIAL_PROFILE);
  const [newSkillInput, setNewSkillInput] = useState("");

  // Selected Job for Deep-Dive Drawer
  const [selectedJob, setSelectedJob] = useState<any | null>(null);

  // Application Status Tracker State (jobId -> status)
  const [jobStatuses, setJobStatuses] = useState<Record<string, "saved" | "applied" | "interviewing" | "offer">>({});

  // Resume PDF State
  const [theme, setTheme] = useState("classic");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState("");

  // Jobs State & Advanced Filters
  const [jobs, setJobs] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [jobFilterAts, setJobFilterAts] = useState("all");
  const [minMatchScore, setMinMatchScore] = useState<number>(0);
  const [filterRemoteOnly, setFilterRemoteOnly] = useState(false);
  const [selectedSkillFilter, setSelectedSkillFilter] = useState<string | null>(null);
  const [sortByProfileMatch, setSortByProfileMatch] = useState(true);
  
  const [likedJobIndices, setLikedJobIndices] = useState<Record<number, boolean>>({});
  const [savedJobIndices, setSavedJobIndices] = useState<Record<number, boolean>>({});

  // ATS State
  const [jdText, setJdText] = useState("");
  const [atsScore, setAtsScore] = useState<any>(null);
  const [isScoring, setIsScoring] = useState(false);

  // Contacts state
  const [contacts, setContacts] = useState<any[]>([]);

  // Interview Prep State
  const [interviewPrep, setInterviewPrep] = useState<any>(null);
  const [isGeneratingPrep, setIsGeneratingPrep] = useState(false);

  // Outreach State
  const [outreachCompany, setOutreachCompany] = useState("Scale AI");
  const [outreachRole, setOutreachRole] = useState("Senior ML Engineer");
  const [outreachResult, setOutreachResult] = useState<any>(null);
  const [isGeneratingOutreach, setIsGeneratingOutreach] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Salary State
  const [salaryRole, setSalaryRole] = useState("Senior ML Engineer");
  const [salaryOffered, setSalaryOffered] = useState<number>(185000);
  const [salaryResult, setSalaryResult] = useState<any>(null);
  const [isEvaluatingSalary, setIsEvaluatingSalary] = useState(false);

  useEffect(() => {
    fetchJobs();
    fetchContacts();
    
    // Load persisted preferences
    const savedTheme = localStorage.getItem("career_os_theme");
    if (savedTheme === "light") setIsDarkMode(false);

    const savedProfile = localStorage.getItem("career_os_profile");
    if (savedProfile) {
      try {
        const parsed = JSON.parse(savedProfile);
        setProfile(parsed);
        setProfileDraft(parsed);
      } catch (e) {
        console.error(e);
      }
    }

    const savedStatuses = localStorage.getItem("career_os_job_statuses");
    if (savedStatuses) {
      try { setJobStatuses(JSON.parse(savedStatuses)); } catch (e) {}
    }
  }, []);

  const toggleDayDarkMode = () => {
    const nextMode = !isDarkMode;
    setIsDarkMode(nextMode);
    localStorage.setItem("career_os_theme", nextMode ? "dark" : "light");
  };

  const fetchJobs = async () => {
    setLoadingJobs(true);
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingJobs(false);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await fetch("/api/contacts");
      const data = await res.json();
      setContacts(data.contacts || []);
    } catch (e) {
      console.error(e);
    }
  };

  // Save Edited Profile
  const handleSaveProfile = () => {
    setProfile(profileDraft);
    localStorage.setItem("career_os_profile", JSON.stringify(profileDraft));
    setIsEditProfileOpen(false);
  };

  const handleAddSkill = () => {
    if (!newSkillInput.trim()) return;
    if (!profileDraft.skills.includes(newSkillInput.trim())) {
      setProfileDraft(prev => ({
        ...prev,
        skills: [...prev.skills, newSkillInput.trim()]
      }));
    }
    setNewSkillInput("");
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setProfileDraft(prev => ({
      ...prev,
      skills: prev.skills.filter(s => s !== skillToRemove)
    }));
  };

  const handleUpdateJobStatus = (jobKey: string, status: "saved" | "applied" | "interviewing" | "offer") => {
    const updated = { ...jobStatuses, [jobKey]: status };
    setJobStatuses(updated);
    localStorage.setItem("career_os_job_statuses", JSON.stringify(updated));
  };

  // Calculate dynamic match score for a job based on current profile skills
  const calculateJobScore = (job: any) => {
    const jobText = (job.Role + " " + job.Company + " " + (job.Location || "")).toLowerCase();
    const userSkills = profile.skills.map(s => s.toLowerCase());
    
    let matchedSkillsCount = 0;
    userSkills.forEach(skill => {
      if (jobText.includes(skill)) matchedSkillsCount++;
    });

    let dynamicScore = 78;
    if (userSkills.length > 0) {
      const ratio = matchedSkillsCount / Math.min(userSkills.length, 5);
      dynamicScore = Math.min(99, Math.round(78 + ratio * 21));
    }
    return Math.max(job.MatchPct || 85, dynamicScore);
  };

  // Filtered & Ranked Jobs
  const filteredAndRankedJobs = useMemo(() => {
    return jobs
      .map((job, index) => ({
        ...job,
        jobKey: `${job.Company}-${job.Role}-${index}`,
        dynamicMatch: calculateJobScore(job)
      }))
      .filter(j => {
        const q = searchQuery.toLowerCase();
        const matchSearch = !q || (j.Role + " " + j.Company + " " + (j.Location || "")).toLowerCase().includes(q);
        const matchAts = jobFilterAts === "all" || (j.ATS || "").toLowerCase() === jobFilterAts.toLowerCase();
        const matchScore = j.dynamicMatch >= minMatchScore;
        const matchRemote = !filterRemoteOnly || (j.Location || "").toLowerCase().includes("remote");
        const matchSkill = !selectedSkillFilter || (j.Role + " " + j.Company).toLowerCase().includes(selectedSkillFilter.toLowerCase());

        return matchSearch && matchAts && matchScore && matchRemote && matchSkill;
      })
      .sort((a, b) => {
        if (sortByProfileMatch) return b.dynamicMatch - a.dynamicMatch;
        return 0;
      });
  }, [jobs, searchQuery, jobFilterAts, minMatchScore, filterRemoteOnly, selectedSkillFilter, sortByProfileMatch, profile]);

  const trackerCounts = useMemo(() => {
    const counts = { saved: 0, applied: 0, interviewing: 0, offer: 0 };
    Object.values(jobStatuses).forEach(st => {
      if (counts[st] !== undefined) counts[st]++;
    });
    return counts;
  }, [jobStatuses]);

  const handleRenderPdf = async () => {
    setIsRendering(true);
    setRenderError("");
    try {
      const payload = {
        name: profile.name,
        headline: profile.headline,
        contact: profile.contact,
        summary: profile.summary,
        experience: profile.experience,
        skills: [{ category: "Core Technologies", items: profile.skills }]
      };
      const res = await fetch("/api/rendercv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, options: { theme } })
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (err: any) {
      setRenderError(err.message || "Failed to render PDF");
    } finally {
      setIsRendering(false);
    }
  };

  const handleCalculateAts = async () => {
    if (!jdText.trim()) return;
    setIsScoring(true);
    try {
      const res = await fetch("/api/ats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: JSON.stringify(profile), jdText })
      });
      const data = await res.json();
      setAtsScore(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsScoring(false);
    }
  };

  const handleGeneratePrep = async () => {
    setIsGeneratingPrep(true);
    try {
      const res = await fetch("/api/interview-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: profile, jdText })
      });
      const data = await res.json();
      setInterviewPrep(data.prep);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingPrep(false);
    }
  };

  const handleGenerateOutreach = async () => {
    setIsGeneratingOutreach(true);
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: outreachCompany, role: outreachRole })
      });
      const data = await res.json();
      setOutreachResult(data.outreach);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingOutreach(false);
    }
  };

  const handleEvaluateSalary = async () => {
    setIsEvaluatingSalary(true);
    try {
      const res = await fetch("/api/salary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: salaryRole, offered: salaryOffered })
      });
      const data = await res.json();
      setSalaryResult(data.salary);
    } catch (err) {
      console.error(err);
    } finally {
      setIsEvaluatingSalary(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const toggleLike = (idx: number) => {
    setLikedJobIndices(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleSave = (idx: number) => {
    setSavedJobIndices(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Launch Actions for Selected Job
  const launchAtsForJob = (job: any) => {
    setJdText(`${job.Role} at ${job.Company}\nLocation: ${job.Location || 'Remote'}\nRequirements: Machine Learning, Distributed Systems, Python, Go, Kafka, AWS, Docker, Kubernetes.`);
    setActiveTab("ats");
    setSelectedJob(null);
  };

  const launchInterviewPrepForJob = (job: any) => {
    setJdText(`${job.Role} at ${job.Company}`);
    setActiveTab("interview");
    setSelectedJob(null);
    handleGeneratePrep();
  };

  const launchOutreachForJob = (job: any) => {
    setOutreachCompany(job.Company || "Scale AI");
    setOutreachRole(job.Role || "Senior ML Engineer");
    setActiveTab("outreach");
    setSelectedJob(null);
    handleGenerateOutreach();
  };

  // Color Classes
  const bgMain = isDarkMode ? "bg-[#09090b] text-white" : "bg-[#f4f4f5] text-zinc-900";
  const headerBg = isDarkMode ? "bg-[#0f0f12]/95 border-zinc-800" : "bg-white/95 border-zinc-200 shadow-sm";
  const cardBg = isDarkMode ? "bg-zinc-900/90 border-zinc-800 text-white" : "bg-white border-zinc-200 text-zinc-900 shadow-xs";
  const cardSubBg = isDarkMode ? "bg-zinc-950 border-zinc-800" : "bg-zinc-100 border-zinc-200";
  const inputBg = isDarkMode ? "bg-zinc-950 border-zinc-800 text-white" : "bg-zinc-50 border-zinc-300 text-zinc-900";
  const textMuted = isDarkMode ? "text-zinc-400" : "text-zinc-500";
  const navContainerBg = isDarkMode ? "bg-zinc-950 border-zinc-800" : "bg-zinc-100 border-zinc-200";
  const navInactiveText = isDarkMode ? "text-zinc-400 hover:text-white hover:bg-zinc-900" : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200";

  return (
    <div className={`min-h-screen font-sans pb-16 transition-colors duration-200 selection:bg-blue-600 selection:text-white ${bgMain}`}>
      
      {/* HEADER */}
      <header className={`sticky top-0 z-50 backdrop-blur-xl border-b px-4 sm:px-6 py-3 transition-colors ${headerBg}`}>
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          
          {/* LOGO */}
          <div className="flex items-center gap-3 shrink-0 cursor-pointer" onClick={() => setActiveTab("jobs")}>
            <div className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 transition flex items-center justify-center font-black text-white shadow-md shadow-blue-600/30">
              <Zap className="size-4.5 fill-white" />
            </div>
            <div>
              <div className="text-sm font-black tracking-tight flex items-center gap-1.5">
                CAREER<span className="text-blue-600">.OS</span>
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                  {isDarkMode ? "DARK" : "DAY"}
                </span>
              </div>
              <div className={`text-[10px] font-medium ${textMuted}`}>{filteredAndRankedJobs.length} Live Drops Active</div>
            </div>
          </div>

          {/* NAVIGATION BAR */}
          <nav className={`flex items-center gap-1 p-1 rounded-xl border overflow-x-auto no-scrollbar ${navContainerBg}`}>
            {[
              { id: "jobs", label: "Jobs", icon: "💼" },
              { id: "tracker", label: "Tracker", icon: "📊" },
              { id: "ats", label: "ATS Match", icon: "🎯" },
              { id: "interview", label: "STAR Prep", icon: "🎙️" },
              { id: "outreach", label: "Outreach", icon: "📬" },
              { id: "salary", label: "Salary", icon: "💰" },
              { id: "resume", label: "Resume PDF", icon: "📄" },
              { id: "contacts", label: "Recruiters", icon: "👥" },
              { id: "apply", label: "Auto-Apply", icon: "⚡" }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 flex items-center gap-1.5 ${
                  activeTab === tab.id ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : navInactiveText
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          {/* RIGHT ACTIONS: SEARCH, EDIT PROFILE, THEME & AVATAR */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-2 size-3.5 text-zinc-400" />
              <input
                type="text"
                placeholder="Search jobs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className={`w-32 focus:w-44 transition-all duration-200 rounded-lg pl-8 pr-3 py-1 text-xs focus:outline-none focus:border-blue-500 border ${inputBg}`}
              />
            </div>

            {/* EDIT PROFILE BUTTON */}
            <button
              onClick={() => { setProfileDraft(profile); setIsEditProfileOpen(true); }}
              className="px-2.5 py-1.5 rounded-lg border border-blue-600/40 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer active:scale-95"
              title="Edit Profile"
            >
              <Edit3 className="size-3.5" />
              <span className="hidden sm:inline">Edit Profile</span>
            </button>

            {/* DAY / DARK MODE TOGGLE */}
            <button
              onClick={toggleDayDarkMode}
              className="px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer active:scale-95"
              title="Switch Day/Dark Mode"
            >
              {isDarkMode ? (
                <>
                  <Sun className="size-4 text-amber-400" />
                  <span className="hidden sm:inline text-zinc-200">Day</span>
                </>
              ) : (
                <>
                  <Moon className="size-4 text-blue-600" />
                  <span className="hidden sm:inline text-zinc-700">Dark</span>
                </>
              )}
            </button>

            <button
              onClick={() => { setProfileDraft(profile); setIsEditProfileOpen(true); }}
              className="w-8 h-8 rounded-lg bg-blue-600 text-white font-bold text-xs flex items-center justify-center shadow-xs cursor-pointer hover:bg-blue-500 transition"
              title="Open Profile"
            >
              {profile.name.split(" ").map(n => n[0]).join("") || "AC"}
            </button>
          </div>

        </div>
      </header>

      {/* JOB QUICK-VIEW MODAL / DRAWER */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-xl rounded-2xl border p-6 space-y-4 shadow-2xl relative ${cardBg}`}>
            
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-zinc-900 dark:text-white">{selectedJob.Role}</h2>
                  <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded text-[10px] font-black">
                    {selectedJob.dynamicMatch}% MATCH
                  </span>
                </div>
                <p className={`text-xs mt-1 ${textMuted}`}>
                  <strong className="text-zinc-900 dark:text-white">{selectedJob.Company}</strong> • {selectedJob.Location || "Remote"} • {selectedJob.ATS || "Greenhouse"}
                </p>
              </div>
              <button onClick={() => setSelectedJob(null)} className="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition text-zinc-400">
                <X className="size-5" />
              </button>
            </div>

            <div className={`p-3 rounded-xl border text-xs space-y-2 ${cardSubBg}`}>
              <div className="flex justify-between">
                <span className={textMuted}>Target Compensation:</span>
                <span className="font-bold">{selectedJob.Salary || "$165k - $220k"}</span>
              </div>
              <div className="flex justify-between">
                <span className={textMuted}>Application Platform:</span>
                <span className="font-semibold">{selectedJob.ATS || "Direct API"}</span>
              </div>
            </div>

            {/* ACTIONS */}
            <div className="space-y-2 pt-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">One-Click Actions</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  onClick={() => launchAtsForJob(selectedJob)}
                  className="p-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:border-blue-500 text-xs font-bold flex items-center justify-center gap-1.5 transition hover:bg-blue-50/40 dark:hover:bg-blue-950/20"
                >
                  <Target className="size-3.5 text-blue-600" /> Tailor Resume
                </button>

                <button
                  onClick={() => launchInterviewPrepForJob(selectedJob)}
                  className="p-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:border-blue-500 text-xs font-bold flex items-center justify-center gap-1.5 transition hover:bg-blue-50/40 dark:hover:bg-blue-950/20"
                >
                  <Mic className="size-3.5 text-blue-600" /> Prep Interview
                </button>

                <button
                  onClick={() => launchOutreachForJob(selectedJob)}
                  className="p-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:border-blue-500 text-xs font-bold flex items-center justify-center gap-1.5 transition hover:bg-blue-50/40 dark:hover:bg-blue-950/20"
                >
                  <Send className="size-3.5 text-blue-600" /> Cold Email
                </button>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <div className="flex items-center gap-1 text-xs">
                  <span className={textMuted}>Track Status:</span>
                  {(["saved", "applied", "interviewing", "offer"] as const).map(st => (
                    <button
                      key={st}
                      onClick={() => handleUpdateJobStatus(selectedJob.jobKey, st)}
                      className={`px-2 py-1 rounded text-[10px] font-bold capitalize transition ${
                        jobStatuses[selectedJob.jobKey] === st ? "bg-blue-600 text-white" : "border border-zinc-300 dark:border-zinc-700 text-zinc-400"
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                <a
                  href={selectedJob["Apply URL"] || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1 transition shadow-sm"
                >
                  Apply Directly <ExternalLink className="size-3.5" />
                </a>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* EDIT PROFILE MODAL */}
      {isEditProfileOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className={`w-full max-w-2xl rounded-2xl border p-6 space-y-5 shadow-2xl relative my-8 ${cardBg}`}>
            
            <div className="flex items-center justify-between border-b pb-3 border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold">
                  <User className="size-4.5" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Edit Candidate Profile</h2>
                  <p className={`text-xs ${textMuted}`}>Updating your profile will dynamically recalibrate job match rankings.</p>
                </div>
              </div>

              <button
                onClick={() => setIsEditProfileOpen(false)}
                className="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
              >
                <X className="size-5 text-zinc-400" />
              </button>
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold block mb-1">Full Name</label>
                  <input
                    type="text"
                    value={profileDraft.name}
                    onChange={e => setProfileDraft(p => ({ ...p, name: e.target.value }))}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1">Current Headline</label>
                  <input
                    type="text"
                    value={profileDraft.headline}
                    onChange={e => setProfileDraft(p => ({ ...p, headline: e.target.value }))}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold block mb-1">Target Job Title</label>
                  <input
                    type="text"
                    value={profileDraft.targetRole}
                    onChange={e => setProfileDraft(p => ({ ...p, targetRole: e.target.value }))}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1">Min Salary Target ($/yr)</label>
                  <input
                    type="number"
                    value={profileDraft.minSalary}
                    onChange={e => setProfileDraft(p => ({ ...p, minSalary: Number(e.target.value) }))}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1">Years Experience</label>
                  <input
                    type="number"
                    value={profileDraft.yearsExperience}
                    onChange={e => setProfileDraft(p => ({ ...p, yearsExperience: Number(e.target.value) }))}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
              </div>

              {/* SKILLS TAGS */}
              <div>
                <label className="text-xs font-bold block mb-1.5">Core Technical Skills (Used for Job Matching)</label>
                <div className="flex flex-wrap gap-1.5 p-3 rounded-lg border min-h-16 ${cardSubBg}">
                  {profileDraft.skills.map(skill => (
                    <span
                      key={skill}
                      className="px-2.5 py-1 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                    >
                      {skill}
                      <button
                        onClick={() => handleRemoveSkill(skill)}
                        className="hover:text-red-500 transition"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>

                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    placeholder="Add skill (e.g. PyTorch, Rust, GCP)..."
                    value={newSkillInput}
                    onChange={e => setNewSkillInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddSkill(); } }}
                    className={`flex-1 text-xs px-3 py-1.5 border rounded-lg ${inputBg}`}
                  />
                  <button
                    onClick={handleAddSkill}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* CONTACT DETAILS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold block mb-1">Email</label>
                  <input
                    type="email"
                    value={profileDraft.contact.email}
                    onChange={e => setProfileDraft(p => ({ ...p, contact: { ...p.contact, email: e.target.value } }))}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1">Location Preference</label>
                  <input
                    type="text"
                    value={profileDraft.contact.location}
                    onChange={e => setProfileDraft(p => ({ ...p, contact: { ...p.contact, location: e.target.value } }))}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
              </div>

            </div>

            <div className="flex items-center justify-between pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => setProfileDraft(INITIAL_PROFILE)}
                className={`text-xs font-bold ${textMuted} hover:text-blue-600 transition`}
              >
                Reset to Defaults
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditProfileOpen(false)}
                  className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveProfile}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-md flex items-center gap-1.5"
                >
                  <Check className="size-4" /> Save & Recalibrate Jobs
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* MAIN 3-COLUMN LAYOUT */}
      <div className="max-w-6xl mx-auto px-4 pt-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* LEFT COLUMN: CANDIDATE CARD */}
        <aside className="lg:col-span-3 space-y-4">
          <div className={`rounded-xl p-4 border space-y-4 ${cardBg}`}>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center font-black text-lg text-white shadow-md shadow-blue-600/20">
                  {profile.name.split(" ").map(n => n[0]).join("") || "AC"}
                </div>
                <div>
                  <h2 className="text-sm font-bold">{profile.name}</h2>
                  <p className={`text-xs font-medium ${textMuted}`}>{profile.headline}</p>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{profile.contact.location}</div>
                </div>
              </div>

              <button
                onClick={() => { setProfileDraft(profile); setIsEditProfileOpen(true); }}
                className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 hover:text-blue-600 transition"
                title="Edit Profile"
              >
                <Edit3 className="size-3.5" />
              </button>
            </div>

            {/* QUICK SKILLS PREVIEW */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${textMuted}`}>Core Skills</span>
                <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold">{profile.skills.length} skills</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {profile.skills.slice(0, 6).map(s => (
                  <button
                    key={s}
                    onClick={() => setSelectedSkillFilter(selectedSkillFilter === s ? null : s)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer ${
                      selectedSkillFilter === s
                        ? "bg-blue-600 text-white"
                        : "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* STATS */}
            <div className={`p-3 rounded-lg border space-y-2 text-xs ${cardSubBg}`}>
              <div className="flex justify-between">
                <span className={textMuted}>Target Match Score</span>
                <span className="font-bold text-blue-600 dark:text-blue-400">96%</span>
              </div>
              <div className="flex justify-between">
                <span className={textMuted}>Target Min Salary</span>
                <span className="font-bold">${(profile.minSalary / 1000).toFixed(0)}k/yr</span>
              </div>
              <div className="flex justify-between">
                <span className={textMuted}>Shortlist Matches</span>
                <span className="font-bold">{filteredAndRankedJobs.length}</span>
              </div>
            </div>

            {/* SHORTCUT BUTTONS */}
            <div className="space-y-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => { setSortByProfileMatch(true); setActiveTab("jobs"); }}
                className="w-full flex items-center justify-between p-2 rounded-lg bg-blue-600 text-white text-xs font-bold transition shadow-xs"
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5" /> Match Jobs to My Profile
                </span>
                <ChevronRight className="size-3.5 text-white" />
              </button>

              <button
                onClick={() => setActiveTab("tracker")}
                className={`w-full flex items-center justify-between p-2 rounded-lg border text-xs font-semibold transition ${cardSubBg} hover:border-blue-500`}
              >
                <span className="flex items-center gap-1.5">
                  <CheckSquare className="size-3.5 text-blue-600" /> Pipeline Tracker ({trackerCounts.applied + trackerCounts.interviewing})
                </span>
                <ChevronRight className="size-3.5 text-zinc-400" />
              </button>

              <button
                onClick={() => setActiveTab("ats")}
                className={`w-full flex items-center justify-between p-2 rounded-lg border text-xs font-semibold transition ${cardSubBg} hover:border-blue-500`}
              >
                <span>Target ATS Keyword Scan</span>
                <ChevronRight className="size-3.5 text-zinc-400" />
              </button>
            </div>

          </div>
        </aside>

        {/* MIDDLE COLUMN: ACTIVE TAB CONTENT */}
        <main className="lg:col-span-6 space-y-4">
          
          {/* TAB 1: JOBS WITH PROFILE SEARCH ENGINE */}
          {activeTab === "jobs" && (
            <div className="space-y-4">
              
              {/* PROFILE MATCH BANNER */}
              <div className={`rounded-xl p-4 border flex flex-wrap items-center justify-between gap-3 ${cardBg}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4.5 text-blue-600 dark:text-blue-400" />
                    <h3 className="text-sm font-bold">Profile-Matched Job Feed</h3>
                  </div>
                  <p className={`text-xs mt-0.5 ${textMuted}`}>
                    Ranking <strong>{jobs.length}</strong> postings against your skills: <span className="text-blue-600 dark:text-blue-400 font-semibold">{profile.skills.slice(0, 3).join(", ")}...</span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setProfileDraft(profile); setIsEditProfileOpen(true); }}
                    className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:border-blue-500 text-xs font-bold flex items-center gap-1 transition"
                  >
                    <Settings className="size-3.5 text-zinc-400" /> Refine Profile
                  </button>
                  <button
                    onClick={fetchJobs}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1 transition shadow-xs"
                  >
                    <RefreshCw className={`size-3.5 ${loadingJobs ? "animate-spin" : ""}`} /> Scan New Jobs
                  </button>
                </div>
              </div>

              {/* ADVANCED FILTER ROW */}
              <div className={`rounded-xl p-3 border space-y-2.5 ${cardBg}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    <span className={`text-xs font-bold flex items-center gap-1 shrink-0 ${textMuted}`}>
                      <Filter className="size-3 text-blue-600" /> ATS:
                    </span>
                    {["all", "Greenhouse", "Lever", "Ashby", "Workday"].map(ats => (
                      <button
                        key={ats}
                        onClick={() => setJobFilterAts(ats)}
                        className={`px-2.5 py-1 text-xs rounded-lg font-bold transition shrink-0 ${
                          jobFilterAts === ats
                            ? "bg-blue-600 text-white"
                            : `${cardSubBg} ${textMuted} hover:text-blue-600`
                        }`}
                      >
                        {ats === "all" ? "All Platforms" : ats}
                      </button>
                    ))}
                  </div>

                  {/* MIN MATCH % FILTER */}
                  <div className="flex items-center gap-1">
                    <span className={`text-xs font-bold ${textMuted}`}>Match:</span>
                    {[0, 85, 90, 95].map(score => (
                      <button
                        key={score}
                        onClick={() => setMinMatchScore(score)}
                        className={`px-2 py-0.5 text-xs rounded-md font-bold transition ${
                          minMatchScore === score
                            ? "bg-blue-600 text-white"
                            : `${cardSubBg} ${textMuted}`
                        }`}
                      >
                        {score === 0 ? "All" : `${score}%+`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterRemoteOnly}
                        onChange={e => setFilterRemoteOnly(e.target.checked)}
                        className="rounded text-blue-600"
                      />
                      <span className="font-semibold">Remote Only</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sortByProfileMatch}
                        onChange={e => setSortByProfileMatch(e.target.checked)}
                        className="rounded text-blue-600"
                      />
                      <span className="font-semibold">Rank by Best Match</span>
                    </label>
                  </div>

                  <div className="text-[11px] text-zinc-400">
                    Showing <strong className="text-zinc-900 dark:text-white">{filteredAndRankedJobs.length}</strong> jobs
                  </div>
                </div>
              </div>

              {/* JOBS FEED */}
              <div className="space-y-3">
                {filteredAndRankedJobs.length === 0 ? (
                  <div className={`rounded-xl p-12 text-center text-xs ${cardBg} ${textMuted}`}>
                    No jobs match your current search filters. Try adjusting minimum match % or search query.
                  </div>
                ) : (
                  filteredAndRankedJobs.slice(0, 20).map((j, idx) => {
                    const isLiked = !!likedJobIndices[idx];
                    const isSaved = !!savedJobIndices[idx];
                    const currentStatus = jobStatuses[j.jobKey];

                    return (
                      <div
                        key={idx}
                        className={`rounded-xl p-4 border transition space-y-3 ${cardBg} hover:border-blue-500 cursor-pointer`}
                        onClick={() => setSelectedJob(j)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="w-11 h-11 rounded-lg bg-blue-100 dark:bg-zinc-950 border border-blue-200 dark:border-zinc-800 text-blue-700 dark:text-blue-400 font-black text-xs flex items-center justify-center shrink-0">
                              {j.Company ? j.Company.slice(0, 2).toUpperCase() : "CO"}
                            </div>

                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-sm font-bold hover:text-blue-600 cursor-pointer">
                                  {j.Role || "Senior ML Engineer"}
                                </h3>
                                <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded text-[10px] font-black">
                                  {j.dynamicMatch}% MATCH
                                </span>
                                {currentStatus && (
                                  <span className="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded text-[10px] font-bold uppercase">
                                    {currentStatus}
                                  </span>
                                )}
                              </div>

                              <p className={`text-xs mt-0.5 font-medium ${textMuted}`}>
                                <span className="font-bold text-zinc-900 dark:text-white">{j.Company}</span> • {j.Location || "Remote"}
                              </p>

                              <div className="flex items-center gap-2 mt-2">
                                <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${cardSubBg}`}>
                                  {j.ATS || "Greenhouse"}
                                </span>
                                <span className="text-xs font-semibold">
                                  {j.Salary || "$165k - $220k"}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSave(idx); }}
                            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
                          >
                            <Bookmark className={`size-4 ${isSaved ? "text-blue-600 fill-blue-600" : "text-zinc-400"}`} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-zinc-200 dark:border-zinc-800 text-xs">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleLike(idx); }}
                              className={`flex items-center gap-1 font-semibold ${isLiked ? "text-blue-600" : textMuted}`}
                            >
                              <Heart className={`size-3.5 ${isLiked ? "fill-blue-600" : ""}`} /> Like
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                launchAtsForJob(j);
                              }}
                              className="font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                            >
                              Tailor Resume
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); setSelectedJob(j); }}
                              className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:border-blue-500 font-bold text-xs flex items-center gap-1 transition"
                            >
                              <Eye className="size-3" /> Details
                            </button>
                            <a
                              href={j["Apply URL"] || "#"}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateJobStatus(j.jobKey, "applied");
                              }}
                              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1 transition shadow-xs"
                            >
                              Easy Apply <ArrowUpRight className="size-3.5" />
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

            </div>
          )}

          {/* TAB: APPLICATION TRACKER PIPELINE */}
          {activeTab === "tracker" && (
            <div className={`rounded-xl p-5 border space-y-4 ${cardBg}`}>
              <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <CheckSquare className="size-5 text-blue-600 dark:text-blue-400" /> Application Pipeline Tracker
                  </h2>
                  <p className={`text-xs mt-0.5 ${textMuted}`}>Organize your career search pipeline across stages.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Saved Jobs", key: "saved", count: trackerCounts.saved },
                  { label: "Applied", key: "applied", count: trackerCounts.applied },
                  { label: "Interviewing", key: "interviewing", count: trackerCounts.interviewing },
                  { label: "Offers", key: "offer", count: trackerCounts.offer }
                ].map(col => (
                  <div key={col.key} className={`rounded-xl p-3 border space-y-2 ${cardSubBg}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">{col.label}</span>
                      <span className="px-2 py-0.5 bg-blue-600 text-white rounded-full text-[10px] font-black">{col.count}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {col.count === 0 ? "No listings yet" : `${col.count} active roles`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: ATS */}
          {activeTab === "ats" && (
            <div className={`rounded-xl p-5 border space-y-4 ${cardBg}`}>
              <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <h2 className="text-base font-bold flex items-center gap-2">
                  <Target className="size-5 text-blue-600 dark:text-blue-400" /> ATS Keyword Matcher
                </h2>
                <p className={`text-xs mt-0.5 ${textMuted}`}>Parse job descriptions to compute keyword density and overlap.</p>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-bold block">Target Job Description</label>
                <textarea
                  value={jdText}
                  onChange={e => setJdText(e.target.value)}
                  placeholder="Paste Job Description here..."
                  className={`w-full h-36 border rounded-lg p-3 text-xs focus:outline-none focus:border-blue-500 resize-none font-mono ${inputBg}`}
                />
                <button
                  onClick={handleCalculateAts}
                  disabled={isScoring || !jdText.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-xs transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Target className="size-4" /> {isScoring ? "Analyzing..." : "Calculate ATS Match"}
                </button>
              </div>

              {atsScore && (
                <div className={`rounded-xl p-4 border space-y-4 mt-4 ${cardSubBg}`}>
                  <div className={`flex items-center justify-between p-3 rounded-lg border ${cardBg}`}>
                    <div>
                      <div className={`text-[10px] font-bold uppercase ${textMuted}`}>ATS Grade</div>
                      <div className="text-2xl font-black text-blue-600 dark:text-blue-400">{atsScore.grade}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[10px] font-bold uppercase ${textMuted}`}>Match Score</div>
                      <div className="text-2xl font-black">{atsScore.scorePct}%</div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-2">Matched Keywords ({atsScore.matchedCount}):</h4>
                    <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                      {atsScore.matchedKeywords?.map((kw: string) => (
                        <span key={kw} className="px-2 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[10px] font-bold rounded">
                          ✓ {kw}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className={`text-xs font-bold mb-2 ${textMuted}`}>Missing Keywords:</h4>
                    <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                      {atsScore.missingKeywords?.map((kw: string) => (
                        <span key={kw} className={`px-2 py-0.5 border text-[10px] font-bold rounded ${cardBg}`}>
                          ✗ {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: STAR INTERVIEW PREP */}
          {activeTab === "interview" && (
            <div className={`rounded-xl p-5 border space-y-4 ${cardBg}`}>
              <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <Mic className="size-5 text-blue-600 dark:text-blue-400" /> STAR Interview Copilot
                  </h2>
                  <p className={`text-xs mt-0.5 ${textMuted}`}>Generate tailored behavioral answers (Situation, Task, Action, Result).</p>
                </div>
                <button
                  onClick={handleGeneratePrep}
                  disabled={isGeneratingPrep}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition disabled:opacity-50"
                >
                  {isGeneratingPrep ? "Generating..." : "Generate Prep Sheet"}
                </button>
              </div>

              {interviewPrep ? (
                <div className="space-y-3 mt-4">
                  {interviewPrep.starStories?.map((s: any, idx: number) => (
                    <div key={idx} className={`rounded-xl p-4 border space-y-2 text-xs ${cardSubBg}`}>
                      <div className="font-bold text-sm">Q{idx + 1}: "{s.question}"</div>
                      <div className={textMuted}><strong>Situation:</strong> {s.situation}</div>
                      <div className={textMuted}><strong>Task:</strong> {s.task}</div>
                      <div className={textMuted}><strong>Action:</strong> {s.action}</div>
                      <div className="text-blue-600 dark:text-blue-400 font-bold"><strong>Result:</strong> {s.result}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-center py-12 text-xs ${textMuted}`}>
                  Click <strong>Generate Prep Sheet</strong> to build behavioral interview answers.
                </div>
              )}
            </div>
          )}

          {/* TAB 4: RECRUITER OUTREACH */}
          {activeTab === "outreach" && (
            <div className={`rounded-xl p-5 border space-y-4 ${cardBg}`}>
              <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <h2 className="text-base font-bold flex items-center gap-2">
                  <Send className="size-5 text-blue-600 dark:text-blue-400" /> Recruiter Cold Outreach
                </h2>
                <p className={`text-xs mt-0.5 ${textMuted}`}>3-sentence cold emails with 5-day follow-up cadences.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold block mb-1">Company</label>
                  <input
                    type="text"
                    value={outreachCompany}
                    onChange={e => setOutreachCompany(e.target.value)}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1">Role</label>
                  <input
                    type="text"
                    value={outreachRole}
                    onChange={e => setOutreachRole(e.target.value)}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
              </div>

              <button
                onClick={handleGenerateOutreach}
                disabled={isGeneratingOutreach}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-xs transition disabled:opacity-50"
              >
                Generate Outreach Email
              </button>

              {outreachResult && (
                <div className="space-y-4 mt-4">
                  <div className={`rounded-xl p-4 border space-y-2 ${cardSubBg}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Cold Email Template</span>
                      <button
                        onClick={() => copyToClipboard(`Subject: ${outreachResult.coldEmailSubject}\n\n${outreachResult.coldEmailBody}`, "cold")}
                        className={`text-[11px] font-bold flex items-center gap-1 ${textMuted} hover:text-blue-600`}
                      >
                        {copiedKey === "cold" ? <CheckCheck className="size-3.5 text-blue-600" /> : <Copy className="size-3.5" />}
                        {copiedKey === "cold" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <div className="text-xs font-bold">Subject: {outreachResult.coldEmailSubject}</div>
                    <pre className="text-xs font-mono whitespace-pre-wrap">{outreachResult.coldEmailBody}</pre>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: SALARY */}
          {activeTab === "salary" && (
            <div className={`rounded-xl p-5 border space-y-4 ${cardBg}`}>
              <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <h2 className="text-base font-bold flex items-center gap-2">
                  <DollarSign className="size-5 text-blue-600 dark:text-blue-400" /> Salary Benchmark & Counter-Offer Advisor
                </h2>
                <p className={`text-xs mt-0.5 ${textMuted}`}>Evaluate offer against percentiles and generate counter-scripts.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold block mb-1">Target Role</label>
                  <input
                    type="text"
                    value={salaryRole}
                    onChange={e => setSalaryRole(e.target.value)}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1">Offered Salary (USD)</label>
                  <input
                    type="number"
                    value={salaryOffered}
                    onChange={e => setSalaryOffered(Number(e.target.value))}
                    className={`w-full text-xs px-3 py-2 border rounded-lg ${inputBg}`}
                  />
                </div>
              </div>

              <button
                onClick={handleEvaluateSalary}
                disabled={isEvaluatingSalary}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-xs transition disabled:opacity-50"
              >
                Evaluate Offer
              </button>

              {salaryResult && (
                <div className={`rounded-xl p-4 border space-y-4 mt-4 ${cardSubBg}`}>
                  <div className={`flex items-center justify-between p-3 rounded-lg border ${cardBg}`}>
                    <div>
                      <div className={`text-[10px] font-bold uppercase ${textMuted}`}>Market Verdict</div>
                      <div className="text-lg font-black text-blue-600 dark:text-blue-400">{salaryResult.verdict}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[10px] font-bold uppercase ${textMuted}`}>Suggested Counter</div>
                      <div className="text-lg font-black">{salaryResult.suggestedCounter}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className={`p-2.5 rounded-lg border ${cardBg}`}>
                      <span className={`text-[10px] block ${textMuted}`}>25th Pct</span>
                      <span className="font-bold">{salaryResult.benchmarks?.p25}</span>
                    </div>
                    <div className={`p-2.5 rounded-lg border ${cardBg}`}>
                      <span className={`text-[10px] block ${textMuted}`}>Median</span>
                      <span className="font-bold text-blue-600 dark:text-blue-400">{salaryResult.benchmarks?.p50}</span>
                    </div>
                    <div className={`p-2.5 rounded-lg border ${cardBg}`}>
                      <span className={`text-[10px] block ${textMuted}`}>75th Pct</span>
                      <span className="font-bold">{salaryResult.benchmarks?.p75}</span>
                    </div>
                    <div className={`p-2.5 rounded-lg border ${cardBg}`}>
                      <span className={`text-[10px] block ${textMuted}`}>90th Pct</span>
                      <span className="font-bold">{salaryResult.benchmarks?.p90}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-bold">Counter Script:</div>
                    <pre className={`text-xs font-mono p-3 rounded-lg border whitespace-pre-wrap ${cardBg}`}>{salaryResult.counterScript}</pre>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: RENDERCV RESUME */}
          {activeTab === "resume" && (
            <div className={`rounded-xl p-5 border space-y-4 ${cardBg}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <FileText className="size-5 text-blue-600 dark:text-blue-400" /> RenderCV Resume Builder
                  </h2>
                  <p className={`text-xs mt-0.5 ${textMuted}`}>Compile Typst-formatted ATS resumes directly from profile.</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={theme}
                    onChange={e => setTheme(e.target.value)}
                    className={`text-xs border rounded-lg px-3 py-1.5 ${inputBg}`}
                  >
                    <option value="classic">Theme: Classic ATS</option>
                    <option value="modern">Theme: Modern Minimal</option>
                    <option value="sb2">Theme: SB2 Dual-Column</option>
                  </select>
                  <button
                    onClick={handleRenderPdf}
                    disabled={isRendering}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition disabled:opacity-50"
                  >
                    {isRendering ? "Building..." : "Render PDF"}
                  </button>
                </div>
              </div>

              <div className={`border rounded-lg p-2 flex items-center justify-center min-h-96 text-xs ${cardSubBg} ${textMuted}`}>
                {pdfUrl ? (
                  <iframe src={pdfUrl} className="w-full h-96 rounded" title="PDF Preview" />
                ) : (
                  <div>Click <strong>Render PDF</strong> to compile with RenderCV.</div>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: RECRUITERS */}
          {activeTab === "contacts" && (
            <div className={`rounded-xl p-5 border space-y-4 ${cardBg}`}>
              <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <h2 className="text-base font-bold flex items-center gap-2">
                  <Users className="size-5 text-blue-600 dark:text-blue-400" /> Recruiter Directory
                </h2>
                <button onClick={fetchContacts} className="text-xs text-blue-600 dark:text-blue-400 font-bold">Refresh</button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`uppercase text-[10px] font-bold ${cardSubBg} ${textMuted}`}>
                    <tr>
                      <th className="p-3">Recruiter</th>
                      <th className="p-3">Company</th>
                      <th className="p-3">Direct Email</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {contacts.map((c, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/50 dark:hover:bg-zinc-800/40 transition">
                        <td className="p-3 font-bold">{c.name}</td>
                        <td className="p-3">{c.company}</td>
                        <td className="p-3 font-mono text-blue-600 dark:text-blue-400">{c.email}</td>
                        <td className="p-3">
                          <button
                            onClick={() => {
                              setOutreachCompany(c.company || "Acme Corp");
                              setActiveTab("outreach");
                            }}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-[10px]"
                          >
                            Outreach
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 8: AUTO-APPLY */}
          {activeTab === "apply" && (
            <div className={`rounded-xl p-5 border space-y-4 ${cardBg}`}>
              <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <h2 className="text-base font-bold flex items-center gap-2">
                  <Bot className="size-5 text-blue-600 dark:text-blue-400" /> Auto-Apply Stealth Runner
                </h2>
                <p className={`text-xs mt-0.5 ${textMuted}`}>Automated application engine with stealth browser execution.</p>
              </div>

              <div className={`border rounded-lg p-4 font-mono text-xs h-60 overflow-y-auto space-y-1 ${cardSubBg}`}>
                <div className="text-blue-600 dark:text-blue-400 font-bold">[AutoPilot] Engine active for candidate: {profile.name}</div>
                <div>[Skills Index] {profile.skills.length} skills loaded: {profile.skills.slice(0, 4).join(", ")}...</div>
                <div>[Scan Results] {filteredAndRankedJobs.length} listings qualify with &gt;= 85% ATS match.</div>
                <div className={textMuted}>[Standby] Ready for user execution.</div>
              </div>
            </div>
          )}

        </main>

        {/* RIGHT COLUMN: NEWS & MATCH RADAR */}
        <aside className="lg:col-span-3 space-y-4">
          
          {/* PROFILE MATCH RADAR */}
          <div className={`rounded-xl p-4 border space-y-3 ${cardBg}`}>
            <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="size-3.5 text-blue-600 dark:text-blue-400" /> Role Compatibility Radar
            </h3>
            
            <div className="space-y-2.5 text-xs">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span>ML & AI Engineering</span>
                  <span className="text-blue-600 dark:text-blue-400 font-bold">98% Match</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full w-[98%]"></div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span>Backend Microservices</span>
                  <span className="text-blue-600 dark:text-blue-400 font-bold">94% Match</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full w-[94%]"></div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span>Cloud & Infrastructure</span>
                  <span className="text-blue-600 dark:text-blue-400 font-bold">88% Match</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full w-[88%]"></div>
                </div>
              </div>
            </div>
          </div>

          {/* VERIFIED RECRUITERS */}
          <div className={`rounded-xl p-4 border space-y-3 ${cardBg}`}>
            <h3 className="text-xs font-bold uppercase tracking-wider">Verified Recruiters</h3>
            <div className="space-y-2 text-xs">
              <div className={`flex items-center justify-between p-2 rounded-lg border ${cardSubBg}`}>
                <div>
                  <div className="font-bold">Sarah Jenkins</div>
                  <div className={`text-[10px] ${textMuted}`}>Scale AI</div>
                </div>
                <button
                  onClick={() => { setOutreachCompany("Scale AI"); setActiveTab("outreach"); }}
                  className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold"
                >
                  DM
                </button>
              </div>

              <div className={`flex items-center justify-between p-2 rounded-lg border ${cardSubBg}`}>
                <div>
                  <div className="font-bold">David Miller</div>
                  <div className={`text-[10px] ${textMuted}`}>Stripe</div>
                </div>
                <button
                  onClick={() => { setOutreachCompany("Stripe"); setActiveTab("outreach"); }}
                  className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold"
                >
                  DM
                </button>
              </div>
            </div>
          </div>
        </aside>

      </div>

    </div>
  );
}
