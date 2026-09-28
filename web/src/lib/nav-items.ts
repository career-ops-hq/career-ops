import {
  LayoutDashboard,
  FileText,
  UserCheck,
  Briefcase,
  Compass,
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
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
  category?: "core" | "operations" | "insights" | "system";
};

export const NAV_CATEGORIES = [
  { id: "core", label: "Core" },
  { id: "operations", label: "Operations" },
  { id: "insights", label: "Growth & Insights" },
  { id: "system", label: "System" },
] as const;

export const NAV_ITEMS: NavItem[] = [
  // Core
  { href: "/", label: "Today", icon: LayoutDashboard, category: "core" },
  { href: "/cv", label: "CV & Resume", icon: FileText, chip: "AI", category: "core" },
  { href: "/profile", label: "Profile & Target", icon: UserCheck, category: "core" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, category: "core" },
  { href: "/explore", label: "Discovery", icon: Compass, chip: "Live", category: "core" },
  { href: "/pipeline", label: "Pipeline", icon: ListChecks, category: "core" },
  { href: "/tracker", label: "Applications", icon: Kanban, category: "core" },
  { href: "/documents", label: "Documents", icon: Files, category: "core" },

  // Operations
  { href: "/contacts", label: "Contacts", icon: Users, category: "operations" },
  { href: "/companies", label: "Companies", icon: Building2, category: "operations" },
  { href: "/interviews", label: "Interviews", icon: CalendarCheck2, category: "operations" },
  { href: "/offers", label: "Offers & Comp", icon: Award, category: "operations" },
  { href: "/followups", label: "Follow-ups", icon: Send, category: "operations" },
  { href: "/replies", label: "Replies", icon: MessageSquareReply, category: "operations" },

  // Growth & Insights
  { href: "/analytics", label: "Analytics", icon: BarChart3, category: "insights" },
  { href: "/upskill", label: "Upskilling", icon: GraduationCap, category: "insights" },
  { href: "/projects", label: "Projects", icon: FolderGit2, category: "insights" },
  { href: "/training", label: "Training", icon: BookOpen, category: "insights" },
  { href: "/inbox", label: "Agent Inbox", icon: Inbox, category: "insights" },

  // System
  { href: "/plugins", label: "Plugins", icon: Blocks, category: "system" },
  { href: "/diagnostics", label: "Diagnostics", icon: Activity, category: "system" },
  { href: "/config", label: "Settings", icon: Settings, category: "system" },
];

export function isActivePath(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}
