// Data source: LinkedIn public "jobs-guest" endpoints. No authentication required.
// Search returns an HTML list of job cards; detail returns a single job's HTML.
// We parse both with regex (the markup is shallow and stable; a full DOM parser
// is unnecessary and node-html-parser has known nesting bugs on LinkedIn cards).

export const SEARCH_URL =
  "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
export const DETAIL_URL =
  "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; linkedin-search-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  seniority: string | null
  employmentType: string | null
  jobFunction: string | null
  industries: string | null
  isActive: boolean
}

/**
 * Extract the inner HTML of a <div> identified by a CSS class name, correctly
 * handling nested <div> elements by tracking tag depth.
 */
export function extractDivContent(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const openRe = new RegExp(`<div[^>]*class="[^"]*${escaped}[^"]*"[^>]*>`, 'i')
  const open = openRe.exec(html)
  if (!open) return null

  let i = open.index + open[0].length
  let depth = 1

  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf('<div', i)
    const nextClose = html.indexOf('</div>', i)

    if (nextClose === -1) return null

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }

  return html.slice(open.index + open[0].length, i - 6)
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

/** Parse the job ID out of a LinkedIn job-view URL or URN. */
function idFromUrl(url: string): string | null {
  const m = url.match(/-(\d{6,})(?:\?|$)/) || url.match(/(\d{6,})/)
  return m ? m[1] : null
}

/**
 * Parse the search response: a flat list of <li> job cards. We split on the
 * job-posting URN and parse each chunk independently so one malformed card
 * cannot break the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split(/data-entity-urn="urn:li:jobPosting:/).slice(1)

  for (const chunk of chunks) {
    const idMatch = chunk.match(/^(\d+)/)
    if (!idMatch) continue
    const id = idMatch[1]

    // Full link + title (title lives in the sr-only span or the <h3> title).
    const linkMatch = chunk.match(/class="base-card__full-link[^"]*"[^>]*href="([^"]+)"/i)
    const url = linkMatch ? decodeHtmlEntities(linkMatch[1]).split("?")[0] : ""

    let title: string | null = null
    const h3 = chunk.match(/class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/i)
    if (h3) title = clean(h3[1])
    if (!title) {
      const sr = chunk.match(/class="sr-only"[^>]*>([\s\S]*?)<\/span>/i)
      if (sr) title = clean(sr[1])
    }
    if (!title) continue

    // Company (subtitle <h4> with optional inner <a>).
    let company: string | null = null
    let companyUrl: string | null = null
    const sub = chunk.match(/class="base-search-card__subtitle"[^>]*>([\s\S]*?)<\/h4>/i)
    if (sub) {
      const a = sub[1].match(/href="([^"]+)"/i)
      if (a) companyUrl = decodeHtmlEntities(a[1]).split("?")[0]
      company = clean(sub[1]) || null
    }

    // Location + date.
    const loc = chunk.match(/class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>/i)
    const location = loc ? clean(loc[1]) || null : null
    const dt = chunk.match(/class="job-search-card__listdate[^"]*"[^>]*datetime="([^"]+)"/i)
    const date = dt ? dt[1] : null

    results.push({
      id,
      title,
      company,
      companyUrl,
      location,
      date,
      url: url || `https://www.linkedin.com/jobs/view/${id}`,
    })
  }

  return results
}

/** Parse the single-job detail page. */
export function parseJobDetail(html: string, id: string): JobDetail {
  const title = html.match(
    /class="(?:top-card-layout__title|topcard__title)[^"]*"[^>]*>([\s\S]*?)<\/h[12]>/i,
  )?.[1]
  const orgMatch = html.match(
    /class="topcard__org-name-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
  )
  const company = orgMatch ? clean(orgMatch[2]) || null : null
  const companyUrl = orgMatch ? decodeHtmlEntities(orgMatch[1]).split("?")[0] : null

  const locMatch = html.match(
    /class="topcard__flavor topcard__flavor--bullet"[^>]*>([\s\S]*?)<\/span>/i,
  )
  const location = locMatch ? clean(locMatch[1]) || null : null

  // Rich description block. Keep paragraph/line breaks as newlines.
  let description: string | null = null
  const descHtml =
    extractDivContent(html, "show-more-less-html__markup") ??
    extractDivContent(html, "description__text")
  if (descHtml) {
    const withBreaks = descHtml
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    description = decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim() || null
  }

  // Job-criteria items: subheader label -> text value.
  const criteria: Record<string, string> = {}
  const itemRe =
    /class="description__job-criteria-subheader"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?class="description__job-criteria-text[^"]*"[^>]*>([\s\S]*?)<\/span>/gi
  let cm: RegExpExecArray | null
  while ((cm = itemRe.exec(html)) !== null) {
    criteria[clean(cm[1]).toLowerCase()] = clean(cm[2])
  }

  // Closed-state detection, scoped to the top card. A closed posting renders
  //   <figure class="closed-job closed-job__flavor topcard__flavor-row">
  //     <figcaption ...>No longer accepting applications</figcaption>
  //   </figure>
  // there; that class and its visible text are the only markers real closed
  // pages carry (verified against live guest pages, 2026-08-09). The search
  // stops where the description markup begins: recruiter boilerplate quotes
  // these phrases, and a false CLOSED talks a user out of a live job.
  // Absence of the banner is absence of evidence, not proof the posting is
  // open - markup drift or a consent-walled response also renders no banner -
  // so isActive: true means only "no closed banner found".
  const descStart = html.search(/class="(?:show-more-less-html__markup|description__text)/i)
  const topcard = descStart === -1 ? html : html.slice(0, descStart)
  const isActive = !/closed-job__flavor|no longer accepting applications/i.test(topcard)

  return {
    id,
    title: title ? clean(title) : "(untitled)",
    company,
    companyUrl,
    location,
    date: null,
    url: `https://www.linkedin.com/jobs/view/${id}`,
    description,
    seniority: criteria["seniority level"] ?? null,
    employmentType: criteria["employment type"] ?? null,
    jobFunction: criteria["job function"] ?? null,
    industries: criteria["industries"] ?? null,
    isActive,
  }
}

/** Convert a job-age in days to LinkedIn's f_TPR seconds value. */
export function jobageToTPR(days: number): string | null {
  if (!days || days <= 0 || days >= 9999) return null
  return `r${days * 86400}`
}

/** Convert a job-age in minutes to LinkedIn's f_TPR seconds value (sub-day precision). */
export function minutesToTPR(minutes: number): string | null {
  if (!minutes || minutes <= 0) return null
  return `r${minutes * 60}`
}

/** Workplace-type flag: on-site=1, remote=2, hybrid=3. */
export function workTypeFlag(mode: string | undefined): string | null {
  switch ((mode || "").toLowerCase()) {
    case "remote":
      return "2"
    case "hybrid":
      return "3"
    case "onsite":
    case "on-site":
      return "1"
    default:
      return null
  }
}
