// tests/fixtures/same-title-board.mjs — a local-parser fixture board.
//
// Emits TWO different postings with the SAME title under the board's own name —
// the shape of a multi-employer feed (a Telegram channel, a VC portfolio board),
// where identical titles are different employers' jobs. Used by
// tests/scan-aggregator-dedup.test.mjs; no network involved.
console.log(JSON.stringify([
  { title: 'Backend Engineer', url: 'https://t.me/fixturejobs/101', company: 'Fixture Feed', location: '' },
  { title: 'Backend Engineer', url: 'https://t.me/fixturejobs/102', company: 'Fixture Feed', location: '' },
]));
