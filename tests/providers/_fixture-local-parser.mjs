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

// Default payload
console.log(JSON.stringify([
  { title: 'Standard Job', url: 'https://example.com/job1', location: ['Remote', 'NY'] },
  { title: 'No URL' }, // Should be dropped
  { url: 'https://example.com/notitle' } // Should be dropped
]));
