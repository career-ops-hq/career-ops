import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, makeT, normalizeLocale, type Locale, type T } from "@/lib/i18n";

// Precedence: the viewer's choice (cookie, set by the sidebar switch) beats the
// install default (CAREER_OPS_LOCALE in web/.env.local), which beats English.
export async function getLocale(): Promise<Locale> {
  const fallback = normalizeLocale(process.env.CAREER_OPS_LOCALE, DEFAULT_LOCALE);
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value, fallback);
}

export async function getT(): Promise<T> {
  return makeT(await getLocale());
}
