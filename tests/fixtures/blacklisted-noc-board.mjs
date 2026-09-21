// tests/fixtures/blacklisted-noc-board.mjs — a MIXED board: the postings that
// carry an occupation code are from a company the user blacklisted, the one
// that carries none is not.
//
// The mix is the point. With presence accounting inside the declared-field
// gate, the blacklist skip removes both code-bearing postings before they are
// counted, only the code-less posting is seen, and the run reports "noc absent
// on all 1 job" — a claim about the provider produced entirely by the user's
// own do-not-apply decision. Blacklisting ALL of them does not discriminate:
// the warning is silent either way, since the seen count stays zero.
console.log(JSON.stringify([
  { title: 'Analyst, Client Services', url: 'https://example.invalid/bl/1', company: 'Blocked Co', location: 'Ottawa, ON', noc: '22221' },
  { title: 'Guest Experience Associate', url: 'https://example.invalid/bl/2', company: 'Blocked Co', location: 'Ottawa, ON', noc: '22221' },
  { title: 'Team Member', url: 'https://example.invalid/bl/3', company: 'Open Co', location: 'Ottawa, ON' },
]));
