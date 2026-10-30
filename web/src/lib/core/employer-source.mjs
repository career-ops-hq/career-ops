// Isolated, read-only worker: import core functions, never invoke scan.main().
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EMPLOYER_ENTRIES } from "../employer-preset.mjs";

export const EMPLOYER_PAGE_CAP = 10;

/** Uses the provider unchanged and the exact scan.mjs filter functions. */
export async function scanEmployer(id, request, { provider, core, http }) {
  const titleMatches = core.buildTitleFilter({ positive: request.positive });
  const locationMatches = core.buildLocationFilter({ allow: request.allow });
  let incomplete = "";
  let invalid = 0;
  const ctx = {
    ...http,
    fetchJson: async (url, options) => {
      try {
        const json = await http.fetchJson(url, {
          ...options,
          timeoutMs: 10_000,
        });
        const list =
          id === "tencent"
            ? json?.Data?.Posts
            : id === "bytedance"
              ? json?.data?.job_post_list
              : json?.data?.list;
        const total = Number(
          id === "tencent"
            ? json?.Data?.Count
            : id === "bytedance"
              ? json?.data?.count
              : json?.data?.page?.totalCount,
        );
        if (!Array.isArray(list) || !Number.isFinite(total) || total < 0)
          throw new Error("Source-data problem: unreadable listing response");
        // Providers omit malformed records; do not turn their omission into a clean empty scan.
        for (const item of list) {
          const title =
            id === "tencent"
              ? item?.RecruitPostName
              : id === "bytedance"
                ? item?.title
                : item?.name;
          const identity =
            id === "tencent"
              ? item?.PostURL || item?.PostId
              : id === "bytedance"
                ? item?.id
                : item?.jobUnionId;
          if (
            typeof title !== "string" ||
            !title.trim() ||
            identity == null ||
            identity === ""
          )
            invalid++;
        }
        if (total > EMPLOYER_PAGE_CAP * 100)
          incomplete = `page cap (${EMPLOYER_PAGE_CAP} pages) limits coverage`;
        if (!list.length && total > 0)
          incomplete = "source stopped before reporting all postings";
        return json;
      } catch (error) {
        incomplete = "source request failed or timed out";
        throw error;
      }
    },
  };
  // No keywords: provider fetches the board; core filters are the only matcher.
  const jobs = await provider.fetch(
    { ...EMPLOYER_ENTRIES[id], max_pages: EMPLOYER_PAGE_CAP },
    ctx,
  );
  const offers = [];
  const seen = new Set();
  for (const job of jobs) {
    let url;
    if (!job || typeof job.url !== "string") {
      invalid++;
      continue;
    }
    try {
      url = new URL(job.url);
    } catch {
      invalid++;
      continue;
    }
    if (
      typeof job.company !== "string" ||
      !job.company.trim() ||
      typeof job.title !== "string" ||
      !job.title.trim() ||
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      invalid++;
      continue;
    }
    if (
      !titleMatches(job.title) ||
      !locationMatches(job.location, job.url, job.title)
    )
      continue;
    const key = core.normalizeUrlForDedup(job.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const date = job.postedAt == null ? null : new Date(job.postedAt);
    offers.push({
      company: job.company,
      title: job.title,
      url: job.url,
      location: job.location || "",
      postedAt:
        date && Number.isFinite(date.getTime())
          ? date.toISOString().slice(0, 10)
          : "",
      ats: id,
      source: id,
    });
  }
  if (invalid)
    incomplete = `source-data problem: ${invalid} records missing company, title or posting identity`;
  return {
    id,
    state: incomplete ? "incomplete" : "complete",
    reason: incomplete,
    offers,
  };
}

// The Web route spawns this source worker by absolute filename; no user paths
// are written, no CLI main, scan history, health, liveness or AI task is called.
if (process.argv[2] === "--worker") {
  const [codeRoot, id] = process.argv.slice(3);
  try {
    if (!Object.hasOwn(EMPLOYER_ENTRIES, id)) throw new Error("Unknown source");
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const load = (relative) =>
      import(pathToFileURL(path.join(codeRoot, relative)).href);
    const [{ default: provider }, core, http] = await Promise.all([
      load(`providers/${EMPLOYER_ENTRIES[id].provider || id}.mjs`),
      load("scan.mjs"),
      load("providers/_http.mjs"),
    ]);
    const result = await scanEmployer(id, JSON.parse(input), {
      provider,
      core,
      http: http.makeHttpCtx(),
    });
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stdout.write(
      JSON.stringify({
        id,
        state: "failed",
        reason: "source request failed or returned invalid data",
        offers: [],
      }),
    );
    process.exitCode = 1;
  }
}
