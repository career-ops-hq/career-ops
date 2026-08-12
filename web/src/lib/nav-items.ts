import {
  LayoutDashboard,
  Compass,
  ListChecks,
  Send,
  Radar,
  BarChart3,
  FileText,
  Settings,
  WandSparkles,
  Activity,
  BellRing,
  CircleHelp,
  Brain,
  Mail,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { NAVIGATION_SECTIONS, searchNavigation } from "@/lib/navigation-model.mjs";

export type NavItem = {
  href: string;
  label: string;
  description: string;
  keywords: readonly string[];
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
  shortcut?: string;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

const ICONS: Record<string, NavItem["icon"]> = {
  dashboard: LayoutDashboard,
  explore: Compass,
  intelligence: Brain,
  watch: BellRing,
  pipeline: ListChecks,
  followups: Send,
  apply: WandSparkles,
  mail: Mail,
  portals: Radar,
  analytics: BarChart3,
  cv: FileText,
  jobs: Activity,
  settings: Settings,
  guide: CircleHelp,
};

export const NAV_SECTIONS: NavSection[] = NAVIGATION_SECTIONS.map((section) => ({
  id: section.id,
  label: section.label,
  items: section.items.map((item) => ({
    ...item,
    keywords: [...item.keywords],
    icon: ICONS[item.iconKey] ?? CircleHelp,
  })),
}));

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export function searchNavItems(query: string): NavItem[] {
  const orderedHrefs = searchNavigation(query).map((item) => item.href);
  const itemsByHref = new Map(NAV_ITEMS.map((item) => [item.href, item]));
  return orderedHrefs.flatMap((href) => {
    const item = itemsByHref.get(href);
    return item ? [item] : [];
  });
}

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
