// Übersetzt Fehlermeldungen des Backends (das deutsch antwortet) in die gewählte Sprache.
// Feste Texte gehen direkt über t(), Texte mit variablen Teilen über Muster.

import { t } from './i18n';

const PATTERNS: [RegExp, string, string[]][] = [
  [/^Homeegramm (\d+) nicht gefunden$/, 'Homeegramm {n} nicht gefunden', ['n']],
  [/^Homeegramm (\d+) ist nicht in der Sicherung$/, 'Homeegramm {n} ist nicht in der Sicherung', ['n']],
  [/^Keine Verbindung zu homee: (.+)$/, 'Keine Verbindung zu homee: {error}', ['error']],
  [/^Keine Antwort von homee \(erwartet: (.+)\)$/, 'Keine Antwort von homee (erwartet: {what})', ['what']],
  [/^homee meldet (?:warning|error): (.+)$/, 'homee hat den Befehl abgelehnt: {details}', ['details']],
  [/^(\w+) muss eine ganze Zahl sein$/, '{field} muss eine ganze Zahl sein', ['field']],
];

export function translateServerMessage(message: string): string {
  const direct = t(message);
  if (direct !== message) return direct;
  for (const [re, key, names] of PATTERNS) {
    const m = message.match(re);
    if (m) return t(key, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return message;
}
