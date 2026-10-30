**12. Jurisdiction-Prohibited Content** (from JD text; jurisdiction from `config/profile.yml` → `location` (country + city/province/state), same region-aware pattern as signal 6):

Some posting content is not just a yellow flag — it is content the candidate's own jurisdiction has explicitly prohibited employers from requiring or asking for (e.g. a "Canadian experience" requirement in Ontario postings, salary-history questions in California). Candidates either don't know their rights, or notice and have nowhere to record it. Check for it like this:

1. Read `templates/jurisdiction-prohibited-content.yml` — a jurisdiction-keyed table of prohibited content with legal basis, effective date, and sources. It is a data reference, not instruction logic: extending it to another jurisdiction never requires touching this rule text, and every entry must carry a citable legal source plus effective date (see the contribution rule in the file header).
2. Derive the candidate's jurisdiction key from `config/profile.yml` → `location` (e.g. Ontario, Canada → `CA-ON`; California, USA → `US-CA`). No table entry for the candidate's jurisdiction → this signal is not evaluated; say nothing.
3. For each entry matching the candidate's jurisdiction, judge whether the JD text actually contains the prohibited content per that entry's `matching` guidance. This is agent-judged, never naive keyword matching — e.g. "we will never ask for your salary history" in a fraud-warning footer must NOT fire, and a salary-*expectations* question is not a salary-*history* question.

**Phrasing discipline (mandatory):** state the verifiable fact about the posting text only — what the posting contains, what the jurisdiction's law prohibits, since when. Never assert that the employer is breaking the law or committing a violation: employer size, posting type, and statutory exemptions are not verifiable from the JD, so no such conclusion can be drawn from it.

If matched, append a short, warn-only note to the report:

> ⚠️ **Jurisdiction-prohibited content signal:** [Render in {language.output}: a factual statement that this posting contains "{the matched content, quoted from the JD}", which {jurisdiction_name}'s {legal_basis} has prohibited in {the scope stated by the entry, e.g. publicly advertised postings} since {effective date} — cite the entry's `legal_basis` and `effective` fields verbatim as data tokens. Describe the posting text only; draw no conclusion about the employer. Close with a note that this is informational only and not legal advice.]

This signal does not change the High Confidence / Proceed with Caution / Suspicious tier below — it is orthogonal to ghost-job detection and is reported separately. It never blocks or discourages an application on its own; the candidate decides what to do with the information.
