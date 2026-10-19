// Rohe Datenstrukturen, wie homee sie über den WebSocket liefert.
// Nicht vollständig: homee schickt mehr Felder, die hier über die Index-Signatur durchgereicht werden.

export interface HomeeAttribute {
  id: number;
  node_id: number;
  instance: number;
  minimum: number;
  maximum: number;
  current_value: number;
  target_value: number;
  last_value: number;
  unit: string;
  step_value: number;
  editable: number;
  type: number;
  state: number;
  last_changed: number;
  changed_by: number;
  changed_by_id: number;
  based_on: number;
  data: string;
  name: string;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HomeeNode {
  id: number;
  name: string;
  profile: number;
  image: string;
  favorite: number;
  order: number;
  protocol: number;
  routing: number;
  state: number;
  state_changed: number;
  added: number;
  history: number;
  cube_type: number;
  note: string;
  services: number;
  phonetic_name: string;
  owner: number;
  security: number;
  attributes: HomeeAttribute[];
  [key: string]: unknown;
}

export interface HomeeGroup {
  id: number;
  name: string;
  image: string;
  order: number;
  added: number;
  state: number;
  category: number;
  phonetic_name: string;
  note: string;
  services: number;
  owner: number;
  [key: string]: unknown;
}

export interface HomeeRelationship {
  id: number;
  group_id: number;
  node_id: number;
  homeegram_id: number;
  order: number;
  [key: string]: unknown;
}

/** Ein Auslöser, eine Bedingung oder eine Aktion eines Homeegramms. */
export interface HomeegramItem {
  id: number;
  homeegram_id: number;
  [key: string]: unknown;
}

/** Auslöser/Bedingungen/Aktionen sind nach Art gruppiert, z. B. { time_triggers: [...], attribute_triggers: [...] }. */
export type HomeegramItemGroups = Record<string, HomeegramItem[]>;

export interface Homeegram {
  id: number;
  name: string;
  image: string;
  active: number;
  play: number;
  state: number;
  favorite: number;
  order: number;
  visible: number;
  last_triggered: number;
  owner: number;
  note: string;
  triggers: HomeegramItemGroups;
  conditions: HomeegramItemGroups;
  actions: HomeegramItemGroups;
  [key: string]: unknown;
}

export interface HomeeState {
  nodes: HomeeNode[];
  groups: HomeeGroup[];
  relationships: HomeeRelationship[];
  homeegrams: Homeegram[];
  plans: Record<string, unknown>[];
  settings: Record<string, unknown> | null;
  users: Record<string, unknown>[];
}

/** Eine Nachricht von homee hat genau einen Schlüssel, z. B. { "attribute": {...} }. */
export type HomeeMessage = Record<string, unknown>;

export type ItemKind = 'triggers' | 'conditions' | 'actions';
