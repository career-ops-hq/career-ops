/** Verify the current a16z portfolio payload is parsed without losing the legacy fallback. */

import assert from 'node:assert/strict';
import { parseA16zPayload } from '../seeds/vc-portfolios.mjs';

const current = `<script>window.a16z_portfolio_companies = [
  {"title":"Abridge","web":"https://abridge.com"},
  {"title":"Abridge","web":"https://abridge.com"},
  {"title":"11x","web":"https://www.11x.ai/"}
];</script>`;
assert.deepEqual(parseA16zPayload(current), [
  { name: 'Abridge', slug: 'abridge', url: 'https://abridge.com', source: 'a16z' },
  { name: '11x', slug: '11x', url: 'https://www.11x.ai/', source: 'a16z' },
]);
assert.equal(parseA16zPayload('<a data-company-name="Figma" data-company-url="https://figma.com"></a>')[0].name, 'Figma');
console.log('a16z portfolio: embedded directory and legacy fallback passed');
