// Converts provider scan offers into canonical SQLite opportunity records.
import { openOpportunityStore } from '../opportunities/store.mjs';
import { createHash } from 'node:crypto';

export function normalizeDiscoveryOffer(offer) {
  const description = offer.scan_jd?.text ?? offer.description ?? offer.text ?? '';
  return {
    ...offer,
    title: offer.title ?? offer.role,
    description,
    fingerprint: offer.fingerprint ?? (description ? createHash('sha256').update(description).digest('hex').slice(0, 16) : undefined),
  };
}

export async function ingestScanOffers(databasePath, offers) {
  const store = await openOpportunityStore(databasePath);
  try {
    return offers.map(rawOffer => {
      const offer = normalizeDiscoveryOffer(rawOffer);
      const row = store.ingest({
      url: offer.url,
      company: offer.company,
      role: offer.title,
      source: offer.source ?? 'scan',
      payload: offer,
      });
      store.recordScanObservation(row.id, { url: offer.url, company: offer.company, title: offer.title, observedOn: offer.first_seen });
      return row;
    });
  } finally {
    store.close();
  }
}
