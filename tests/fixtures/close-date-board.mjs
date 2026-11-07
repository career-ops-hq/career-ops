const closesAt = process.env.FIXTURE_CLOSES_AT || '2026-10-03';
const job = {
  title: 'Strategic Finance Manager',
  url: 'https://boards.example.com/fixture/close-date',
  company: 'Fixture Defense',
  location: 'Costa Mesa, CA',
};
if (closesAt !== 'none') job.closesAt = closesAt;
console.log(JSON.stringify([job]));
