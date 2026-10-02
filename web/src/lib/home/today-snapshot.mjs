import { pickAwaitingDecision } from "./awaiting.mjs";

/**
 * Send only what Today renders across the server/client boundary. Completed
 * inbox URLs still identify saved discoveries; their descriptions do not.
 * Keep every undecided application so the headline can count beyond six cards.
 *
 * @template {{date?: string, score?: string, status?: string}} T
 * @param {{applications: T[], inbox: {url: string, done: boolean}[]}} snapshot
 * @param {(score: string) => number} scoreOf
 */
export function todaySnapshot({ applications, inbox }, scoreOf) {
  return {
    applications: pickAwaitingDecision(applications, scoreOf, Infinity),
    inbox: inbox.map(({ url, done }) => ({ url, done })),
  };
}
