// Planung von Wiederherstellung (aus Sicherungen) und Gerätetausch.
// Erzeugt Änderungspakete (ChangeSet), die das Backend der Reihe nach an homee schickt.

import type { HomeeAttribute, HomeeNode, HomeeState, Homeegram, HomeegramItem, ItemKind } from './types.ts';
import { decode, enumName } from './views.ts';

/** Gruppe der Einträge (wie homee sie liefert) → Typnummer für POST:homeegrams/<id>/<art>?type=… */
export const ITEM_GROUP_TYPES: Record<string, number> = {
  time_triggers: 1,
  attribute_triggers: 2,
  switch_triggers: 3,
  webhook_triggers: 4,
  homeegram_triggers: 5,
  celestial_triggers: 6,
  plan_triggers: 7,
  group_triggers: 8,
  user_triggers: 9,
  time_conditions: 1,
  attribute_conditions: 2,
  homeegram_conditions: 3,
  celestial_conditions: 4,
  plan_conditions: 5,
  group_conditions: 6,
  user_conditions: 7,
  attribute_actions: 1,
  tts_actions: 2,
  notification_actions: 3,
  group_actions: 4,
  webhook_actions: 5,
  homeegram_actions: 6,
  plan_actions: 7,
  user_actions: 8,
};

export const ITEM_KINDS: ItemKind[] = ['triggers', 'conditions', 'actions'];

export type Params = Record<string, string | number | boolean | unknown[]>;

export interface ChangeSet {
  fields?: Params;
  remove?: { kind: ItemKind; itemId: number }[];
  update?: { kind: ItemKind; itemId: number; params: Params }[];
  add?: { kind: ItemKind; params: Params }[];
}

/** Felder, die homee prozent-kodiert liefert und beim Senden wieder kodiert werden. */
const ENCODED = ['message', 'url', 'body', 'event', 'content_type'];
const SKIP = new Set(['id', 'homeegram_id', 'next_invocation']);
const HG_REFS = ['source_homeegram_id', 'target_homeegram_id'];

/** Felder eines Eintrags als Parameter (dekodiert, ohne IDs). */
export function itemFields(item: HomeegramItem, idMap: Map<number, number> = new Map()): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(item)) {
    if (SKIP.has(k) || v === null || v === undefined) continue;
    if (HG_REFS.includes(k) && idMap.has(Number(v))) out[k] = idMap.get(Number(v))!;
    else out[k] = ENCODED.includes(k) && typeof v === 'string' ? decode(v) : (v as Params[string]);
  }
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function flatItems(hg: Homeegram, kind: ItemKind): { group: string; item: HomeegramItem }[] {
  return Object.entries(hg[kind] ?? {}).flatMap(([group, items]) => (items ?? []).map((item) => ({ group, item })));
}

// ---------------------------------------------------------------- Wiederherstellen

export type RestoreStatus = 'unchanged' | 'changed' | 'deleted' | 'new';

/**
 * Plant, wie ein Homeegramm wieder auf den Stand der Sicherung gebracht wird.
 * current fehlt → Homeegramm wurde gelöscht und muss neu angelegt werden (dann nur add).
 * idMap: alte → neue Homeegramm-IDs (für Verweise auf ebenfalls neu angelegte Homeegramme).
 */
export function planRestore(backup: Homeegram, current: Homeegram | undefined, idMap: Map<number, number> = new Map()): ChangeSet {
  const cs: Required<ChangeSet> = { fields: {}, remove: [], update: [], add: [] };
  for (const kind of ITEM_KINDS) {
    const cur = current ? flatItems(current, kind) : [];
    const bak = flatItems(backup, kind);
    const used = new Set<number>();
    const pending: { group: string; item: HomeegramItem }[] = [];

    // 1. Gleiche ID → Felder vergleichen
    for (const b of bak) {
      const match = cur.find((c) => c.item.id === b.item.id && c.group === b.group);
      if (!match) {
        pending.push(b);
        continue;
      }
      used.add(match.item.id);
      const wanted = itemFields(b.item, idMap);
      const have = itemFields(match.item);
      const changed = Object.keys(wanted).filter((k) => !sameValue(wanted[k], have[k]));
      if (changed.length) cs.update.push({ kind, itemId: match.item.id, params: Object.fromEntries(changed.map((k) => [k, wanted[k]])) });
    }
    // 2. Andere ID, aber gleicher Inhalt (z. B. nach einer früheren Wiederherstellung) → nichts zu tun
    for (const b of pending) {
      const wanted = itemFields(b.item, idMap);
      const twin = cur.find((c) => !used.has(c.item.id) && c.group === b.group && sameValue(itemFields(c.item), wanted));
      if (twin) used.add(twin.item.id);
      else cs.add.push({ kind, params: { type: ITEM_GROUP_TYPES[b.group] ?? 0, ...wanted } });
    }
    // 3. Übrige aktuelle Einträge gab es in der Sicherung nicht
    for (const c of cur) if (!used.has(c.item.id)) cs.remove.push({ kind, itemId: c.item.id });
  }
  const name = decode(backup.name);
  if (!current || decode(current.name) !== name) cs.fields.name = name;
  if (!current || current.active !== backup.active) cs.fields.active = backup.active;
  return cs;
}

export function changeCount(cs: ChangeSet): number {
  return (cs.remove?.length ?? 0) + (cs.update?.length ?? 0) + (cs.add?.length ?? 0) + Object.keys(cs.fields ?? {}).length;
}

export function restoreStatus(backup: Homeegram | undefined, current: Homeegram | undefined, idMap: Map<number, number> = new Map()): RestoreStatus {
  if (!backup) return 'new';
  if (!current) return 'deleted';
  return changeCount(planRestore(backup, current, idMap)) ? 'changed' : 'unchanged';
}

// ---------------------------------------------------------------- Gerätetausch

export interface SwapPair {
  from: number;
  to: number;
}

export interface SwapOptions {
  /** Gruppenmitgliedschaften vom alten auf das neue Gerät übertragen */
  groups: boolean;
  /** Neues Gerät bekommt den Namen des alten, altes Gerät „<Name> (alt)“ */
  rename: boolean;
}

export interface SwapItemChange {
  kind: ItemKind;
  itemId: number;
  group: string;
  before: string;
  after: string;
  params: Params;
}

export interface SwapPlan {
  homeegrams: { id: number; name: string; changes: SwapItemChange[] }[];
  groups: { groupId: number; name: string; add: number[]; removeRelationships: { id: number; nodeId: number }[] }[];
  renames: { nodeId: number; from: string; to: string }[];
  warnings: string[];
}

const typeName = (a: HomeeAttribute) => enumName('CAAttributeType', a.type);

/** Ordnet einem Attribut des alten Geräts das passende am neuen Gerät zu (gleicher Typ, gleiche Instanz). */
export function matchAttribute(oldAttr: HomeeAttribute, newNode: HomeeNode): HomeeAttribute | undefined {
  const sameType = newNode.attributes.filter((a) => a.type === oldAttr.type);
  return sameType.find((a) => a.instance === oldAttr.instance) ?? (sameType.length === 1 ? sameType[0] : undefined);
}

export function planSwap(state: HomeeState, pairs: SwapPair[], opts: SwapOptions): SwapPlan {
  const invalid = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  if (!pairs.length) invalid('Mindestens ein Gerätepaar angeben.');
  const sources = new Set(pairs.map((p) => p.from));
  const targets = new Set(pairs.map((p) => p.to));
  if (sources.size !== pairs.length || targets.size !== pairs.length) invalid('Jedes alte und neue Gerät darf nur einmal vorkommen.');
  for (const { from, to } of pairs) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) invalid('Ungültige Geräte-ID.');
    if (!state.nodes.some((n) => n.id === from) || !state.nodes.some((n) => n.id === to)) invalid('Gerät nicht gefunden.');
    if (sources.has(to)) invalid('Alte und neue Geräte müssen verschieden sein; Tauschketten sind nicht unterstützt.');
  }
  const plan: SwapPlan = { homeegrams: [], groups: [], renames: [], warnings: [] };
  const node = (id: number) => state.nodes.find((n) => n.id === id);
  const nodeName = (id: number) => decode(node(id)?.name) || `#${id}`;

  // Attribut-Zuordnung alt → neu
  const attrMap = new Map<number, { to: HomeeAttribute; toNode: HomeeNode }>();
  const missing = new Map<number, string>();
  for (const { from, to } of pairs) {
    const a = node(from), b = node(to);
    if (!a || !b) {
      plan.warnings.push(`Gerät ${!a ? from : to} gibt es nicht.`);
      continue;
    }
    if (from === to) {
      plan.warnings.push(`„${nodeName(from)}“: altes und neues Gerät sind identisch.`);
      continue;
    }
    if (a.profile !== b.profile) {
      plan.warnings.push(`„${nodeName(from)}“ (${enumName('CANodeProfile', a.profile)}) und „${nodeName(to)}“ (${enumName('CANodeProfile', b.profile)}) sind verschiedene Gerätetypen – bitte Vorschau genau prüfen.`);
    }
    for (const attr of a.attributes) {
      const m = matchAttribute(attr, b);
      if (m) attrMap.set(attr.id, { to: m, toNode: b });
      else missing.set(attr.id, `${typeName(attr)}${attr.instance ? ' ' + attr.instance : ''}`);
    }
  }
  const fromIds = new Set(pairs.map((p) => p.from));
  const pairOf = (from: number) => pairs.find((p) => p.from === from);

  // Homeegramme
  for (const hg of state.homeegrams) {
    const changes: SwapItemChange[] = [];
    for (const kind of ITEM_KINDS) {
      for (const { group, item } of flatItems(hg, kind)) {
        const params: Params = {};
        const notes: string[] = [];
        const nodeId = Number(item.node_id);
        if (item.node_id !== undefined && fromIds.has(nodeId)) {
          const target = pairOf(nodeId)!.to;
          const attrId = Number(item.attribute_id);
          const m = attrMap.get(attrId);
          if (!m) {
            plan.warnings.push(`„${decode(hg.name)}“: Funktion ${missing.get(attrId) ?? '#' + attrId} von „${nodeName(nodeId)}“ gibt es am neuen Gerät nicht – Eintrag bleibt unverändert.`);
            continue;
          }
          params.node_id = target;
          params.attribute_id = m.to.id;
          notes.push(`${nodeName(nodeId)} → ${nodeName(target)} (${typeName(m.to)})`);
        }
        const src = Number(item.source_attribute_id);
        if (src && attrMap.has(src)) {
          params.source_attribute_id = attrMap.get(src)!.to.id;
          notes.push(`Vergleichswert → ${decode(attrMap.get(src)!.toNode.name)}`);
        }
        if (Object.keys(params).length) {
          changes.push({ kind, itemId: item.id, group, before: notes.map((n) => n.split(' → ')[0]).join(', '), after: notes.join(', '), params });
        }
      }
    }
    if (changes.length) plan.homeegrams.push({ id: hg.id, name: decode(hg.name), changes });
  }

  // Gruppen
  if (opts.groups) {
    for (const g of state.groups) {
      const rels = state.relationships.filter((r) => r.group_id === g.id && r.node_id);
      const members = new Set(rels.map((r) => r.node_id));
      const add: number[] = [];
      const removeRelationships: { id: number; nodeId: number }[] = [];
      for (const { from, to } of pairs) {
        if (!members.has(from)) continue;
        if (!members.has(to)) add.push(to);
        const rel = rels.find((r) => r.node_id === from);
        if (rel) removeRelationships.push({ id: rel.id, nodeId: from });
      }
      if (add.length || removeRelationships.length) plan.groups.push({ groupId: g.id, name: decode(g.name), add, removeRelationships });
    }
  }

  // Namen
  if (opts.rename) {
    for (const { from, to } of pairs) {
      const oldName = nodeName(from);
      if (!node(from) || !node(to)) continue;
      plan.renames.push({ nodeId: to, from: nodeName(to), to: oldName });
      plan.renames.push({ nodeId: from, from: oldName, to: `${oldName} (alt)` });
    }
  }

  return plan;
}
