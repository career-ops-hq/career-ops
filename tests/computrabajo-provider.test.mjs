import test from 'node:test';
import assert from 'node:assert/strict';
import provider from '../providers/computrabajo.mjs';

function pageHtml(page) {
  return `
    <article class="box_offer">
      <h2><a href="/ofertas-de-trabajo/oferta-${page}">Ingeniero de integraci&#243;n ${page} &amp; IA</a></h2>
      <p class="fs16 fc_base">Empresa ${page} &amp; Co</p>
    </article>
  `;
}

test('Computrabajo keeps the real employer, decodes entities, and enforces crawl caps', async () => {
  const requested = [];
  const jobs = await provider.fetch(
    {
      name: 'Computrabajo Colombia',
      careers_url: 'https://co.computrabajo.com/trabajos-de-sistemas?foo=bar',
      provider: 'computrabajo',
      max_pages: 999,
      max_jobs: 999,
    },
    {
      sleep: async () => {},
      fetchText: async (url) => {
        requested.push(url);
        const page = Number(new URL(url).searchParams.get('p'));
        return pageHtml(page);
      },
    },
  );

  assert.equal(requested.length, 3);
  assert.equal(new URL(requested[0]).searchParams.get('foo'), 'bar');
  assert.deepEqual(jobs.map((job) => job.company), [
    'Empresa 1 & Co',
    'Empresa 2 & Co',
    'Empresa 3 & Co',
  ]);
  assert.equal(jobs[0].title, 'Ingeniero de integración 1 & IA');
});

test('Computrabajo stops cleanly on an anti-bot challenge', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const jobs = await provider.fetch(
      {
        name: 'Computrabajo Colombia',
        careers_url: 'https://co.computrabajo.com/trabajos-de-sistemas',
        provider: 'computrabajo',
      },
      { sleep: async () => {}, fetchText: async () => '<html>Cloudflare CAPTCHA</html>' },
    );
    assert.deepEqual(jobs, []);
  } finally {
    console.warn = originalWarn;
  }
});
