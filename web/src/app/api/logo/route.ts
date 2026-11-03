import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { companyDomain } from "@/lib/company";
import { companyCacheKey } from "@/lib/core/logo-cache-key.mjs";
import { companyDomains } from "@/lib/core/company-domains.mjs";
import { cacheLogoResult, resolveLogo } from "@/lib/core/logo-fetch.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Localhost logo proxy + on-disk cache, FOREVER per key. Honors local-first: the
// browser never talks to Google directly. Accepts `?domain=` (exact) OR
// `?company=` (a name → we guess a handful of likely domains and resolve once).
// Each key is fetched until Google answers for it, then served from
// .career-ops-web/logo-cache forever (a hit, or an empty sentinel for a known
// miss). A lookup that failed (timeout, offline, 429, 5xx) is not an answer and
// is not cached. On any miss → 404 so the client's <img onError> falls back to
// the offline monogram. Because the cache is
// keyed by company, once a company's logo resolves it's instant for that card AND
// every other card (this search or any future one), forever. "Forever" is why
// company keys are versioned — see lib/core/logo-cache-key.

const DOMAIN_RE = /^[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;

function cacheDir(): string {
  return path.join(careerOpsRoot(), ".career-ops-web", "logo-cache");
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
    // Versioned + digested (see lib/core/logo-cache-key): the cache never
    // expires, so the key has to carry both the resolver version and enough of
    // the name to keep two companies apart.
    const companyKey = companyCacheKey(company);
    if (!companyKey) return new Response("bad company", { status: 400 });
    key = companyKey;
    candidates = companyDomains(company, companyDomain);
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

  // 2) resolve: first candidate domain that yields a real favicon wins. A hit
  // or a definite miss is cached for good (sentinel on miss → never refetch);
  // a failed lookup is not, so the next request asks again.
  const result = await resolveLogo(candidates);
  await cacheLogoResult(file, result);

  if (result.kind !== "hit") return new Response("no logo", { status: 404 });
  return new Response(result.bytes, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
}
