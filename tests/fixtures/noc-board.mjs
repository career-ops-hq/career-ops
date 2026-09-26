// tests/fixtures/noc-board.mjs — a local-parser fixture board that publishes an
// occupation code alongside each posting, the shape #3438 is about.
//
// The titles are deliberately ones no sane title whitelist would enumerate:
// that is the point — the occupation is knowable from `noc`, never from the
// title. One posting carries no `noc` at all, to exercise the absent-field
// path (passes, counted, warned about) without a second fixture.
console.log(JSON.stringify([
  { title: 'Analyst, Client Services', url: 'https://example.invalid/jobs/1', company: 'Fixture Board', location: 'Ottawa, ON', noc: '22221' },
  { title: 'Guest Experience Associate', url: 'https://example.invalid/jobs/2', company: 'Fixture Board', location: 'Ottawa, ON', noc: '65102' },
  { title: 'Team Member', url: 'https://example.invalid/jobs/3', company: 'Fixture Board', location: 'Ottawa, ON' },
]));
