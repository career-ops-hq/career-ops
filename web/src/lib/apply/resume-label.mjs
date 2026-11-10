/**
 * Whether a file field's label asks for the candidate's résumé, the one upload
 * the apply flow attaches itself. Shared by the fill step (`session.ts`) and the
 * review screen (`apply-view.tsx`) so the badge and the upload agree. Covers the
 * locales the repo ships modes for; other uploads stay with the person.
 */
const RESUME_LABEL_RX =
  /resume|résumé|\bcv\b|curr[ií]cul(?:um|o)|lebenslauf|резюме|życiorys|özgeçmiş|履歴書|職務経歴書|简历|簡歷|履歷|이력서|السيرة الذاتية|रिज्यूमे|बायोडाटा|riwayat hidup/iu;

/** @param {string | undefined} label */
export function isResumeLabel(label) {
  return RESUME_LABEL_RX.test(label || "");
}
