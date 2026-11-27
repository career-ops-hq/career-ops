import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitPluginJobs } from '../plugins.mjs';

const admit = jobs => admitPluginJobs(jobs, {
  id: 'fixture',
  gateOptions: { seen: new Set() },
}).jobs;

test('plugin admission rejects records the host cannot persist', () => {
  for (const job of [
    { title: '', url: 'https://jobs.example/empty' },
    { title: '   ', url: 'https://jobs.example/blank' },
    { title: 42, url: 'https://jobs.example/title' },
    { title: 'Engineer', url: 'mailto:jobs@example.com' },
    { title: 'Engineer', url: '' },
    null,
  ]) {
    assert.deepEqual(admit([job]), [], JSON.stringify(job));
  }
});

test('plugin admission returns the canonical fields used by the host writer', () => {
  assert.deepEqual(admit([{
    title: '  Engineer  ', url: ' https://jobs.example/valid ',
    company: ' Acme ', location: ' Berlin ', salary: 80000,
    untrusted: 'extra field',
  }]), [{
    title: 'Engineer', url: 'https://jobs.example/valid',
    company: 'Acme', location: 'Berlin', salary: 80000, source: 'plugin:fixture',
  }]);
});
