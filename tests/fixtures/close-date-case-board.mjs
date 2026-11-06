const closesAt = process.env.FIXTURE_CLOSES_AT || '2026-10-03';
const job = {
  title: 'Strategic Finance Manager',
  url: process.env.FIXTURE_JOB_URL || 'https://boards.example.com/fixture/Acme',
  company: 'Fixture Defense',
  location: 'Costa Mesa, CA',
  listingIdentity: {
    ats_provider: 'greenhouse',
    board_slug: 'acme',
    posting_id: '4012345',
  },
};
if (closesAt !== 'none') job.closesAt = closesAt;
console.log(JSON.stringify([job]));
