# Mode: email — Application Email Drafts

Generate a formal application email body that the candidate can paste into an
email client. This mode is for direct application emails, recruiter follow-up
emails with a CV attached, referral request emails, and cold application emails.

It is NOT:
- `contacto`: short LinkedIn / BOSS Zhipin / chat-style outreach.
- `cover`: a full cover letter PDF.
- `apply`: live application form filling.

**Never submit. Never send email. Never click send.** Draft only. The candidate
must review and send manually.

---

## Invocation

Supported inputs:

1. `/career-ops email {report-number-or-slug}`
   - Load the matching `reports/{NNN}-*.md`.
   - Use the report header, score, archetype, PDF status, and evaluation content.
   - If `data/pdf-index.tsv` contains a PDF for that report, mention it as the CV
     attachment candidate. If no PDF is indexed, say that the CV should be
     generated first via `/career-ops pdf {slug}` or attached manually.

2. `/career-ops email {pasted JD}`
   - Use the pasted JD directly.
   - Do not create a report, tracker row, PDF, or cover letter.
   - Ask for company name if the JD lacks it and the email would otherwise read
     generic.

3. `/career-ops email`
   - If there is a most recent evaluated tracker row, offer to draft from that
     row.
   - If no usable context exists, ask for a report number, slug, or JD.

---

## Step 1 — Load Context

Read:
- `config/profile.yml`
- `cv.md`
- `article-digest.md` if it exists
- `modes/_profile.md` if it exists
- `modes/_custom.md` if it exists
- `voice-dna.md` if it exists, for writing style only
- The selected report if invoked by report number or slug
- `data/pdf-index.tsv` if present, to find generated PDF attachments

Use `modes/_custom.md` only for procedural output preferences such as whether to
include a contact block, whether to show an attachment checklist, or how concise
the email should be. It must never introduce contact details, work experience,
or other factual claims.

Use `voice-dna.md` only as a writing guardrail. It must never introduce factual
claims.

### Profile fields

Use these optional fields when present:
- `candidate.full_name`
- `candidate.chinese_name`
- `candidate.email`
- `candidate.phone`
- `candidate.wechat`
- `candidate.location`
- `candidate.linkedin`
- `candidate.github`
- `candidate.portfolio_url`
- `application_email.default_sender_note`
- `application_email.include_contact_block`
- `application_email.include_attachment_checklist`
- `application_email.signature_name`
- `contact_preferences.preferred_channel`
- `contact_preferences.note`

If `candidate.wechat` is absent, omit WeChat. Do not invent one.

---

## Step 2 — Classify Email Type

Choose one of three variants from user wording or context:

| Variant | When | Tone |
|---|---|---|
| `hr_application` | Default. Sending CV to HR/recruiter for a posted role. | Formal, concise, screening-friendly |
| `referral_request` | User asks for referral, internal contact, friend, alumni, or former colleague. | Warm, low-pressure, easy to forward |
| `cold_application` | No posted role, speculative reach-out, "cold email". | Direct, value-first, no desperation |

If unclear, default to `hr_application`.

---

## Step 3 — Extract Fit Points

From the report/JD and source-of-truth files, select 2-3 fit points:

- One role-to-profile match: stack, domain, workflow, product type, or delivery
  style.
- One proof point: project, metric, open-source contribution, or shipped system.
- One differentiator: business ownership, domain knowledge, communication,
  open-source ecosystem, or production handover.

Use only facts from source-of-truth files. Reformulate keywords from the JD;
never fabricate.

If a report has a score:
- `>= 4.5`: confident, priority application.
- `4.0-4.4`: good match, worth applying.
- `< 4.0`: restrained; do not oversell. If below 4.0, warn the user before
  drafting that career-ops normally recommends against applying.

---

## Step 4 — Attachment Checklist

Before the draft, output:

```text
Attachments to include:
- CV: {pdf path or "attach your tailored CV"}
- Cover letter: {path if known, otherwise "optional / not generated"}
```

Rules:
- If `application_email.include_attachment_checklist` is `false`, omit this
  checklist.
- Mention only files that exist or are indexed. Do not claim a cover letter
  exists unless it does.
- Do not attach files or send anything.

---

## Step 5 — Draft Structure

Always output:

```text
Subject: {subject}

{email body}
```

### HR application structure

1. Greeting
2. Role intent and attachment sentence
3. 2-3 fit points in one short paragraph or compact bullets
4. Why this role is relevant, using JD language
5. Contact block and signature

### Referral request structure

1. Greeting
2. One-line context: role and company
3. 2 concise proof points that are easy to forward
4. Low-pressure ask: "If this looks aligned, would you be comfortable referring
   me or pointing me to the right person?"
5. Contact block and signature

### Cold application structure

1. Greeting
2. Value proposition first, not "I am looking for a job"
3. 2 proof points tied to the company/domain
4. Specific ask: short call, right contact, or permission to send CV
5. Contact block and signature

---

## Language

- Match the JD/report language.
- If the JD is Chinese, use Simplified Chinese.
- If the company/recruiter language is unknown, default to the user's language.
- Keep the subject line in the same language as the body unless the user asks
  otherwise.

---

## Contact Block

Default behavior:
- Include contact block for direct application emails.
- Omit phone in short social outreach; this mode is not short social outreach.

Use:

```text
联系方式：
{if candidate.wechat}微信：{candidate.wechat}{/if}
{if candidate.phone}手机号：{candidate.phone}{/if}
{if candidate.email or application_email.default_sender_note}邮箱：{candidate.email or application_email.default_sender_note}{/if}
```

For English:

```text
Contact:
{if candidate.wechat}WeChat: {candidate.wechat}{/if}
{if candidate.phone}Phone: {candidate.phone}{/if}
{if candidate.email or application_email.default_sender_note}Email: {candidate.email or application_email.default_sender_note}{/if}
```

If `application_email.default_sender_note` is set in `config/profile.yml` to a
phrase such as "the email used to send this message", use that phrase instead of
a concrete email address.

If `application_email.include_contact_block` is `false`, use a normal signature
only.

**Contact channel preference:** If `application_email.include_contact_block` is
`true` (or absent/default), check `contact_preferences.preferred_channel` in
`config/profile.yml`. If it is absent or set to `"either"`, the contact block
stays exactly as above — no change. If it is set to `"email"` or `"phone"`, add
one short line directly under the contact block naming that preference, e.g.:

```text
Contact:
Email: jane@example.com
Phone: +1-555-0123
(Prefers email first.)
```

If `contact_preferences.note` is set, use its wording (or a close paraphrase)
for that line instead of a generic phrase. Keep it to one line, no bold, no
extra emphasis -- it should read as a practical note, not a demand.

---

## Style Rules

- No corporate-speak.
- No "passionate about", "perfect fit", "unique opportunity", or vague praise.
- No exaggerated authorship claims.
- Short paragraphs. Prefer 150-250 words for HR applications.
- Keep the proof easy to scan.
- Do not include salary unless the user asks.
- Do not include private references, ID numbers, or unsupported claims.

---

## Output

Return in this order:

1. Context line:
   - `Source: report {NNN}` or `Source: pasted JD`
   - Variant
   - Language
2. Attachment checklist, unless disabled
3. Subject and email body
4. One-line note with any missing inputs or assumptions

Do not write files unless the user explicitly asks to save the draft.
