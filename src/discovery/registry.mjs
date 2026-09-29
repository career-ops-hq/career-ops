// Owns the provider registry shared by the remaining Node collection tools.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProviders as loadProviderModules, resolveProvider } from '../../providers/_registry.mjs';
const providers = await loadProviderModules(join(dirname(fileURLToPath(import.meta.url)), '../../providers'));

export function discoveryProvider(id) {
  const provider = providers.get(id);
  if (!provider) throw new Error(`Missing discovery provider: ${id}`);
  return provider;
}

export { loadProviderModules as loadProviders, resolveProvider };
export { normalizeDiscoveryOffer } from './ingest.mjs';
