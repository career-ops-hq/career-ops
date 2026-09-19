#!/usr/bin/env node
/**
 * jev-reply-classify.mjs — optional TypeSafe (Jev) fallback classifier for
 * reply-watch candidates the deterministic keyword matcher (reply-matcher.mjs
 * classifyReply) could not confidently type.
 *
 * Opt-in only: requires TYPESAFE_API_KEY. With no key set, callers get `null`
 * back and must keep whatever the deterministic classifier already decided —
 * this module never becomes a silent hard dependency.
 *
 * This is a fallback, not a replacement: reply-watch.mjs calls it only when
 * classifyReply() returns type 'Unknown'. A keyword hit always wins; Jev never
 * overrides a deterministic match, and a low-confidence Jev answer (<0.6)
 * stays 'Unknown' rather than guessing.
 *
 * Email body/subject text is untrusted external content — sent to Jev only as
 * `state` for classification, per AGENTS.md "Untrusted External Content".
 * Nothing here writes to the tracker; reply-watch.mjs stays HITL-suggest-only.
 */

try {
  const { config } = await import('dotenv');
  config();
} catch {
  // dotenv optional
}

const API_URL = 'https://api.typesafe.ai/v1/systemone';
const CONFIDENCE_FLOOR = 0.6;
const REQUEST_TIMEOUT_MS = 10_000;

const CATEGORIES = {
  Interview: 'The email invites or schedules an interview, screen, or assessment call with the candidate.',
  Responded: 'The employer replied to acknowledge, follow up, or say someone will reach out, without a concrete next step yet.',
  'Need Action': 'The email asks the candidate to complete a form, test, assessment, or respond by a deadline.',
  Rejected: 'The email rejects the candidate or says the role/search has closed.',
  Offer: 'The email contains a job offer, offer letter, or compensation details for an accepted role.',
  'Auto-confirmation': 'An automated receipt confirming an application was received, with no human judgment yet.',
  Noise: 'A job alert, newsletter, or recruiting marketing email not tied to a specific application the candidate made.',
  Unknown: 'None of the above fit, or there is not enough information to tell.',
};

/** True only when TYPESAFE_API_KEY is present; callers should skip the call otherwise. */
export function jevAvailable() {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

/**
 * Classify one reply candidate with Jev. Returns null if unavailable, on any
 * request/response error, or when confidence is below CONFIDENCE_FLOOR — in
 * every case the caller should keep its existing 'Unknown' classification.
 */
export async function classifyReplyWithJev(cand) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) return null;

  const state = {
    from: cand.from || '',
    subject: cand.subject || '',
    body: cand.body_snippet || '',
  };

  // One deadline for the whole request, headers and body — fetch() can
  // resolve as soon as headers arrive, leaving res.json() free to hang on a
  // stalled body with no timeout of its own.
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      signal: deadline,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        state,
        model: 'jev-latest',
        questions: {
          category: {
            type: 'choice',
            instructions: 'This is an email a job applicant received. Which category best describes it?',
            criteria: CATEGORIES,
          },
          // Asked alongside category (independent, same state) rather than as
          // a follow-up request — the deterministic matcher uses this same
          // signal to route 'Need Action' to Interview vs Responded, so Jev's
          // fallback needs it too, not just the top-level category.
          hasSchedulingAsk: {
            type: 'noul',
            instructions: 'Does the email ask the candidate to pick, book, or confirm a specific interview or call time/slot?',
          },
        },
      }),
    });
  } catch (err) {
    console.error(`jev-reply-classify: request failed — ${err.message}`);
    return null; // network failure or timeout — fail closed, caller keeps 'Unknown'
  }

  if (!res.ok) {
    console.error(`jev-reply-classify: API returned ${res.status} ${res.statusText}`);
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(`jev-reply-classify: could not parse response — ${err.message}`);
    return null; // includes abort mid-body-read once the deadline fires
  }

  const answer = data?.answers?.category;
  if (!answer || typeof answer.choice !== 'string') return null;
  if (typeof answer.confidence === 'number' && answer.confidence < CONFIDENCE_FLOOR) return null;
  if (!(answer.choice in CATEGORIES) || answer.choice === 'Unknown') return null;

  const schedulingProbability = data?.answers?.hasSchedulingAsk?.noul;
  if (answer.choice === 'Need Action' && !Number.isFinite(schedulingProbability)) return null;
  const hasSchedulingAsk = schedulingProbability > CONFIDENCE_FLOOR;

  const suggestedTrackerUpdate = {
    Interview: 'Interview',
    Responded: 'Responded',
    'Need Action': hasSchedulingAsk ? 'Interview' : 'Responded',
    Rejected: 'Rejected',
    Offer: 'Offer',
    'Auto-confirmation': 'none',
    Noise: 'none',
  }[answer.choice] || 'Needs Review';

  return {
    type: answer.choice,
    evidence: [`jev:${answer.confidence?.toFixed?.(2) ?? '?'}`],
    suggestedTrackerUpdate,
  };
}
