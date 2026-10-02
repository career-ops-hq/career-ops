# Prompt context manifest

| Commands | Domain prompt | Candidate inputs | Opportunity inputs | Market inputs |
|---|---|---|---|---|
| discovery and evaluation | evaluation | cv.md, article-digest.md (optional), config/profile.yml, modes/_profile.md, modes/_custom.md | URL, JD snapshot, data/pipeline.md, reports/{report}.md | markets/{cn,hk,remote}/employment.md |
| application preparation | applications | cv.md, article-digest.md (optional), config/profile.yml, modes/_profile.md, modes/_custom.md, writing-samples/ (optional), voice-dna.md (optional) | selected shortlist record, reports/{report}.md, form fields | markets/{cn,hk,remote}/employment.md |
| interview preparation | interviews | cv.md, article-digest.md (optional), config/profile.yml, modes/_profile.md, modes/_custom.md, interview-prep/story-bank.md (optional) | selected opportunity, interview-prep/{company}-{role}.md (optional) | markets/{cn,hk,remote}/employment.md |
| CV maintenance | cv | cv.md, article-digest.md (optional), config/profile.yml, modes/_profile.md, modes/_custom.md | user request | none |
| retained evidence and lifecycle queries | insights | cv.md, article-digest.md (optional), config/profile.yml, modes/_profile.md, modes/_custom.md | data/opportunities.db, portals.yml, retained reports/ | markets/{cn,hk,remote}/employment.md |

Every command also receives `prompts/shared/contract.md` and the resolved
output-language instruction.
