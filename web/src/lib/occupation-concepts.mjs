// Local catalog v1, inspired by ESCO v1.2.0 preferred/non-preferred labels:
// https://esco.ec.europa.eu/en/classification/occupation_main
// These stable local IDs are curated search concepts, not official ESCO IDs
// or a claim that qualifications are interchangeable across countries.
const concepts = [
  {
    id: "pharmacy-assistant", markets: ["portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands"],
    aliases: {
      pt: ["Técnico Auxiliar de Farmácia", "Técnico de Farmácia", "Ajudante de Farmácia", "Auxiliar de Farmácia"],
      es: ["Auxiliar de Farmacia", "Técnico de Farmacia"], en: ["Pharmacy Assistant"],
      fr: ["Assistant en pharmacie"], de: ["Apothekenhelfer", "Apothekenhelferin"], nl: ["Apotheekassistent"],
    },
    requiredTokens: [["farmacia"], ["pharmacy"], ["pharmacie"], ["apothekenhelfer"], ["apothekenhelferin"], ["apotheekassistent"]],
  },
  {
    id: "sales-assistant", markets: ["portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands"],
    aliases: {
      pt: ["Assistente de Vendas"], es: ["Asistente de ventas", "Auxiliar de ventas"], en: ["Sales Assistant"],
      fr: ["Assistant de vente", "Assistante de vente"], de: ["Verkaufsassistent", "Verkaufsassistentin"], nl: ["Verkoopassistent"],
    },
    requiredTokens: [["vendas"], ["ventas"], ["sales"], ["vente"], ["verkaufsassistent"], ["verkaufsassistentin"], ["verkoopassistent"]],
  },
  {
    id: "retail-assistant", markets: ["portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands"],
    aliases: {
      pt: ["Operador de Loja", "Operadora de Loja", "Assistente de Loja"], es: ["Dependiente de tienda", "Dependienta de tienda"],
      en: ["Retail Assistant", "Store Assistant", "Shop Assistant"], fr: ["Employé de magasin", "Employée de magasin"],
      de: ["Verkäufer im Einzelhandel", "Verkäuferin im Einzelhandel"], nl: ["Winkelmedewerker"],
    },
    inputs: { pt: ["loja", "retalho", "loja de roupa"], en: ["retail"] },
    requiredTokens: [["loja"], ["tienda"], ["retail"], ["store"], ["shop"], ["magasin"], ["einzelhandel"], ["winkelmedewerker"]],
  },
  {
    id: "web-developer", markets: ["remote", "portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands"],
    aliases: {
      pt: ["Programador Web", "Programadora Web", "Desenvolvedor Web"], es: ["Desarrollador web", "Desarrolladora web"],
      en: ["Web Developer", "Frontend Developer", "Front-end Developer"], fr: ["Développeur web", "Développeuse web"],
      de: ["Webentwickler", "Webentwicklerin"], nl: ["Webontwikkelaar"],
    },
    inputs: { pt: ["desenvolvimento web", "websites"], en: ["web development", "developer"] },
    requiredTokens: [["web"], ["frontend"], ["front", "end"], ["webentwickler"], ["webentwicklerin"], ["webontwikkelaar"]],
  },
  {
    id: "app-developer", markets: ["remote", "portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands"],
    aliases: {
      pt: ["Programador de aplicações", "Programadora de aplicações", "Desenvolvedor de aplicações"],
      es: ["Desarrollador de aplicaciones", "Desarrolladora de aplicaciones"], en: ["App Developer", "Mobile Developer", "Application Developer"],
      fr: ["Développeur d'applications", "Développeuse d'applications"], de: ["App-Entwickler", "App-Entwicklerin"], nl: ["App-ontwikkelaar"],
    },
    inputs: { pt: ["aplicações", "desenvolvimento de aplicações"], en: ["app development", "apps", "developer"] },
    requiredTokens: [["aplicacoes"], ["aplicaciones"], ["app"], ["mobile"], ["application"], ["applications"]],
  },
  {
    id: "chatbot-developer", markets: ["remote", "portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands"],
    aliases: {
      pt: ["Programador de chatbots"], es: ["Desarrollador de chatbots"], en: ["Chatbot Developer", "Conversational AI Developer"],
      fr: ["Développeur de chatbots"], de: ["Chatbot-Entwickler"], nl: ["Chatbot-ontwikkelaar"],
    },
    inputs: { en: ["chatbot", "chatbots"] },
    requiredTokens: [["chatbot"], ["chatbots"], ["conversational", "ai"]],
  },
  {
    id: "ai-automation", markets: ["remote", "portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands"],
    aliases: {
      pt: ["Especialista em automação com IA"], es: ["Especialista en automatización con IA"], en: ["AI Automation Specialist", "AI Automation Engineer"],
      fr: ["Spécialiste en automatisation IA"], de: ["KI-Automatisierungsspezialist"], nl: ["AI-automatiseringsspecialist"],
    },
    inputs: { pt: ["automação com IA", "automação IA"], en: ["AI automation"] },
    requiredTokens: [["automacao", "ia"], ["automatizacion", "ia"], ["automation", "ai"], ["automatisation", "ia"], ["ki", "automatisierungsspezialist"], ["ai", "automatiseringsspecialist"]],
  },
];

// Catalog values also reach resolved results; callers must not mutate a later search.
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  return Object.freeze(value);
}
export const OCCUPATION_CONCEPTS = freeze(concepts.map(concept => ({
  ...concept,
  labels: Object.fromEntries(Object.entries(concept.aliases).map(([language, aliases]) => [language, aliases[0]])),
  queryTerms: concept.aliases,
})));
