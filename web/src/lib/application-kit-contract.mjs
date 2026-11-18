/**
 * Keep absent model scores distinct from a genuine zero score.
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeMatchScore(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(5, Math.max(0, value))
    : null;
}

const PATCH_KEYS = new Set(["id", "coverLetter", "outreach", "answers", "cvFile"]);
const OUTREACH_KEYS = new Set([
  "linkedinRecruiterNote",
  "linkedinHiringManagerMessage",
  "referralRequestMessage",
  "hiringManagerColdEmailSubject",
  "hiringManagerColdEmail",
  "postApplicationEmailSubject",
  "postApplicationEmail",
]);
const MAX_PATCH_BYTES = 120_000;
const MAX_COVER_LETTER = 40_000;
const MAX_OUTREACH_FIELD = 20_000;
const MAX_ANSWERS = 100;
const MAX_ANSWER_QUESTION = 4_000;
const MAX_ANSWER = 20_000;
const MAX_CV_FILE = 500;

function boundedString(value, max, field) {
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  if (value.length > max) return { error: `${field} is too large.` };
  return { value };
}

function validateOutreach(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "outreach must be an object." };
  }
  for (const key of Object.keys(value)) {
    if (!OUTREACH_KEYS.has(key)) return { error: `Unexpected outreach field: ${key}.` };
    const result = boundedString(value[key], MAX_OUTREACH_FIELD, `outreach.${key}`);
    if (result.error) return result;
  }
  return { value: Object.fromEntries(Object.entries(value)) };
}

function validateAnswers(value) {
  if (!Array.isArray(value)) return { error: "answers must be an array." };
  if (value.length > MAX_ANSWERS) return { error: "answers contains too many entries." };
  const answers = [];
  for (const answer of value) {
    if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
      return { error: "Each answer must be an object." };
    }
    if (Object.keys(answer).some((key) => !["question", "answer", "needsConfirmation"].includes(key))) {
      return { error: "Each answer contains an unexpected field." };
    }
    const question = boundedString(answer.question, MAX_ANSWER_QUESTION, "answer.question");
    const text = boundedString(answer.answer, MAX_ANSWER, "answer.answer");
    if (question.error) return question;
    if (text.error) return text;
    if (answer.needsConfirmation !== undefined && typeof answer.needsConfirmation !== "boolean") {
      return { error: "answer.needsConfirmation must be a boolean." };
    }
    answers.push({
      question: question.value,
      answer: text.value,
      ...(answer.needsConfirmation === undefined ? {} : { needsConfirmation: answer.needsConfirmation }),
    });
  }
  return { value: answers };
}

/** Validate and copy the user-editable PATCH payload before any file access. */
export function validatePatchPayload(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Invalid request body." };
  }
  if (JSON.stringify(body).length > MAX_PATCH_BYTES) return { error: "Request body is too large." };
  for (const key of Object.keys(body)) {
    if (!PATCH_KEYS.has(key)) return { error: `Unexpected field: ${key}.` };
  }
  if (typeof body.id !== "string" || !/^[a-z0-9-]+$/.test(body.id)) {
    return { error: "Invalid application kit." };
  }
  const value = { id: body.id };
  if (body.coverLetter !== undefined) {
    const result = boundedString(body.coverLetter, MAX_COVER_LETTER, "coverLetter");
    if (result.error) return result;
    value.coverLetter = result.value;
  }
  if (body.outreach !== undefined) {
    const result = validateOutreach(body.outreach);
    if (result.error) return result;
    value.outreach = result.value;
  }
  if (body.answers !== undefined) {
    const result = validateAnswers(body.answers);
    if (result.error) return result;
    value.answers = result.value;
  }
  if (body.cvFile !== undefined) {
    const result = boundedString(body.cvFile, MAX_CV_FILE, "cvFile");
    if (result.error) return result;
    if (!result.value.startsWith("data/application-kits/") || result.value.includes("..") || result.value.includes("\\")) {
      return { error: "cvFile must point to a relative application-kit Markdown file." };
    }
    value.cvFile = result.value;
  }
  return { value };
}
