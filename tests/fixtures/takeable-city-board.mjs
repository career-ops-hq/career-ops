// Local-parser board for tests/scan-dedup-takeable-location.test.mjs.
// One role, three places, fictional cities. Pebbleford comes first on purpose.
console.log(JSON.stringify([
  { title: 'Automation Analyst', url: 'https://boards.example.com/fixture/pebbleford', company: 'Lumenfield', location: 'Pebbleford, TX' },
  { title: 'Automation Analyst', url: 'https://boards.example.com/fixture/remote', company: 'Lumenfield', location: 'Remote — United States' },
  { title: 'Automation Analyst', url: 'https://boards.example.com/fixture/harbor', company: 'Lumenfield', location: 'Harbor Bay, United States' },
  { title: 'Automation Analyst', url: 'https://boards.example.com/fixture/harbor-again', company: 'Lumenfield', location: 'Harbor Bay, United States' },
]));
