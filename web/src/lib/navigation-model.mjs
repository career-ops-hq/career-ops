const sections = [
  {
    id: "overview",
    label: "Överblick",
    items: [
      {
        href: "/",
        label: "Idag",
        description: "Se dagens viktigaste uppgifter och nästa bästa steg.",
        keywords: ["start", "översikt", "dashboard", "att göra"],
        iconKey: "dashboard",
        shortcut: "G I",
      },
    ],
  },
  {
    id: "work",
    label: "Jobbsökning",
    items: [
      {
        href: "/explore",
        label: "Hitta jobb",
        description: "Sök, filtrera och matcha roller mot din profil.",
        keywords: ["utforska", "sök", "matchning", "annonser"],
        iconKey: "explore",
        chip: "Smart",
        shortcut: "G H",
      },
      {
        href: "/pipeline",
        label: "Pipeline",
        description: "Följ varje möjlighet från fynd till erbjudande.",
        keywords: ["status", "kanban", "ansökningar", "process"],
        iconKey: "pipeline",
        shortcut: "G P",
      },
      {
        href: "/followups",
        label: "Uppföljningar",
        description: "Planera påminnelser och professionella kontaktsteg.",
        keywords: ["påminnelse", "kontakt", "mejl", "follow-up"],
        iconKey: "followups",
      },
      {
        href: "/apply",
        label: "Ansök",
        description: "Förbered och kvalitetskontrollera en säker ansökan.",
        keywords: ["ansökan", "skicka", "formulär", "brev"],
        iconKey: "apply",
        shortcut: "G A",
      },
      {
        href: "/portals",
        label: "Jobbportaler",
        description: "Hantera källor, portaler och datatäckning på ett ställe.",
        keywords: ["källor", "webbplatser", "portaler", "datakvalitet"],
        iconKey: "portals",
      },
    ],
  },
  {
    id: "improve",
    label: "Förbättra",
    items: [
      {
        href: "/analytics",
        label: "Analys",
        description: "Förstå konvertering, tempo och var du tappar fart.",
        keywords: ["statistik", "resultat", "funnel", "insikter"],
        iconKey: "analytics",
        shortcut: "G N",
      },
      {
        href: "/cv",
        label: "CV-studio",
        description: "Redigera, förhandsgranska och anpassa ditt CV.",
        keywords: ["cv", "resume", "meritförteckning", "pdf"],
        iconKey: "cv",
        shortcut: "G C",
      },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      {
        href: "/jobs",
        label: "Automatisering",
        description: "Följ bakgrundsjobb, körningar och teknisk status.",
        keywords: ["automatisering", "jobb", "worker", "körningar"],
        iconKey: "jobs",
      },
      {
        href: "/config",
        label: "Inställningar",
        description: "Konfigurera profil, AI, säkerhet och arbetsflöde.",
        keywords: ["konfiguration", "profil", "ai", "säkerhet"],
        iconKey: "settings",
      },
      {
        href: "/guide",
        label: "Hjälpcenter",
        description: "Lär dig funktionerna, flödet och säkerhetsreglerna.",
        keywords: ["hjälp", "guide", "information", "manual"],
        iconKey: "guide",
        shortcut: "?",
      },
    ],
  },
];

export const NAVIGATION_SECTIONS = Object.freeze(
  sections.map((section) => Object.freeze({
    ...section,
    items: Object.freeze(section.items.map((item) => Object.freeze({ ...item, keywords: Object.freeze(item.keywords) }))),
  })),
);

export function flattenNavigation() {
  return NAVIGATION_SECTIONS.flatMap((section) => section.items);
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("sv")
    .trim();
}

export function searchNavigation(query) {
  const needle = normalize(query);
  const items = flattenNavigation();
  if (!needle) return items;

  return items
    .map((item, order) => {
      const label = normalize(item.label);
      const haystack = normalize([item.label, item.description, ...item.keywords].join(" "));
      let score = 0;
      if (label === needle) score = 100;
      else if (label.startsWith(needle)) score = 80;
      else if (label.includes(needle)) score = 60;
      else if (haystack.includes(needle)) score = 40;
      return { item, score, order };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.item);
}
