/**
 * `Content-Disposition: inline` for a served file. Header values must be
 * ByteStrings, so a raw "cv-łukasz-….pdf" makes `new Response` throw. The
 * quoted `filename` is an ASCII fallback; `filename*` carries the real name
 * (RFC 6266).
 *
 * @param {string} filename
 * @returns {string}
 */
export function inlineDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "?").replace(/(["\\])/g, "\\$1");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
