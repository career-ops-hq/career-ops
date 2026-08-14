#!/usr/bin/env node
/**
 * PII Sanitizer & Anonymization Engine (#2888)
 * Redacts personally identifiable information before LLM request transmission.
 */

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    restore: { type: 'boolean', default: false },
    in: { type: 'string' },
    out: { type: 'string' },
  },
  allowPositionals: true,
});

export function sanitizeText(text = '') {
  const map = new Map();
  let counter = 1;

  let sanitized = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, match => {
    const token = `[EMAIL_${counter++}]`;
    map.set(token, match);
    return token;
  });

  sanitized = sanitized.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, match => {
    const token = `[PHONE_${counter++}]`;
    map.set(token, match);
    return token;
  });

  return { sanitized, map };
}

export function restoreText(sanitized = '', map = new Map()) {
  let restored = sanitized;
  for (const [token, original] of map.entries()) {
    restored = restored.replaceAll(token, original);
  }
  return restored;
}

if (process.argv[1] && process.argv[1].endsWith('pii-sanitizer.mjs')) {
  const sample = 'Contact me at john@example.com or 555-123-4567.';
  const { sanitized } = sanitizeText(sample);
  console.log('Sanitized output:');
  console.log(sanitized);
}
