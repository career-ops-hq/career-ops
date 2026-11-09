// The exact text rememberFact() stores. The remember confirm card shows this
// same string, so the user approves what is saved.
export const MEMORY_FACT_MAX = 300;

export function normalizeMemoryFact(fact) {
  return String(fact).trim().replace(/\s+/g, " ").slice(0, MEMORY_FACT_MAX);
}
