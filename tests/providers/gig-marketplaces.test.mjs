import { test } from 'node:test';
import assert from 'node:assert/strict';
import dataannotation, { parseDataAnnotationBoard } from '../../providers/dataannotation.mjs';

const daCard = (slug = 'backend-engineer', role = 'Backend Engineer', rate = '$150+') =>
  `<a class="card jb-card jb-item" href="/job-board/${slug}" data-domain="Coding" data-search="x"><div class="jb-card-head"><h2>${role}</h2><span class="jb-pill">Coding</span></div><div class="card-foot"><span class="rate"><span class="rate-pre">Up to</span> <!-- -->${rate}<!-- --> <small>/ hr</small></span><span class="hired">121<!-- --> hired recently</span></div></a>`;
test('dataannotation: one standing role per card, pay as a ceiling, fixed host', async () => {
  const jobs = parseDataAnnotationBoard(daCard() + daCard() + daCard('generalist', 'Generalist', '$50') + daCard('../x', 'Bad') + daCard('ok', ''));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, 'Backend Engineer – AI Training');
  assert.equal(jobs[0].url, 'https://www.dataannotation.tech/job-board/backend-engineer');
  assert.match(jobs[0].description, /Pay: up to \$150\/hour or more/);
  assert.match(jobs[1].description, /Pay: up to \$50\/hour,/);
  assert.equal(jobs[0].postedAt, undefined, 'standing roles carry no posting date');
  assert.throws(() => parseDataAnnotationBoard('<a class="jb-card" href="/job-board/x"><h3>changed</h3></a>'), /dataannotation/);
  assert.deepEqual(parseDataAnnotationBoard('<p>No roles</p>'), []);
  const calls = [];
  await dataannotation.fetch({ careers_url: 'https://evil.example' }, { fetchText: async (url, opts) => { calls.push(url); assert.equal(opts.redirect, 'error'); return daCard(); } });
  assert.deepEqual(calls, ['https://www.dataannotation.tech/']);
});
