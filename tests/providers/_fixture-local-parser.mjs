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

// If the first argument is "invalid", print invalid JSON
if (inputArgs[0] === 'invalid') {
  console.log("NOT JSON");
  process.exit(0);
}

// If the first argument is "posted-at", exercise optional postedAt coercion
if (inputArgs[0] === 'posted-at') {
  console.log(JSON.stringify([
    { title: 'ISO date', url: 'https://example.com/a', postedAt: '2026-09-08' },
    { title: 'Epoch ms', url: 'https://example.com/b', postedAt: 1757289600000 },
    { title: 'Snake case', url: 'https://example.com/c', posted_at: '2026-01-15T10:00:00Z' },
    { title: 'Camel alias', url: 'https://example.com/f', publishedAt: '2026-03-20' },
    { title: 'Snake alias', url: 'https://example.com/g', published_at: '2026-04-01T00:00:00Z' },
    { title: 'Breezy spelling', url: 'https://example.com/i', published_date: '2026-05-10T00:00:00Z' },
    { title: 'JSON-LD spelling', url: 'https://example.com/j', datePosted: '2026-06-01' },
    { title: 'JSON-LD snake spelling', url: 'https://example.com/k', date_posted: '2026-07-04T00:00:00Z' },
    { title: 'Epoch zero', url: 'https://example.com/h', postedAt: 0 },
    { title: 'Bad date', url: 'https://example.com/d', postedAt: 'not-a-date' },
    { title: 'No date', url: 'https://example.com/e' },
    { title: 'Out-of-range epoch', url: 'https://example.com/l', postedAt: 1e20 },
    { title: 'Wrong-shaped date', url: 'https://example.com/m', postedAt: { toString: null } },
    { title: 'Bad alias falls back to good one', url: 'https://example.com/n', postedAt: 'not-a-date', posted_at: '2026-08-01' },
  ]));
  process.exit(0);
}

// Default payload
console.log(JSON.stringify([
  { title: 'Standard Job', url: 'https://example.com/job1', location: ['Remote', 'NY'] },
  { title: 'No URL' }, // Should be dropped
  { url: 'https://example.com/notitle' } // Should be dropped
]));
