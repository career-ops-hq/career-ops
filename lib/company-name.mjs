// Normalize employer names for the retained Node collection tools.

const LEGAL_SUFFIXES = [
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co',
  'limited', 'ltd', 'llc', 'llp', 'lp', 'plc',
];
const GENERIC_DESCRIPTORS = [
  'group', 'holdings', 'technologies', 'technology', 'solutions',
  'canada', 'international',
];

export function normalizeCompanyName(name) {
  let key = String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{M}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      const re = new RegExp(`\\s${suffix}$`);
      if (re.test(key)) {
        key = key.replace(re, '').trim();
        changed = true;
      }
    }
  }

  for (const word of GENERIC_DESCRIPTORS) {
    const re = new RegExp(`\\s${word}$`);
    if (re.test(key)) {
      key = key.replace(re, '').trim();
      break;
    }
  }
  return key;
}
