/**
 * blank-unknown.mjs — drop drafted answers the profile does not state.
 *
 * The planner is told to leave sponsorship, salary, and demographic questions
 * blank. It still returns a guess, and the fill posts any non-empty string.
 * This gate runs on the draft and again on the fill body. A value stays only
 * when the profile states that fact, or when the person edited the field.
 */
import fs from "node:fs";
import * as yaml from "js-yaml";
import { getProfilePath } from "../core/profile-path.mjs";

/**
 * @param {string} root
 * @returns {Record<string, unknown>}
 */
export function readApplyProfile(root) {
  const file = getProfilePath(root);
  try {
    const doc = yaml.load(fs.readFileSync(file, "utf8"));
    return doc && typeof doc === "object" ? /** @type {Record<string, unknown>} */ (doc) : {};
  } catch (err) {
    // A missing profile states nothing. A broken or unreadable one must not
    // look the same, or every stated answer is blanked with no reason.
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code === "ENOENT") return {};
    const message = err instanceof Error ? err.message : "could not read the profile";
    throw new Error(`${file}: ${message}`);
  }
}

/**
 * @param {{ type?: string, label?: string } | null | undefined} field
 * @returns {string | null}
 */
export function classifyApplyQuestion(field) {
  if (!field || field.type === "file") return null;
  const q = String(field.label || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return null;
  if (/gender|\brac(?:e|ial)\b|ethnic|veteran|disability|self-identif|pronouns?\b|hispanic|latin[oa]|sexual orientation/.test(q)) return "eeo";
  if (/felony|conviction|convicted|criminal background/.test(q)) return "legal";
  if (/salary history|compensation history|wage history|pay history|\b(?:current|previous|prior|last) (?:salary|compensation|pay|wage)\b/.test(q)) return "salary-history";
  const visa = visaQuestionKind(q);
  if (visa) return visa;
  if (/salary|compensation|pay expectation|desired pay|\bwage\b/.test(q)) return "salary";
  if (/how did you hear|where did you hear|how did you find|referral source/.test(q)) return "source";
  // "in total do you have" and a bare "overall" are the profile total.
  // "in Total Rewards" names a discipline, so it stays blank, as do "with Python"
  // and "for Python".
  if (/years of (?:relevant )?experience in total(?:\s+do\s+you\s+have\b)?(?:\s*[?.!]|$)/.test(q)) return "years";
  if (/years of (?:relevant )?experience (?:overall|altogether)\b/.test(q)) return "years";
  if (/years of (?:relevant )?experience (?:with|in|using|as|on|for)\b/.test(q)) return "years-specific";
  if (/years of experience|years of relevant/.test(q)) return "years";
  if (/start date|earliest start|when can you start|date you can start/.test(q)) return "start-date";
  if (/relocat/.test(q)) return "relocation";
  if (/role description|responsibilit/.test(q)) return null;
  if (field.type === "textarea" || /why (do you|are you|us\b|this|join)|cover letter|additional information|tell us|essay|anything else/.test(q)) {
    return "essay";
  }
  return null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function mentionsPlace(label, place) {
  const token = String(place).trim().toLowerCase();
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(label);
}

const WORK_AUTH_RE = /authori[sz]ed to work|work authori[sz]ation|right to work|eligible to work/;

function mentionsSponsorship(q) {
  return /sponsor/.test(q);
}

function sponsorshipDeclined(q) {
  if (!mentionsSponsorship(q)) return false;
  return /\bwithout\b[^.]{0,80}sponsor/.test(q)
    || /\b(?:do not|don't|does not)\s+(?:require|requires|required|requiring|need|needs|needed)\b[^.]{0,80}sponsor/.test(q)
    || /\bno\s+need\b[^.]{0,80}sponsor/.test(q)
    || /\bsponsor\w*\b[^.]{0,40}\bnot\s+(?:required|needed)\b/.test(q);
}

function asksIfSponsorshipRequired(q) {
  if (!mentionsSponsorship(q) || sponsorshipDeclined(q)) return false;
  return /\b(?:require|requires|required|requiring|need|needs|needed)\b[^.]{0,80}sponsor/.test(q)
    || /\bsponsor\w*\b[^.]{0,40}\b(?:required|needed)\b/.test(q);
}

function visaQuestionKind(q) {
  if (sponsorshipDeclined(q)) return "work-authorization";
  if (asksIfSponsorshipRequired(q)) return "sponsorship";
  if (WORK_AUTH_RE.test(q)) {
    if (mentionsSponsorship(q)) return "auth-unresolved";
    return "work-authorization";
  }
  if (mentionsSponsorship(q)) return "sponsorship";
  return null;
}

function workAuthAffirms(label) {
  if (/\bnot authori[sz]ed\b/.test(label)) return false;
  if (/\b(?:require|need)s?\b[^.]{0,40}\b(?:work )?authori[sz]ation\b/.test(label)) return false;
  return true;
}

function yesNo(field, wantYes) {
  const word = wantYes ? "Yes" : "No";
  if (field.type === "checkbox") return wantYes ? "yes" : "no";
  const options = Array.isArray(field.options) ? field.options : [];
  if (options.length) {
    return options.find((option) => new RegExp(`^${word}\\b`, "i").test(String(option).trim())) ?? null;
  }
  return word;
}

function optionOrText(field, value) {
  const options = Array.isArray(field.options) ? field.options : [];
  if (!options.length) return value;
  const hit = options.find((option) => String(option).trim().toLowerCase() === value.toLowerCase());
  return hit ?? null;
}

function readPayAmount(numStr, kFlag) {
  let n = null;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(numStr)) n = Number(numStr.replace(/,/g, ""));
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(numStr)) n = Number(numStr.replace(/\./g, ""));
  else if (/^\d+(?:\.\d+)?$/.test(numStr)) n = Number(numStr);
  if (n == null || Number.isNaN(n)) return null;
  return kFlag ? n * 1000 : n;
}

// A number box cannot hold "$150K-200K". Fill the low end. A trailing k on
// the other bound scales a bare partner under 1000 ("95-120K" is 95000).
function digitsForNumberBox(range) {
  if (/(?:\/\s*(?:hour|hr|month|mo)\b|\bper\s+(?:hour|month)\b|\bhourly\b|\bmonthly\b)/i.test(range)) {
    return null;
  }
  const s = range
    .replace(/[€$£¥]/g, "")
    .replace(/^(?:[A-Za-z]{3})\s+(?=\d)/, "")
    .replace(/\s*[A-Za-z]{3}\s*$/, "")
    .trim();
  const pair = s.match(/^([\d.,]+)\s*(k)?\s*[-–—]\s*([\d.,]+)\s*(k)?$/i);
  if (pair) {
    let lo = readPayAmount(pair[1], pair[2]);
    let hi = readPayAmount(pair[3], pair[4]);
    if (lo == null || hi == null) return null;
    if (!pair[2] && pair[4] && lo < 1000) lo *= 1000;
    if (!pair[4] && pair[2] && hi < 1000) hi *= 1000;
    const low = Math.min(lo, hi);
    return low >= 1000 ? String(Math.round(low)) : null;
  }
  const single = s.match(/^([\d.,]+)\s*(k)?\s*\+?$/i);
  if (!single) return null;
  const n = readPayAmount(single[1], single[2]);
  return n != null && n >= 1000 ? String(Math.round(n)) : null;
}

/**
 * The profile's own answer for this question, or null when it does not state one.
 * EEO, salary history, and a skill-specific years question never come from the profile.
 *
 * @param {string} category
 * @param {{ type?: string, label?: string, options?: string[] }} field
 * @param {Record<string, unknown>} profile
 * @returns {string | null}
 */
export function statedAnswer(category, field, profile) {
  const doc = asRecord(profile);
  const location = asRecord(doc.location);
  const compensation = asRecord(doc.compensation);
  const availability = asRecord(doc.availability);
  const experience = asRecord(doc.experience);
  const apply = asRecord(doc.apply);

  if (category === "eeo" || category === "salary-history" || category === "legal" || category === "years-specific") return null;

  if (category === "auth-unresolved") return null;

  if (category === "sponsorship") {
    if (typeof location.needs_sponsorship !== "boolean") return null;
    return yesNo(field, location.needs_sponsorship);
  }

  if (category === "work-authorization") {
    const places = Array.isArray(location.authorized_in)
      ? location.authorized_in.filter((place) => typeof place === "string" && place.trim())
      : [];
    const label = String(field.label || "").toLowerCase();
    if (/sponsor/.test(label)) {
      if (typeof location.needs_sponsorship !== "boolean") return null;
      if (location.needs_sponsorship === true && workAuthAffirms(label)) {
        return field.type === "checkbox" ? "no" : yesNo(field, false);
      }
    }
    if (!places.some((place) => mentionsPlace(label, place))) return null;
    const affirm = workAuthAffirms(label);
    return field.type === "checkbox" ? (affirm ? "yes" : "no") : yesNo(field, affirm);
  }

  if (category === "salary") {
    const range = text(compensation.target_range);
    if (!range) return null;
    if (/(?:\/\s*(?:hour|hr|month|mo)\b|\bper\s+(?:hour|month)\b|\bhourly\b|\bmonthly\b)/i.test(String(field.label || ""))) {
      return null;
    }
    if (field.type === "number" && !/^\d+(\.\d+)?$/.test(range)) return digitsForNumberBox(range);
    return optionOrText(field, range);
  }

  if (category === "source") {
    const source = text(doc.source) || text(apply.source);
    if (!source) return null;
    return optionOrText(field, source);
  }

  if (category === "years") {
    const raw = doc.years_experience ?? experience.years;
    if (raw == null || raw === "") return null;
    const years = String(raw).trim();
    if (!/^\d+(\.\d+)?$/.test(years)) return null;
    return years;
  }

  if (category === "start-date") {
    return text(doc.start_date) || text(availability.start_date);
  }

  if (category === "relocation") {
    if (typeof location.willing_to_relocate !== "boolean") return null;
    return yesNo(field, location.willing_to_relocate);
  }

  if (category === "essay") {
    const answers = asRecord(apply.answers);
    const label = String(field.label || "").toLowerCase();
    if (!label) return null;
    for (const [key, value] of Object.entries(answers)) {
      if (key.toLowerCase() === label && text(value)) return text(value);
    }
    return null;
  }

  return null;
}

/**
 * @param {{ fields?: { id: string, type?: string, label?: string, options?: string[] }[], answers?: Record<string, string>, profile?: Record<string, unknown>, edited?: string[] }} input
 * @returns {Record<string, string>}
 */
export function prepareFillAnswers({ fields = [], answers = {}, profile = {}, edited = [] } = {}) {
  const keep = new Set(edited.filter((id) => typeof id === "string"));
  const out = { ...answers };
  for (const field of fields) {
    if (!field?.id || keep.has(field.id)) continue;
    const category = classifyApplyQuestion(field);
    if (!category) continue;
    out[field.id] = statedAnswer(category, field, profile) ?? "";
  }
  return out;
}

/**
 * Planner draft `{ id: { value, needs_confirmation } }` → the same shape, gated.
 *
 * @param {{ id: string, type?: string, label?: string, options?: string[] }[]} fields
 * @param {Record<string, unknown>} draft
 * @param {Record<string, unknown>} [profile]
 * @returns {Record<string, { value: string, needs_confirmation: boolean }>}
 */
export function blankUnknownDraft(fields, draft, profile = {}) {
  const byId = new Map(fields.map((field) => [field.id, field]));
  /** @type {Record<string, { value: string, needs_confirmation: boolean }>} */
  const out = {};
  for (const [id, raw] of Object.entries(draft || {})) {
    const field = byId.get(id);
    const incoming = raw && typeof raw === "object" ? String(raw.value ?? "") : String(raw ?? "");
    const needs = !!(raw && typeof raw === "object" && raw.needs_confirmation);
    const category = classifyApplyQuestion(field);
    if (!category) {
      out[id] = { value: incoming, needs_confirmation: needs };
      continue;
    }
    const stated = statedAnswer(category, field, profile);
    out[id] = stated == null
      ? { value: "", needs_confirmation: true }
      : { value: stated, needs_confirmation: false };
  }
  for (const field of fields) {
    if (out[field.id]) continue;
    const category = classifyApplyQuestion(field);
    if (!category) continue;
    const stated = statedAnswer(category, field, profile);
    if (stated == null) continue;
    out[field.id] = { value: stated, needs_confirmation: false };
  }
  return out;
}

/**
 * Agent-fill answers are `{ label, value }` pairs. Drop a gated label the
 * person did not edit and the profile does not state.
 *
 * @param {{ id?: string, label?: string, value?: string }[]} answers
 * @param {Record<string, unknown>} profile
 * @param {string[]} [editedLabels]
 * @param {{ id?: string, type?: string, label?: string, options?: string[] }[]} [fields]
 * @returns {{ id?: string, label: string, value: string }[]}
 */
function driveKey(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[\s*?:.!-]+$/g, "").trim();
}

/**
 * A full-drive type or select may enter only a value listed for this field.
 * Empty text is allowed: clearing a field is leaving it blank. Punctuation
 * alone is not empty, so a dash is not a clear. A non-empty value needs a
 * field label, so an unlabeled box cannot take another field's answer.
 *
 * @param {string | null | undefined} text
 * @param {{ label?: string, value?: string }[] | null | undefined} answers
 * @param {string | null | undefined} [fieldLabel]
 * @returns {boolean}
 */
export function listedDriveText(text, answers, fieldLabel) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return true;
  const normalized = driveKey(text);
  if (!normalized) return false;
  if (!Array.isArray(answers)) return false;
  const hits = answers.filter((answer) => driveKey(answer?.value) !== "" && driveKey(answer?.value) === normalized);
  if (!hits.length) return false;
  const label = driveKey(fieldLabel);
  if (!label) return false;
  return hits.some((answer) => driveKey(answer?.label) === label);
}

/**
 * A radio or checkbox click on a full drive has to be the listed answer for
 * that question. A button or a link is navigation and stays available. A radio
 * or checkbox with no question label is not clicked.
 *
 * @param {string | null | undefined} kind
 * @param {string | null | undefined} optionLabel
 * @param {string | null | undefined} groupLabel
 * @param {{ label?: string, value?: string }[] | null | undefined} answers
 * @returns {boolean}
 */
export function listedDriveClick(kind, optionLabel, groupLabel, answers) {
  const control = driveKey(kind);
  if (control !== "radio" && control !== "checkbox") return true;
  const group = driveKey(groupLabel);
  const option = driveKey(optionLabel);
  if (!group || !option || !Array.isArray(answers)) return false;
  return answers.some((answer) => driveKey(answer?.label) === group && driveKey(answer?.value) === option);
}

export function prepareLabeledAnswers(answers, profile, editedLabels = [], fields = []) {
  const edited = new Set(editedLabels.map((label) => String(label || "").toLowerCase()));
  const byId = new Map(fields.filter((field) => field?.id).map((field) => [String(field.id), field]));
  return (answers || []).flatMap((answer) => {
    const label = String(answer?.label || "");
    const value = String(answer?.value || "");
    const row = answer?.id ? { id: String(answer.id), label, value } : { label, value };
    if (edited.has(label.toLowerCase())) return [row];
    const known = answer?.id ? byId.get(String(answer.id)) : undefined;
    const field = known || { id: label, type: "text", label };
    const category = classifyApplyQuestion(field);
    if (!category) return [row];
    const stated = statedAnswer(category, field, profile);
    if (!stated) return [];
    return [{ ...row, value: stated }];
  });
}
