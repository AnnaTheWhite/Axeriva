import { createContext, useContext, useEffect, useMemo, useState } from "react";
import en from "./en.json";
import hu from "./hu.json";

// Adding a new language later is a translation-file-only change: drop a
// new JSON file next to en.json/hu.json (same key shape) and register it
// here — no page component needs to change.
export const LANGUAGES = ["en", "hu"] as const;
export type Language = (typeof LANGUAGES)[number];

const DICTIONARIES: Record<Language, Record<string, unknown>> = { en, hu };

const DEFAULT_LANGUAGE: Language = "en";
const STORAGE_KEY = "axeriva.language";

function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

function getInitialLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
}

// Looks up "a.b.c" inside a nested dictionary object.
function resolveKey(dict: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (typeof node === "object" && node !== null && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match
  );
}

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: TranslateFn;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  const t = useMemo<TranslateFn>(() => {
    return (key, vars) => {
      const dict = DICTIONARIES[language];
      const fallbackDict = DICTIONARIES[DEFAULT_LANGUAGE];
      const value = resolveKey(dict, key) ?? resolveKey(fallbackDict, key);
      if (typeof value !== "string") return key;
      return interpolate(value, vars);
    };
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage: setLanguageState, t }),
    [language, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// Single hook for both reading translations and switching language —
// components never import en.json/hu.json directly.
export function useTranslation(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within a LanguageProvider");
  }
  return ctx;
}
