/**
 * upload-name.mjs — the file name an employer sees for the tailored CV the
 * apply flow attaches (#6399).
 *
 * The PDF on disk is named for career-ops, `cv-{candidate}-{report}-{company}-
 * {date}.pdf`, and the manifest and matchers (cv-match.mjs) depend on that
 * pattern, so it never changes. What changes is the name the upload carries:
 * fillSession hands Playwright a file payload (name + bytes) instead of the
 * path, so the ATS receives `First-Last-Role-CV.pdf` while the file on disk
 * keeps its own name.
 *
 * Plain .mjs (same pattern as cv-match.mjs) so the tests under web/tests/lib/
 * can import it with no build step.
 */

import fs from 'node:fs';

/**
 * "José Müller" -> "Jose-Muller": Latin accents dropped, any run that is not a
 * letter, mark or digit becomes "-". Letters of every script stay, so
 * "Иван Петров" -> "Иван-Петров" and "张伟" -> "张伟" (#6478 follow-up).
 * Only a mark on a Latin letter is dropped: the breve of "й" or the accent
 * of Greek "ά" is part of the letter, so "Йосиф" stays "Йосиф".
 * With recaseCaps (the candidate's name), an all-caps word of 2+ letters is a
 * surname typed in capitals and is recased: "Jane DOE" -> "Jane-Doe". Without
 * it (the role), words keep their casing, so acronyms such as BI, HRIS or
 * COBOL stay as written.
 * @param {string} s
 * @param {{ recaseCaps?: boolean }} [opts]
 * @returns {string}
 */
export function fileWords(s, { recaseCaps = false } = {}) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/(\p{Script=Latin})[\u0300-\u036f]+/gu, '$1')
    .normalize('NFC')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => (recaseCaps && w.length >= 2 && /\p{Lu}/u.test(w) && !/\p{Ll}/u.test(w)
      ? w[0] + w.slice(1).toLowerCase()
      : w))
    .join('-');
}

/**
 * The role, cut at its first qualifier: "Data Engineer, Data Quality &
 * Provenance" -> "Data Engineer", "Analyst (Remote)" -> "Analyst",
 * "Data Engineer - Talent Ops" -> "Data Engineer". A form title such as
 * "Data Engineer @ Acme" or "Analyst at Acme" loses the company first.
 * @param {string} role
 * @returns {string}
 */
export function shortRole(role) {
  const withoutCompany = String(role ?? '').split(/\s+@\s+|\s+at\s+(?=[A-Z])/)[0];
  return withoutCompany.split(/\s*(?:,|\(|\s[-–—|]\s)/)[0].trim();
}

/**
 * `First-Last-Role-CV.pdf`, dropping whichever part is unknown: no role gives
 * `First-Last-CV.pdf`, no name `Role-CV.pdf`, neither `CV.pdf`.
 * @param {{ fullName?: string, role?: string }} opts
 * @returns {string}
 */
export function cvUploadName({ fullName, role } = {}) {
  return [fileWords(fullName ?? '', { recaseCaps: true }), fileWords(shortRole(role ?? '')), 'CV'].filter(Boolean).join('-') + '.pdf';
}

/**
 * What fillSession passes to setInputFiles: the path itself when there is no
 * display name, else Playwright's file payload carrying that name and the
 * file's bytes. Reading the bytes leaves the file on disk untouched.
 * @param {string} cvPath
 * @param {string} [uploadName]
 * @returns {string | { name: string, mimeType: string, buffer: Buffer }}
 */
export function cvUploadFile(cvPath, uploadName) {
  if (!uploadName) return cvPath;
  return { name: uploadName, mimeType: 'application/pdf', buffer: fs.readFileSync(cvPath) };
}
