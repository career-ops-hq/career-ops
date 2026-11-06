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
 * "Jane DOE" -> "Jane-Doe": accents dropped, any other non-alphanumeric run
 * becomes "-". An all-caps word of 5+ letters (a surname typed in capitals) is
 * recased; shorter all-caps words are acronyms (BI, SQL, HRIS) and stay.
 * @param {string} s
 * @returns {string}
 */
export function fileWords(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length >= 5 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
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
  return [fileWords(fullName ?? ''), fileWords(shortRole(role ?? '')), 'CV'].filter(Boolean).join('-') + '.pdf';
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
