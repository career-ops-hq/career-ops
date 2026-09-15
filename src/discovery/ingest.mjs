// Converts provider scan offers into canonical SQLite opportunity records.
import { openOpportunityStore } from '../opportunities/store.mjs';
import { createHash } from 'node:crypto';

export function normalizeDiscoveryOffer(offer) {
  const description = offer.description ?? offer.text ?? '';
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
      return store.ingest({
      url: offer.url,
      company: offer.company,
      role: offer.title,
      source: offer.source ?? 'scan',
      payload: offer,
      });
    });
  } finally {
    store.close();
  }
}
