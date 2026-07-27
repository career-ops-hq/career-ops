# Custom Instructions -- career-ops

<!-- ============================================================
     THIS FILE IS YOURS. It will NEVER be auto-updated.

     Put your own house rules, custom workflows, and automations
     here -- anything you want the agent to ALWAYS do (or never do).

     This is for PROCEDURAL rules ("HOW I want things done").
     For WHO you are (archetypes, narrative, comp, negotiation),
     use modes/_profile.md instead. Keeping the two separate keeps
     each one readable.

     The agent reads this file alongside the system instructions;
     your rules here take precedence over the defaults, as long as
     they don't break the Data Contract (your files are never
     touched, and we never auto-submit an application for you).

     Because this is a user-layer file, anything you write here
     survives `node update-system.mjs`. Put customizations HERE,
     not in CLAUDE.md / modes/_shared.md / other system files --
     those get overwritten on update.
     ============================================================ -->

## House Rules

<!-- Rules the agent should always follow. Examples:
     - Always write evaluation summaries in British English.
     - Never include a photo in my CV (US / ATS-first market).
     - Cap each batch run at 20 listings unless I say otherwise.
     - If a report scores below 6, skip the cover letter. -->

### Never ship a copied CV - always customize it to the target role

Clone the most recent prior CV as the STRUCTURAL base (keep the same general
structure, sections, conventions and typography - do NOT rebuild from the
template). But NEVER submit that clone as-is. Every CV must be tailored to the
specific role before it goes out:

- **Subtitle:** match the role's emphasis (role-only, no program names).
- **Summary:** reorder and reframe so the FIRST thing the reviewer reads is the
  credential that role prices highest; demote or compress what that role does
  not care about. For a low-level/perf/SVM shop, lead with execution-layer Rust
  (SabVM/REVM); for a security/custody shop, lead with the audit + fund-custody
  work; etc.
- **Core Skills:** reorder so the target's keywords sit at the top; drop skills
  that are pure noise for that target.
- **Cut ruthlessly:** trim or minimize content irrelevant to the target (e.g.
  heavy EVM-audit / EIP / C# volume for a Solana-perf role) so the signal they
  scan for is not buried under things they will not read.
- **Never lead with a gap** on the role's core axis. Reorder/reframe/emphasize
  to fit - never fabricate (keywords get reformulated, never invented).

Rationale: an untailored clone reads as a generic mass-application and gets
fast-rejected at top-of-funnel (see the Ellipsis Labs SVM reject). Same effort,
converts far better when the CV speaks the target's language. This rule is the
second half of the clone rule, not a contradiction of it: clone the structure,
customize the content.

### Source check on every opportunity (mandatory)

Whenever a job opportunity enters the system - a URL/JD/image/email the user
hands over, OR a role the agent finds itself during scans, discovery, or
research - the agent must evaluate the SOURCE, not just the job:

1. **Identify the platform** the job is posted on (ATS, job board, aggregator,
   agency board, social). Decode tracking params (`?source=`, `utm_*`,
   `?gh_src=`) - they often reveal the original discovery channel, which may be
   a second source worth checking.
2. **Check current coverage:**
   - Provider: does `providers/{platform}.mjs` exist?
   - Config: is the company/board already in `portals.yml`, a discovery feed,
     or `data/manual-sources.md`?
3. **Judge COULD vs SHOULD:**
   - COULD: provider supported (or trivially addable), fetchable without login,
     clean per-employer or per-board API.
   - SHOULD: does this company/board plausibly keep posting roles matching the
     current targets (SC primary; backend web3 Rust/Go/Node secondary)?
     Respect existing source policies: agency boards = discovery-only skim,
     login-gated platforms (X) = manual paste-in, aggregators require the
     liveness/freshness gate.
4. **Notify - ALWAYS, even when the answer is "already covered" or "skip".**
   End the response with a short `Source check:` block stating: platform,
   company/board, coverage status, and the recommendation (add to
   `portals.yml` / add to `data/manual-sources.md` / already covered / skip)
   with a one-line why.
5. **Never silently modify** `portals.yml` or `data/manual-sources.md` -
   propose the exact entry and add it only after the user confirms (a "yes,
   add it" in the same conversation counts).

### Close browser windows/tabs when done with them

The Playwright MCP browser opens a visible Chrome window on the user's machine.
After finishing with a page (liveness check, JD capture, form inspection),
close what was opened as soon as it is no longer needed:

- Opened one page for a quick check -> `browser_close` right after capturing
  the snapshot/content needed.
- Working across multiple tabs -> close individual tabs via `browser_tabs`
  as each one is done; `browser_close` at the end of the task.
- EXCEPTION: keep the window open when the user still needs it - e.g. a
  half-filled application form awaiting their review before submission, or
  when they explicitly ask to leave it open.

Snapshots/screenshots are saved to disk, so closing loses nothing.

## Custom Workflows

<!-- Multi-step routines you run often, given a short name. Examples:
     - "weekly review": scan my saved portals, evaluate the new roles,
       then give me a one-paragraph summary of the top 3.
     - "prep <company>": pull the JD, generate STAR stories from
       article-digest.md, and draft 5 likely interview questions. -->

(none yet -- add yours above)

## Output Preferences

<!-- How you like results formatted. Examples:
     - Reports: lead with the score and the one-line verdict.
     - Show the per-step token breakdown after a batch run.
     - Save PDFs date-first: YYYY-MM-DD-company.pdf -->

(none yet -- add yours above)

## Off-Limits

<!-- Things the agent must never do for you. Examples:
     - Never auto-fill or submit an application without showing me first.
     - Never edit a system file to customize my setup -- put it here. -->

(none yet -- add yours above)
