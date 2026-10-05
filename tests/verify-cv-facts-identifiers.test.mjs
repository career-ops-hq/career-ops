import { pass, fail } from './helpers.mjs';
import { metricClaims, auditClaims } from '../verify-cv-facts.mjs';

console.log('\nStandard identifiers are not count claims (EIP-712, ERC-4626, BIP-39)');

// A number glued to letters by a hyphen names a standard. Read as a count, a
// truthful tailored bullet fails the gate whenever the source phrased the same
// fact with one more word inside the modifier window: the source yields no
// claim, the bullet yields "712 offers", and the PDF is blocked.
const source = 'Implemented EIP-712 off-chain signed listings (ETH) and offers (WETH). Shipped 3 audits.';

const identifierCases = [
  ['EIP-712 before a metric noun', 'Built EIP-712 signed offers for the OTC desk'],
  ['ERC-20 before a metric noun', 'Audited ERC-20 tokens for the treasury'],
  ['BIP-39 before a metric noun', 'Wrote BIP-39 integration tests'],
];
for (const [label, bullet] of identifierCases) {
  const { invented } = auditClaims(bullet, source);
  if (invented.length === 0) pass(`no invented claim: ${label}`);
  else fail(`${label}: identifier read as a count, invented ${JSON.stringify(invented)}`);
}

// The guard is anchored to the hyphen, so real counts are untouched.
const realCases = [
  ['a plain count is still extracted', 'Shipped 12 audits', '12 audits'],
  ['a count after a hyphenated word is still extracted', 'Co-led 3 audits', '3 audits'],
];
for (const [label, text, claim] of realCases) {
  if (metricClaims(text).has(claim)) pass(label);
  else fail(`${label}: expected "${claim}" in ${JSON.stringify([...metricClaims(text)])}`);
}

const { invented } = auditClaims('Shipped 12 audits', source);
if (JSON.stringify(invented) === JSON.stringify(['12 audits'])) pass('an inflated real count still fails the gate');
else fail(`an inflated real count must fail the gate, got ${JSON.stringify(invented)}`);
