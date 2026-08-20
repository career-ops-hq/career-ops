import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRequest, parseAllowedHosts } from "@/lib/origin-guard.mjs";

// Single choke point over the API surface. Every /api request is gated on the
// same-origin + loopback guard before it can reach a route handler (which may
// spawn a child process or write the user's files). See origin-guard.mjs for
// the two-layer rationale (F1 drive-by CSRF, F2 LAN reachability).
//
// Opt in to extra hosts (e.g. a trusted LAN box) with a comma/space separated
// CAREER_OPS_WEB_ALLOWED_HOSTS; unset means loopback only.
export function proxy(req: NextRequest) {
  const decision = checkRequest({
    secFetchSite: req.headers.get("sec-fetch-site"),
    origin: req.headers.get("origin"),
    host: req.headers.get("host"),
    allowedHosts: parseAllowedHosts(process.env.CAREER_OPS_WEB_ALLOWED_HOSTS),
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.reason }, { status: decision.status });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
