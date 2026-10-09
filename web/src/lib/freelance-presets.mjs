import { cleanChips } from "./clean-chips.mjs";

export const FREELANCE_SHORTCUTS = {
  Websites: ["web developer", "frontend", "full stack"],
  Aplicações: ["mobile developer", "flutter", "iOS developer", "Android developer"],
  Chatbots: ["chatbot", "conversational AI", "AI agent", "LLM"],
  Automação: ["automation engineer", "QA automation", "workflow automation", "n8n"],
  IA: ["AI engineer", "machine learning", "generative AI", "LLM"],
};

/** Add a shortcut's terms to the existing editable title chips. */
export function applyFreelanceShortcut(existing, label) {
  return cleanChips([...(Array.isArray(existing) ? existing : []), ...(FREELANCE_SHORTCUTS[label] ?? [])]);
}
