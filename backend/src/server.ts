import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  HomeeClient,
  attributeTypeCatalog,
  attributeView,
  homeegramEnumCatalog,
  homeegramSummary,
  homeegramView,
  nodeView,
  decode,
  changeCount,
  planRestore,
  planSwap,
  restoreStatus,
  type HomeeAttribute,
  type Homeegram,
  type ItemKind,
  type SwapPair,
} from '@cubepilot/client';
import { config } from './config.ts';
import { hostOf, saveCredentials, testConnection, validateCredentials, type HomeeCredentials } from './env-file.ts';
import { audit, autoBackup, createBackup, importBackup, listBackups, readAudit, readBackup } from './store.ts';
import { secureApi } from './security.ts';

const homee = new HomeeClient(config.homee);
const app = Fastify({ logger: {
  level: 'info',
  // SSE URLs contain an API key; never write query strings to request logs.
  serializers: { req: (req) => ({ method: req.method, url: req.url?.split('?')[0], hostname: req.hostname }) },
} });

homee.on('connected', () => app.log.info(`Mit homee verbunden (${homee.isRemote ? 'über homee-Cloud' : 'lokal'})`));
homee.on('disconnected', (info) => app.log.warn({ info }, 'Verbindung zu homee getrennt, verbinde neu …'));
homee.on('error', (err: Error) => app.log.error(`homee: ${err.message}`));

// ---------------------------------------------------------------- Hilfsfunktionen

const ITEM_KINDS: ItemKind[] = ['triggers', 'conditions', 'actions'];

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

function toInt(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n)) throw httpError(400, `${name} muss eine ganze Zahl sein`);
  return n;
}

function toKind(v: unknown): ItemKind {
  if (!ITEM_KINDS.includes(v as ItemKind)) throw httpError(400, `Art muss eine von ${ITEM_KINDS.join(', ')} sein`);
  return v as ItemKind;
}

/** Felder für homee-Query-Parameter: Text/Zahl direkt, Wahrheitswerte als 1/0, Listen als JSON (z. B. user_ids=[0]). */
function toParams(v: unknown): Record<string, string | number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw httpError(400, 'params muss ein Objekt sein');
  const out: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string' || typeof val === 'number') out[k] = val;
    else if (typeof val === 'boolean') out[k] = val ? 1 : 0;
    else if (Array.isArray(val)) out[k] = JSON.stringify(val);
    else throw httpError(400, `params.${k} muss Text, Zahl, Wahrheitswert oder Liste sein`);
  }
  return out;
}

interface ChangeSet {
  fields?: Record<string, unknown>;
  remove?: { kind: string; itemId: number }[];
  update?: { kind: string; itemId: number; params: Record<string, unknown> }[];
  add?: { kind: string; params: Record<string, unknown> }[];
}

/**
 * Wendet ein Änderungspaket der Reihe nach an: löschen, ändern, hinzufügen, zuletzt Felder (z. B. active).
 * Bricht beim ersten Fehler ab und meldet, wie weit es gekommen ist.
 */
async function applyChanges(id: number, cs: ChangeSet): Promise<{ applied: number; error: string | null }> {
  let applied = 0;
  try {
    for (const r of cs.remove ?? []) {
      await homee.deleteItem(id, toKind(r.kind), toInt(r.itemId, 'itemId'));
      applied++;
    }
    for (const u of cs.update ?? []) {
      await homee.updateItem(id, toKind(u.kind), toInt(u.itemId, 'itemId'), toParams(u.params));
      applied++;
    }
    for (const a of cs.add ?? []) {
      await homee.addItem(id, toKind(a.kind), toParams(a.params));
      applied++;
    }
    if (cs.fields && Object.keys(cs.fields).length) {
      const { active, ...rest } = toParams(cs.fields);
      if (Object.keys(rest).length) await homee.updateHomeegram(id, rest);
      if (active !== undefined) await homee.setHomeegramActive(id, Number(active) === 1);
      applied++;
    }
    await homee.fetchHomeegram(id);
    return { applied, error: null };
  } catch (err) {
    await homee.fetchHomeegram(id).catch(() => null);
    return { applied, error: (err as Error).message };
  }
}

/** Nutzt ein Homeegramm das Gerät (direkt oder über eine Gruppe, in der es steckt)? */
function homeegramUsesNode(hg: Homeegram, nodeId: number): boolean {
  const groupIds = new Set(homee.state.relationships.filter((r) => r.node_id === nodeId).map((r) => r.group_id));
  for (const kind of ITEM_KINDS) {
    for (const items of Object.values(hg[kind] ?? {})) {
      for (const i of items) {
        if (Number(i.node_id) === nodeId) return true;
        if (i.group_id !== undefined && groupIds.has(Number(i.group_id))) return true;
      }
    }
  }
  return false;
}

function requireConnection(): void {
  if (!homee.connected || !homee.ready) throw httpError(503, `Keine Verbindung zu homee${homee.lastError ? `: ${homee.lastError}` : ''}`);
}

function findHomeegram(id: number): Homeegram {
  const hg = homee.state.homeegrams.find((h) => h.id === id);
  if (!hg) throw httpError(404, `Homeegramm ${id} nicht gefunden`);
  return hg;
}

const view = (hg: Homeegram | null) => (hg ? homeegramView(hg, homee.state) : null);

/** Führt eine schreibende Aktion aus: Nur-Lesen-Prüfung, Sicherung, Protokoll. */
async function write<T>(
  req: FastifyRequest,
  action: string,
  details: unknown,
  fn: () => Promise<T>,
  backup: 'none' | 'auto' | 'force' = 'none',
): Promise<T> {
  if (config.readOnly) throw httpError(403, 'Backend läuft im Nur-Lesen-Modus (READ_ONLY=true)');
  requireConnection();
  if (backup !== 'none') await autoBackup(homee.state, action, backup === 'force');
  const source = String(req.headers['x-client'] ?? 'api');
  try {
    const result = await fn();
    const outcome = result as { error?: string; errors?: string[]; results?: { error?: string | null }[] } | null;
    const errors = outcome && typeof outcome === 'object'
      ? [outcome.error, ...(outcome.errors ?? []), ...(outcome.results ?? []).map((r) => r.error)].filter(Boolean)
      : [];
    await audit({ source, action, details, ok: errors.length === 0, ...(errors.length ? { error: errors.join('; ') } : {}) });
    return result;
  } catch (err) {
    await audit({ source, action, details, ok: false, error: (err as Error).message });
    throw err;
  }
}

// Leere Anfragen mit Content-Type JSON (z. B. DELETE aus Skripten) nicht als Fehler behandeln
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  if (!body) return done(null, undefined);
  try {
    done(null, JSON.parse(body as string));
  } catch (err) {
    done(Object.assign(err as Error, { statusCode: 400 }), undefined);
  }
});

// ---------------------------------------------------------------- Absicherung

secureApi(app, config.apiToken);

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  reply.code(status).send({ error: err.message });
});

// ---------------------------------------------------------------- Status & Katalog

app.get('/api/status', async () => ({
  // erst „verbunden“, wenn auch die Daten da sind
  connected: homee.connected && homee.ready,
  remote: homee.isRemote,
  host: config.homee.host,
  homeeName: decode(homee.state.settings?.homee_name) || 'homee',
  version: homee.state.settings?.version ?? null,
  lastError: homee.lastError,
  readOnly: config.readOnly,
  allowRaw: config.allowRaw,
  counts: {
    nodes: homee.state.nodes.length,
    homeegrams: homee.state.homeegrams.length,
    groups: homee.state.groups.length,
  },
}));

// ---------------------------------------------------------------- Einrichtung (homee-Zugangsdaten)

const ADMIN_ROLE = 2;

/** Eingaben aus dem Formular; leeres Passwort = bisheriges behalten. */
function toCredentials(body: unknown): HomeeCredentials {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const c: HomeeCredentials = {
    mode: b.mode === 'remote' ? 'remote' : 'local',
    ip: str(b.ip),
    homeeId: str(b.homeeId),
    user: str(b.user),
    password: str(b.password) || config.homee.password,
  };
  const problem = validateCredentials(c);
  if (problem) throw httpError(400, problem);
  return c;
}

app.get('/api/setup', async () => {
  const me = homee.state.users.find((u) => decode(u.username).toLowerCase() === config.homee.user.toLowerCase());
  return {
    mode: config.homee.mode,
    ip: process.env.HOMEE_IP ?? '',
    homeeId: process.env.HOMEE_ID ?? '',
    user: config.homee.user,
    hasPassword: !!config.homee.password,
    isAdmin: me ? me.role === ADMIN_ROLE : null,
  };
});

app.post('/api/setup/test', async (req) => testConnection(toCredentials(req.body), `${config.homee.deviceName}-setup`));

app.post<{ Body: { force?: boolean } }>('/api/setup', async (req) => {
  const c = toCredentials(req.body);
  const result = await testConnection(c, `${config.homee.deviceName}-setup`);
  if (!result.ok && !req.body?.force) throw httpError(400, result.error ?? 'Verbindung fehlgeschlagen');

  saveCredentials(c, result.homeeId);
  Object.assign(config.homee, { mode: c.mode, host: hostOf(c), user: c.user.trim(), password: c.password });
  const source = String(req.headers['x-client'] ?? 'api');
  await audit({ source, action: 'setup', details: { mode: c.mode, host: config.homee.host, user: config.homee.user }, ok: true });

  homee.reconfigure(config.homee).catch((err: Error) => app.log.error(`Neue Verbindung zu homee fehlgeschlagen: ${err.message}`));
  return result;
});

app.get('/api/catalog', async () => ({
  homeegram: homeegramEnumCatalog(),
  attributeTypes: attributeTypeCatalog(),
}));

app.post('/api/refresh', async () => {
  requireConnection();
  await homee.refreshAll();
  return { ok: true };
});

// ---------------------------------------------------------------- Geräte

// Enthält auch den homee selbst (id -1, z. B. Attribut HomeeMode für Anwesenheitsmodi).
app.get('/api/nodes', async () => homee.state.nodes.map(nodeView));

app.get<{ Params: { id: string } }>('/api/nodes/:id/usage', async (req) => {
  const nodeId = toInt(req.params.id, 'id');
  return homee.state.homeegrams.filter((h) => homeegramUsesNode(h, nodeId)).map((h) => homeegramSummary(h, homee.state));
});

app.get<{ Querystring: { event?: string } }>('/api/webhook-url', async (req) => {
  const key = homee.state.settings?.webhooks_key;
  if (!key) throw httpError(404, 'homee hat keinen Webhook-Schlüssel geliefert');
  const q = `api/v2/webhook_trigger?webhooks_key=${key}&event=${encodeURIComponent(req.query.event ?? '')}`;
  const local = homee.isRemote ? null : `http://${config.homee.host}:7681/${q}`;
  const ip = homee.state.settings?.lan_ip_address || homee.state.settings?.wlan_ip_address;
  return {
    local: local ?? (ip ? `http://${ip}:7681/${q}` : null),
    remote: process.env.HOMEE_ID ? `https://${process.env.HOMEE_ID}.hom.ee/${q}` : null,
  };
});

app.get<{ Params: { id: string } }>('/api/nodes/:id', async (req) => {
  const node = homee.state.nodes.find((n) => n.id === toInt(req.params.id, 'id'));
  if (!node) throw httpError(404, 'Gerät nicht gefunden');
  return nodeView(node);
});

app.put<{ Params: { id: string; attributeId: string }; Body: { value: number } }>(
  '/api/nodes/:id/attributes/:attributeId',
  async (req) => {
    const nodeId = toInt(req.params.id, 'id');
    const attributeId = toInt(req.params.attributeId, 'attributeId');
    const value = Number(req.body?.value);
    if (!Number.isFinite(value)) throw httpError(400, 'value muss eine Zahl sein');
    const attr = homee.state.nodes.find((n) => n.id === nodeId)?.attributes.find((a) => a.id === attributeId);
    if (!attr) throw httpError(404, 'Attribut nicht gefunden');
    if (attr.editable !== 1) throw httpError(400, 'Attribut ist nicht schreibbar');
    if (req.body?.value === null || typeof req.body?.value === 'boolean' || value < attr.minimum || value > attr.maximum) {
      throw httpError(400, `value muss zwischen ${attr.minimum} und ${attr.maximum} liegen`);
    }
    const res = await write(req, 'set-value', { nodeId, attributeId, value }, () => homee.setValue(nodeId, attributeId, value));
    return { ok: true, attribute: res ? attributeView(res) : null };
  },
);

app.get('/api/groups', async () =>
  homee.state.groups.map((g) => ({
    id: g.id,
    name: decode(g.name),
    nodeIds: homee.state.relationships.filter((r) => r.group_id === g.id && r.node_id).map((r) => r.node_id),
  })),
);

// ---------------------------------------------------------------- Homeegramme

app.get<{ Querystring: { full?: string } }>('/api/homeegrams', async (req) =>
  req.query.full ? homee.state.homeegrams.map(view) : homee.state.homeegrams.map((h) => homeegramSummary(h, homee.state)),
);

app.get<{ Params: { id: string }; Querystring: { raw?: string } }>('/api/homeegrams/:id', async (req) => {
  const hg = findHomeegram(toInt(req.params.id, 'id'));
  return req.query.raw ? hg : view(hg);
});

app.post<{ Params: { id: string } }>('/api/homeegrams/:id/play', async (req) => {
  const id = findHomeegram(toInt(req.params.id, 'id')).id;
  await write(req, 'play-homeegram', { id }, () => homee.playHomeegram(id));
  return { ok: true };
});

app.post<{ Params: { id: string } }>('/api/homeegrams/:id/test', async (req) => {
  const id = findHomeegram(toInt(req.params.id, 'id')).id;
  await write(req, 'test-homeegram', { id }, () => homee.testHomeegram(id));
  return { ok: true };
});

app.put<{ Params: { id: string }; Body: { active: boolean } }>('/api/homeegrams/:id/active', async (req) => {
  const id = findHomeegram(toInt(req.params.id, 'id')).id;
  const active = Boolean(req.body?.active);
  await write(req, 'set-homeegram-active', { id, active }, () => homee.setHomeegramActive(id, active), 'auto');
  return view(findHomeegram(id));
});

app.patch<{ Params: { id: string }; Body: { fields: Record<string, string | number> } }>('/api/homeegrams/:id', async (req) => {
  const id = findHomeegram(toInt(req.params.id, 'id')).id;
  const fields = toParams(req.body?.fields);
  return view(await write(req, 'update-homeegram', { id, fields }, () => homee.updateHomeegram(id, fields), 'auto'));
});

/**
 * Legt ein Homeegramm an. Optional mit Einträgen (add) – dann wird es zunächst inaktiv angelegt,
 * befüllt und erst am Ende auf den gewünschten active-Wert gesetzt.
 */
app.post<{ Body: { name: string; fields?: Record<string, unknown>; add?: ChangeSet['add'] } }>('/api/homeegrams', async (req, reply) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw httpError(400, 'name fehlt');
  const { active, ...fields } = req.body?.fields ? toParams(req.body.fields) : ({} as Record<string, string | number>);
  const add = req.body?.add ?? [];
  const result = await write(
    req,
    'create-homeegram',
    { name, fields, active, add },
    async () => {
      const hg = await homee.createHomeegram(name, { ...fields, active: 0 });
      const res = await applyChanges(hg.id, { add, fields: { active: active ?? 1 } });
      return { id: hg.id, ...res };
    },
    'auto',
  );
  if (result.error) reply.code(207);
  return { ...result, homeegram: view(homee.state.homeegrams.find((h) => h.id === result.id) ?? null) };
});

/** Änderungspaket aus dem Editor: { fields, remove, update, add } in einem Rutsch, mit Sicherung vorher. */
app.post<{ Params: { id: string }; Body: ChangeSet }>('/api/homeegrams/:id/changes', async (req, reply) => {
  const id = findHomeegram(toInt(req.params.id, 'id')).id;
  const cs = req.body ?? {};
  const before = findHomeegram(id);
  const result = await write(req, 'save-homeegram', { id, changes: cs, before }, () => applyChanges(id, cs), 'force');
  if (result.error) reply.code(207);
  return { ...result, homeegram: view(findHomeegram(id)) };
});

app.delete<{ Params: { id: string } }>('/api/homeegrams/:id', async (req) => {
  const hg = findHomeegram(toInt(req.params.id, 'id'));
  await write(req, 'delete-homeegram', { id: hg.id, name: decode(hg.name), backup: hg }, () => homee.deleteHomeegram(hg.id), 'force');
  return { ok: true };
});

app.post<{ Params: { id: string; kind: string }; Body: { params: Record<string, string | number> } }>(
  '/api/homeegrams/:id/:kind',
  async (req) => {
    const id = findHomeegram(toInt(req.params.id, 'id')).id;
    const kind = toKind(req.params.kind);
    const params = toParams(req.body?.params);
    return view(await write(req, `add-${kind}`, { id, params }, () => homee.addItem(id, kind, params), 'auto'));
  },
);

app.put<{ Params: { id: string; kind: string; itemId: string }; Body: { params: Record<string, string | number> } }>(
  '/api/homeegrams/:id/:kind/:itemId',
  async (req) => {
    const id = findHomeegram(toInt(req.params.id, 'id')).id;
    const kind = toKind(req.params.kind);
    const itemId = toInt(req.params.itemId, 'itemId');
    const params = toParams(req.body?.params);
    const before = homee.findItem(id, kind, itemId);
    if (!before) throw httpError(404, 'Eintrag nicht gefunden');
    return view(
      await write(req, `update-${kind}`, { id, itemId, params, before: before.item }, () => homee.updateItem(id, kind, itemId, params), 'auto'),
    );
  },
);

app.delete<{ Params: { id: string; kind: string; itemId: string } }>('/api/homeegrams/:id/:kind/:itemId', async (req) => {
  const id = findHomeegram(toInt(req.params.id, 'id')).id;
  const kind = toKind(req.params.kind);
  const itemId = toInt(req.params.itemId, 'itemId');
  const before = homee.findItem(id, kind, itemId);
  if (!before) throw httpError(404, 'Eintrag nicht gefunden');
  return view(await write(req, `delete-${kind}`, { id, itemId, before: before.item }, () => homee.deleteItem(id, kind, itemId), 'auto'));
});

// ---------------------------------------------------------------- Verlauf

app.get<{ Params: { kind: string; id: string }; Querystring: { from?: string; till?: string; limit?: string } }>(
  '/api/history/:kind/:id',
  async (req) => {
    requireConnection();
    const kind = req.params.kind;
    if (kind !== 'node' && kind !== 'attribute' && kind !== 'homeegram') throw httpError(400, 'kind: node | attribute | homeegram');
    const q = req.query;
    return homee.getHistory(kind, toInt(req.params.id, 'id'), {
      from: q.from ? Number(q.from) : undefined,
      till: q.till ? Number(q.till) : undefined,
      limit: q.limit ? Number(q.limit) : 100,
    });
  },
);

app.get<{ Querystring: { limit?: string; from?: string; till?: string } }>('/api/diary', async (req) => {
  requireConnection();
  const q = req.query;
  return homee.getDiary({ limit: Number(q.limit ?? 50), from: q.from ? Number(q.from) : undefined, till: q.till ? Number(q.till) : undefined });
});

// ---------------------------------------------------------------- Sicherungen & Protokoll

app.get('/api/backups', async () => listBackups());
app.post<{ Body: { reason?: string } }>('/api/backups', async (req) => {
  requireConnection();
  return createBackup(homee.state, req.body?.reason || 'manuell');
});
app.get<{ Params: { file: string } }>('/api/backups/:file', async (req) => readBackup(req.params.file));
app.get<{ Querystring: { limit?: string } }>('/api/audit', async (req) => readAudit(Number(req.query.limit ?? 100)));

// ---------------------------------------------------------------- Rohbefehle

app.post<{ Body: { command: string; expect?: string[]; timeoutMs?: number } }>('/api/raw', async (req) => {
  if (!config.allowRaw) throw httpError(403, 'Rohbefehle sind deaktiviert (ALLOW_RAW=true setzen)');
  const command = String(req.body?.command ?? '').trim();
  if (!/^(GET|PUT|POST|DELETE):/.test(command)) throw httpError(400, 'Befehl muss mit GET:, PUT:, POST: oder DELETE: beginnen');
  const run = async () => {
    // Alle Nachrichten der nächsten Sekunden einsammeln, damit man sieht, was homee antwortet.
    const received: unknown[] = [];
    const onMsg = (m: unknown) => received.push(m);
    homee.on('message', onMsg);
    try {
      homee.send(command);
      await new Promise((r) => setTimeout(r, Math.min(Number(req.body?.timeoutMs ?? 2500), 10000)));
    } finally {
      homee.off('message', onMsg);
    }
    return received;
  };
  if (command.startsWith('GET:')) {
    requireConnection();
    return { command, received: await run() };
  }
  return { command, received: await write(req, 'raw', { command }, run, 'auto') };
});

// ---------------------------------------------------------------- Wiederherstellen aus Sicherungen

interface BackupContent {
  createdAt: string;
  reason: string;
  homeegrams: Homeegram[];
}

/**
 * Ordnet jedem Homeegramm der Sicherung das aktuelle zu: zuerst über die ID, sonst (z. B. nach Löschen und
 * Neuanlegen) über den Namen – aber nur unter Homeegrammen, die es in der Sicherung nicht gibt.
 */
function matchBackup(backup: Homeegram[]): Map<number, Homeegram | undefined> {
  const backupIds = new Set(backup.map((h) => h.id));
  const map = new Map<number, Homeegram | undefined>();
  for (const b of backup) {
    const byId = homee.state.homeegrams.find((h) => h.id === b.id);
    const byName = byId
      ? undefined
      : homee.state.homeegrams.find((h) => !backupIds.has(h.id) && decode(h.name) === decode(b.name));
    map.set(b.id, byId ?? byName);
  }
  return map;
}

app.get<{ Params: { file: string } }>('/api/backups/:file/homeegrams', async (req) => {
  requireConnection();
  const b = (await readBackup(req.params.file)) as BackupContent;
  const matched = matchBackup(b.homeegrams);
  const backupState = { ...homee.state, homeegrams: b.homeegrams };
  const idMap = new Map<number, number>();
  for (const [oldId, cur] of matched) if (cur && cur.id !== oldId) idMap.set(oldId, cur.id);
  const matchedIds = new Set([...matched.values()].filter(Boolean).map((h) => h!.id));
  const rows = b.homeegrams.map((h) => {
    const cur = matched.get(h.id);
    return {
      id: h.id,
      currentId: cur?.id ?? null,
      name: decode(h.name),
      status: restoreStatus(h, cur, idMap),
      changes: changeCount(planRestore(h, cur, idMap)),
      backup: homeegramView(h, backupState),
      current: cur ? homeegramView(cur, homee.state) : null,
    };
  });
  const added = homee.state.homeegrams
    .filter((h) => !matchedIds.has(h.id))
    .map((h) => ({ id: h.id, currentId: h.id, name: decode(h.name), status: 'new' as const, changes: 0, backup: null, current: homeegramView(h, homee.state) }));
  return { file: req.params.file, createdAt: b.createdAt, reason: b.reason, homeegrams: [...rows, ...added] };
});

app.post<{ Params: { file: string }; Body: { ids: number[] } }>('/api/backups/:file/restore', async (req) => {
  const ids = (req.body?.ids ?? []).map((x) => toInt(x, 'id'));
  if (!ids.length) throw httpError(400, 'ids fehlt');
  const b = (await readBackup(req.params.file)) as BackupContent;
  const selected = ids.map((id) => {
    const h = b.homeegrams.find((x) => x.id === id);
    if (!h) throw httpError(404, `Homeegramm ${id} ist nicht in der Sicherung`);
    return h;
  });

  return write(
    req,
    'restore-homeegrams',
    { file: req.params.file, ids, names: selected.map((h) => decode(h.name)) },
    async () => {
      const matched = matchBackup(b.homeegrams);
      // alte → aktuelle IDs, damit Verweise zwischen Homeegrammen stimmen
      const idMap = new Map<number, number>();
      for (const [oldId, cur] of matched) if (cur && cur.id !== oldId) idMap.set(oldId, cur.id);

      // 1. Gelöschte Homeegramme zuerst (leer, inaktiv) anlegen, damit Verweise aufeinander auflösbar sind
      for (const h of selected) {
        if (matched.get(h.id)) continue;
        const created = await homee.createHomeegram(decode(h.name), { active: 0 });
        idMap.set(h.id, created.id);
      }
      // 2. Inhalte angleichen
      const results = [];
      for (const h of selected) {
        const targetId = idMap.get(h.id) ?? h.id;
        const current = homee.state.homeegrams.find((x) => x.id === targetId);
        const res = await applyChanges(targetId, planRestore(h, current, idMap));
        results.push({ id: h.id, currentId: targetId, name: decode(h.name), ...res });
      }
      return { results };
    },
    'force',
  );
});

app.post<{ Body: unknown }>('/api/backups/import', async (req) => importBackup(req.body));

// ---------------------------------------------------------------- Gerätetausch

function swapInput(body: { pairs?: SwapPair[]; groups?: boolean; rename?: boolean } | undefined) {
  const pairs = (body?.pairs ?? []).map((p) => ({ from: toInt(p.from, 'from'), to: toInt(p.to, 'to') }));
  if (!pairs.length) throw httpError(400, 'pairs fehlt (Liste aus { from, to })');
  if (new Set(pairs.map((p) => p.from)).size !== pairs.length) throw httpError(400, 'Ein altes Gerät ist mehrfach angegeben');
  return { pairs, opts: { groups: body?.groups !== false, rename: body?.rename === true } };
}

app.post<{ Body: { pairs: SwapPair[]; groups?: boolean; rename?: boolean } }>('/api/swap/preview', async (req) => {
  requireConnection();
  const { pairs, opts } = swapInput(req.body);
  return planSwap(homee.state, pairs, opts);
});

app.post<{ Body: { pairs: SwapPair[]; groups?: boolean; rename?: boolean } }>('/api/swap/apply', async (req) => {
  const { pairs, opts } = swapInput(req.body);
  return write(
    req,
    'swap-devices',
    { pairs, opts },
    async () => {
      const plan = planSwap(homee.state, pairs, opts);
      const errors: string[] = [];
      for (const hg of plan.homeegrams) {
        const res = await applyChanges(hg.id, { update: hg.changes.map((c) => ({ kind: c.kind, itemId: c.itemId, params: c.params })) });
        if (res.error) errors.push(`„${hg.name}“: ${res.error}`);
      }
      for (const g of plan.groups) {
        try {
          for (const nodeId of g.add) await homee.addToGroup(g.groupId, nodeId);
          for (const r of g.removeRelationships) await homee.removeRelationship(r.id);
        } catch (err) {
          errors.push(`Gruppe „${g.name}“: ${(err as Error).message}`);
        }
      }
      for (const r of plan.renames) {
        try {
          await homee.renameNode(r.nodeId, r.to);
        } catch (err) {
          errors.push(`Umbenennen „${r.from}“: ${(err as Error).message}`);
        }
      }
      await homee.refreshAll();
      return { plan, errors };
    },
    'force',
  );
});

// ---------------------------------------------------------------- Live-Ereignisse (Server-Sent Events)

app.get('/api/events', (req: FastifyRequest, reply: FastifyReply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('connection', { connected: homee.connected });

  const onAttr = (a: HomeeAttribute) => send('attribute', attributeView(a));
  const onHg = (h: Homeegram) => send('homeegram', homeegramView(h, homee.state));
  const onState = () => send('state', {});
  const onConn = () => send('connection', { connected: true });
  const onDisc = () => send('connection', { connected: false });
  homee.on('attribute', onAttr);
  homee.on('homeegram', onHg);
  homee.on('state', onState);
  homee.on('connected', onConn);
  homee.on('disconnected', onDisc);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  req.raw.on('close', () => {
    clearInterval(ping);
    homee.off('attribute', onAttr);
    homee.off('homeegram', onHg);
    homee.off('state', onState);
    homee.off('connected', onConn);
    homee.off('disconnected', onDisc);
  });
});

// ---------------------------------------------------------------- gebautes Frontend ausliefern

if (existsSync(config.frontendDist)) {
  await app.register(fastifyStatic, { root: config.frontendDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
    return reply.sendFile('index.html');
  });
}

// ---------------------------------------------------------------- Start

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  // Läuft schon ein Backend (z. B. vom MCP-Server automatisch gestartet)? Dann einfach das weiterverwenden.
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    const running = await fetch(`http://127.0.0.1:${config.port}/api/status`, {
      headers: config.apiToken ? { 'x-api-key': config.apiToken } : {},
      signal: AbortSignal.timeout(2000),
    }).then((r) => r.ok, () => false);
    if (running) {
      console.log(`Backend läuft bereits auf Port ${config.port} – es wird weiterverwendet. Beenden mit "npm run stop".`);
      process.exit(0);
    }
  }
  throw err;
}

const pidFile = join(config.dataDir, 'backend.pid');
mkdirSync(config.dataDir, { recursive: true });
writeFileSync(pidFile, String(process.pid));
process.on('exit', () => rmSync(pidFile, { force: true }));

homee.connect().catch((err: Error) => {
  app.log.error(`Erste Verbindung zu homee fehlgeschlagen: ${err.message}. Neuer Versuch läuft automatisch.`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    homee.disconnect();
    await app.close();
    process.exit(0);
  });
}
