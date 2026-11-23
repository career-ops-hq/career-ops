// A route that reads fields off its body needs a JSON object. `null`, arrays
// and scalars parse fine but throw on the first property read, which surfaced
// as a 500 instead of the route's own 400.
//
// `maxBytes` (optional) counts the bytes as they arrive and gives up past the cap, so an
// oversized request is never buffered in full. Without it the behaviour is unchanged.
export async function readJsonObject<T extends object = Record<string, unknown>>(
  req: Request,
  opts: { maxBytes?: number } = {},
): Promise<T | null> {
  let value: unknown;
  try {
    if (opts.maxBytes === undefined) {
      value = await req.json();
    } else {
      const text = await readTextUpTo(req, opts.maxBytes);
      if (text === null) return null;
      value = JSON.parse(text);
    }
  } catch {
    return null;
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as T) : null;
}

async function readTextUpTo(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
