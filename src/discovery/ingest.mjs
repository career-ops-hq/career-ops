// Converts provider scan offers into canonical SQLite opportunity records.
import { openOpportunityStore } from '../opportunities/store.mjs';

export async function ingestScanOffers(databasePath, offers) {
  const store = await openOpportunityStore(databasePath);
  try {
    return offers.map(offer => store.ingest({
      url: offer.url,
      company: offer.company,
      role: offer.title,
      source: offer.source ?? 'scan',
      payload: offer,
    }));
  } finally {
    store.close();
  }
}
