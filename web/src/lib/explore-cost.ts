// The cost-honesty taxonomy — a single source for the FREE vs $ boundary that the
// Explorer teaches by repetition. Discovery (finding roles) is structurally free:
// it calls no LLM. Only evaluation (scoring a role against your CV) spends tokens,
// and only when the user chooses it. The framing is always local-first: "your key,
// your AI, your machine."

export type CostClass = "free" | "free-network" | "spend" | "free-gemini";

export const COST_META: Record<CostClass, { label: string; tip: string }> = {
  "free-network": {
    label: "Free",
    tip: "Scans the public ATS network over HTTP. No AI, no tokens, nothing sent — and it writes nothing until you choose to add a role.",
  },
  free: {
    label: "Free",
    tip: "No tokens. Reads or writes local files only.",
  },
  spend: {
    label: "Uses tokens",
    tip: "Runs a real A–F evaluation on your own AI. This is the only thing that spends tokens — and only when you pick a role.",
  },
  "free-gemini": {
    label: "Free · Gemini",
    tip: "Evaluate with Google's free Gemini tier — no token cost.",
  },
};
