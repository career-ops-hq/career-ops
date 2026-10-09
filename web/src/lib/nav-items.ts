import { LayoutDashboard, Compass, ListChecks, Send, Radar, BarChart3, FileText, Settings, CalendarClock } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// Single source of truth for the app's primary destinations — shared by the
// desktop sidebar and the mobile nav so they can never drift.
export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Hoje", icon: LayoutDashboard },
  { href: "/explore", label: "Procurar", icon: Compass, chip: "Novo" },
  { href: "/scheduled-scans", label: "Pesquisas guardadas", icon: CalendarClock },
  { href: "/pipeline", label: "Candidaturas", icon: ListChecks },
  { href: "/followups", label: "Acompanhamento", icon: Send },
  { href: "/portals", label: "Empresas", icon: Radar },
  { href: "/analytics", label: "Resultados", icon: BarChart3 },
  { href: "/cv", label: "CV", icon: FileText },
  { href: "/config", label: "Definições", icon: Settings },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
