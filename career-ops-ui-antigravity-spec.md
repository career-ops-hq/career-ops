# Career-ops Web UI — Antigravity Implementation Specification

## 1. Objective

Add a first-class local web UI to the existing Career-ops repository.

The UI must expose the existing Career-ops functionality through a browser so a non-technical user can operate Career-ops without memorizing CLI/agent commands.

The existing CLI/agent workflows MUST continue to work unchanged.

Target experience:

```text
C:\Users\<user>\career-ops
        |
        | npm run ui
        v
Local Career-ops Web Server
        |
        v
http://localhost:<port>
        |
        +-- Dashboard
        +-- Jobs
        +-- Job Evaluation
        +-- Pipeline
        +-- Applications
        +-- CV / Documents
        +-- Recruiter / Contacts
        +-- Company Research
        +-- Interview Center
        +-- Offers
        +-- Follow-ups / Replies
        +-- Skill / Pattern Analysis
        +-- Job Discovery
        +-- Plugins / Integrations
        +-- Settings
```

Career-ops is local-first and human-in-the-loop. The UI must never silently submit job applications, send email, send LinkedIn messages, accept offers, or perform other irreversible external actions.

---

# 2. Critical implementation rules

## 2.1 Do not rewrite the Career-ops core

Reuse the existing scripts, modes, data contracts, providers, generators, tracker, reports, and configuration.

The web UI is another interface to Career-ops.

Do NOT create a second implementation of:

- Job scoring
- Job scanning
- Pipeline evaluation
- CV tailoring
- PDF generation
- Cover letters
- Application tracking
- Interview preparation
- Offer analysis
- Follow-up logic
- Reply classification
- Company research

The UI should invoke/reuse the existing capabilities.

## 2.2 Inspect before implementing

Before writing UI code:

1. Read `AGENTS.md`.
2. Read `ARCHITECTURE.md`.
3. Read `DATA_CONTRACT.md`.
4. Read the current `README.md`.
5. Inspect `modes/`.
6. Inspect `providers/`.
7. Inspect `config/`.
8. Inspect `data/`.
9. Inspect `reports/`.
10. Inspect `output/`.
11. Inspect the existing `web/` directory.
12. Inspect all relevant CLI scripts and their arguments.
13. Inspect the existing Antigravity skill under `.antigravitycli/skills/career-ops/`.
14. Run the existing test suite and doctor check before changing anything.

Do not assume that an older command list is complete. The UI must reflect the current repository.

---

# 3. Product principles

### Local-first

The default UI server runs on localhost.

### Human-in-the-loop

Every consequential action must be visible and user initiated.

### Reuse existing behavior

Existing Career-ops behavior is the source of truth.

### Configuration transparency

Anything configurable in files, environment variables, plugins, or runtime options should be discoverable in Settings.

### Secrets safety

Never display API keys or credentials in plaintext.

### Non-destructive defaults

Do not overwrite existing user files without confirmation.

### Graceful degradation

If an optional plugin, MCP server, provider, browser capability, or integration is unavailable, the UI should still start and explain what is unavailable.

---

# 4. Proposed command

Add a local UI command.

Preferred:

```bash
npm run ui
```

Optional convenience command if the repository has a CLI executable:

```bash
career-ops ui
```

The UI server should:

1. Validate prerequisites.
2. Resolve the Career-ops data root using the existing path-resolution rules.
3. Load existing configuration.
4. Start the local web server.
5. Print the URL.
6. Optionally open the browser automatically.
7. Shut down cleanly on Ctrl+C.

Example:

```text
Career-ops UI
──────────────────────────────

✓ Configuration loaded
✓ Profile loaded
✓ Tracker loaded
✓ Data directory ready

Web UI:
http://localhost:3000

Press Ctrl+C to stop.
```

Support:

```bash
npm run ui -- --port 3000
npm run ui -- --host 127.0.0.1
npm run ui -- --no-open
```

Use the repository's existing conventions where applicable.

---

# 5. Architecture

Preferred high-level architecture:

```text
                         Browser
                            |
                            v
                    React / TypeScript
                            |
                     HTTP / WebSocket
                            |
                            v
                  Local Node.js Server
                            |
              +-------------+-------------+
              |             |             |
              v             v             v
          Core modes    Existing libs   Scripts
              |             |             |
              +-------------+-------------+
                            |
                            v
                     Existing data
                            |
        +-------------------+--------------------+
        |                   |                    |
        v                   v                    v
      data/              reports/             output/
```

Use the repository's existing `web/` application if it is already an application shell. Extend it rather than creating a duplicate frontend.

If there is no suitable existing server/API architecture, introduce a small local API layer.

Avoid adding a database unless the existing repository genuinely requires one. Prefer existing markdown/YAML/JSON/data files and existing data contracts.

---

# 6. Navigation

Create a persistent sidebar/navigation.

Recommended sections:

1. Dashboard
2. Jobs
3. Discovery
4. Pipeline
5. Applications
6. Documents
7. Contacts
8. Companies
9. Interviews
10. Offers
11. Follow-ups
12. Analytics
13. Plugins
14. Settings

Use responsive navigation for smaller screens.

---

# 7. Dashboard

The dashboard is the default page.

Show:

### Overview cards

- Jobs discovered
- Jobs evaluated
- Interested jobs
- Applications
- Interviews
- Offers
- Pending follow-ups
- Unread employer replies if available

### Application funnel

```text
Discovered → Evaluated → Interested → Applied → Interview → Offer
```

### Recent jobs

Show:

- Company
- Role
- Location
- Score/evaluation
- Date
- Status

### Upcoming actions

Examples:

- Follow up with recruiter
- Interview tomorrow
- Review application
- Complete interview preparation
- Review employer reply

### Recent activity

Show recent pipeline/application/document actions.

---

# 8. Jobs

Provide a powerful table.

Columns should be configurable by the user.

Default columns:

- Company
- Role
- Location
- Work mode
- Score
- Seniority
- Salary/compensation
- Status
- Source
- Date discovered
- Date evaluated
- Sponsorship/work authorization signal
- Legitimacy signal

Features:

- Search
- Filters
- Sort
- Pagination
- Column visibility
- Column ordering
- Saved views
- Bulk selection
- Bulk pipeline processing
- Open original posting
- Open report
- Generate CV
- Generate cover letter
- Add/update tracker
- Research company

Job detail page:

```text
Overview
A-H Evaluation
CV Match
Requirements
Compensation
Level Strategy
Personalization
Legitimacy / Ghost-job Signal
Work Authorization
Interview Preparation
Documents
Application Status
Notes
Source
```

Do not hide the reasoning/report content behind a single score.

---

# 9. Job Discovery

UI equivalent of scanning/discovery.

Controls:

- Search keywords
- Positive title filters
- Negative title filters
- Location
- Remote/hybrid/on-site
- Seniority
- Source/provider
- Company list
- Date range
- Compensation filters if supported

Actions:

```text
[Scan Now]
[Refresh Results]
[Verify Sources]
```

Show scan progress.

Show provider/source health.

Show:

- provider name
- enabled/disabled
- number of results
- errors
- last scan
- authentication state where relevant

Do not expose credentials.

---

# 10. Pipeline

Provide a visual pipeline for pending work.

Stages should reflect the repository's actual pipeline and status model.

Example:

```text
Discovered
    ↓
Evaluated
    ↓
Interested
    ↓
Application Prepared
    ↓
Applied
    ↓
Recruiter Contact
    ↓
Interview
    ↓
Offer
    ↓
Outcome
```

Support:

- Run pipeline
- Process selected jobs
- Process all pending jobs
- View progress
- Retry failed jobs
- View logs/errors
- Cancel user-initiated running jobs where technically safe

Do not create a competing status model. Map the existing tracker statuses.

---

# 11. A-H Evaluation

The evaluation page must expose the full existing A-H evaluation.

Do not reduce it to a score.

Show:

- Role summary
- CV match
- Requirement-by-requirement importance
- Evidence/source of weighting
- Level strategy
- Compensation research
- Personalization
- Interview preparation
- Posting legitimacy / scam / ghost-job checks
- Work authorization signal
- Score
- Caveats and uncertainty

Clearly distinguish:

- Fact from job posting
- User profile evidence
- Research
- AI inference
- Estimate

Never present an estimate as a confirmed fact.

---

# 12. Applications

Create a complete application tracker.

Views:

### Table

Configurable columns.

### Kanban

Columns based on existing application statuses.

### Calendar/timeline

For:

- Application date
- Interview dates
- Follow-up dates
- Offer deadlines

Application detail should show:

- Company
- Role
- Status
- Dates
- Score
- Report
- CV/PDF
- Cover letter
- Emails
- Contacts
- Interview history
- Notes
- Follow-up history
- Employer replies
- Outcome

Actions:

- Update status
- Add note
- Attach/link artifact
- Schedule follow-up
- Open report
- Open CV
- Open original job

---

# 13. Documents

Central document manager.

Categories:

- Master CV
- Tailored CVs
- Cover letters
- Application emails
- Interview documents
- Reports
- Offer documents
- Other generated artifacts

Each document should show:

- Name
- Type
- Related company
- Related job
- Created date
- Updated date
- Location
- Open
- Preview
- Download
- Regenerate where supported

Do not silently delete or overwrite documents.

---

# 14. CV Management

Provide:

### Master CV

Display the current `cv.md`.

Allow editing only through an explicit save action.

### Tailored CV

Select:

- Job
- Template/style if configurable
- Personalization options

Actions:

```text
[Generate]
[Preview]
[Regenerate]
```

Show a warning before generation if required profile information is missing.

---

# 15. Cover Letter

Support the existing cover-letter workflow.

UI should expose:

- Job selection
- Why this role?
- Problems/impact
- Approach
- Tone
- Draft preview
- Approval step
- PDF generation

Important:

Do not automatically finalize/send a cover letter.

---

# 16. Email

Support application and follow-up email drafting.

Types:

- Recruiter application
- Referral
- Cold application
- Follow-up
- Interview follow-up
- Other

Show:

- Recipient
- Subject
- Body
- Attachment checklist
- Supporting fit points
- Contact block

Provide:

```text
[Generate Draft]
[Edit]
[Copy]
[Save]
```

Never send email unless an explicitly enabled integration exists and the user explicitly initiates the send action.

If Gmail is disabled, only provide draft/copy functionality.

---

# 17. Contacts

Expose the contact workflow.

Show:

- Name
- Company
- Role
- Source
- LinkedIn/profile URL if available
- Related job
- Contact status
- Draft outreach

Actions:

```text
[Find Contacts]
[Draft Message]
[Copy Message]
[Mark Contacted]
```

No automatic messaging.

---

# 18. Company Research

Company page:

- Company overview
- Website
- Open roles
- Relevant jobs
- Research findings
- Funding information if available
- Technology/engineering information where available
- Interview notes
- Red flags
- Source links
- Last researched date

Support the existing `deep` and funded-company discovery capabilities where available.

---

# 19. Interview Center

Dashboard:

```text
Upcoming
In Progress
Completed
```

Interview detail:

- Company
- Role
- Round
- Date/time
- Interviewer/contact
- Preparation status
- Questions
- Notes
- Feedback
- Debrief

Actions:

```text
[Prepare]
[Create Plan]
[Practice]
[Debrief]
[Research Company]
[Check Red Flags]
```

---

# 20. Interview Preparation Plan

Expose the existing time-blocked preparation functionality.

Allow:

- Interview date
- Available preparation days
- Hours/day
- Focus areas
- Job/company context

Show a checklist/calendar.

---

# 21. Interview Practice

Create an interactive practice screen.

Features:

- Question
- User answer
- Feedback
- Follow-up question
- STAR+R structure where applicable
- Session history
- Areas to improve

Allow starting/stopping a practice session.

Do not claim that AI feedback is a definitive assessment.

---

# 22. Interview Debrief

After interview:

- Record questions
- Record user's answers
- Mark confidence
- Capture feedback
- Identify gaps
- Generate follow-up tasks
- Update application

Do not automatically send follow-up messages.

---

# 23. Interview Red Flags

Expose the existing red-flag detector.

Show:

- Signal
- Evidence
- Source
- Confidence/uncertainty
- User notes

Avoid sensational labels. Present concrete evidence and let the user decide.

---

# 24. Offers

Expose the offer stage.

Include:

### Offer summary

- Employer
- Role
- Location
- Base salary
- Bonus
- Equity
- Benefits
- Start date
- Deadline

### Offer preparation

Support the existing `offer-prep` functionality.

Show:

- Contract/clause analysis
- Questions to ask a lawyer
- Negotiation notes

### Salary gap

Expose desired vs advertised vs actual compensation analysis.

Never present a legal analysis as legal advice.

---

# 25. Negotiation

Provide the existing negotiation-script functionality.

Sections:

- Salary
- Geographic discount
- Competing offers
- Other compensation

Allow generated scripts to be edited.

---

# 26. Follow-ups

Show all pending follow-ups.

Columns:

- Company
- Role
- Contact
- Last contact
- Recommended follow-up date
- Status
- Draft

Support the existing follow-up cadence calculator and reminder seeding.

Actions:

```text
[Draft Follow-up]
[Mark Done]
[Reschedule]
[Skip]
```

---

# 27. Employer Replies

If reply-watch is available:

Show:

- Message
- Company
- Related application
- Classification
- Suggested tracker update
- Confidence
- Source

Never automatically change critical application state without user confirmation unless the existing system explicitly guarantees a safe operation.

---

# 28. Analytics

Expose existing pattern analysis.

Show:

- Applications over time
- Interview conversion
- Outcomes
- Job-source performance
- Role/title distribution
- Skill frequency
- Skill gaps
- Rejection patterns
- Application status distribution

Do not invent statistics when data is insufficient.

Show sample size.

Example:

```text
Interview conversion
23 applications → 4 interviews
Sample size: 23
```

---

# 29. Upskilling

Expose the existing upskill functionality.

Show:

- Frequently requested skills
- Skills missing from profile
- Jobs requesting each skill
- Suggested learning priorities
- Related jobs

Do not turn the feature into an automatic career decision-maker.

---

# 30. Project / Portfolio

Expose the existing project functionality where supported.

Allow:

- Add project
- Edit project
- Link project to skills
- Link project to jobs
- Reuse project evidence in CV/application material

---

# 31. Training

Expose existing training functionality.

Provide:

- Training topics
- Progress
- Related skills
- Related jobs
- Practice tasks

Reuse existing data structures rather than inventing a new training database.

---

# 32. Agent Inbox

Expose `agent-inbox`.

Show:

- Pending tasks
- Requests
- Results
- Errors
- Needs-user-input states

Each item should clearly say what the user needs to do.

---

# 33. Plugins

Create a Plugins page.

Current optional integrations include:

- Gmail
- Notion
- Apify
- H1B sponsor functionality where present
- Community/plugin registry functionality

The repository's plugin system is opt-in and disabled by default.

For every plugin show:

```text
Plugin name
Status: Enabled / Disabled
Description
Required credentials
Permissions
Last used
```

Actions:

```text
[Enable]
[Disable]
[Configure]
[Test Connection]
```

Never expose secrets.

---

# 34. Settings — major requirement

**Every user-configurable setting must be accessible from the Settings UI.**

Do not make users edit YAML/config files for normal configuration.

Settings should be organized into sections.

## 34.1 Profile

Expose everything represented in:

```text
config/profile.yml
modes/_profile.md
modes/_custom.md
modes/_brief.md
```

Examples:

- Name
- Email
- Phone
- Location
- Timezone
- Current title
- Experience
- Education
- Skills
- Target roles
- Target companies
- Preferred locations
- Remote preference
- Salary expectations
- Work authorization
- Sponsorship needs
- Career goals
- Strengths
- Unique value
- Work preferences
- Deal-breakers
- Industries
- Company size preferences

Do not invent fields that conflict with the current schema. Generate the form dynamically from the existing configuration/schema where practical.

---

# 35. Job Search Settings

Expose:

- Positive title filters
- Negative title filters
- Location filters
- Remote/hybrid/on-site preference
- Seniority
- Compensation preferences
- Company preferences
- Excluded companies
- Keywords
- Search frequency if scheduling exists
- Source/provider selection

---

# 36. Portal Settings

Render the current `portals.yml` configuration.

Support:

- Enable/disable portal
- Company
- ATS
- Careers URL
- Search configuration
- Query configuration
- Filters
- Provider
- Custom sources

Provide validation.

Provide:

```text
[Verify Portals]
```

Do not silently rewrite working portal definitions.

---

# 37. Scanner Settings

Expose:

- Extractor mode
- Scan limits
- Batch size
- Concurrency where supported
- Timeouts
- Retry behavior
- Deduplication behavior
- Date windows
- Enabled providers

Respect existing configuration and environment variables.

---

# 38. Evaluation Settings

Expose configurable evaluation preferences.

Where current implementation supports configuration, expose:

- Scoring preferences
- Evaluation behavior
- Job-title strategy
- Compensation research options
- Personalization behavior
- Work-authorization handling
- Legitimacy checks

Do not let UI controls contradict the core scoring rules.

---

# 39. CV / PDF Settings

Expose:

- CV template
- Font choices if supported
- Font directory/status
- PDF page settings
- Output directory
- Naming convention
- Tailoring preferences
- Keyword injection preferences
- Personalization settings

Provide preview where practical.

---

# 40. Application Settings

Expose:

- Tracker location
- Status options if configurable
- Default follow-up cadence
- Application artifact behavior
- Default notes
- PDF/report linking behavior

Do not create a new tracker format.

---

# 41. Interview Settings

Expose:

- Default preparation duration
- Hours/day
- Preferred preparation areas
- Practice behavior
- Feedback preferences

---

# 42. AI / Model Settings

Show which AI CLI/runtime is being used.

Where configurable:

- Provider
- Model
- Temperature or equivalent
- Token/budget limits
- Batch workers
- Concurrency

If a setting is controlled by the selected AI CLI rather than Career-ops, show it as read-only with an explanation.

---

# 43. Environment / Runtime

Show:

- Career-ops version
- Node version
- Data root
- Tracker path
- Reports path
- Output path
- Port
- Host
- Browser availability
- Playwright availability
- MCP availability
- Active CLI
- Plugin status

Separate runtime information from editable settings.

---

# 44. Secrets

Create a dedicated Credentials section.

Show only:

```text
Gmail     Connected
Apify     Not configured
Notion    Connected
```

Never show:

```text
API_KEY=abc123...
```

Use masked values if the existing integration requires displaying a value.

Provide:

```text
[Configure]
[Reconnect]
[Remove]
[Test]
```

Never commit credentials to the repository.

---

# 45. Data & Storage

Show the resolved data root.

Example:

```text
Data root:
C:\Users\inzam\career-ops
```

Show:

- Profile location
- CV location
- Tracker location
- Reports location
- Output location
- Pipeline location

Actions:

```text
[Open Folder]
[Backup]
[Validate Data]
```

Do not expose filesystem operations that can accidentally delete user data.

---

# 46. Appearance

Allow:

- Light / dark / system
- Compact / comfortable density
- Sidebar collapse
- Table page size
- Date format
- Time format

Persist UI preferences separately from Career-ops business configuration.

---

# 47. Notifications

If notification support exists:

- Follow-up reminders
- Interview reminders
- Pipeline completion
- Scan completion
- Errors
- Employer replies

Allow enabling/disabling each category.

---

# 48. Advanced Settings

For advanced users:

- Raw config viewer
- Environment diagnostics
- Provider diagnostics
- MCP diagnostics
- Log viewer
- Cache information
- Reset UI preferences

Raw configuration should have:

```text
[View]
[Edit]
[Validate]
```

and a confirmation before destructive changes.

---

# 49. Settings synchronization

The Settings UI must read the actual current configuration.

Do not create a fake settings store that can diverge from:

- profile.yml
- portals.yml
- environment variables
- tracker paths
- plugin state
- Career-ops data-root resolution

Use a single source of truth.

When saving:

1. Validate.
2. Show what changed.
3. Write using the existing configuration format.
4. Preserve comments where practical.
5. Create a backup using existing project conventions if supported.
6. Re-read configuration.
7. Confirm successful application.

---

# 50. Configuration precedence

Respect the existing Career-ops precedence rules.

For data root, the current repository supports:

1. `CAREER_OPS_ROOT`
2. `CAREER_OPS_DATA_DIR`
3. `.career-ops-data`
4. Repository root

The UI must show the resolved value and its source.

Do not silently override environment variables.

---

# 51. API design

Create a small internal API layer.

Example endpoint groups:

```text
/api/health
/api/config
/api/profile
/api/jobs
/api/jobs/:id
/api/jobs/:id/evaluate
/api/jobs/:id/cv
/api/jobs/:id/cover
/api/pipeline
/api/applications
/api/applications/:id
/api/documents
/api/contacts
/api/companies
/api/interviews
/api/interviews/:id
/api/offers
/api/followups
/api/replies
/api/analytics
/api/plugins
/api/settings
/api/diagnostics
```

These are conceptual endpoints. Follow existing project conventions and avoid unnecessary API duplication.

Long-running operations should use job/task IDs and progress reporting instead of blocking HTTP requests.

---

# 52. Long-running jobs

Operations such as:

- Scan
- Batch evaluation
- Pipeline
- Company research
- CV generation
- PDF generation
- Interview preparation

may take time.

UI behavior:

```text
Starting...
  ↓
Running 35%
  ↓
Running 72%
  ↓
Completed
```

Provide:

- Progress
- Current operation
- Logs
- Error state
- Retry where safe

Do not freeze the browser.

---

# 53. Error handling

Errors should be understandable to non-technical users.

Bad:

```text
ENOENT spawn claude EPIPE
```

Better:

```text
The AI CLI could not be started.

Check that your configured AI CLI is installed and logged in.

[Run Diagnostics]
[View Technical Details]
```

Always allow technical details to be expanded.

---

# 54. Permissions and safety

Local UI should bind to:

```text
127.0.0.1
```

by default.

Do not expose the UI publicly by default.

If the user chooses `0.0.0.0`, display a clear warning.

Sensitive operations require confirmation:

- Sending email
- External message
- Changing credentials
- Deleting data
- Bulk status changes
- Regenerating/overwriting documents
- Running potentially expensive batch operations

---

# 55. Accessibility

Implement:

- Keyboard navigation
- Visible focus states
- Proper labels
- Accessible dialogs
- ARIA where needed
- Sufficient contrast
- Responsive layout
- Screen-reader-friendly tables

---

# 56. Search and command palette

Add global:

```text
Ctrl + K
```

Search/actions:

```text
Find job
Evaluate job
Run scan
Run pipeline
Generate CV
Generate cover letter
Draft email
Open tracker
Prepare interview
Research company
Open settings
Run diagnostics
```

This is especially useful for power users.

---

# 57. Responsive behavior

Desktop-first because Career-ops is primarily a workstation application.

Still support:

- Laptop
- Tablet
- Smaller browser widths

Avoid requiring mobile support for every advanced operation.

---

# 58. UI state

The UI should preserve:

- Selected filters
- Table columns
- Sort order
- Theme
- Sidebar state
- Last selected job
- Draft text

Do not store business data in browser local storage if the source of truth is the Career-ops filesystem.

---

# 59. Testing

Add tests for:

### Backend/API

- Configuration read
- Configuration write
- Data-root resolution
- Job retrieval
- Application retrieval
- Pipeline invocation
- Plugin status
- Diagnostics

### Frontend

- Dashboard loads
- Jobs table loads
- Job detail loads
- Filters work
- Application tracker works
- Settings read/write
- Plugin enable/disable
- Long-running job progress
- Error states

### End-to-end

At minimum:

1. Start UI.
2. Open dashboard.
3. Load existing profile.
4. Load existing jobs.
5. Open a job.
6. View evaluation.
7. Open application tracker.
8. Open settings.
9. Change a safe UI setting.
10. Reload and verify persistence.
11. Run a non-destructive operation.
12. Verify CLI behavior remains intact.

---

# 60. Existing CLI compatibility

After implementation, all existing Career-ops CLI/agent modes must continue working.

Do not remove or rename existing commands.

The UI is additive.

Example:

```text
CLI                         WEB UI
------------------------------------------------
scan                 →      Discovery → Scan
oferta               →      Job → Evaluate
ofertas              →      Jobs → Compare
contacto             →      Contacts
deep                 →      Company Research
pdf                  →      Documents → CV
email                →      Documents → Email
cover                →      Documents → Cover Letter
tracker              →      Applications
pipeline             →      Pipeline
interview-prep      →      Interviews
interview/plan       →      Interviews → Plan
interview/practice   →      Interviews → Practice
interview/debrief    →      Interviews → Debrief
interview-redflag    →      Interviews → Red Flags
offer-prep           →      Offers
followup             →      Follow-ups
reply-watch          →      Replies
analyze/patterns     →      Analytics
upskill              →      Upskilling
agent-inbox          →      Agent Inbox
plugins              →      Plugins
```

This mapping must be verified against the actual repository before implementation.

---

# 61. UI command discovery

The existing command/mode router currently includes functionality such as:

- discovery
- auto-pipeline
- oferta
- ofertas
- contacto
- deep
- interview-prep
- interview
- interview/plan
- interview/practice
- interview/debrief
- regional modes
- pdf
- text
- latex
- email
- add
- expand
- training
- project
- tracker
- agent-inbox
- pipeline
- apply
- scan
- discover
- batch
- patterns
- offer-prep
- titles
- upskill
- followup
- reply-watch
- outcome
- interview-redflag
- update
- cover

The UI implementation MUST inspect the current router before finalizing its feature list.

---

# 62. Feature parity checklist

The implementation is incomplete until all currently supported user-facing capabilities are represented in the UI or explicitly marked as CLI-only with a reason.

Checklist:

- [ ] Dashboard
- [ ] Discovery
- [ ] Scan
- [ ] Job evaluation
- [ ] Job comparison
- [ ] Auto pipeline
- [ ] Batch processing
- [ ] CV generation
- [ ] PDF generation
- [ ] Cover letters
- [ ] Application emails
- [ ] Contacts
- [ ] Company research
- [ ] Application tracker
- [ ] Interview preparation
- [ ] Interview plans
- [ ] Interview practice
- [ ] Interview debrief
- [ ] Interview red flags
- [ ] Offer preparation
- [ ] Salary gap
- [ ] Negotiation scripts
- [ ] Follow-ups
- [ ] Employer replies
- [ ] Outcomes
- [ ] Pattern analysis
- [ ] Upskilling
- [ ] Projects
- [ ] Training
- [ ] Agent inbox
- [ ] Plugin management
- [ ] Portal management
- [ ] Diagnostics
- [ ] Complete Settings
- [ ] Existing CLI compatibility

---

# 63. Settings parity checklist

Before declaring the UI complete, inspect every configuration file and environment variable used by Career-ops.

Create a table internally:

```text
Configuration source
        ↓
Setting name
        ↓
Current value
        ↓
Editable?
        ↓
UI section
        ↓
Validation
        ↓
Persistence method
```

No user-facing configuration should be silently omitted.

If a setting cannot safely be changed through UI, display it as read-only and explain why.

---

# 64. Empty states

Every page needs a useful empty state.

Example:

```text
No applications yet.

Once you apply to a job, your application will appear here.

[Find Jobs]
```

Do not show blank tables.

---

# 65. Loading states

Use skeletons or meaningful progress indicators.

Avoid generic full-page spinners for long operations.

---

# 66. Confirmation patterns

Before destructive/irreversible operations:

```text
Are you sure?

This will overwrite the existing tailored CV.

[Cancel] [Continue]
```

For bulk operations, show the number of affected records.

---

# 67. Audit/activity log

Provide an activity view showing actions performed through the UI:

```text
19:32  Scan started
19:34  42 jobs discovered
19:35  10 jobs evaluated
19:38  CV generated for Example Corp
```

This should help users understand what the system did.

---

# 68. Diagnostics page

Create a friendly diagnostics page based on the existing doctor functionality.

Show:

```text
System
✓ Node.js
✓ Dependencies

Career Profile
✓ CV
✓ Profile
✓ Personalization

Browser
✓ Chromium
⚠ MCP

Data
✓ Tracker
✓ Reports
✓ Output

Plugins
✓/⚠/✕
```

For each failure:

- Explain the issue.
- Explain how to fix it.
- Provide a copyable command where appropriate.

Do not require users to understand terminal output.

---

# 69. Browser startup

When `npm run ui` starts:

1. Start server.
2. Verify health endpoint.
3. Open browser unless `--no-open`.
4. Display URL in terminal.
5. Keep server alive.

If the port is occupied, either:

- select an available port and report it, or
- fail with a clear message.

Prefer predictable behavior.

---

# 70. Security

Because this is a local career-data application:

- Bind localhost by default.
- Do not expose credentials.
- Do not expose arbitrary filesystem read/write APIs.
- Validate paths.
- Prevent path traversal.
- Validate uploaded files.
- Avoid shell execution from raw browser input.
- Do not pass arbitrary commands from UI directly to a shell.
- Use allowlisted operations.
- Escape rendered Markdown/HTML.
- Sanitize external job content before rendering.
- Treat job descriptions as untrusted content.
- Do not allow job descriptions to instruct the application to execute commands.

---

# 71. UI design direction

Use a professional productivity-app aesthetic.

Recommended:

- Clean typography
- Neutral background
- Compact data tables
- Clear status badges
- Cards only where useful
- Strong hierarchy
- Consistent spacing
- Dark/light mode
- Minimal visual noise

Avoid:

- Overly colorful dashboards
- Huge decorative hero sections
- Excessive animations
- Fake AI visualizations
- Hidden settings

This is a serious career-management application.

---

# 72. Implementation phases

## Phase 1 — Foundation

- Inspect current web directory.
- Choose/extend frontend stack.
- Create local server.
- Create API boundary.
- Add `npm run ui`.
- Add health endpoint.
- Add diagnostics.
- Add base layout/navigation.

## Phase 2 — Core job workflow

- Dashboard
- Jobs
- Job detail
- Evaluation
- Discovery
- Pipeline

## Phase 3 — Application workflow

- Applications
- Documents
- CV
- Cover letter
- Email
- Contacts

## Phase 4 — Interview workflow

- Interviews
- Plan
- Practice
- Debrief
- Red flags

## Phase 5 — Advanced workflow

- Offers
- Negotiation
- Salary gap
- Follow-ups
- Replies
- Analytics
- Upskilling
- Projects
- Training
- Agent inbox

## Phase 6 — Integrations

- Plugins
- Gmail
- Notion
- Apify
- Other currently supported integrations

## Phase 7 — Settings

Implement the complete configuration surface.

## Phase 8 — Hardening

- Security
- Accessibility
- Error handling
- Performance
- Tests
- CLI compatibility
- Documentation

---

# 73. Definition of Done

The feature is complete only when:

- `npm run ui` starts successfully.
- Browser opens to the local UI.
- Existing Career-ops data is visible.
- Dashboard works.
- Jobs can be discovered.
- Jobs can be evaluated.
- Pipeline can be run.
- Applications can be viewed/updated.
- CV/PDF workflows are accessible.
- Cover letters are accessible.
- Email drafts are accessible.
- Contacts are accessible.
- Company research is accessible.
- Interview workflows are accessible.
- Offer workflows are accessible.
- Follow-ups are accessible.
- Replies are accessible.
- Analytics are accessible.
- Plugins are visible/configurable.
- Diagnostics are accessible.
- All supported configuration is represented in Settings.
- Secrets are protected.
- Existing CLI commands continue to work.
- No existing Career-ops data contract is broken.
- Tests pass.
- `npm run doctor` still passes.
- The UI does not silently submit applications or send communications.

---

# 74. Final instruction to Antigravity

Implement this incrementally.

Before changing architecture, inspect the existing repository and reuse existing code.

Do not create mock data for features that already have real data.

Do not hard-code the user's profile.

Do not replace existing Career-ops logic with simplified UI-only logic.

Do not remove CLI functionality.

Do not introduce a database merely for convenience.

Do not expose secrets.

Do not make external actions automatic.

When a feature is unavailable because an optional plugin/integration is disabled, show the feature in the UI with an informative disabled state and instructions for enabling it.

The finished result should make Career-ops usable by a non-technical user entirely through:

```bash
npm run ui
```

while preserving the full power of the existing Antigravity/CLI workflow.
