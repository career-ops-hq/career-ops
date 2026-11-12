/** Explicit, verbatim Profile facts -> HTML CV payload. No source or PDF writes. */
import { createHash } from 'node:crypto';
import { validateProfile } from './career-profile.mjs';
import { validatePayload } from './cv-payload-schema.mjs';

export class SelectionError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = 'SelectionError';
    this.code = code;
    Object.assign(this, context);
  }
}

function requireThat(condition, code, message, context) {
  if (!condition) throw new SelectionError(code, message, context);
}

// Object key order/JSON formatting is immaterial; array order is significant.
// Reject values JSON would silently drop or change, including cyclic objects.
export function selectionDigest(value) {
  const ancestors = new Set();
  function canonical(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    requireThat(item && typeof item === 'object' && !ancestors.has(item)
      && (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype),
    'non-json-input', 'Selection inputs must contain only JSON values.');
    ancestors.add(item);
    const result = Array.isArray(item)
      ? `[${Array.from(item, canonical).join(',')}]`
      : `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`;
    ancestors.delete(item);
    return result;
  }
  return createHash('sha256').update(canonical(value)).digest('hex');
}

const evidenceIdentity = evidence => ({ source: evidence.source, quote: evidence.quote });

/**
 * Revalidates the whole Profile and the existing HTML payload contract.
 * Selection v1 binds stable Profile IDs to exact base-payload experience slots.
 * Hashes detect stale/changed inputs; they certify neither truth nor consent.
 */
export function prepareCvSelection({ profile, basePayload, selection }) {
  const profileErrors = validateProfile(profile);
  requireThat(!profileErrors.length, 'invalid-profile', `Invalid profile:\n- ${profileErrors.join('\n- ')}`);
  const { errors } = validatePayload(basePayload, 'html');
  requireThat(!errors.length, 'invalid-payload', `Invalid HTML payload:\n- ${errors.join('\n- ')}`);
  const baseDigest = selectionDigest(basePayload);
  requireThat(selection?.schema === 'profile-selection.v1', 'selection-schema', 'Expected profile-selection.v1.');
  // Validate the entire manifest as JSON before examining any of its fields.
  const manifestDigest = selectionDigest(selection);
  requireThat(selection.base_payload_sha256 === baseDigest, 'base-payload-changed', 'Base payload changed; select facts again.');
  requireThat(Array.isArray(selection.bindings) && selection.bindings.length > 0, 'empty-bindings', 'Select at least one experience binding.');
  requireThat(Array.isArray(basePayload.experience), 'invalid-target', 'Base payload must have an experience list.');
  const payload = structuredClone(basePayload);
  const targets = new Set();
  const selectedIds = new Set();
  const selectedProfile = [];
  const bullets = [];
  for (const binding of selection.bindings) {
    const context = { profile_entry_id: binding?.profile_entry_id, experience_index: binding?.target?.experience_index };
    const entry = profile.experiences.find(item => item.id === binding?.profile_entry_id);
    requireThat(entry, 'missing-entry', 'Selected Profile experience does not exist.', context);
    requireThat(entry.review_status !== 'needs_review', 'entry-not-verified', 'Selected Profile experience needs review.', context);
    const index = binding.target?.experience_index;
    requireThat(Number.isInteger(index) && index >= 0 && index < payload.experience.length, 'invalid-target', 'Experience index is outside the base payload.', context);
    requireThat(!targets.has(index), 'duplicate-target', 'An experience may be bound only once.', context);
    targets.add(index);
    requireThat(binding.target.entry_sha256 === selectionDigest(basePayload.experience[index]), 'target-anchor-changed', 'Bound experience changed; select facts again.', context);
    requireThat(Array.isArray(binding.fact_ids) && binding.fact_ids.length > 0, 'empty-fact-selection', 'Select at least one fact for each binding.', context);
    const facts = [];
    for (const id of binding.fact_ids) {
      const factContext = { ...context, fact_id: id };
      requireThat(!selectedIds.has(id), 'duplicate-selected-fact', 'A fact may be selected only once.', factContext);
      selectedIds.add(id);
      const fact = entry.facts.find(item => item.id === id);
      requireThat(fact, 'missing-or-wrongly-bound-fact', 'Selected fact does not belong to the bound Profile experience.', factContext);
      requireThat(fact.review_status === 'verified', 'fact-not-verified', 'Selected fact needs review.', factContext);
      facts.push({ id: fact.id, text: fact.text, review_status: fact.review_status, evidence: evidenceIdentity(fact.evidence) });
      bullets.push({ experience_index: index, bullet_index: facts.length - 1,
        profile_entry_id: entry.id, fact_id: fact.id,
        text_sha256: selectionDigest(fact.text), evidence: evidenceIdentity(fact.evidence) });
    }
    payload.experience[index].bullets = facts.map(fact => fact.text);
    selectedProfile.push({ id: entry.id, label: entry.label, review_status: entry.review_status ?? 'verified',
      evidence: evidenceIdentity(entry.evidence), facts });
  }
  return {
    payload,
    mapping: {
      schema: 'profile-mapping.v1', base_payload_sha256: baseDigest,
      selection_sha256: manifestDigest, selected_profile_sha256: selectionDigest(selectedProfile),
      payload_sha256: selectionDigest(payload), bullets,
    },
  };
}

/** Reconstruct from independent originals, rather than trusting a sidecar hash. */
export function verifyCvSelection(inputs, prepared) {
  const expected = prepareCvSelection(inputs);
  requireThat(prepared && typeof prepared === 'object', 'invalid-prepared', 'Expected a prepared payload and mapping.');
  requireThat(selectionDigest(prepared.payload) === selectionDigest(expected.payload), 'prepared-payload-mismatch', 'Prepared payload differs from the current selection.');
  requireThat(selectionDigest(prepared.mapping) === selectionDigest(expected.mapping), 'prepared-mapping-mismatch', 'Prepared mapping differs from the current selection.');
  return true;
}
