# Prompt context manifest

| Commands | Domain prompt | Candidate inputs | Opportunity inputs | Market inputs |
|---|---|---|---|---|
| scan, discover, pipeline, auto-pipeline, oferta, shortlist, batch, ofertas, deep, triage, eu-swe, eu-fintech | evaluation | cv.md, article-digest.md (optional), config/profile.yml, modes/_profile.md, modes/_custom.md | URL, JD snapshot, data/pipeline.md, reports/{report}.md | markets/{cn,hk,remote}/employment.md |
| apply, pdf, latex, latex-tex, cover, email, contacto | applications | cv.md, article-digest.md (optional), config/profile.yml, modes/_profile.md, modes/_custom.md, writing-samples/ (optional), voice-dna.md (optional) | selected shortlist record, reports/{report}.md, form fields | markets/{cn,hk,remote}/employment.md |
| interview-prep, interview, interview/plan, interview/practice, interview/debrief, interview-redflag | interviews | cv.md, article-digest.md (optional), config/profile.yml, modes/_profile.md, modes/_custom.md, interview-prep/story-bank.md (optional) | selected opportunity, interview-prep/{company}-{role}.md (optional) | markets/{cn,hk,remote}/employment.md |
| add, expand, intake | cv | cv.md, article-digest.md (optional), config/profile.yml, modes/_profile.md, modes/_custom.md | documents/ (intake only), user request | none |
| tracker, followup, reply-watch, outcome, offer-prep, patterns, titles, upskill, training, project, agent-inbox, update | insights | cv.md, article-digest.md (optional), config/profile.yml, modes/_profile.md, modes/_custom.md | data/applications.md, data/pipeline.md, reports/, data/status-log.tsv | markets/{cn,hk,remote}/employment.md |

Every command also receives `prompts/shared/contract.md` and the resolved
output-language instruction.
