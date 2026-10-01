/** Exercise hydrated JD text and publisher metadata through the browser extraction path. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readPage } from '../browser-extract.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://fixture.myworkdayjobs.com/**', route => route.fulfill({
    contentType: 'text/html', body: `<html><body><h1>Accept Cookies</h1><main>Loading</main><script>
      setTimeout(() => { document.title = 'Engineer'; document.querySelector('main').innerHTML = '<h2>Engineer</h2><div data-automation-id="jobPostingDescription"><p>Full responsibilities and qualifications.</p><p>Build reliable products.</p></div>'; }, 2300);
    </script></body></html>`,
  }));
  await page.goto('https://fixture.myworkdayjobs.com/Jobs/job/Engineer_R1');
  const result = await readPage(page, { timeout: 4000 });
  assert(result.text.includes('Full responsibilities and qualifications.'), 'Must wait for the JD, not return the Loading shell');
  assert.equal(result.title, 'Engineer');
  assert(result.text.includes('qualifications.\nBuild reliable products.'), 'Paragraph boundaries must survive DOM cloning');
  await page.setContent('<main>Loading</main>');
  await assert.rejects(readPage(page, { timeout: 100 }), /Timeout/);
  await page.setContent('<main>This job is no longer available.</main>');
  assert((await readPage(page, { timeout: 100 })).text.includes('no longer available'));
  await page.setContent(`<main data-automation-id="jobPostingDescription">Job details</main>
    <script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'JobPosting',
      title: 'Engineer', hiringOrganization: { name: 'Employer' }, description: '&lt;p&gt;Build software.&lt;/p&gt;&lt;p&gt;Maintain services.&lt;/p&gt;' }] })}</script>`);
  const structured = await readPage(page, { timeout: 100 });
  assert.equal(structured.postings[0].hiringOrganization.name, 'Employer');
  assert.equal(structured.postings[0].description.trim(), 'Build software.\nMaintain services.');

  const jobUrl = 'https://www.efinancialcareers.hk/jobs-Senior_Engineer.id123';
  const state = { 'https://job-branding-facade.efinancialcareers.com/job/123': { status: 200, body: { data: {
    title: 'Senior Engineer', description: '<p>Build software.</p><p>Maintain services.</p>',
    brand: { name: 'Publisher employer' }, location: { city: 'Masonboro', state: 'NC', country: 'United States' },
  } } } };
  await page.route('https://www.efinancialcareers.hk/**', route => route.fulfill({ contentType: 'text/html',
    body: `<h1>Senior Engineer</h1><script id="ng-state" type="application/json">${JSON.stringify(state)}</script>`,
  }));
  await page.goto(jobUrl);
  const publisher = await readPage(page, { timeout: 100 });
  assert.equal(publisher.postings[0].url, jobUrl);
  assert.equal(publisher.postings[0].hiringOrganization.name, 'Publisher employer');
  assert.equal(publisher.postings[0].jobLocation.address.addressCountry, 'United States');
  assert.equal(publisher.postings[0].description.trim(), 'Build software.\nMaintain services.');
  await page.goto(jobUrl.replace('id123', 'id456'));
  assert.deepEqual((await readPage(page, { timeout: 100 })).postings, [], 'Metadata must belong to the current posting');
} finally { await browser.close(); }
console.log('browser-extract: hydrated JD text and publisher metadata are extracted');
