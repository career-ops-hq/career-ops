// Local-parser fixture board for workplace_filter: one remote and one on-site
// posting, with `workplaceType` set the way a provider sets it, so the scan's
// workplace filter sees exactly what it reads in a real run.
console.log(JSON.stringify([
  { title: 'Remote Platform Engineer', url: 'https://example.invalid/jobs/remote-platform', company: 'Fixture Labs', location: 'Remote', workplaceType: 'remote' },
  { title: 'Onsite Platform Engineer', url: 'https://example.invalid/jobs/onsite-platform', company: 'Fixture Labs', location: 'Berlin, Germany', workplaceType: 'onsite' },
]));
