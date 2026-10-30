/**
 * url-normalize.mjs — Normalizes a job description URL to its direct application form URL.
 * Pure isomorphic helper: safe for both client and server components.
 *
 * Examples:
 * - Ashby: https://jobs.ashbyhq.com/qlub/975d7158... -> https://jobs.ashbyhq.com/qlub/975d7158.../application
 * - Lever: https://jobs.lever.co/org/job-id -> https://jobs.lever.co/org/job-id/apply
 * - Workable: https://apply.workable.com/org/j/job-id -> https://apply.workable.com/org/j/job-id/apply/
 * - SmartRecruiters: https://jobs.smartrecruiters.com/org/job-id -> https://jobs.smartrecruiters.com/org/job-id/apply
 * - Greenhouse: boards.greenhouse.io/org/jobs/job-id -> boards.greenhouse.io/org/jobs/job-id#app
 */
export function normalizeToApplicationUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed) return rawUrl;

  try {
    const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    const candidate = hasProtocol ? trimmed : `https://${trimmed}`;
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();

    // Ashby: https://jobs.ashbyhq.com/:company/:jobId -> /application
    if (/(^|\.)ashbyhq\.com$/.test(host)) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length === 2 && parts[1] !== "application") {
        parsed.pathname = `/${parts[0]}/${parts[1]}/application`;
        return parsed.toString();
      }
    }

    // Lever: https://jobs.lever.co/:company/:jobId -> /apply
    if (/(^|\.)lever\.co$/.test(host)) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length === 2 && parts[1] !== "apply") {
        parsed.pathname = `/${parts[0]}/${parts[1]}/apply`;
        return parsed.toString();
      }
    }

    // Workable: https://apply.workable.com/:company/j/:jobId -> /apply/
    if (/(^|\.)workable\.com$/.test(host)) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length === 3 && parts[1] === "j" && parts[2] !== "apply") {
        parsed.pathname = `/${parts[0]}/j/${parts[2]}/apply`;
        return parsed.toString();
      }
    }

    // SmartRecruiters: https://jobs.smartrecruiters.com/:company/:jobId -> /apply
    if (/(^|\.)smartrecruiters\.com$/.test(host)) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length === 2 && parts[1] !== "apply") {
        parsed.pathname = `/${parts[0]}/${parts[1]}/apply`;
        return parsed.toString();
      }
    }

    // Greenhouse: boards.greenhouse.io/:company/jobs/:jobId -> #app
    if (/(^|\.)greenhouse\.io$/.test(host)) {
      if (parsed.pathname.includes("/jobs/") && !parsed.hash) {
        parsed.hash = "app";
        return parsed.toString();
      }
    }

    return hasProtocol ? parsed.toString() : rawUrl;
  } catch {
    return rawUrl;
  }
}
