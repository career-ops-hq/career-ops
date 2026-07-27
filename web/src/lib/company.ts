// Company identity helpers — PURE, client-safe (no node imports).
//
// The job logos look "pro" when the real brand mark sits next to the name. But
// the posting URL is ALWAYS a job board (greenhouse/lever/ashby/workday/linkedin),
// so it can NEVER be used to derive the employer domain. We resolve the domain
// from the company NAME instead: a small curated override map for the brand≠slug
// long tail, then a slug+.com heuristic. The logo itself is fetched (and cached)
// by the /api/logo localhost proxy; if anything fails we fall back to a
// deterministic monogram that works fully offline with zero privacy leak.

/** Curated name → domain overrides for the common cases slug+.com gets wrong. */
const DOMAIN_OVERRIDES: Record<string, string> = {
  anthropic: "anthropic.com",
  openai: "openai.com",
  google: "google.com",
  "google deepmind": "deepmind.google",
  deepmind: "deepmind.google",
  meta: "meta.com",
  "meta platforms": "meta.com",
  facebook: "meta.com",
  microsoft: "microsoft.com",
  apple: "apple.com",
  amazon: "amazon.com",
  aws: "aws.amazon.com",
  netflix: "netflix.com",
  nvidia: "nvidia.com",
  x: "x.com",
  twitter: "x.com",
  xai: "x.ai",
  "x.ai": "x.ai",
  stripe: "stripe.com",
  shopify: "shopify.com",
  airbnb: "airbnb.com",
  uber: "uber.com",
  lyft: "lyft.com",
  spotify: "spotify.com",
  linkedin: "linkedin.com",
  github: "github.com",
  gitlab: "gitlab.com",
  notion: "notion.so",
  figma: "figma.com",
  canva: "canva.com",
  databricks: "databricks.com",
  snowflake: "snowflake.com",
  datadog: "datadoghq.com",
  cloudflare: "cloudflare.com",
  vercel: "vercel.com",
  netlify: "netlify.com",
  hugging: "huggingface.co",
  huggingface: "huggingface.co",
  "hugging face": "huggingface.co",
  cohere: "cohere.com",
  "mistral ai": "mistral.ai",
  mistral: "mistral.ai",
  perplexity: "perplexity.ai",
  scale: "scale.com",
  "scale ai": "scale.com",
  replit: "replit.com",
  ramp: "ramp.com",
  brex: "brex.com",
  plaid: "plaid.com",
  coinbase: "coinbase.com",
  robinhood: "robinhood.com",
  doordash: "doordash.com",
  instacart: "instacart.com",
  pinterest: "pinterest.com",
  reddit: "reddit.com",
  discord: "discord.com",
  slack: "slack.com",
  atlassian: "atlassian.com",
  salesforce: "salesforce.com",
  oracle: "oracle.com",
  ibm: "ibm.com",
  intel: "intel.com",
  amd: "amd.com",
  tesla: "tesla.com",
  spacex: "spacex.com",
  palantir: "palantir.com",
  twilio: "twilio.com",
  zoom: "zoom.us",
  dropbox: "dropbox.com",
  asana: "asana.com",
  airtable: "airtable.com",
  segment: "segment.com",
  elastic: "elastic.co",
  mongodb: "mongodb.com",
  hashicorp: "hashicorp.com",
  "booking.com": "booking.com",
  booking: "booking.com",
  revolut: "revolut.com",
  wise: "wise.com",
  klarna: "klarna.com",
  adyen: "adyen.com",
  glovo: "glovoapp.com",
  cabify: "cabify.com",
  "typeform": "typeform.com",
  factorial: "factorialhr.com",
  "n26": "n26.com",
  "red hat": "redhat.com",
  redhat: "redhat.com",
};

const LEGAL_SUFFIX = /\b(inc|llc|ltd|limited|gmbh|co|corp|corporation|sa|s\.a|ag|plc|sl|s\.l|bv|oy|ab|company|group|holdings|technologies|technology|labs|systems)\b/gi;

/** Normalize a company name to a likely registrable domain, or null if empty. */
export function companyDomain(name: string | undefined | null): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  if (!key) return null;
  if (DOMAIN_OVERRIDES[key]) return DOMAIN_OVERRIDES[key];

  // strip the leading word before "@"/"·"/"-" separators sometimes present
  const cleaned = key
    .replace(/[®™©]/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/[.,&'’/()|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  // re-check overrides after stripping suffixes (e.g. "Stripe, Inc." → "stripe")
  if (DOMAIN_OVERRIDES[cleaned]) return DOMAIN_OVERRIDES[cleaned];

  const slug = cleaned.replace(/\s+/g, "");
  if (slug.length < 2) return null;
  return `${slug}.com`;
}

/** 1–2 uppercase initials for the monogram fallback. */
export function companyInitials(name: string | undefined | null): string {
  if (!name) return "?";
  const words = name
    .replace(LEGAL_SUFFIX, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return name.trim().slice(0, 1).toUpperCase() || "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Deterministic hue (0–359) from the name, so a company is always one color. */
export function monogramHue(name: string | undefined | null): number {
  const s = (name ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
