// tests/fixtures/blacklisted-noc-board.mjs — a MIXED board: the postings that
// carry an occupation code are from a company the user blacklisted, the one
// that carries none is not.
//
// The mix is the point. If presence were counted after the blacklist skip,
// only the code-less posting would be seen and the run would report "noc
// absent on all 1 job" — a claim about the provider produced entirely by the
// user's own do-not-apply decision. Blacklisting ALL of them would not
// discriminate: the seen count stays zero and the warning is silent either way.
console.log(JSON.stringify([
  { title: 'Analyst, Client Services', url: 'https://example.invalid/bl/1', company: 'Blocked Co', location: 'Ottawa, ON', noc: '22221' },
  { title: 'Guest Experience Associate', url: 'https://example.invalid/bl/2', company: 'Blocked Co', location: 'Ottawa, ON', noc: '22221' },
  { title: 'Team Member', url: 'https://example.invalid/bl/3', company: 'Open Co', location: 'Ottawa, ON' },
]));
