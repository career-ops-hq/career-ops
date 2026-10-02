# Retained interview sessions

Keep manually retained session notes in private `inputs/stories/sessions/`.
Interview context reads relevant Markdown files as historical evidence; it does
not treat a transcript as a verified candidate claim. To associate a note with
a role, include YAML frontmatter with `company`, `role`, and an optional `date`.

`career_ops interview context` combines an opportunity, published evidence,
candidate sources, and relevant retained notes. `interview start` and its
show/resume/confirm/history commands manage persisted preparation and review;
read-only tools include match-star, story-provenance, preparation-plan, and
jd-skill-gap. These commands do not promise automatic transcript capture or
write session files. Run them through `.venv/bin/python -B -m career_ops`.
