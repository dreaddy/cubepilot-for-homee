// Laufzeit-Übersetzung DE/EN. Der deutsche Text ist zugleich der Schlüssel, Englisch steht in i18n.en.ts.
// t() liest das Signal `lang` – Templates und computed() aktualisieren sich beim Umschalten automatisch.

import { signal } from '@angular/core';
import { EN } from './i18n.en';

export type Lang = 'de' | 'en';

const STORAGE_KEY = 'homee-lang';

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    // localStorage nicht verfügbar
  }
  // Standard: Englisch (Deutsch per Umschalter, die Wahl wird gemerkt)
  return 'en';
}

export const lang = signal<Lang>(initialLang());
document.documentElement.lang = lang();

export function setLang(l: Lang): void {
  lang.set(l);
  document.documentElement.lang = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    // ignorieren
  }
}

/** Locale für toLocaleString & Co. */
export const locale = (): string => (lang() === 'de' ? 'de-DE' : 'en-GB');

/**
 * Übersetzt einen deutschen Text. Platzhalter: t('„{name}“ aktiviert', { name }).
 * Fehlt eine Übersetzung, bleibt der deutsche Text stehen.
 */
export function t(text: string, params?: Record<string, string | number>): string {
  const s = lang() === 'en' ? (EN[text] ?? text) : text;
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}
