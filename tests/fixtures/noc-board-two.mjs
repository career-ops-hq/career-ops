// Publishes `noc`; paired with noc-less-board.mjs under the SAME target name, so
// its field must not suppress the other target's all-absent warning.
console.log(JSON.stringify([
  { title: 'Analyst, Client Services', url: 'https://example.invalid/two/1', company: 'Second Board', location: 'Ottawa, ON', noc: '22221' },
]));
