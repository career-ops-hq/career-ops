/** @type {import('next').NextConfig} */
const allowedOrigins = [
  '192.168.2.48',
  'localhost',
  '127.0.0.1',
  ...(process.env.CAREER_OPS_WEB_ALLOWED_HOSTS
    ? process.env.CAREER_OPS_WEB_ALLOWED_HOSTS.split(/[\s,]+/)
    : [])
];

const nextConfig = {
  allowedDevOrigins: allowedOrigins,
  // Two lockfiles exist on purpose (repo root + web/), so Next would infer the
  // repo root as the workspace root. On Windows that misinference can send
  // Turbopack's postcss workers into an unbounded respawn loop that exhausts
  // all RAM (vercel/next.js#92978) — pin the root to this app.
  turbopack: { root: import.meta.dirname },
  // Allow a throwaway build dir (e.g. BUILD_DIST=.next-prod) so a production
  // `next build` can run without clobbering a live `next dev` .next.
  ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
};

export default nextConfig;
