export function reopenApplyOptions(nextUrl, current = {}) {
  if (typeof nextUrl !== "string" || !nextUrl || nextUrl !== current.url) return undefined;
  const opts = {};
  if (current.n) opts.n = current.n;
  if (current.from) opts.from = current.from;
  if (current.company) opts.company = current.company;
  return opts.n || opts.from || opts.company ? opts : undefined;
}
