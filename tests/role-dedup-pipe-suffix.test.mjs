import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoleForDedup } from '../scan.mjs';

// Grafana Labs posts one requisition per country and packs the place into the
// TITLE, not only the location field, so a single role arrives as six titles:
// "… | USA | Remote", "… | Germany | Remote", and so on. The tracker stores the
// clean employer title, so the scanned title never matched it and an
// already-evaluated role was re-added on the next scan.
test('strips a trailing pipe-delimited location suffix', () => {
  assert.equal(
    normalizeRoleForDedup('Senior Engineering Manager, Grafana Frontend | USA | Remote'),
    normalizeRoleForDedup('Senior Engineering Manager, Grafana Frontend'),
  );
  assert.equal(
    normalizeRoleForDedup('Engineering Manager - Observability | Germany | Remote'),
    normalizeRoleForDedup('Engineering Manager - Observability'),
  );
});

test('keeps a trailing pipe segment that is not a location', () => {
  assert.notEqual(
    normalizeRoleForDedup('Engineering Manager | Payments'),
    normalizeRoleForDedup('Engineering Manager'),
  );
});

test('bracketed suffixes still strip, and mixed forms collapse together', () => {
  assert.equal(normalizeRoleForDedup('Engineering Manager (Remote)'), normalizeRoleForDedup('Engineering Manager'));
  assert.equal(normalizeRoleForDedup('Engineering Manager (Remote) | USA'), normalizeRoleForDedup('Engineering Manager'));
});
