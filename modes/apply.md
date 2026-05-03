# Mode: apply — Live Application Assistant

Interactive mode for when the candidate is filling out an application form in Chrome. It reads what is on the screen, loads the previous context of the job, and generates personalized responses for each form question.

## Requirements

- **Best with Playwright in visible mode**: In visible mode, the candidate sees the browser and Claude can interact with the page.
- **Without Playwright**: the candidate shares a screenshot or pastes the questions manually.

## Workflow

```text
1. DETECT      → Read active Chrome tab (screenshot/URL/title)
2. IDENTIFY    → Extract company + role from the page
3. SEARCH      → Match against existing reports in reports/
4. LOAD        → Read full report + Section G (if it exists)
5. COMPARE     → Does the role on screen match the one evaluated? If it changed → notify
6. ANALYZE     → Identify ALL visible form questions
7. GENERATE    → For each question, generate a personalized response
8. PRESENT     → Show formatted responses for copy-paste
```

## Step 1 — Detect the job

**With Playwright:** Take a snapshot of the active page. Read title, URL, and visible content.

**Without Playwright:** Ask the candidate to:
- Share a screenshot of the form (Read tool can read images)
- Or paste the form questions as text
- Or say company + role so we can search for it

## Step 2 — Identify and search for context

1. Extract company name and role title from the page
2. Search in `reports/` by company name (case-insensitive grep)
3. If there is a match → load the full report
4. If there is a Section G → load previous draft answers as a base
5. If there is NO match → notify and offer to run a quick auto-pipeline

## Step 3 — Detect changes in the role

If the role on screen differs from the one evaluated:
- **Notify the candidate**: "The role has changed from [X] to [Y]. Do you want me to re-evaluate or adapt the responses to the new title?"
- **If adapt**: Adjust responses to the new role without re-evaluating
- **If re-evaluate**: Execute full A-F evaluation, update report, regenerate Section G
- **Update tracker**: Change role title in applications.md if applicable

## Step 4 — Analyze form questions

Identify ALL visible questions:
- Free text fields (cover letter, why this role, etc.)
- Dropdowns (how did you hear, work authorization, etc.)
- Yes/No (relocation, visa, etc.)
- Salary fields (range, expectation)
- Upload fields (resume, cover letter PDF)

Classify each question:
- **Already answered in Section G** → adapt the existing response
- **New question** → generate response from the report + cv.md

## Step 5 — Generate responses

For each question, generate the response following:

1. **Report context**: Use proof points from block B, STAR stories from block F
2. **Previous Section G**: If a draft response exists, use it as a base and refine
3. **"I'm choosing you" tone**: Same auto-pipeline framework
4. **Specificity**: Reference something specific from the JD visible on screen
5. **career-ops proof point**: Include in "Additional info" if there is a field for it

**Output format:**

```text
## Responses for [Company] — [Role]

Based on: Report #NNN | Score: X.X/5 | Archetype: [type]

---

### 1. [Exact form question]
> [Response ready for copy-paste]

### 2. [Next question]
> [Response]

...

---

Notes:
- [Any observations about the role, changes, etc.]
- [Personalization suggestions the candidate should review]
```

## Step 6 — Post-apply (optional)

If the candidate confirms that they submitted the application:
1. Update status in `applications.md` from "Evaluated" to "Applied"
2. Update Section G of the report with the final responses
3. Suggest next step: `/career-ops contacto` for LinkedIn outreach

## Scroll handling

If the form has more questions than the visible ones:
- Ask the candidate to scroll and share another screenshot
- Or paste the remaining questions
- Process in iterations until the entire form is covered
