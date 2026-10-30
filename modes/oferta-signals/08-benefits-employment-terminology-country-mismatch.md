**8. Benefits/Employment Terminology Country Mismatch** (from JD text; cross-check stated location against jurisdiction-specific benefits/employment terms):

Some JDs are copy-pasted from a template built for a different country's postings, leaving behind benefits or employment-law terminology that belongs to the wrong jurisdiction — e.g. a Canada-located posting that lists "401(k)" or "W-2 employment," which are US-only terms. The posting can be entirely live and real and still describe the wrong country's benefits; this is a template-error detector, not a ghost-job signal. Check the JD's benefits/employment section against the jurisdiction-specific term list below (add a new row to extend to another country — this table is a data reference, not instruction logic, so extending it never requires touching the rule text):

| Jurisdiction | Strong markers (unconditional) | Corroborating-only markers |
|---|---|---|
| US only | "401(k)", "W-2 employment" | "PTO" — used in Canada and other jurisdictions too, so it never triggers this signal on its own; count it only when it appears alongside "401(k)" or "W-2 employment" in the same posting |
| Canada only | "RRSP", "T4" | "Employment Standards Act" spelled out — the bare acronym "ESA" is ambiguous (collides with other jurisdictions' usage) and must never be matched on its own |

Only flag when the JD's stated location is in jurisdiction A, but the benefits/employment section uses a strong marker exclusive to jurisdiction B, or a corroborating-only marker that co-occurs with a strong marker from jurisdiction B. A corroborating-only marker appearing by itself (e.g. "PTO" with no "401(k)"/"W-2," or a bare "ESA" with no expanded "Employment Standards Act") must never trigger this signal on its own. Generic terms ("health benefits," "retirement plan") should never trigger this on their own.

If this mismatch is present, append a short, non-alarmist note to the report:

> ⚠️ **Benefits terminology mismatch signal:** This posting is listed in {location}, but its benefits section uses {jurisdiction B}-specific terms ("{specific phrase found}"). This is often a copy-paste artifact from a template used for a different country's postings, and doesn't necessarily mean the posting is fake — but worth confirming with the employer/recruiter which country's employment terms actually apply before assuming the listed benefits package is accurate.

This signal does not change the High Confidence / Proceed with Caution / Suspicious tier below — it is orthogonal to ghost-job detection and is reported separately.
