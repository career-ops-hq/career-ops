// Mock script for testing local-parser.mjs

const inputArgs = process.argv.slice(2);

// If the first argument is "echo", return a job containing all args
if (inputArgs[0] === 'echo') {
  console.log(JSON.stringify([{ title: inputArgs.join(' '), url: 'https://example.com/job' }]));
  process.exit(0);
}

// If the first argument is "envelope-jobs", test { jobs: [...] } wrapper
if (inputArgs[0] === 'envelope-jobs') {
  console.log(JSON.stringify({ jobs: [{ title: 'Envelope Job', url: '/job2' }] }));
  process.exit(0);
}

// If the first argument is "dates", exercise every accepted posting-date spelling
// plus the values that must NOT become a postedAt.
if (inputArgs[0] === 'dates') {
  console.log(JSON.stringify([
    { title: 'Epoch ms', url: '/d1', postedAt: 1760000000000 },
    { title: 'ISO date', url: '/d2', posted_at: '2026-02-08' },
    { title: 'ISO datetime', url: '/d3', publishedAt: '2026-02-08T10:30:00Z' },
    { title: 'Breezy spelling', url: '/d4', published_date: '2026-02-08T10:30:00Z' },
    { title: 'JSON-LD spelling', url: '/d5', datePosted: '2026-02-08' },
    { title: 'Unparseable', url: '/d6', postedAt: 'sometime last spring' },
    { title: 'Empty', url: '/d7', postedAt: '' },
    { title: 'Absent', url: '/d8' },
  ]));
  process.exit(0);
}

// If the first argument is "invalid", print invalid JSON
if (inputArgs[0] === 'invalid') {
  console.log("NOT JSON");
  process.exit(0);
}

// Default payload
console.log(JSON.stringify([
  { title: 'Standard Job', url: 'https://example.com/job1', location: ['Remote', 'NY'] },
  { title: 'No URL' }, // Should be dropped
  { url: 'https://example.com/notitle' } // Should be dropped
]));
