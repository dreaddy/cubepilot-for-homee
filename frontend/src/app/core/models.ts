// Spiegel der Ansichten aus packages/homee-client/src/views.ts (REST-Antworten des Backends).

export interface Status {
  connected: boolean;
  remote: boolean;
  host: string;
  homeeName: string;
  version: string | null;
  lastError: string | null;
  readOnly: boolean;
  allowRaw: boolean;
  counts: { nodes: number; homeegrams: number; groups: number };
}

/** homee-Zugangsdaten (Passwort wird nie zurückgegeben). */
export interface SetupInfo {
  mode: 'local' | 'remote';
  ip: string;
  homeeId: string;
  user: string;
  hasPassword: boolean;
  /** null = unbekannt (keine Verbindung) */
  isAdmin: boolean | null;
}

export interface SetupInput {
  mode: 'local' | 'remote';
  ip: string;
  homeeId: string;
  user: string;
  /** leer = bisheriges Passwort behalten */
  password: string;
}

export interface ConnectionTest {
  ok: boolean;
  error?: string;
  homeeName?: string;
  version?: string;
  nodes?: number;
  homeeId?: string;
  isAdmin?: boolean;
}

export interface AttributeView {
  id: number;
  nodeId: number;
  type: number;
  typeName: string;
  instance: number;
  name: string;
  value: number;
  target: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  editable: boolean;
  lastChanged: string | null;
}

export interface NodeView {
  id: number;
  name: string;
  profile: number;
  profileName: string;
  protocol: string;
  state: string;
  favorite: boolean;
  note: string;
  attributes: AttributeView[];
}

export interface GroupView {
  id: number;
  name: string;
  nodeIds: number[];
}

export type ItemKind = 'triggers' | 'conditions' | 'actions';

export interface ItemView {
  id: number;
  kind: ItemKind;
  group: string;
  description: string;
  raw: Record<string, unknown>;
}

export interface HomeegramSummary {
  id: number;
  name: string;
  active: boolean;
  lastTriggered: string | null;
  triggerCount: number;
  conditionCount: number;
  actionCount: number;
  summary: string;
}

export interface HomeegramView {
  id: number;
  name: string;
  active: boolean;
  playing: boolean;
  favorite: boolean;
  note: string;
  lastTriggered: string | null;
  triggers: ItemView[];
  conditions: ItemView[];
  actions: ItemView[];
  summary: string;
}

export type Params = Record<string, string | number | boolean | unknown[]>;

export interface ChangeSet {
  fields?: Params;
  remove?: { kind: ItemKind; itemId: number }[];
  update?: { kind: ItemKind; itemId: number; params: Params }[];
  add?: { kind: ItemKind; params: Params }[];
}

export interface SaveResult {
  id?: number;
  applied: number;
  error: string | null;
  homeegram: HomeegramView | null;
}

export interface BackupInfo {
  file: string;
  createdAt: string;
  reason: string;
  size: number;
}

export interface AuditEntry {
  at: string;
  source: string;
  action: string;
  details: unknown;
  ok: boolean;
  error?: string;
}

export type RestoreStatus = 'unchanged' | 'changed' | 'deleted' | 'new';

export interface BackupHomeegram {
  id: number;
  currentId: number | null;
  name: string;
  status: RestoreStatus;
  changes: number;
  backup: HomeegramView | null;
  current: HomeegramView | null;
}

export interface BackupComparison {
  file: string;
  createdAt: string;
  reason: string;
  homeegrams: BackupHomeegram[];
}

export interface RestoreResult {
  results: { id: number; currentId: number; name: string; applied: number; error: string | null }[];
}

export interface SwapPair {
  from: number;
  to: number;
}

export interface SwapPlan {
  homeegrams: { id: number; name: string; changes: { kind: ItemKind; itemId: number; group: string; before: string; after: string }[] }[];
  groups: { groupId: number; name: string; add: number[]; removeRelationships: { id: number; nodeId: number }[] }[];
  renames: { nodeId: number; from: string; to: string }[];
  warnings: string[];
}
