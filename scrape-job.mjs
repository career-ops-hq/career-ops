import { chromium } from 'playwright';

async function scrapeJob(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    // LinkedIn often redirects to login. Let's check if we're on a login page.
    const isLoginPage = await page.title().then(t => t.includes('Sign In') || t.includes('Login'));
    if (isLoginPage) {
      console.error('Redirected to login page. Cannot scrape LinkedIn without authentication.');
      process.exit(1);
    }

    // Attempt to extract data. LinkedIn uses dynamic classes, but some attributes/patterns are stable.
    const data = await page.evaluate(() => {
      const getText = (selector) => document.querySelector(selector)?.innerText || '';

      return {
        title: getText('.job-details-top-card__richtext'),
        company: getText('.job-details-top-card__company-name'),
        description: getText('.jobs-description-content__text'),
      };
    });

    // If the above selectors failed, try fallback for the search-view layout
    if (!data.title || !data.description) {
      const fallbackData = await page.evaluate(() => {
        return {
          title: document.querySelector('h2')?.innerText || '',
          company: document.querySelector('.job-details-top-card__company-name')?.innerText || '',
          description: document.querySelector('#job-details')?.innerText || '',
        };
      });
      Object.assign(data, fallbackData);
    }

    console.log(JSON.stringify(data));
  } catch (e) {
    console.error('Scraping failed:', e);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

const url = process.argv[2];
if (!url) {
  console.error('URL is required');
  process.exit(1);
}
scrapeJob(url);
