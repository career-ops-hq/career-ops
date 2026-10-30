// Local-parser fixture board publishing an occupation code (#3438). Titles no
// title whitelist would enumerate; one posting has no `noc` (the absent path).
console.log(JSON.stringify([
  { title: 'Analyst, Client Services', url: 'https://example.invalid/jobs/1', company: 'Fixture Board', location: 'Ottawa, ON', noc: '22221' },
  { title: 'Guest Experience Associate', url: 'https://example.invalid/jobs/2', company: 'Fixture Board', location: 'Ottawa, ON', noc: '65102' },
  { title: 'Team Member', url: 'https://example.invalid/jobs/3', company: 'Fixture Board', location: 'Ottawa, ON' },
]));
