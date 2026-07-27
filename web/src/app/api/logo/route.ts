import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Localhost logo proxy + on-disk cache, FOREVER per key. Honors local-first: the
// browser never talks to Google directly. Accepts `?domain=` (exact) OR
// `?company=` (a name → we guess a handful of likely domains and resolve once).
// Each key is fetched at most once ever, then served from .career-ops-web/logo-cache
// (a hit, or an empty sentinel for a known miss). On any miss → 404 so the
// client's <img onError> falls back to the offline monogram. Because the cache is
// keyed by company, once a company's logo resolves it's instant for that card AND
// every other card (this search or any future one), forever.

const DOMAIN_RE = /^[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;

function cacheDir(): string {
  return path.join(careerOpsRoot(), ".career-ops-web", "logo-cache");
}

/** Plausible domains for a company name, cheapest/likeliest first. */
function companyDomains(company: string): string[] {
  const paren = company.match(/\(([A-Za-z0-9]{2,12})\)/)?.[1]; // "… (5WPR)"
  // [^()] (not [^)]) keeps the match unambiguous — no polynomial backtracking on
  // adversarial inputs full of unclosed parens (CodeQL js/polynomial-redos).
  const base = company.replace(/\([^()]*\)/g, "").trim();
  const compact = base.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  const firstWord = base.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
  const stems = [...new Set([compact, paren?.toLowerCase(), firstWord].filter((s): s is string => !!s && s.length >= 2 && s.length <= 30))];
  const out: string[] = [];
  for (const t of [".com", ".ai", ".io", ".co"]) for (const s of stems) out.push(s + t);
  return out.slice(0, 5);
}

/** Fetch a real favicon for one domain (Google's tokenless service). Returns the
 *  bytes, or null for a miss (Google serves a tiny globe placeholder for misses). */
async function fetchFavicon(domain: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(3500),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return ab.byteLength > 220 ? ab : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const domain = (sp.get("domain") ?? "").trim().toLowerCase();
  const company = (sp.get("company") ?? "").trim();

  let key: string;
  let candidates: string[];
  if (domain) {
    if (!DOMAIN_RE.test(domain) || domain.includes("..")) return new Response("bad domain", { status: 400 });
    key = domain.replace(/[^a-z0-9.-]/g, "_");
    candidates = [domain];
  } else if (company) {
    const slug = company.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    if (!slug) return new Response("bad company", { status: 400 });
    key = `co_${slug}`;
    candidates = companyDomains(company);
    if (candidates.length === 0) return new Response("no logo", { status: 404 });
  } else {
    return new Response("need domain or company", { status: 400 });
  }

  // `key` is already sanitized above, but enforce containment anyway: a cache
  // path must never resolve outside the cache dir (defense in depth).
  const file = path.resolve(cacheDir(), `${key}.png`);
  if (!file.startsWith(path.resolve(cacheDir()) + path.sep)) return new Response("bad key", { status: 400 });

  // 1) serve from disk cache forever (hit, or empty sentinel = known miss)
  try {
    const buf = await fs.readFile(file);
    if (buf.byteLength > 0) {
      return new Response(new Uint8Array(buf), { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
    }
    return new Response("no logo", { status: 404 });
  } catch {
    /* not cached yet → resolve below */
  }

  // 2) resolve once: first candidate domain that yields a real favicon wins
  let bytes: ArrayBuffer | null = null;
  for (const d of candidates) {
    bytes = await fetchFavicon(d);
    if (bytes) break;
  }

  try {
    await fs.mkdir(cacheDir(), { recursive: true });
    await fs.writeFile(file, bytes ? Buffer.from(bytes) : new Uint8Array(0)); // sentinel on miss → never refetch
  } catch {
    /* best-effort */
  }

  if (!bytes) return new Response("no logo", { status: 404 });
  return new Response(bytes, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
}
