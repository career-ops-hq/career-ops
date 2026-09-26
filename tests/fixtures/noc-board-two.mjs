// tests/fixtures/noc-board-two.mjs — a second local-parser fixture board that
// DOES publish an occupation code, under a company name of its own.
//
// Paired with noc-less-board.mjs under the SAME target name, to prove the
// absence counters are keyed per target rather than per name: a duplicate
// enabled name is only a validate-portals warning, so two real targets can
// share one, and a field supplied by this board must not suppress the
// all-absent warning for the other.
console.log(JSON.stringify([
  { title: 'Analyst, Client Services', url: 'https://example.invalid/two/1', company: 'Second Board', location: 'Ottawa, ON', noc: '22221' },
]));
