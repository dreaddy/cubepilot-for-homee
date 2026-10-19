// Fernzugang für Sprachassistenten (z. B. eigener GPT mit Actions in ChatGPT).
//
// Rechte kommen ausschließlich aus homee: Der Dienst meldet sich mit einem eigenen, eingeschränkten homee-Benutzer an
// und sieht/steuert nur, was diesem Benutzer in homee freigegeben ist. Hier gibt es nur Absicherung (Schlüssel,
// Zugriffslimit, Protokoll), keine eigene Rechteverwaltung.
// Lauscht nur lokal; nach außen nur über einen Tunnel (z. B. Cloudflare) freigeben.

import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { HomeeClient, decode, enumName, type HomeeAttribute, type HomeeNode } from '@cubepilot/client';

// ---------------------------------------------------------------- Konfiguration

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (existsSync(resolve(rootDir, '.env'))) process.loadEnvFile(resolve(rootDir, '.env'));

// Derzeit deaktiviert – nur bewusst einschalten (siehe remote/EINRICHTUNG.md)
if (process.env.REMOTE_ENABLED !== 'true') {
  console.log('Fernzugang ist deaktiviert (REMOTE_ENABLED=true setzen, siehe remote/EINRICHTUNG.md).');
  process.exit(0);
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Umgebungsvariable ${name} fehlt (siehe remote/EINRICHTUNG.md)`);
  return v;
}

const mode = (process.env.HOMEE_MODE || 'local').toLowerCase();
const config = {
  homee: {
    host: mode === 'remote' ? env('HOMEE_ID') : env('HOMEE_IP'),
    user: env('REMOTE_HOMEE_USER'),
    password: env('REMOTE_HOMEE_PASSWORD'),
    deviceName: process.env.REMOTE_HOMEE_DEVICE_NAME || 'homee-remote',
  },
  port: Number(process.env.REMOTE_PORT || 5312),
  apiKey: env('REMOTE_API_KEY'),
  publicUrl: (process.env.REMOTE_PUBLIC_URL || `http://127.0.0.1:${process.env.REMOTE_PORT || 5312}`).replace(/\/$/, ''),
  rateLimitPerMinute: Number(process.env.REMOTE_RATE_LIMIT || 30),
  readOnly: ['1', 'true', 'yes'].includes((process.env.READ_ONLY ?? '').toLowerCase()),
};
if (!Number.isInteger(config.rateLimitPerMinute) || config.rateLimitPerMinute < 1) throw new Error('REMOTE_RATE_LIMIT muss eine positive ganze Zahl sein');
if (config.apiKey.length < 32) throw new Error('REMOTE_API_KEY muss mindestens 32 Zeichen lang sein');
if (config.homee.user === process.env.HOMEE_USER) {
  console.warn('WARNUNG: REMOTE_HOMEE_USER ist derselbe Benutzer wie HOMEE_USER – für den Fernzugang einen eigenen, eingeschränkten homee-Benutzer anlegen.');
}

// ---------------------------------------------------------------- homee

const homee = new HomeeClient(config.homee);
const app = Fastify({ logger: { level: 'info' }, bodyLimit: 8192 });

homee.on('connected', () => app.log.info(`Mit homee verbunden als „${config.homee.user}“`));
homee.on('error', (err: Error) => app.log.error(`homee: ${err.message}`));

/** Rein technische Attribute – nur ausgeblendet, damit die KI nicht durcheinanderkommt (keine Rechtefrage). */
const TECHNICAL = /^(LinkQuality|SoftwareRevision|FirmwareRevision|IdentificationMode|WatchdogOnOff|RestoreLastKnownState|EndPositionConfiguration|PollingInterval|WakeUpInterval|MemoryUsage|ProcessorUtilization|UsedStorage|StorageAlarm|ColorMode|.*ReportInterval|PresenceAlarmCancelationDelay|HighTemperatureAlarmTreshold|Forecast.*|SunriseTime|SunsetTime)$/;

/** Bedeutung bekannter Werte, damit die KI „hoch“, „aus“ usw. richtig zuordnet. */
const VALUE_MEANING: Record<string, Record<number, string>> = {
  OnOff: { 0: 'aus', 1: 'an' },
  Position: { 0: 'ganz offen', 100: 'ganz geschlossen' },
  UpDown: { 0: 'öffnen', 1: 'schließen', 2: 'stoppen' },
  LockState: { 0: 'entriegelt', 1: 'verriegelt' },
  HomeeMode: { 0: 'zuhause', 1: 'nacht', 2: 'abwesend', 3: 'urlaub' },
  OpenClose: { 0: 'geschlossen', 1: 'offen' },
};

function attributeInfo(a: HomeeAttribute) {
  const type = enumName('CAAttributeType', a.type);
  const unit = decode(a.unit);
  return {
    attributeId: a.id,
    type,
    ...(a.instance > 0 && { instance: a.instance }),
    value: a.current_value,
    ...(a.editable === 1 && a.target_value !== a.current_value && { targetValue: a.target_value }),
    ...(unit && unit !== 'n/a' && unit !== 'text' && { unit }),
    ...(a.editable === 1 && { min: a.minimum, max: a.maximum, step: a.step_value }),
    ...(VALUE_MEANING[type] && { meaning: VALUE_MEANING[type] }),
  };
}

function deviceInfo(n: HomeeNode) {
  const attrs = n.attributes.filter((a) => !TECHNICAL.test(enumName('CAAttributeType', a.type)));
  return {
    id: n.id,
    name: n.id === -1 ? 'homee' : decode(n.name),
    kind: enumName('CANodeProfile', n.profile),
    reachable: n.state === 1,
    controls: attrs.filter((a) => a.editable === 1).map(attributeInfo),
    readings: attrs.filter((a) => a.editable !== 1).map(attributeInfo),
  };
}

// ---------------------------------------------------------------- Absicherung

const keyBuf = Buffer.from(config.apiKey);
function validKey(header: string | undefined): boolean {
  const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''));
  return given.length === keyBuf.length && timingSafeEqual(given, keyBuf);
}

const hits: number[] = [];
function rateLimited(): boolean {
  const now = Date.now();
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= config.rateLimitPerMinute) return true;
  hits.push(now);
  return false;
}

app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/openapi.json' || req.url === '/health') return;
  if (!validKey(req.headers.authorization)) {
    app.log.warn(`Abgewiesen (falscher Schlüssel) von ${req.headers['cf-connecting-ip'] ?? req.ip}`);
    return reply.code(401).send({ error: 'Nicht autorisiert' });
  }
  if (rateLimited()) return reply.code(429).send({ error: 'Zu viele Anfragen, bitte kurz warten' });
  if (!homee.connected || !homee.ready) return reply.code(503).send({ error: 'Keine Verbindung zu homee' });
});

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  reply.code(err.statusCode ?? 500).send({ error: err.message });
});

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

async function audit(action: string, details: unknown, ok: boolean, error?: string): Promise<void> {
  const dataDir = resolve(rootDir, 'data');
  await mkdir(dataDir, { recursive: true });
  await appendFile(
    resolve(dataDir, 'audit.jsonl'),
    JSON.stringify({ at: new Date().toISOString(), source: 'remote', action, details, ok, ...(error && { error }) }) + '\n',
  );
}

// ---------------------------------------------------------------- Endpunkte

app.get('/health', async () => ({ ok: homee.connected && homee.ready }));

/** Alles, was der homee-Benutzer sehen darf. */
app.get('/devices', async () => homee.state.nodes.map(deviceInfo));

app.post<{ Body: { commands: { deviceId: number; attributeId: number; value: number }[] } }>('/control', async (req) => {
  if (config.readOnly) throw fail(403, 'READ_ONLY=true');
  const commands = req.body?.commands;
  if (!Array.isArray(commands) || !commands.length || commands.length > 30) throw fail(400, 'commands: 1 bis 30 Befehle');

  // Erst alles prüfen, dann ausführen
  const checked = commands.map((c) => {
    const node = homee.state.nodes.find((n) => n.id === Number(c.deviceId));
    const a = node?.attributes.find((x) => x.id === Number(c.attributeId));
    if (!node || !a) throw fail(404, `Gerät ${c.deviceId} / Attribut ${c.attributeId} nicht gefunden oder nicht freigegeben`);
    if (a.editable !== 1) throw fail(400, `${enumName('CAAttributeType', a.type)} von „${decode(node.name)}“ ist nicht steuerbar`);
    const value = Number(c.value);
    if (typeof c.value !== 'number' || !Number.isFinite(value) || value < a.minimum || value > a.maximum) {
      throw fail(400, `Wert für ${enumName('CAAttributeType', a.type)} muss zwischen ${a.minimum} und ${a.maximum} liegen`);
    }
    return { node, a, value };
  });

  const results: string[] = [];
  try {
    for (const { node, a, value } of checked) {
      // homee prüft die Rechte des Benutzers; eine Ablehnung kommt hier als Fehler zurück
      await homee.request(`PUT:nodes/${node.id}/attributes/${a.id}?target_value=${value}`, ['attribute', 'node'], 5000).catch((err: Error) => {
        if (!err.message.startsWith('Keine Antwort')) throw err;
      });
      results.push(`${decode(node.name)}: ${enumName('CAAttributeType', a.type)} → ${VALUE_MEANING[enumName('CAAttributeType', a.type)]?.[value] ?? value}`);
    }
    await audit('control', { commands }, true);
  } catch (err) {
    await audit('control', { commands }, false, (err as Error).message);
    throw fail(403, `homee hat abgelehnt: ${(err as Error).message}`);
  }
  return { ok: true, message: results.join('; ') };
});

/** Homeegramme, die der homee-Benutzer sehen darf. */
app.get('/homeegrams', async () =>
  homee.state.homeegrams.map((h) => ({ id: h.id, name: decode(h.name), active: h.active === 1 })),
);

app.post<{ Params: { id: string } }>('/homeegrams/:id/play', async (req) => {
  if (config.readOnly) throw fail(403, 'READ_ONLY=true');
  const hg = homee.state.homeegrams.find((h) => h.id === Number(req.params.id));
  if (!hg) throw fail(404, 'Homeegramm nicht gefunden oder nicht freigegeben');
  try {
    await homee.request(`PUT:homeegrams/${hg.id}?play=1`, ['homeegram'], 5000).catch((err: Error) => {
      if (!err.message.startsWith('Keine Antwort')) throw err;
    });
    await audit('play-homeegram', { id: hg.id, name: decode(hg.name) }, true);
  } catch (err) {
    await audit('play-homeegram', { id: hg.id }, false, (err as Error).message);
    throw fail(403, `homee hat abgelehnt: ${(err as Error).message}`);
  }
  return { ok: true, message: `„${decode(hg.name)}“ wird ausgeführt` };
});

// ---------------------------------------------------------------- OpenAPI-Beschreibung (für den GPT-Builder)

const json = (schema: object) => ({ content: { 'application/json': { schema } } });
const result = { '200': { description: 'Ausgeführt', ...json({ type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }) } };

app.get('/openapi.json', async () => ({
  openapi: '3.1.0',
  info: {
    title: 'CubePilot for homee — Remote API',
    version: '1.0.0',
    description: 'Smart Home (homee) steuern. Immer zuerst listDevices aufrufen, um Namen den IDs zuzuordnen.',
  },
  servers: [{ url: config.publicUrl }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
  security: [{ bearer: [] }],
  paths: {
    '/devices': {
      get: {
        operationId: 'listDevices',
        summary: 'Alle freigegebenen Geräte mit steuerbaren Werten (controls) und Messwerten (readings)',
        description:
          'Gerätenamen sind meist Raumnamen. Rollladen: Position 0 = ganz offen (hoch), 100 = ganz geschlossen (runter); UpDown 2 = stoppen. Heizung: TargetTemperature in °C. Licht/Steckdose: OnOff 0/1. "meaning" erklärt bekannte Werte.',
        responses: { '200': { description: 'Geräteliste', ...json({ type: 'array', items: { type: 'object' } }) } },
      },
    },
    '/control': {
      post: {
        operationId: 'controlDevices',
        summary: 'Einen oder mehrere Gerätewerte setzen',
        description: 'Für „alle Rollläden hoch“ einen Befehl je Rollladen schicken. Werte müssen zwischen min und max des Attributs liegen.',
        requestBody: {
          required: true,
          ...json({
            type: 'object',
            required: ['commands'],
            properties: {
              commands: {
                type: 'array',
                minItems: 1,
                maxItems: 30,
                items: {
                  type: 'object',
                  required: ['deviceId', 'attributeId', 'value'],
                  properties: {
                    deviceId: { type: 'integer', description: 'id aus listDevices' },
                    attributeId: { type: 'integer', description: 'attributeId aus controls' },
                    value: { type: 'number' },
                  },
                },
              },
            },
          }),
        },
        responses: result,
      },
    },
    '/homeegrams': {
      get: {
        operationId: 'listHomeegrams',
        summary: 'Freigegebene Homeegramme (Automationen/Szenen)',
        responses: { '200': { description: 'Liste', ...json({ type: 'array', items: { type: 'object' } }) } },
      },
    },
    '/homeegrams/{id}/play': {
      post: {
        operationId: 'playHomeegram',
        summary: 'Homeegramm sofort ausführen',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: result,
      },
    },
  },
}));

// ---------------------------------------------------------------- Start

await app.listen({ host: '127.0.0.1', port: config.port });
homee.connect().catch((err: Error) => app.log.error(`Erste Verbindung zu homee fehlgeschlagen: ${err.message}. Neuer Versuch läuft automatisch.`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    homee.disconnect();
    await app.close();
    process.exit(0);
  });
}
