import { DETAIL_URL, htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const LINKEDIN_HOST = /(^|\.)linkedin\.com$/i

/**
 * Accept a raw job ID, a job URN, a LinkedIn job-view URL (any linkedin.com
 * host, with or without scheme), or a bare title slug ending in the ID.
 *
 * A URL on any other host is rejected. The previous pattern took the first
 * 6+-digit path segment from ANY URL, so a Greenhouse or Lever apply link -
 * the kind a posting's own page hands out - fetched whatever LinkedIn
 * posting happened to carry that number and printed it with exit 0. Host and
 * path are read through real URL parsing, so look-alike hosts
 * (linkedin.com.evil.io) and userinfo tricks (linkedin.com@evil.io) fall on
 * the reject side too.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  const urn = trimmed.match(/urn:li:jobPosting:(\d+)/)
  if (urn) return urn[1]
  if (/^\d{6,}$/.test(trimmed)) return trimmed

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!LINKEDIN_HOST.test(parsed.hostname)) return null
    const path = parsed.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/)
    return path ? path[1] : null
  }

  // A scheme- and slash-free slug such as "software-engineer-1234567890".
  const slug = trimmed.match(/^[a-z0-9-]*-(\d{6,})$/i)
  return slug ? slug[1] : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(`${DETAIL_URL}/${id}`)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.seniority ? `Seniority: ${job.seniority}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.jobFunction ? `Function: ${job.jobFunction}` : "",
        job.industries ? `Industries: ${job.industries}` : "",
        `Status: ${job.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
