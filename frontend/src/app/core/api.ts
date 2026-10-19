import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { translateServerMessage } from './server-messages';
import type {
  AuditEntry,
  BackupComparison,
  BackupInfo,
  RestoreResult,
  SwapPair,
  SwapPlan,
  ChangeSet,
  GroupView,
  HomeegramSummary,
  HomeegramView,
  NodeView,
  Params,
  SaveResult,
  SetupInfo,
  SetupInput,
  ConnectionTest,
  Status,
} from './models';

const KEY_STORAGE = 'cubepilot-for-homee.apiKey';

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  /** Optionaler API-Schlüssel (nur nötig, wenn im Backend API_TOKEN gesetzt ist). */
  readonly apiKey = signal(readKey());

  setApiKey(key: string): void {
    this.apiKey.set(key);
    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch {
      // Speicher nicht verfügbar – Schlüssel gilt dann nur für diese Sitzung
    }
  }

  private headers(): HttpHeaders {
    let h = new HttpHeaders({ 'x-client': 'frontend' });
    if (this.apiKey()) h = h.set('x-api-key', this.apiKey());
    return h;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await firstValueFrom(this.http.request<T>(method, `/api${path}`, { body, headers: this.headers() }));
    } catch (err) {
      if (err instanceof HttpErrorResponse) {
        throw new Error(err.error?.error ? translateServerMessage(err.error.error) : `${err.status} ${err.statusText}`);
      }
      throw err;
    }
  }

  eventsUrl(): string {
    return this.apiKey() ? `/api/events?key=${encodeURIComponent(this.apiKey())}` : '/api/events';
  }

  status = () => this.req<Status>('GET', '/status');
  refresh = () => this.req('POST', '/refresh');

  nodes = () => this.req<NodeView[]>('GET', '/nodes');
  nodeUsage = (id: number) => this.req<HomeegramSummary[]>('GET', `/nodes/${id}/usage`);
  setValue = (nodeId: number, attributeId: number, value: number) =>
    this.req('PUT', `/nodes/${nodeId}/attributes/${attributeId}`, { value });
  groups = () => this.req<GroupView[]>('GET', '/groups');
  webhookUrl = (event: string) =>
    this.req<{ local: string | null; remote: string | null }>('GET', `/webhook-url?event=${encodeURIComponent(event)}`);

  homeegrams = () => this.req<HomeegramView[]>('GET', '/homeegrams?full=1');
  homeegram = (id: number) => this.req<HomeegramView>('GET', `/homeegrams/${id}`);
  homeegramRaw = (id: number) => this.req<Record<string, unknown>>('GET', `/homeegrams/${id}?raw=1`);
  play = (id: number) => this.req('POST', `/homeegrams/${id}/play`);
  test = (id: number) => this.req('POST', `/homeegrams/${id}/test`);
  setActive = (id: number, active: boolean) => this.req<HomeegramView>('PUT', `/homeegrams/${id}/active`, { active });
  deleteHomeegram = (id: number) => this.req('DELETE', `/homeegrams/${id}`);
  /** Legt ein Homeegramm samt Einträgen an. */
  createHomeegram = (name: string, fields: Params, add: ChangeSet['add']) =>
    this.req<SaveResult>('POST', '/homeegrams', { name, fields, add });
  /** Speichert ein Änderungspaket aus dem Editor. */
  saveChanges = (id: number, changes: ChangeSet) => this.req<SaveResult>('POST', `/homeegrams/${id}/changes`, changes);

  backups = () => this.req<BackupInfo[]>('GET', '/backups');
  backup = (file: string) => this.req<unknown>('GET', `/backups/${encodeURIComponent(file)}`);
  createBackup = (reason: string) => this.req<BackupInfo>('POST', '/backups', { reason });
  compareBackup = (file: string) => this.req<BackupComparison>('GET', `/backups/${encodeURIComponent(file)}/homeegrams`);
  restoreHomeegrams = (file: string, ids: number[]) =>
    this.req<RestoreResult>('POST', `/backups/${encodeURIComponent(file)}/restore`, { ids });
  importBackup = (content: unknown) => this.req<BackupInfo>('POST', '/backups/import', content);
  swapPreview = (pairs: SwapPair[], groups: boolean, rename: boolean) => this.req<SwapPlan>('POST', '/swap/preview', { pairs, groups, rename });
  swapApply = (pairs: SwapPair[], groups: boolean, rename: boolean) =>
    this.req<{ plan: SwapPlan; errors: string[] }>('POST', '/swap/apply', { pairs, groups, rename });
  audit = (limit = 200) => this.req<AuditEntry[]>('GET', `/audit?limit=${limit}`);
  raw = (command: string, timeoutMs?: number) =>
    this.req<{ command: string; received: unknown[] }>('POST', '/raw', { command, timeoutMs });

  setup = () => this.req<SetupInfo>('GET', '/setup');
  testSetup = (input: SetupInput) => this.req<ConnectionTest>('POST', '/setup/test', input);
  /** Speichert in .env und verbindet neu; ohne force nur nach erfolgreichem Verbindungstest. */
  saveSetup = (input: SetupInput, force = false) => this.req<ConnectionTest>('POST', '/setup', { ...input, force });
}

function readKey(): string {
  try {
    const current = localStorage.getItem(KEY_STORAGE);
    if (current !== null) return current;
    const previous = localStorage.getItem('homee-control.apiKey');
    if (previous) {
      localStorage.setItem(KEY_STORAGE, previous);
      localStorage.removeItem('homee-control.apiKey');
    }
    return previous ?? '';
  } catch {
    return '';
  }
}
