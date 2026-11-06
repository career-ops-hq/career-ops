console.log(JSON.stringify([
  ['barcelona', 'Barcelona, Spain'],
  ['madrid', 'Madrid, Spain (Hybrid)'],
  ['perth', 'Remote — Perth, Australia'],
  ['spain', 'Remote — Spain'],
  ['unknown', 'Remote'],
  ['uk-restricted', 'Remote — Europe', 'Applicants must be based in the UK.'],
].map(([id, location, description]) => ({
  title: 'Sales Engineer ' + id, company: 'Policy Fixture',
  url: 'https://boards.example.com/workplace/' + id, location, description,
}))));
