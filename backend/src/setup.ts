// Einrichtung: fragt die homee-Zugangsdaten ab, testet die Verbindung und schreibt .env.
// Aufruf: npm run configure                -> immer (bei vorhandener .env mit Rückfrage)
//         tsx backend/src/setup.ts --if-missing -> nur, wenn noch keine .env existiert (für npm start usw.)
// Im laufenden Betrieb geht das auch in der Weboberfläche unter „Einrichtung“.

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  cleanHomeeId,
  cleanIp,
  envFile,
  saveCredentials,
  testConnection,
  validateCredentials,
  type HomeeCredentials,
} from './env-file.ts';

const ifMissing = process.argv.includes('--if-missing');

if (existsSync(envFile) && ifMissing) process.exit(0);

if (!process.stdin.isTTY) {
  console.error('Keine .env gefunden. Bitte einmal "npm run configure" im Terminal ausführen oder .env.example nach .env kopieren.');
  process.exit(1);
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function abort(): never {
  console.log('\nAbgebrochen, es wurde nichts gespeichert.');
  process.exit(130);
}

async function ask(label: string, def = ''): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', abort);
  const answer = await rl.question(`${label}${def ? dim(` [${def}]`) : ''}: `);
  rl.close();
  return answer.trim() || def;
}

async function askRequired(label: string, def = '', check?: (v: string) => string | null): Promise<string> {
  for (;;) {
    const v = await ask(label, def);
    const problem = !v ? 'Bitte ausfüllen.' : check?.(v);
    if (!problem) return v;
    console.log(red(`  ${problem}`));
  }
}

async function confirm(label: string, def: boolean): Promise<boolean> {
  const v = (await ask(`${label} ${dim(def ? '(J/n)' : '(j/N)')}`)).toLowerCase();
  return v ? ['j', 'ja', 'y', 'yes'].includes(v) : def;
}

/** Liest ein Passwort ohne Echo (Sterne statt Zeichen). Leere Eingabe übernimmt def. */
function askPassword(label: string, def = ''): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(`${label}${def ? dim(' [unverändert]') : ''}: `);
  return new Promise((done) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          abort();
        } else if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          done(value || def);
          return;
        } else if (ch === '\u007f' || ch === '\b') {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          value += ch;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

function existingEnv(): Record<string, string | undefined> {
  if (!existsSync(envFile)) return {};
  try {
    process.loadEnvFile(envFile);
  } catch {
    return {};
  }
  return process.env;
}

// --- Ablauf ---

console.log(`\n${bold('CubePilot for homee – Einrichtung')}\n`);

if (existsSync(envFile)) {
  console.log('Es gibt bereits eine .env.');
  if (!(await confirm('homee-Zugangsdaten neu einrichten?', false))) process.exit(0);
  console.log(dim('Leere Eingabe übernimmt den bisherigen Wert in [Klammern]; übrige Einstellungen bleiben erhalten.\n'));
} else {
  console.log('Es gibt noch keine .env. Ein paar Angaben, dann kann es losgehen.\n');
}

console.log(yellow('Empfehlung: Lege für dieses Tool einen eigenen homee-Benutzer an (homee-App → Einstellungen →'));
console.log(yellow('Benutzer → Benutzer hinzufügen), statt den Admin-Zugang zu verwenden. So siehst du im homee,'));
console.log(yellow('was das Tool geändert hat, kannst ihm den Zugriff jederzeit entziehen, und dein Admin-Passwort'));
console.log(yellow('liegt nicht im Klartext in der .env. Der Admin-Zugang funktioniert aber auch.\n'));

const old = existingEnv();
const c: HomeeCredentials = {
  mode: old.HOMEE_MODE === 'remote' ? 'remote' : 'local',
  ip: old.HOMEE_IP ?? '',
  homeeId: old.HOMEE_ID ?? '',
  user: old.HOMEE_USER ?? '',
  password: old.HOMEE_PASSWORD ?? '',
};
const deviceName = old.HOMEE_DEVICE_NAME || 'cubepilot-for-homee';
let detectedId: string | undefined;

for (;;) {
  console.log('Wie soll die Verbindung laufen?');
  console.log(`  1) lokal im Heimnetz über die IP-Adresse ${dim('(schneller, empfohlen)')}`);
  console.log(`  2) über die homee-Cloud mit der homee-ID ${dim('(funktioniert auch unterwegs)')}`);
  const choice = await askRequired('Auswahl', c.mode === 'remote' ? '2' : '1', (v) => (['1', '2'].includes(v) ? null : 'Bitte 1 oder 2 eingeben.'));
  c.mode = choice === '2' ? 'remote' : 'local';

  if (c.mode === 'local') {
    c.ip = cleanIp(await askRequired('IP-Adresse des homee', c.ip, (ip) => validateCredentials({ ...c, ip, user: 'x', password: 'x' })));
  } else {
    console.log(dim('  Die homee-ID findest du in der homee-App unter Einstellungen → homee (12 Zeichen).'));
    c.homeeId = cleanHomeeId(await askRequired('homee-ID', c.homeeId, (homeeId) => validateCredentials({ ...c, homeeId, user: 'x', password: 'x' })));
  }

  c.user = await askRequired('Benutzername', c.user);
  c.password = await askPassword('Passwort', c.password);
  if (!c.password) {
    console.log(red('  Ohne Passwort geht es nicht.\n'));
    continue;
  }

  console.log(`\nTeste die Verbindung …`);
  const result = await testConnection(c, `${deviceName}-setup`);

  if (result.ok) {
    console.log(green(`✓ Verbunden mit „${result.homeeName}“, Version ${result.version}, ${result.nodes} Geräte`));
    detectedId = result.homeeId;
    if (result.isAdmin) {
      console.log(yellow(`  Hinweis: „${c.user}“ ist ein Admin-Benutzer. Das funktioniert, empfohlen ist aber ein eigener Benutzer.`));
    }
    break;
  }

  console.log(red(`✗ ${result.error}`));
  console.log(dim('  Häufige Ursachen: Tippfehler bei Benutzer/Passwort, falsche IP, homee nicht im selben Netz.'));
  const next = (await ask(`\n[W]iederholen, trotzdem [s]peichern oder [a]bbrechen? ${dim('(W/s/a)')}`)).toLowerCase();
  if (next === 's') break;
  if (next === 'a') abort();
  console.log('');
}

saveCredentials(c, detectedId);

console.log(green(`\n✓ Gespeichert in ${envFile}`));
console.log(`Weitere Einstellungen (Port, API-Token, Nur-Lesen-Modus) kannst du dort direkt anpassen.`);
console.log(`Später lassen sich die Zugangsdaten auch in der Weboberfläche unter „Einrichtung“ ändern.\n`);
process.exit(0);
