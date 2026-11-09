export const CV_UPLOAD_ACCEPT = ".pdf,.tex,.md,.markdown,.txt,.docx";
export const MAX_CV_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_CV_SOURCE_CHARS = 60_000;

/** @param {{name: string, size: number}} file */
export function cvUploadError(file) {
  if (!/\.(pdf|tex|md|markdown|txt|docx)$/i.test(file.name)) return "Choose a PDF, TeX, Markdown, text or Word file.";
  if (!file.size) return "That file is empty. Choose a CV with text in it.";
  if (file.size > MAX_CV_UPLOAD_BYTES) return "That file is too large. Choose a CV under 10 MB.";
  return null;
}
