// A UI hint, not an authorization or validation decision. Users can always
// choose the other type because job sites do not share one URL convention.
export function suggestPortalUrlKind(raw) {
  const first = String(raw || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
  if (!first) return null;
  let url;
  try { url = new URL(first); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (/(^|\.)linkedin\.com$/.test(host)) {
    if (/^\/(?:comm\/)?jobs\/view\//.test(url.pathname) || /^\d+$/.test(url.searchParams.get('currentJobId') || '')) return 'job';
    return 'website';
  }
  if (/^jobs\.(?:ashbyhq\.com|(?:eu\.)?lever\.co)$/.test(host) && parts.length >= 2) return 'job';
  if (/(?:^|\/)(?:job|jobs|position|positions|vacancy|vacancies|stellenangebot)\/(?:[^/]*\d[^/]*|[^/]+\/[^/]+)/i.test(url.pathname)) return 'job';
  return 'website';
}
