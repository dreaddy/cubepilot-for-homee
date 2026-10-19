import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { Enums } from './enums.ts';
import type {
  HomeeAttribute,
  HomeeMessage,
  HomeeState,
  Homeegram,
  HomeegramItem,
  ItemKind,
} from './types.ts';

export interface HomeeClientOptions {
  /** Lokale IP/Hostname oder die 12-stellige homee-ID (dann Verbindung über <id>.hom.ee). */
  host: string;
  user: string;
  password: string;
  /** homee erlaubt nur eine Verbindung pro Gerätename. */
  deviceName?: string;
  reconnectIntervalMs?: number;
  requestTimeoutMs?: number;
}

export interface WaitResult {
  type: string;
  data: unknown;
}

/** Prüft, ob eine Nachricht die erwartete Antwort ist (Fehler/Warnungen werden immer durchgelassen). */
export type MessageFilter = (type: string, data: any) => boolean;

interface Waiter {
  types: string[];
  filter?: MessageFilter;
  resolve: (r: WaitResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Client für die (inoffizielle) WebSocket-API des homee.
 *
 * Events: 'connected', 'disconnected', 'error' (Error), 'message' (HomeeMessage),
 * 'attribute' (HomeeAttribute), 'node', 'homeegram', 'state' (nach GET:all)
 */
export class HomeeClient extends EventEmitter {
  readonly state: HomeeState = {
    nodes: [],
    groups: [],
    relationships: [],
    homeegrams: [],
    plans: [],
    settings: null,
    users: [],
  };

  connected = false;
  /** true, sobald nach dem Verbinden der vollständige Zustand (GET:all) geladen ist */
  ready = false;
  lastError: string | null = null;

  private ws: WebSocket | null = null;
  private token: string | null = null;
  private tokenExpires = 0;
  private shouldRun = false;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private alive = false;
  private waiters: Waiter[] = [];
  /** Wird bei disconnect() erhöht, damit späte Ereignisse alter Sockets ignoriert werden. */
  private generation = 0;
  private readonly opts: Required<HomeeClientOptions>;

  constructor(options: HomeeClientOptions) {
    super();
    this.opts = {
      deviceName: 'cubepilot-for-homee',
      reconnectIntervalMs: 5000,
      requestTimeoutMs: 8000,
      ...options,
    };
    // Ohne Listener würde ein 'error'-Event den Prozess beenden.
    this.on('error', () => {});
  }

  get isRemote(): boolean {
    return /^[0-9a-zA-Z]{12}$/.test(this.opts.host);
  }

  private get httpUrl(): string {
    return this.isRemote ? `https://${this.opts.host}.hom.ee` : `http://${this.opts.host}:7681`;
  }

  private get wsUrl(): string {
    return this.isRemote ? `wss://${this.opts.host}.hom.ee` : `ws://${this.opts.host}:7681`;
  }

  /** Verbindet und wartet, bis der erste vollständige Zustand (GET:all) da ist. */
  async connect(): Promise<void> {
    this.shouldRun = true;
    try {
      await this.openSocket();
    } catch (err) {
      this.lastError = (err as Error).message;
      this.scheduleReconnect();
      throw err;
    }
    if (!this.ready) await this.waitFor(['all'], 15000);
  }

  disconnect(): void {
    this.shouldRun = false;
    this.generation++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.ready = false;
    this.rejectWaiters(new Error('Verbindung zu homee getrennt'));
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.tokenExpires > Date.now() + 60_000) return this.token;

    const pwHash = createHash('sha512').update(this.opts.password).digest('hex');
    const basic = Buffer.from(`${this.opts.user}:${pwHash}`).toString('base64');
    const hardwareId = createHash('md5').update(this.opts.deviceName).digest('hex').slice(0, 16);
    const body = new URLSearchParams({
      device_name: this.opts.deviceName,
      device_hardware_id: hardwareId,
      device_os: String(Enums.CADeviceOS.CADeviceOSLinux),
      device_type: String(Enums.CADeviceType.CADeviceTypeNone),
      device_app: String(Enums.CADeviceApp.CADeviceAppHomee),
    });

    const res = await fetch(`${this.httpUrl}/access_token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Anmeldung bei homee fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    const parsed = new URLSearchParams(text);
    const token = parsed.get('access_token');
    if (!token) throw new Error(`Unerwartete Antwort beim Token-Abruf: ${text.slice(0, 200)}`);
    this.token = token;
    this.tokenExpires = Date.now() + Number(parsed.get('expires') ?? 3600) * 1000;
    return token;
  }

  /** Neue Zugangsdaten übernehmen und neu verbinden. */
  async reconfigure(options: Pick<HomeeClientOptions, 'host' | 'user' | 'password'>): Promise<void> {
    this.disconnect();
    Object.assign(this.opts, options);
    this.token = null;
    this.tokenExpires = 0;
    this.lastError = null;
    await this.connect();
  }

  private async openSocket(): Promise<void> {
    const gen = this.generation;
    const token = await this.getAccessToken();
    if (gen !== this.generation) throw new Error('Verbindung wurde zwischenzeitlich getrennt');

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}/connection?access_token=${token}`, 'v2', {
        origin: this.httpUrl,
        handshakeTimeout: 10000,
      });
      this.ws = ws;
      let opened = false;

      ws.on('open', () => {
        if (gen !== this.generation) return ws.close();
        opened = true;
        this.connected = true;
        this.ready = false;
        this.lastError = null;
        this.startHeartbeat();
        this.emit('connected');
        this.send('GET:all');
        resolve();
      });

      ws.on('message', (raw) => { if (gen === this.generation) this.handleRaw(raw.toString()); });

      ws.on('pong', () => {
        this.alive = true;
      });

      ws.on('error', (err) => {
        if (gen !== this.generation) return;
        this.lastError = err.message;
        this.emit('error', err);
        if (!opened) reject(err);
      });

      ws.on('close', (code, reason) => {
        if (!opened) reject(new Error(`homee-Verbindung vor dem Öffnen geschlossen (${code})`));
        if (gen !== this.generation) return;
        this.stopHeartbeat();
        const wasConnected = this.connected;
        this.connected = false;
        this.ready = false;
        this.rejectWaiters(new Error('Verbindung zu homee getrennt'));
        if (this.ws === ws) this.ws = null;
        if (wasConnected) this.emit('disconnected', { code, reason: reason.toString() });
        // 4401/4403 o. ä.: Token ungültig -> beim nächsten Versuch neu holen
        if (code >= 4000) this.token = null;
        this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldRun || this.connected) return;
      try {
        await this.openSocket();
      } catch (err) {
        this.lastError = (err as Error).message;
        this.emit('error', err);
        this.scheduleReconnect();
      }
    }, this.opts.reconnectIntervalMs);
  }

  private startHeartbeat(): void {
    this.alive = true;
    this.heartbeat = setInterval(() => {
      if (!this.ws) return;
      if (!this.alive) {
        this.ws.terminate();
        return;
      }
      this.alive = false;
      this.ws.ping();
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private handleRaw(raw: string): void {
    let msg: HomeeMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.emit('error', new Error(`Nicht-JSON-Nachricht von homee: ${raw.slice(0, 200)}`));
      return;
    }
    const type = Object.keys(msg)[0];
    if (!type) return;
    const data = msg[type];
    this.applyToState(type, data);

    for (const w of [...this.waiters]) {
      if (w.types.includes(type) && (!w.filter || type === 'warning' || type === 'error' || w.filter(type, data))) {
        clearTimeout(w.timer);
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve({ type, data });
      }
    }

    this.emit('message', msg);
    this.emit(type, type === 'error' ? new Error(`homee: ${JSON.stringify(data)}`) : data);
  }

  private applyToState(type: string, data: any): void {
    const s = this.state;
    switch (type) {
      case 'all':
        this.ready = true;
        s.nodes = data.nodes ?? [];
        s.groups = data.groups ?? [];
        s.relationships = data.relationships ?? [];
        s.homeegrams = data.homeegrams ?? [];
        s.plans = data.plans ?? [];
        s.settings = data.settings ?? null;
        s.users = data.users ?? [];
        this.emit('state', s);
        break;
      case 'attribute':
        this.applyAttribute(data as HomeeAttribute);
        break;
      case 'node':
        upsert(s.nodes, data);
        break;
      case 'nodes':
        s.nodes = data;
        break;
      case 'group':
        upsert(s.groups, data);
        break;
      case 'groups':
        s.groups = data;
        break;
      case 'relationship':
        upsert(s.relationships, data);
        break;
      case 'relationships':
        s.relationships = data;
        break;
      case 'homeegram':
        upsert(s.homeegrams, data);
        break;
      case 'homeegrams':
        s.homeegrams = data;
        break;
      case 'settings':
        s.settings = data;
        break;
    }
  }

  private applyAttribute(attr: HomeeAttribute): void {
    const node = this.state.nodes.find((n) => n.id === attr.node_id);
    if (!node) return;
    const i = node.attributes.findIndex((a) => a.id === attr.id);
    if (i >= 0) node.attributes[i] = { ...node.attributes[i], ...attr };
    else node.attributes.push(attr);
  }

  // ---------------------------------------------------------------- senden

  /** Schickt einen Rohbefehl, z. B. "GET:nodes" oder "PUT:homeegrams/3?play=1". */
  send(command: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Keine Verbindung zu homee');
    }
    this.ws.send(command);
  }

  /** Wartet auf die nächste Nachricht eines der angegebenen Typen. */
  waitFor(types: string[], timeoutMs = this.opts.requestTimeoutMs, filter?: MessageFilter, command?: string): Promise<WaitResult> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        types,
        filter,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error(`Keine Antwort von homee (erwartet: ${types.join(', ')})`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
      if (command !== undefined) {
        try {
          this.send(command);
        } catch (err) {
          clearTimeout(waiter.timer);
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(err);
        }
      }
    });
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  /** Sendet einen Befehl und wartet auf eine Antwort der angegebenen Typen. */
  async request(command: string, expect: string[], timeoutMs?: number, filter?: MessageFilter): Promise<WaitResult> {
    const res = await this.waitFor([...expect, 'warning', 'error'], timeoutMs, filter, command);
    if (res.type === 'warning' || res.type === 'error') {
      throw new Error(`homee meldet ${res.type}: ${JSON.stringify(res.data)}`);
    }
    return res;
  }

  /**
   * Sendet einen Befehl und wartet kurz auf eine Antwort, ohne einen Fehler zu werfen,
   * wenn keine kommt (manche Schreibbefehle werden nicht explizit bestätigt).
   */
  async sendAndSettle(command: string, expect: string[], timeoutMs = 3000, filter?: MessageFilter): Promise<WaitResult | null> {
    try {
      return await this.request(command, expect, timeoutMs, filter);
    } catch (err) {
      if ((err as Error).message.startsWith('Keine Antwort')) return null;
      throw err;
    }
  }

  async refreshAll(): Promise<HomeeState> {
    await this.request('GET:all', ['all'], 15000);
    return this.state;
  }

  // ---------------------------------------------------------------- Geräte

  async setValue(nodeId: number, attributeId: number, value: number): Promise<HomeeAttribute | null> {
    const res = await this.sendAndSettle(
      `PUT:nodes/${nodeId}/attributes/${attributeId}?target_value=${value}`,
      ['attribute'],
      3000,
      (_type, data) => data?.id === attributeId && data?.node_id === nodeId,
    );
    return (res?.data as HomeeAttribute) ?? null;
  }

  async getHistory(
    kind: 'node' | 'attribute' | 'homeegram',
    id: number,
    opts: { from?: number; till?: number; limit?: number; nodeId?: number } = {},
  ): Promise<unknown> {
    const params = query({ ...(opts.from && { from: opts.from }), ...(opts.till && { till: opts.till }), ...(opts.limit && { limit: opts.limit }) });
    let cmd: string;
    if (kind === 'attribute') {
      const nodeId = opts.nodeId ?? this.state.nodes.find((n) => n.attributes.some((a) => a.id === id))?.id;
      if (nodeId === undefined) throw new Error(`Attribut ${id} nicht gefunden`);
      cmd = `GET:nodes/${nodeId}/attributes/${id}/history${params}`;
    } else {
      cmd = `GET:${kind}s/${id}/history${params}`;
    }
    const res = await this.request(cmd, [`${kind}_history`], 15000);
    return res.data;
  }

  async getDiary(opts: { from?: number; till?: number; limit?: number } = {}): Promise<unknown> {
    const res = await this.request(`GET:diary${query(opts)}`, ['diary'], 15000);
    return res.data;
  }

  // ---------------------------------------------------------------- Homeegramme

  async playHomeegram(id: number): Promise<void> {
    await this.sendAndSettle(`PUT:homeegrams/${id}?play=1`, ['homeegram']);
  }

  async testHomeegram(id: number): Promise<void> {
    await this.sendAndSettle(`PUT:homeegrams/${id}?play=1&test=1`, ['homeegram']);
  }

  async setHomeegramActive(id: number, active: boolean): Promise<Homeegram | null> {
    const res = await this.sendAndSettle(`PUT:homeegrams/${id}?active=${active ? 1 : 0}`, ['homeegram']);
    return (res?.data as Homeegram) ?? null;
  }

  /** Ändert Eigenschaften des Homeegramms selbst (z. B. name, note). Experimentell. */
  async updateHomeegram(id: number, fields: Record<string, string | number>): Promise<Homeegram | null> {
    await this.sendAndSettle(`PUT:homeegrams/${id}${query(fields)}`, ['homeegram']);
    return this.fetchHomeegram(id);
  }

  async fetchHomeegram(id: number): Promise<Homeegram | null> {
    let res: WaitResult | null = null;
    try {
      res = await this.request(`GET:homeegrams/${id}`, ['homeegram'], 5000, (_t, d) => d?.id === id);
    } catch (err) {
      if (!(err as Error).message.startsWith('Keine Antwort')) throw err;
    }
    return (res?.data as Homeegram) ?? this.state.homeegrams.find((h) => h.id === id) ?? null;
  }

  async createHomeegram(name: string, fields: Record<string, string | number> = {}): Promise<Homeegram> {
    // Nur auf die Antwort zum NEUEN Homeegramm warten – nicht auf Meldungen zu anderen, die gerade geändert werden
    const known = new Set(this.state.homeegrams.map((h) => h.id));
    const res = await this.request(`POST:homeegrams${query({ name, ...fields })}`, ['homeegram'], undefined, (_t, d) => d && !known.has(d.id));
    return res.data as Homeegram;
  }

  async deleteHomeegram(id: number): Promise<void> {
    await this.sendAndSettle(`DELETE:homeegrams/${id}`, ['homeegram', 'homeegrams']);
    this.state.homeegrams = this.state.homeegrams.filter((h) => h.id !== id);
  }

  /**
   * Fügt einen Auslöser, eine Bedingung oder eine Aktion hinzu.
   * params entsprechen den Feldern des Eintrags, z. B. für eine Attribut-Aktion:
   * { type: 1, node_id: 5, attribute_id: 12, value: 1, command: 1 }
   */
  async addItem(homeegramId: number, kind: ItemKind, params: Record<string, string | number>): Promise<Homeegram | null> {
    await this.sendAndSettle(`POST:homeegrams/${homeegramId}/${kind}${query(params)}`, [
      'homeegram',
      kind.slice(0, -1),
    ]);
    return this.fetchHomeegram(homeegramId);
  }

  /** Ändert einen bestehenden Eintrag. Experimentell: von homee nicht dokumentiert. */
  async updateItem(
    homeegramId: number,
    kind: ItemKind,
    itemId: number,
    params: Record<string, string | number>,
  ): Promise<Homeegram | null> {
    await this.sendAndSettle(`PUT:homeegrams/${homeegramId}/${kind}/${itemId}${query(params)}`, [
      'homeegram',
      kind.slice(0, -1),
    ]);
    return this.fetchHomeegram(homeegramId);
  }

  /** Löscht einen Eintrag. Experimentell: von homee nicht dokumentiert. */
  async deleteItem(homeegramId: number, kind: ItemKind, itemId: number): Promise<Homeegram | null> {
    await this.sendAndSettle(`DELETE:homeegrams/${homeegramId}/${kind}/${itemId}`, ['homeegram', kind.slice(0, -1)]);
    return this.fetchHomeegram(homeegramId);
  }

  // ---------------------------------------------------------------- Gruppen & Geräte verwalten

  /** Nimmt ein Gerät in eine Gruppe auf. */
  async addToGroup(groupId: number, nodeId: number): Promise<void> {
    await this.sendAndSettle(`POST:relationships${query({ group_id: groupId, node_id: nodeId })}`, ['relationship']);
  }

  /** Entfernt eine Gruppenmitgliedschaft (homee bestätigt das nicht – Zustand danach neu laden). */
  async removeRelationship(relationshipId: number): Promise<void> {
    await this.sendAndSettle(`DELETE:relationships/${relationshipId}`, ['relationship', 'relationships'], 1500);
    this.state.relationships = this.state.relationships.filter((r) => r.id !== relationshipId);
  }

  async renameNode(nodeId: number, name: string): Promise<void> {
    await this.sendAndSettle(`PUT:nodes/${nodeId}${query({ name })}`, ['node']);
  }

  findItem(homeegramId: number, kind: ItemKind, itemId: number): { group: string; item: HomeegramItem } | null {
    const hg = this.state.homeegrams.find((h) => h.id === homeegramId);
    for (const [group, items] of Object.entries(hg?.[kind] ?? {})) {
      const item = items.find((i) => i.id === itemId);
      if (item) return { group, item };
    }
    return null;
  }
}

function upsert<T extends { id: number }>(list: T[], obj: T): void {
  const i = list.findIndex((o) => o.id === obj.id);
  if (i >= 0) list[i] = obj;
  else list.push(obj);
}

/** Baut "?a=1&b=x" mit Prozent-Kodierung (homee erwartet %20 statt +). */
export function query(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
