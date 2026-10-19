// Lesen und Schreiben der homee-Zugangsdaten in .env, gemeinsam für Einrichtung (CLI) und Backend (Web-Einrichtung).
// Bewusst ohne config.ts, damit es auch ohne vorhandene .env funktioniert.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HomeeClient, decode } from '@cubepilot/client';

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const envFile = resolve(rootDir, '.env');
const exampleFile = resolve(rootDir, '.env.example');

const ADMIN_ROLE = 2;

export type HomeeMode = 'local' | 'remote';

export interface HomeeCredentials {
  mode: HomeeMode;
  ip: string;
  homeeId: string;
  user: string;
  password: string;
}

export interface ConnectionTest {
  ok: boolean;
  error?: string;
  homeeName?: string;
  version?: string;
  nodes?: number;
  /** aus den homee-Einstellungen gelesen, auch im lokalen Modus */
  homeeId?: string;
  isAdmin?: boolean;
}

/** IP-Eingabe bereinigen: http://, Port und Pfad entfernen. */
export const cleanIp = (v: string) => v.trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
export const cleanHomeeId = (v: string) => v.trim().replace(/[\s:-]/g, '');

/** Prüft die Eingaben, liefert eine Fehlermeldung oder null. */
export function validateCredentials(c: HomeeCredentials): string | null {
  if (c.mode === 'local' && !/^[\w.-]+$/.test(cleanIp(c.ip))) return 'Das sieht nicht nach einer IP-Adresse aus.';
  if (c.mode === 'remote' && !/^[0-9a-zA-Z]{12}$/.test(cleanHomeeId(c.homeeId))) {
    return 'Die homee-ID hat genau 12 Zeichen (Ziffern und Buchstaben).';
  }
  if (!c.user.trim()) return 'Bitte einen Benutzernamen angeben.';
  if (!c.password) return 'Bitte ein Passwort angeben.';
  return null;
}

export const hostOf = (c: HomeeCredentials) => (c.mode === 'remote' ? cleanHomeeId(c.homeeId) : cleanIp(c.ip));

/** Meldet sich testweise an und trennt sofort wieder. */
export async function testConnection(c: HomeeCredentials, deviceName: string): Promise<ConnectionTest> {
  const homee = new HomeeClient({ host: hostOf(c), user: c.user.trim(), password: c.password, deviceName });
  try {
    await homee.connect();
  } catch (err) {
    const msg = (err as Error).message;
    // homee sperrt die Anmeldung nach einem Fehlversuch für ein paar Sekunden (blockTime)
    if (/temporar/i.test(msg)) return { ok: false, error: 'homee hat die Anmeldung nach einem Fehlversuch kurz gesperrt. Bitte in ein paar Sekunden erneut versuchen.' };
    return { ok: false, error: msg.includes('HTTP 401') ? 'Benutzername oder Passwort falsch.' : msg };
  } finally {
    homee.disconnect();
  }
  const s = homee.state;
  const me = s.users.find((u) => decode(u.username).toLowerCase() === c.user.trim().toLowerCase());
  return {
    ok: true,
    homeeName: decode(s.settings?.homee_name) || 'homee',
    version: String(s.settings?.version ?? '?'),
    nodes: s.nodes.filter((n) => n.id !== -1).length,
    homeeId: s.settings?.uid ? String(s.settings.uid) : undefined,
    isAdmin: me?.role === ADMIN_ROLE,
  };
}

/** Wert so schreiben, dass process.loadEnvFile ihn unverändert zurückliest. */
export function envValue(v: string): string {
  if (/[\r\n\0]/.test(v)) throw new Error('Zugangsdaten dürfen keine Zeilenumbrüche oder Nullzeichen enthalten.');
  if (/^[\w.@:/+-]*$/.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('"')) return `"${v}"`;
  if (!v.includes('`')) return `\`${v}\``;
  throw new Error('Dieser Wert kann nicht sicher in .env gespeichert werden (enthält alle drei Anführungszeichen).');
}

/** Setzt die angegebenen Schlüssel in .env; Kommentare und übrige Einstellungen bleiben erhalten. */
export function writeEnv(values: Record<string, string>): void {
  let text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : existsSync(exampleFile) ? readFileSync(exampleFile, 'utf8') : '';
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${envValue(value)}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
  }
  writeFileSync(envFile, text, { mode: 0o600 });
}

/** Schreibt die homee-Zugangsdaten. homeeId aus dem Verbindungstest hat Vorrang (auch im lokalen Modus nützlich). */
export function saveCredentials(c: HomeeCredentials, detectedHomeeId?: string): void {
  const values = {
    HOMEE_MODE: c.mode,
    HOMEE_IP: c.mode === 'local' ? cleanIp(c.ip) : '',
    HOMEE_ID: detectedHomeeId || cleanHomeeId(c.homeeId),
    HOMEE_USER: c.user.trim(),
    HOMEE_PASSWORD: c.password,
  };
  writeEnv(values);
  // auch im laufenden Prozess, z. B. für den Fernzugriffs-Link in /api/webhook-url
  Object.assign(process.env, values);
}
