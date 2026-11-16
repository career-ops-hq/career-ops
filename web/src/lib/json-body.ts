// A route that reads fields off its body needs a JSON object. `null`, arrays
// and scalars parse fine but throw on the first property read, which surfaced
// as a 500 instead of the route's own 400.
export async function readJsonObject<T extends object = Record<string, unknown>>(req: Request): Promise<T | null> {
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    return null;
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as T) : null;
}
