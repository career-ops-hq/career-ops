"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Compass,
  Briefcase,
  ListChecks,
  Kanban,
  Files,
  Users,
  Building2,
  CalendarCheck2,
  Award,
  Send,
  MessageSquareReply,
  BarChart3,
  GraduationCap,
  FolderGit2,
  BookOpen,
  Inbox,
  Blocks,
  Activity,
  Settings,
  X,
  Play,
  FileText,
} from "lucide-react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!open) return null;

  const actions = [
    { title: "Evaluate Job URL", desc: "Quickly parse & score an external job posting", icon: Play, href: "/#quick-evaluate" },
    { title: "Run Portal Scanner", desc: "Scan configured ATS portals for matching roles", icon: Compass, href: "/explore" },
    { title: "View Pipeline", desc: "Review pending jobs queue", icon: ListChecks, href: "/pipeline" },
    { title: "Application Tracker", desc: "View all applications & kanban stages", icon: Kanban, href: "/tracker" },
    { title: "Tailor CV / Documents", desc: "Manage Master CV and generated tailored PDFs", icon: Files, href: "/documents" },
    { title: "Interview Center", desc: "Plan rounds, practice simulator, view red flags", icon: CalendarCheck2, href: "/interviews" },
    { title: "Offers & Compensation", desc: "Analyze salary gaps & negotiation scripts", icon: Award, href: "/offers" },
    { title: "Follow-up Cadence", desc: "Check scheduled recruiter follow-ups", icon: Send, href: "/followups" },
    { title: "Employer Replies", desc: "Paste and classify inbound messages", icon: MessageSquareReply, href: "/replies" },
    { title: "Contacts & Warm Intros", desc: "Phonebook and LinkedIn network matcher", icon: Users, href: "/contacts" },
    { title: "Company Research", desc: "Dossiers, funding intel & friction scores", icon: Building2, href: "/companies" },
    { title: "Skill & Upskill Analysis", desc: "Demand matrix & missing cv skills", icon: GraduationCap, href: "/upskill" },
    { title: "Portfolio Projects", desc: "Manage projects and CV evidence points", icon: FolderGit2, href: "/projects" },
    { title: "Training Log", desc: "Skill assessments & practice logs", icon: BookOpen, href: "/training" },
    { title: "Agent Inbox", desc: "Pending background worker tasks", icon: Inbox, href: "/inbox" },
    { title: "Plugins & Integrations", desc: "Gmail, Notion, Apify, H1B Sponsor", icon: Blocks, href: "/plugins" },
    { title: "System Diagnostics", desc: "Doctor check & environment health", icon: Activity, href: "/diagnostics" },
    { title: "Settings & Profile", desc: "Configure targeting, portals, AI runtime", icon: Settings, href: "/config" },
  ];

  const filtered = actions.filter(
    (a) =>
      a.title.toLowerCase().includes(query.toLowerCase()) ||
      a.desc.toLowerCase().includes(query.toLowerCase())
  );

  const navigateTo = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm p-4">
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="size-5 text-faint" />
          <input
            type="text"
            placeholder="Type a command or jump to page... (Esc to close)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1 text-faint hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">
              No matching commands or pages found.
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.title}
                    onClick={() => navigateTo(action.href)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-brand-soft group"
                  >
                    <div className="flex size-8 items-center justify-center rounded-md bg-surface-hover border border-border/50 group-hover:bg-brand/20 group-hover:border-brand/40">
                      <Icon className="size-4 text-muted group-hover:text-brand" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground group-hover:text-foreground">
                        {action.title}
                      </div>
                      <div className="text-xs text-muted truncate">
                        {action.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-surface/50 px-4 py-2 text-[11px] text-faint">
          <span>Navigate with mouse or enter</span>
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-surface-hover border border-border px-1.5 py-0.5 font-mono">Esc</span>
            <span>to close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
