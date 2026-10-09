import { buildMarketPlan, classifyMarketLocation } from './market-presets.mjs';

/** @typedef {{state: 'queued'|'active'|'ok'|'partial'|'error'|'skipped', companies?:number, done?:number, total?:number, matches?:number, unreachable?:number, message?:string}} DiscoverySourceState */
/** @typedef {Record<string, DiscoverySourceState>} DiscoverySources */
/** @typedef {'match'|'fresh'|'company'} DiscoverySort */

export const MARKET_LABEL = { portugal: 'Portugal', spain: 'Espanha', 'united-kingdom': 'Reino Unido', switzerland: 'Suíça', luxembourg: 'Luxemburgo', netherlands: 'Países Baixos', europe: 'Europa', remote: 'Remoto' };
export const SOURCE_STATE_LABEL = { queued: 'Por iniciar', active: 'A pesquisar', ok: 'Concluída', partial: 'Parcial', error: 'Falhou', skipped: 'Não consultada' };
const SOURCE_LABEL = {
  greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday',
  landingjobs: 'Landing.jobs', manfred: 'getManfred', wttj: 'Welcome to the Jungle',
  remoteok: 'RemoteOK', remotive: 'Remotive', himalayas: 'Himalayas', jobicy: 'Jobicy',
  jobspresso: 'Jobspresso', workingnomads: 'Working Nomads', weworkremotely: 'We Work Remotely',
};

/** @param {string} source */
export function sourceLabel(source) {
  const id = source.toLowerCase().replace(/-(api|full)$/, '');
  return SOURCE_LABEL[id] ?? source;
}

/** @param {DiscoverySources} sources */
export function discoverySourceReasons(sources) {
  return Object.entries(sources).filter(([, s]) => s.state !== 'ok').map(([id, s]) =>
    `${sourceLabel(id)}: ${s.message === 'missing-search-terms'
      ? 'Indica uma função nas palavras de pesquisa ou nas funções-alvo do perfil.'
      : s.message || SOURCE_STATE_LABEL[s.state]}`);
}

/** @param {DiscoverySources} sourceStates @param {number} offerCount */
export function summarizeDiscoveryState(sourceStates, offerCount) {
  const states = Object.values(sourceStates).map(s => s.state);
  if (!states.length || states.every(s => s === 'error' || s === 'skipped')) return 'all-failed';
  if (states.some(s => s !== 'ok')) return 'partial';
  return offerCount > 0 ? 'complete' : 'zero-healthy-results';
}

/** @param {import('./explore').DiscoveredOffer[]} offers
 * @param {Extract<import('./explore').ScanEvent, {kind:'offer'|'done'}>} event */
export function applyDiscoveryOfferEvent(offers, event) {
  return [...new Map((event.kind === 'done' ? event.offers : [...offers, event.offer]).map(offer => [offer.url, offer])).values()];
}

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const dateKey = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
/** @template {import('./explore').DiscoveredOffer} T @param {T[]} offers @param {DiscoverySort} sort @returns {T[]} */
export function sortDiscoveryOffers(offers, sort) {
  return [...offers].sort((a, b) =>
    (sort === 'match' ? (b.match?.total ?? 0) - (a.match?.total ?? 0) : sort === 'company' ? compare(a.company, b.company) : 0) ||
    compare(dateKey(b.postedAt), dateKey(a.postedAt)) || compare(a.company, b.company) || compare(a.url, b.url));
}

/** @param {DiscoverySources} sources @param {import('./explore').ScanEvent} event
 * @returns {DiscoverySources} */
export function updateDiscoverySources(sources, event) {
  if (event.kind === 'phaseStart') return {};
  const next = { ...sources };
  const source = 'source' in event ? event.source : 'ats' in event && typeof event.ats === 'string' ? event.ats : '';
  const previous = next[source] ?? { state: 'queued' };
  switch (event.kind) {
    case 'sourceStart': next[source] = { ...previous, state: 'active' }; break;
    case 'sourceDone': next[source] = { ...previous, state: previous.state === 'partial' ? 'partial' : 'ok', matches: event.count }; break;
    case 'sourceError': next[source] = { ...previous, state: 'error', message: event.message }; break;
    case 'atsStart': next[source] = { ...previous, state: 'active', companies: event.companies }; break;
    case 'progress': next[source] = { ...previous, state: 'active', done: event.scanned, total: event.total, matches: event.matches }; break;
    case 'atsDone': next[source] = { ...previous, state: event.unreachable > 0 ? 'partial' : 'ok', unreachable: event.unreachable }; break;
    case 'summary': {
      for (const s of event.sources ?? []) {
        const old = next[s.source];
        next[s.source] = { ...old, state: s.state === 'ok' && old?.state === 'partial' ? 'partial' : s.state, message: s.message ?? old?.message };
      }
      for (const id of event.incomplete ?? []) if (next[id]?.state !== 'skipped' && next[id]?.state !== 'partial') next[id] = { ...next[id], state: 'error', message: next[id]?.message ?? 'A fonte não terminou' };
      for (const [id, state] of Object.entries(event.datasetStatus ?? {})) {
        if (state !== 'ok' && next[id]?.state !== 'error') next[id] = { ...next[id], state: 'partial' };
      }
      if (event.status === 'partial' || event.capHit || event.unreachable > 0 || (event.postingsDroppedNoDate ?? 0) > 0) {
        // The receipt may describe a global limit without identifying a source.
        if (Object.values(next).every(s => s.state === 'ok')) {
          for (const id of Object.keys(next)) next[id] = { ...next[id], state: 'partial' };
        }
      }
      break;
    }
    case 'done':
    case 'error':
      for (const [id, s] of Object.entries(next)) {
        if (s.state === 'queued' || s.state === 'active') next[id] = { ...s, state: 'error', message: event.kind === 'error' ? event.message : 'A fonte não confirmou a conclusão' };
      }
      break;
    default: return sources;
  }
  return next;
}

/** @param {Pick<import('./explore').ExploreFilters, 'ats'|'markets'|'opportunityType'>} filters */
export function canDiscover(filters) {
  return filters.opportunityType === 'freelance' || filters.ats.length > 0 || filters.markets.length > 0;
}

const remotePlan = buildMarketPlan(['remote'], []);
/** @param {Pick<import('./explore').DiscoveredOffer, 'source'|'sources'|'location'> & {ats?:string}} offer */
export function offerProvenance(offer) {
  const rawOrigins = [offer.source, ...(offer.sources ?? []), offer.ats].filter(Boolean);
  const origins = [...new Set(rawOrigins.map(sourceLabel))];
  const eligibilityUnknown = rawOrigins.some(source => classifyMarketLocation({ ...offer, source: source.replace(/-api$/, '') }, remotePlan).remote === true);
  return { origins, eligibilityUnknown };
}
