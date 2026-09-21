// tests/fixtures/noc-less-board.mjs — a local-parser fixture board that
// publishes NO occupation code on any posting.
//
// The failure #3438 is really about: a target declares filter_on: noc, the
// provider never supplies the field, every posting passes, and the run looks
// like a working whitelist. Used to assert the end-of-run warning fires.
console.log(JSON.stringify([
  { title: 'Analyst, Client Services', url: 'https://example.invalid/nb/1', company: 'Silent Board', location: 'Ottawa, ON' },
  { title: 'Team Member', url: 'https://example.invalid/nb/2', company: 'Silent Board', location: 'Ottawa, ON' },
]));
