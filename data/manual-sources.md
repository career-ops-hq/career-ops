# Manual Sources (discovery-only)

Recruiter/agency boards that are **not** wired into `scan.mjs`. Reason: anonymous employers, no clean per-employer API, and the value model is human - you spot a relevant role, then contact the recruiter to de-anonymize and start the process.

**Workflow:** skim periodically -> surface new SC/Solana/Rust-relevant, remote-compatible roles (URLs inline) -> NO full evaluation up front -> user contacts the recruiter and drives the hiring process manually.

**Carve-out:** for these agency boards, missing posting dates do NOT exclude a lead (unlike the automated pipeline). Note when a date is unavailable and make it the first question to the recruiter. See memory `feedback_agency_boards_discovery_only`.

Last full skim: _never_

| Source | URL | What it is | Skim notes / caveats |
|---|---|---|---|
| **Socius Talent** | https://sociustalent.com/jobs | Web3/blockchain/AI recruiting agency | Strongest of the set. ~50 live roles, **salary on every listing** ($160-320K seen), remote-friendly, employers anonymous ("Leading Web3 Company"). Already surfaced a STRONG-fit SC role in June 2026. Filter out non-eng + on-site. |
| **Up Top (Top Shelf Jobs)** | https://uptop.notion.site/job-board | Web3 recruiting agency, curated Notion board | Roles are unique to Up Top (not in any ATS the scanner covers). Client shown as "No access" (anonymous). Apply funnels through a single `noteforms.com/forms/top-shelf-job-application-cheqot` form with the Notion page id as the job id. Notion SPA - skim manually. |
| **StepInX** | https://jobs.stepinx.com/ | General recruiting agency (crypto + iGaming + exec) | Small board (~10 roles), mixes eng with C-suite/BD/marketing. **No posting dates** - ask the recruiter. Filter to Crypto/Web3 + Remote + eng. On-site roles excluded per remote policy. |
| **Agora4** | https://agora4.xyz/jobs | Web3 recruiting / talent firm (Agora Group) | Lower confidence. Live with anonymous #SOLANA #RUST #DEFI roles + comp, but site chrome is stale (© 2025), platform half-launched ("ACCESS_TALENT COMING_SOON"), and JD text has AI-gen artifacts (`[cite: N]` leaks). Re-verify freshness on each skim. |
| **JobStash** | https://jobstash.xyz/jobs | Crypto-native job aggregator (not an agency) | The one aggregator worth a manual skim: date-stamped every listing (solves the freshness-gate), salary visible, investor/funding metadata, faceted filtering (`cl-smartcontracts`). NOT auto-scanned (own platform, no clean per-employer API). Employers are named, so it's a true discovery feed - any strong role can go through the normal pipeline. |
| **X (Twitter) / X Hiring** | https://x.com/jobs | Social platform + verified-org jobs board. TWO value modes: (1) the structured Jobs board, (2) founders/companies tweeting "hiring a Solana eng, DM me" - the warm-lead gold that actually converts. | **LOGIN-GATED: cannot be wired into `scan.mjs`** (no public fetch, no free jobs API, authenticated scraping breaks ToS + is fragile). Discovery is manual: skim X search (queries below) + followed accounts, then **DM the poster directly** (best-fit for the warm/inbound strategy). Individual `x.com/i/jobs/{id}` links are NOT agent-fetchable - paste the JD text or a screenshot for triage (image-sourced postings are valid input). Verify-before-adding still applies. |

## X (Twitter) discovery - search queries to skim

X is the warm/inbound channel (your cold-apply advance rate is ~3%, 0/8 on Ashby - see `analyze-patterns.mjs`). Run these in X search sorted by **Latest**; skim for remote-compatible Solana/Rust/SC roles, then **DM the poster** or paste the link/screenshot here for evaluation:

- `("solana" OR "anchor" OR "SVM") ("hiring" OR "we're hiring" OR "join us") (engineer OR developer) -is:retweet`
- `("smart contract" OR "rust") ("hiring" OR "DM me") (solana OR web3) -is:retweet`
- `("solana engineer" OR "anchor developer") (remote OR contract)`

Follow for hiring signal: Solana-ecosystem job accounts, VC talent accounts, and the founder / eng-lead handles of your target companies - they post roles on X *before* the ATS, and a reply/DM lands warmer than a cold form.

## Not added (for the record)

- **a16z portfolio jobs** (`portfoliojobs.a16z.com`) - high SC density, but Consider.com is session-token-gated so it can't go in `scan.mjs`. Optional manual-skim bookmark, not an agency.
- **Realm Group** - inbound headhunter (pitched the Senior SVM Engineer / $250K role on 2026-06-23). A recruiter relationship to keep warm, not a board to skim.
