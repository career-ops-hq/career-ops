"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, makeT, type Locale, type T } from "@/lib/i18n";

type I18nContextValue = {
  locale: Locale;
  t: T;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const ONE_YEAR = 60 * 60 * 24 * 365;

// The server resolves the locale (cookie → env → en) and passes it down, so the
// first client render matches the server HTML and nothing flashes in English.
export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
      document.documentElement.lang = next;
      // Server components read the cookie; refresh re-renders them in place
      // without dropping client state (open panels, running jobs).
      router.refresh();
    },
    [router],
  );

  const value = useMemo(() => ({ locale, t: makeT(locale), setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useT/useLocale must be used inside I18nProvider");
  return context;
}

export function useT(): T {
  return useI18n().t;
}

export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
}
