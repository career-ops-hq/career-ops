// Publishes no `noc` at all: a filter_on: noc target passes everything, and the
// run must warn that the whitelist is effectively off.
console.log(JSON.stringify([
  { title: 'Analyst, Client Services', url: 'https://example.invalid/nb/1', company: 'Silent Board', location: 'Ottawa, ON' },
  { title: 'Team Member', url: 'https://example.invalid/nb/2', company: 'Silent Board', location: 'Ottawa, ON' },
]));
