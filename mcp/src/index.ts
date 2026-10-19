// MCP-Server für homee. Spricht mit dem Backend (nicht direkt mit homee), damit Sicherungen,
// Änderungsprotokoll und Nur-Lesen-Modus auch für KI-Zugriffe gelten.
// Läuft über stdio; Start: npx tsx mcp/src/index.ts.
// Läuft das Backend nicht, wird es beim ersten Befehl automatisch im Hintergrund gestartet (MCP_AUTOSTART_BACKEND).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = resolve(rootDir, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const BACKEND = (process.env.HOMEE_BACKEND_URL || `http://127.0.0.1:${process.env.BACKEND_PORT || 5311}`).replace(/\/$/, '');
const API_TOKEN = process.env.API_TOKEN || '';
const AUTOSTART = !['0', 'false', 'no'].includes((process.env.MCP_AUTOSTART_BACKEND ?? 'true').toLowerCase());

async function backendStatus(): Promise<{ connected: boolean } | null> {
  try {
    const res = await fetch(`${BACKEND}/api/status`, {
      headers: API_TOKEN ? { 'x-api-key': API_TOKEN } : {},
      signal: AbortSignal.timeout(1500),
    });
    return res.ok ? ((await res.json()) as { connected: boolean }) : null;
  } catch {
    return null;
  }
}

let starting: Promise<void> | null = null;

/**
 * Stellt sicher, dass das Backend läuft. Startet es sonst losgelöst im Hintergrund (läuft nach dem MCP-Server weiter,
 * damit auch die Oberfläche erreichbar ist) und wartet, bis es mit homee verbunden ist. Ausgabe: data/backend.log
 */
function ensureBackend(): Promise<void> {
  starting ??= (async () => {
    if (await backendStatus()) return;
    const host = new URL(BACKEND).hostname;
    if (!AUTOSTART || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Error(`Backend unter ${BACKEND} nicht erreichbar – bitte mit "npm run backend" starten.`);
    }

    const dataDir = resolve(rootDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    const log = openSync(resolve(dataDir, 'backend.log'), 'a');
    const child = spawn(process.execPath, ['--import', 'tsx', 'backend/src/server.ts'], {
      cwd: rootDir,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    child.unref();

    // Bis zu 30 s warten: erst bis das Backend antwortet, dann bis homee verbunden ist
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const s = await backendStatus();
      if (s?.connected) return;
      if (child.exitCode !== null && !s) break;
    }
    if (!(await backendStatus())) {
      throw new Error(`Backend konnte nicht gestartet werden – Details in ${resolve(dataDir, 'backend.log')}`);
    }
    // Läuft, aber (noch) keine Verbindung zu homee: Befehle liefern dann eine verständliche Fehlermeldung
  })().finally(() => {
    starting = null;
  });
  return starting;
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  await ensureBackend();
  let res: Response;
  try {
    res = await fetch(`${BACKEND}/api${path}`, {
      method,
      headers: {
        'x-client': 'mcp',
        ...(API_TOKEN && { 'x-api-key': API_TOKEN }),
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(`Backend unter ${BACKEND} nicht erreichbar: ${(err as Error).message}`);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`);
  return data;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Fehler: ${(err as Error).message}` }], isError: true };
  }
}

const server = new McpServer(
  { name: 'cubepilot', version: '0.1.0' },
  {
    instructions: `Steuerung eines homee-Smart-Home-Systems (inoffizielle API).

Vorgehen beim Bearbeiten von Homeegrammen (Automationen aus Auslösern, Bedingungen und Aktionen):
1. Mit homee_list_homeegrams einen Überblick holen, mit homee_get_homeegram Details lesen.
2. Vor dem Hinzufügen eines Eintrags mit homee_get_homeegram (raw=true) ein bestehendes Homeegramm mit einem Eintrag
   derselben Art ansehen und dessen Felder als Vorlage nehmen. Zahlencodes stehen in homee_catalog.
3. Geräte- und Attribut-IDs mit homee_list_devices ermitteln.
4. Änderungen vorher kurz dem Benutzer beschreiben. Das Backend legt automatisch Sicherungen an.
Ändern und Löschen einzelner Einträge ist von homee nicht offiziell dokumentiert, funktioniert aber (getestet mit homee 2.41.6).
Ergebnis danach mit homee_get_homeegram prüfen.
Zeitangaben: dtstart im Format YYYYMMDDTHHMMSSZ (UTC), Wiederholung als iCal-RRULE, BYHOUR/BYMINUTE ebenfalls in UTC
(deutsche Sommerzeit = UTC+2, Winterzeit = UTC+1). Beim Ändern einer Uhrzeit dtstart immer mit anpassen
(heutiges Datum + neue Uhrzeit), sonst berechnet homee die nächste Ausführung ab dem alten Startzeitpunkt.
Tageszeit-Bedingungen (celestial_conditions, type 4): homee nimmt nur time_of_day 1 (Tag) und 2 (Nacht) an.`,
  },
);

const kindSchema = z.enum(['triggers', 'conditions', 'actions']).describe('Art des Eintrags');
const paramsSchema = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .describe('Felder des Eintrags als Query-Parameter, z. B. {"type":1,"node_id":5,"attribute_id":12,"value":1,"command":1}');

// ---------------------------------------------------------------- Lesen

server.registerTool(
  'homee_status',
  {
    title: 'homee-Status',
    description: 'Verbindungsstatus, Name/Version des homee, Anzahl Geräte und Homeegramme, ob Schreiben erlaubt ist.',
    annotations: { readOnlyHint: true },
  },
  () => run(() => api('GET', '/status')),
);

server.registerTool(
  'homee_list_devices',
  {
    title: 'Geräte auflisten',
    description:
      'Listet Geräte (Nodes) mit ihren Attributen (ID, Typ, aktueller Wert, Einheit, schreibbar). Mit search nach Namen filtern.',
    inputSchema: {
      search: z.string().optional().describe('Teil des Gerätenamens (ohne Groß-/Kleinschreibung)'),
      editable_only: z.boolean().optional().describe('Nur schreibbare Attribute anzeigen'),
    },
    annotations: { readOnlyHint: true },
  },
  ({ search, editable_only }) =>
    run(async () => {
      const nodes = (await api('GET', '/nodes')) as any[];
      return nodes
        .filter((n) => !search || n.name.toLowerCase().includes(search.toLowerCase()))
        .map((n) => ({
          id: n.id,
          name: n.name,
          profile: n.profileName,
          state: n.state,
          attributes: n.attributes
            .filter((a: any) => !editable_only || a.editable)
            .map((a: any) => ({
              id: a.id,
              type: a.typeName,
              value: a.value,
              unit: a.unit,
              editable: a.editable,
              ...(a.editable && { min: a.min, max: a.max, step: a.step }),
            })),
        }));
    }),
);

server.registerTool(
  'homee_get_device',
  {
    title: 'Gerät anzeigen',
    description: 'Alle Details eines Geräts inkl. aller Attribute.',
    inputSchema: { node_id: z.number().int() },
    annotations: { readOnlyHint: true },
  },
  ({ node_id }) => run(() => api('GET', `/nodes/${node_id}`)),
);

server.registerTool(
  'homee_list_homeegrams',
  {
    title: 'Homeegramme auflisten',
    description: 'Alle Homeegramme mit ID, Name, aktiv/inaktiv und einer Zusammenfassung „WENN … UND … DANN …“.',
    annotations: { readOnlyHint: true },
  },
  () => run(() => api('GET', '/homeegrams')),
);

server.registerTool(
  'homee_get_homeegram',
  {
    title: 'Homeegramm anzeigen',
    description:
      'Ein Homeegramm mit allen Auslösern, Bedingungen und Aktionen (jeweils mit ID und Beschreibung). raw=true liefert die Originaldaten von homee, nützlich als Vorlage für neue Einträge.',
    inputSchema: { id: z.number().int(), raw: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  },
  ({ id, raw }) => run(() => api('GET', `/homeegrams/${id}${raw ? '?raw=1' : ''}`)),
);

server.registerTool(
  'homee_catalog',
  {
    title: 'Zahlencodes',
    description:
      'Zahlencodes der homee-API: Typen und Operatoren für Auslöser/Bedingungen/Aktionen (section=homeegram) oder alle Attributtypen (section=attributeTypes).',
    inputSchema: { section: z.enum(['homeegram', 'attributeTypes']).default('homeegram') },
    annotations: { readOnlyHint: true },
  },
  ({ section }) => run(async () => ((await api('GET', '/catalog')) as Record<string, unknown>)[section]),
);

server.registerTool(
  'homee_history',
  {
    title: 'Verlauf',
    description: 'Werteverlauf eines Attributs, Geräts oder Homeegramms. from/till als Unix-Zeitstempel in Sekunden.',
    inputSchema: {
      kind: z.enum(['attribute', 'node', 'homeegram']),
      id: z.number().int(),
      limit: z.number().int().min(1).max(1000).default(100),
      from: z.number().int().optional(),
      till: z.number().int().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  ({ kind, id, limit, from, till }) => {
    const q = new URLSearchParams({ limit: String(limit), ...(from && { from: String(from) }), ...(till && { till: String(till) }) });
    return run(() => api('GET', `/history/${kind}/${id}?${q}`));
  },
);

server.registerTool(
  'homee_diary',
  {
    title: 'Tagebuch',
    description:
      'Einträge aus dem homee-Tagebuch (was wurde wann ausgelöst/geändert). from/till als Unix-Zeitstempel in MILLISEKUNDEN; ohne Angabe die neuesten. Antwort unter result.values, Spalten: timestamp (ms), eventType (CADiaryEventType), eventID, causeType (CADiaryCauseType), causeIDGeneral, causeIDSpecific, eventValue.',
    inputSchema: {
      limit: z.number().int().min(1).max(2000).default(50),
      from: z.number().int().optional(),
      till: z.number().int().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  ({ limit, from, till }) => {
    const q = new URLSearchParams({ limit: String(limit), ...(from && { from: String(from) }), ...(till && { till: String(till) }) });
    return run(() => api('GET', `/diary?${q}`));
  },
);

// ---------------------------------------------------------------- Steuern

server.registerTool(
  'homee_set_attribute',
  {
    title: 'Gerät steuern',
    description: 'Setzt den Zielwert eines schreibbaren Attributs (z. B. OnOff 0/1, Dimmstufe 0–100, Solltemperatur).',
    inputSchema: { node_id: z.number().int(), attribute_id: z.number().int(), value: z.number() },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  ({ node_id, attribute_id, value }) => run(() => api('PUT', `/nodes/${node_id}/attributes/${attribute_id}`, { value })),
);

server.registerTool(
  'homee_play_homeegram',
  {
    title: 'Homeegramm abspielen',
    description: 'Führt die Aktionen eines Homeegramms sofort aus. test=true startet einen Testlauf.',
    inputSchema: { id: z.number().int(), test: z.boolean().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  ({ id, test }) => run(() => api('POST', `/homeegrams/${id}/${test ? 'test' : 'play'}`)),
);

server.registerTool(
  'homee_set_homeegram_active',
  {
    title: 'Homeegramm aktivieren/deaktivieren',
    description: 'Aktiviert oder deaktiviert ein Homeegramm (inaktive Homeegramme reagieren nicht auf Auslöser).',
    inputSchema: { id: z.number().int(), active: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  ({ id, active }) => run(() => api('PUT', `/homeegrams/${id}/active`, { active })),
);

// ---------------------------------------------------------------- Homeegramme bearbeiten

server.registerTool(
  'homee_create_homeegram',
  {
    title: 'Homeegramm anlegen',
    description: 'Legt ein neues, leeres Homeegramm an. Danach Auslöser/Bedingungen/Aktionen mit homee_add_homeegram_item ergänzen.',
    inputSchema: {
      name: z.string().min(1),
      fields: paramsSchema.optional().describe('Weitere Felder, z. B. {"active":0}'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  ({ name, fields }) => run(() => api('POST', '/homeegrams', { name, fields })),
);

server.registerTool(
  'homee_update_homeegram',
  {
    title: 'Homeegramm umbenennen/ändern',
    description: 'Ändert Felder des Homeegramms selbst, z. B. {"name":"Neuer Name"} oder {"note":"…"}. Experimentell.',
    inputSchema: { id: z.number().int(), fields: paramsSchema },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  ({ id, fields }) => run(() => api('PATCH', `/homeegrams/${id}`, { fields })),
);

server.registerTool(
  'homee_add_homeegram_item',
  {
    title: 'Auslöser/Bedingung/Aktion hinzufügen',
    description: `Fügt einem Homeegramm einen Auslöser, eine Bedingung oder eine Aktion hinzu. Beispiele:
- Aktion Gerät schalten: kind=actions, {"type":1,"node_id":5,"attribute_id":12,"value":1,"command":1,"delay":0}
- Bedingung Attribut: kind=conditions, {"type":2,"node_id":5,"attribute_id":12,"operator":1,"operand":1,"value":5,"check_moment":1}
- Auslöser manuell: kind=triggers, {"type":3}
Typen/Operatoren siehe homee_catalog; bestehende Einträge (homee_get_homeegram raw=true) als Vorlage nutzen.`,
    inputSchema: { id: z.number().int(), kind: kindSchema, params: paramsSchema },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  ({ id, kind, params }) => run(() => api('POST', `/homeegrams/${id}/${kind}`, { params })),
);

server.registerTool(
  'homee_update_homeegram_item',
  {
    title: 'Eintrag ändern',
    description:
      'Ändert Felder eines bestehenden Auslösers/einer Bedingung/Aktion; nur die angegebenen Felder werden geändert, z. B. {"value":1,"delay":5}. Bei Zeit-Auslösern rrule und dtstart gemeinsam setzen.',
    inputSchema: { id: z.number().int(), kind: kindSchema, item_id: z.number().int(), params: paramsSchema },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  ({ id, kind, item_id, params }) => run(() => api('PUT', `/homeegrams/${id}/${kind}/${item_id}`, { params })),
);

server.registerTool(
  'homee_delete_homeegram_item',
  {
    title: 'Eintrag löschen',
    description: 'Löscht einen Auslöser, eine Bedingung oder eine Aktion aus einem Homeegramm.',
    inputSchema: { id: z.number().int(), kind: kindSchema, item_id: z.number().int() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  ({ id, kind, item_id }) => run(() => api('DELETE', `/homeegrams/${id}/${kind}/${item_id}`)),
);

const changeSchema = {
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Felder des Homeegramms, z. B. {"name":"…","active":1}'),
  remove: z.array(z.object({ kind: kindSchema, itemId: z.number().int() })).optional(),
  update: z.array(z.object({ kind: kindSchema, itemId: z.number().int(), params: paramsSchema })).optional(),
  add: z.array(z.object({ kind: kindSchema, params: paramsSchema })).optional(),
};

server.registerTool(
  'homee_save_homeegram_changes',
  {
    title: 'Mehrere Änderungen speichern',
    description:
      'Wendet mehrere Änderungen an einem Homeegramm in einem Schritt an (Reihenfolge: remove, update, add, fields) – mit einer Sicherung vorher. Ohne id wird ein neues Homeegramm mit fields.name angelegt und mit add befüllt. Bricht beim ersten Fehler ab und meldet, wie viele Schritte angewendet wurden.',
    inputSchema: { id: z.number().int().optional(), ...changeSchema },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  ({ id, fields, remove, update, add }) =>
    run(async () => {
      if (id === undefined) {
        const { name, ...rest } = fields ?? {};
        if (!name) throw new Error('Für ein neues Homeegramm fields.name angeben');
        return api('POST', '/homeegrams', { name, fields: rest, add });
      }
      return api('POST', `/homeegrams/${id}/changes`, { fields, remove, update, add });
    }),
);

server.registerTool(
  'homee_delete_homeegram',
  {
    title: 'Homeegramm löschen',
    description: 'Löscht ein Homeegramm vollständig. Vorher wird automatisch eine Sicherung angelegt. Nur nach ausdrücklicher Bestätigung verwenden.',
    inputSchema: { id: z.number().int() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  ({ id }) => run(() => api('DELETE', `/homeegrams/${id}`)),
);

// ---------------------------------------------------------------- Sicherungen & Rohbefehle

server.registerTool(
  'homee_backup',
  {
    title: 'Sicherung anlegen',
    description: 'Speichert den aktuellen Zustand (Homeegramme, Geräte, Gruppen) als JSON-Sicherung im Backend.',
    inputSchema: { reason: z.string().default('mcp') },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  ({ reason }) => run(() => api('POST', '/backups', { reason })),
);

server.registerTool(
  'homee_list_backups',
  {
    title: 'Sicherungen auflisten',
    description: 'Listet vorhandene Sicherungen; mit file eine bestimmte Sicherung lesen.',
    inputSchema: { file: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  ({ file }) => run(() => api('GET', file ? `/backups/${encodeURIComponent(file)}` : '/backups')),
);

server.registerTool(
  'homee_compare_backup',
  {
    title: 'Sicherung mit aktuellem Stand vergleichen',
    description:
      'Zeigt für jedes Homeegramm einer Sicherung, ob es seitdem unverändert, geändert, gelöscht oder neu ist (mit Zusammenfassung vorher/jetzt). Sicherungen: homee_list_backups.',
    inputSchema: { file: z.string(), only_differences: z.boolean().default(true) },
    annotations: { readOnlyHint: true },
  },
  ({ file, only_differences }) =>
    run(async () => {
      const r = (await api('GET', `/backups/${encodeURIComponent(file)}/homeegrams`)) as { homeegrams: any[] } & Record<string, unknown>;
      const rows = r.homeegrams
        .filter((h) => !only_differences || h.status !== 'unchanged')
        .map((h) => ({ id: h.id, currentId: h.currentId, name: h.name, status: h.status, changes: h.changes, backup: h.backup?.summary ?? null, current: h.current?.summary ?? null }));
      return { file: r.file, createdAt: r.createdAt, reason: r.reason, homeegrams: rows };
    }),
);

server.registerTool(
  'homee_restore_homeegrams',
  {
    title: 'Homeegramme aus Sicherung wiederherstellen',
    description:
      'Bringt die angegebenen Homeegramme (IDs aus der Sicherung) auf den Stand der Sicherung: Änderungen werden zurückgesetzt, gelöschte neu angelegt, Verweise zwischen Homeegrammen angepasst. Vorher wird automatisch gesichert. Nur nach Bestätigung durch den Benutzer.',
    inputSchema: { file: z.string(), ids: z.array(z.number().int()).min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  ({ file, ids }) => run(() => api('POST', `/backups/${encodeURIComponent(file)}/restore`, { ids })),
);

const swapSchema = {
  pairs: z.array(z.object({ from: z.number().int().describe('altes Gerät (node_id)'), to: z.number().int().describe('neues Gerät (node_id)') })).min(1),
  groups: z.boolean().default(true).describe('Gruppenmitgliedschaften übertragen'),
  rename: z.boolean().default(false).describe('Neues Gerät bekommt den Namen des alten, altes Gerät „… (alt)“'),
};

server.registerTool(
  'homee_swap_devices_preview',
  {
    title: 'Gerätetausch – Vorschau',
    description:
      'Zeigt, was ein Gerätetausch ändern würde: alle betroffenen Einträge in allen Homeegrammen, Gruppen und Namen, plus Warnungen (z. B. Funktion am neuen Gerät nicht vorhanden). Ändert nichts.',
    inputSchema: swapSchema,
    annotations: { readOnlyHint: true },
  },
  (args) => run(() => api('POST', '/swap/preview', args)),
);

server.registerTool(
  'homee_swap_devices',
  {
    title: 'Gerät tauschen',
    description:
      'Ersetzt alte durch neue Geräte in allen Homeegrammen (Auslöser, Bedingungen, Aktionen; Attribute werden nach Typ zugeordnet) und optional in Gruppen und beim Namen. Vorher homee_swap_devices_preview zeigen und bestätigen lassen. Sichert vorher automatisch.',
    inputSchema: swapSchema,
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  (args) => run(() => api('POST', '/swap/apply', args)),
);

server.registerTool(
  'homee_raw_command',
  {
    title: 'Rohbefehl (Experten)',
    description:
      'Schickt einen Rohbefehl an homee (z. B. "GET:settings" oder "PUT:homeegrams/3?name=Test") und liefert alle Antworten der nächsten Sekunden. Nur wenn ALLOW_RAW=true im Backend.',
    inputSchema: { command: z.string(), timeout_ms: z.number().int().min(500).max(10000).optional() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  ({ command, timeout_ms }) => run(() => api('POST', '/raw', { command, timeoutMs: timeout_ms })),
);

await server.connect(new StdioServerTransport());
