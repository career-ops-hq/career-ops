#!/usr/bin/env bun
// Self-contained CLI for searching jobs on LinkedIn's public jobs-guest endpoints,
// for any country/region (plus remote). No external CLI framework, so it runs
// anywhere `bun` is available with zero install beyond the repo clone.
//
// Personal use only. This reads LinkedIn's public job pages; automated access is
// against LinkedIn's Terms of Service, so keep volume low and do not use it
// commercially or for bulk data collection. Run it on your own responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `linkedin-cli — search jobs on LinkedIn (any country/region, plus remote)

USAGE
  bun run src/cli.ts search --location "<place>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --location, -l <text>   Location to search. REQUIRED. e.g. "Mumbai, Maharashtra, India",
                          "Berlin, Germany", "London, United Kingdom", or "Remote".
  --query, -q <text>      Keywords (job title, skill, or role). Recommended.
  --jobage <days>         Posted within N days: 1, 7, 14, 30. Default: all.
  --jobage-minutes <n>    Posted within N minutes (sub-day precision). Conflicts with --jobage.
  --remote <mode>         remote | hybrid | onsite. Filter by workplace type.
  --page <n>              1-indexed page (10 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "data engineer" -l "Bengaluru, Karnataka, India" --jobage 30 --format table
  bun run src/cli.ts search -q "product manager" -l "Berlin, Germany" --remote remote --format table
  bun run src/cli.ts search -q "paralegal" -l "Remote" --format table
  bun run src/cli.ts search -q "engineer" -l "Remote" --jobage-minutes 30 --format table
  bun run src/cli.ts detail 4300011451 --format plain

Personal use only — uses LinkedIn's public pages; keep volume low (LinkedIn ToS).
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/l/n to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "location", "query", "jobage", "jobage-minutes", "remote", "page", "limit", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error (a wrong flag name
  // once returned an entire portal's database as if it matched the query).
  // add-portal.md's contract requires a bogus flag to exit 1 with a JSON
  // error on stderr.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const location = typeof flags.location === "string" ? flags.location : undefined
    if (!location) {
      process.stderr.write(
        JSON.stringify({
          error: 'the --location/-l flag is required (e.g. -l "Mumbai, Maharashtra, India", -l "Berlin, Germany", or -l "Remote")',
          code: "NO_LOCATION",
        }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"

    if (flags.jobage !== undefined && flags["jobage-minutes"] !== undefined) {
      process.stderr.write(
        JSON.stringify({
          error: "--jobage and --jobage-minutes both set a freshness window; pass only one",
          code: "CONFLICTING_AGE_FLAGS",
        }) + "\n",
      )
      return 1
    }

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      // Number(), not parseInt(): parseInt truncates, so "--jobage 0.5"
      // became 0 and silently dropped f_TPR from the request (#371).
      // Whole numbers >= 1 only, matching the other portal CLIs.
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} must be a whole number of at least 1, got "${raw}"`, code: "BAD_ARG" }) + "\n",
        )
        return null
      }
      return val
    }

    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      flags.jobage = String(v)
    }
    if (flags["jobage-minutes"] !== undefined) {
      const v = parseIntFlag("jobage-minutes", flags["jobage-minutes"])
      if (v === null) return 1
      flags["jobage-minutes"] = String(v)
    }
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      flags.page = String(v)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      jobageMinutes: flags["jobage-minutes"] ? parseInt(flags["jobage-minutes"] as string, 10) : undefined,
      remote: typeof flags.remote === "string" ? flags.remote : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      id,
      format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
    }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
