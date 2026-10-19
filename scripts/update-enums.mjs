// Aktualisiert packages/homee-client/src/enums.ts aus der homee-Web-App (https://my.hom.ee).
// Die Web-App enthält alle Zahlencodes der homee-Schnittstelle als Objekt `var ENUMS={…}`.
// Das Objekt wird nur als Daten gelesen (nicht ausgeführt). Aufruf: npm run update-enums
//
// Optional: node scripts/update-enums.mjs <lokale app.min.js>   (statt herunterzuladen)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://my.hom.ee/scripts/app.min.js';
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/homee-client/src/enums.ts');

const bundle = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : await fetch(SOURCE, { signal: AbortSignal.timeout(60_000) }).then((r) => {
      if (!r.ok) throw new Error(`Download fehlgeschlagen: HTTP ${r.status}`);
      return r.text();
    });

/** Schneidet das Objektliteral nach `var ENUMS=` heraus (Klammern zählen, Strings überspringen). */
function extractLiteral(src) {
  const start = src.indexOf('var ENUMS={');
  if (start < 0) throw new Error('`var ENUMS={` nicht gefunden – hat sich der Aufbau der Web-App geändert?');
  const from = src.indexOf('{', start);
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error('Ende des ENUMS-Objekts nicht gefunden');
}

/** Minifiziertes Objektliteral → JSON (Schlüssel quoten, '…' → "…", !0/!1 → true/false, .5 → 0.5). */
function toJson(literal) {
  return literal
    .replace(/'([^'\\]*)'/g, (_, s) => JSON.stringify(s))
    .replace(/([{,])\s*([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/:!0\b/g, ':true')
    .replace(/:!1\b/g, ':false')
    .replace(/:(-?)\.(\d)/g, ':$10.$2');
}

const enums = JSON.parse(toJson(extractLiteral(bundle)));
const tables = Object.keys(enums);
if (!enums.CAAttributeType || !enums.CANodeProfile) throw new Error('Erwartete Tabellen fehlen – Abbruch, enums.ts bleibt unverändert');

const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
const value = (v) => (typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : JSON.stringify(v));
const body = tables
  .map((t) => `  ${key(t)}: {\n${Object.entries(enums[t]).map(([k, v]) => `    ${key(k)}: ${value(v)},`).join('\n')}\n  },`)
  .join('\n');

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  target,
  `// Zahlencodes der homee-Schnittstelle – automatisch erzeugt mit \`npm run update-enums\`, nicht von Hand ändern.
// Quelle: homee-Web-App (${SOURCE}), abgerufen am ${today}.
// Ursprünglich übernommen aus https://github.com/stfnhmplr/homee-api (MIT-Lizenz, Autor: Stefan Himpler).

export const Enums = {
${body}
} as const;
`,
);
console.log(`${tables.length} Tabellen, ${Object.keys(enums.CAAttributeType).length} Attributtypen, ${Object.keys(enums.CANodeProfile).length} Geräteprofile → ${target}`);
