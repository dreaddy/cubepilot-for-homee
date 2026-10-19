// Lesbare Ansichten der homee-Rohdaten: Zahlencodes -> Namen, URL-kodierte Texte -> Klartext,
// Homeegramm-Einträge -> deutsche Kurzbeschreibung. Wird von Backend, Frontend (über die REST-API) und MCP genutzt.

import { Enums } from './enums.ts';
import type { HomeeAttribute, HomeeNode, HomeeState, Homeegram, HomeegramItem, ItemKind } from './types.ts';

type EnumGroup = keyof typeof Enums;

/** Liefert den Namen zu einem Enum-Wert ohne Präfix, z. B. enumName('CAAttributeType', 1) -> 'OnOff'. */
export function enumName(group: EnumGroup, value: unknown): string {
  const table = Enums[group] as Record<string, number>;
  const key = Object.keys(table).find((k) => table[k] === Number(value));
  if (!key) return `${group}#${value}`;
  return key.startsWith(group) ? key.slice(group.length) || key : key;
}

/** homee liefert Namen, Einheiten und URLs prozent-kodiert. */
export function decode(text: unknown): string {
  if (typeof text !== 'string') return '';
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

function isoFromUnix(ts: unknown): string | null {
  const n = Number(ts);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}

// ---------------------------------------------------------------- Geräte

export interface AttributeView {
  id: number;
  nodeId: number;
  type: number;
  typeName: string;
  /** Mehrere gleichartige Attribute (z. B. Tasten einer Fernbedienung) werden über instance unterschieden. */
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

export function attributeView(a: HomeeAttribute): AttributeView {
  return {
    id: a.id,
    nodeId: a.node_id,
    type: a.type,
    typeName: enumName('CAAttributeType', a.type),
    instance: a.instance ?? 0,
    name: decode(a.name),
    value: a.current_value,
    target: a.target_value,
    unit: decode(a.unit),
    min: a.minimum,
    max: a.maximum,
    step: a.step_value,
    editable: a.editable === 1,
    lastChanged: isoFromUnix(a.last_changed),
  };
}

export function nodeView(n: HomeeNode): NodeView {
  return {
    id: n.id,
    name: decode(n.name),
    profile: n.profile,
    profileName: enumName('CANodeProfile', n.profile),
    protocol: enumName('CANodeProtocol', n.protocol),
    state: enumName('CANodeState', n.state),
    favorite: n.favorite === 1,
    note: decode(n.note),
    attributes: (n.attributes ?? []).map(attributeView),
  };
}

// ---------------------------------------------------------------- Homeegramme

export interface ItemView {
  id: number;
  kind: ItemKind;
  /** Gruppe, wie homee sie liefert, z. B. "attribute_triggers" */
  group: string;
  description: string;
  raw: HomeegramItem;
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
  /** Kompakte Zusammenfassung in einer Zeile. */
  summary: string;
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

class Lookup {
  constructor(private readonly state: HomeeState) {}

  node(id: unknown): string {
    const n = this.state.nodes.find((x) => x.id === Number(id));
    return n ? `„${decode(n.name)}“` : `Gerät #${id}`;
  }

  attribute(nodeId: unknown, attributeId: unknown): string {
    const n = this.state.nodes.find((x) => x.id === Number(nodeId));
    const a = n?.attributes.find((x) => x.id === Number(attributeId))
      ?? this.state.nodes.flatMap((x) => x.attributes).find((x) => x.id === Number(attributeId));
    const owner = n ?? this.state.nodes.find((x) => x.id === a?.node_id);
    const nodeName = owner ? `„${decode(owner.name)}“` : `Gerät #${nodeId}`;
    return a ? `${nodeName}.${enumName('CAAttributeType', a.type)}` : `${nodeName}.Attribut #${attributeId}`;
  }

  unit(attributeId: unknown): string {
    const a = this.state.nodes.flatMap((x) => x.attributes).find((x) => x.id === Number(attributeId));
    const u = decode(a?.unit);
    return u && u !== 'n%2Fa' && u !== 'n/a' ? ` ${u}` : '';
  }

  homeegram(id: unknown): string {
    const h = this.state.homeegrams.find((x) => x.id === Number(id));
    return h ? `Homeegramm „${decode(h.name)}“` : `Homeegramm #${id}`;
  }

  group(id: unknown): string {
    const g = this.state.groups.find((x) => x.id === Number(id));
    return g ? `Gruppe „${decode(g.name)}“` : `Gruppe #${id}`;
  }

  user(id: unknown): string {
    if (Number(id) === 0) return 'Alle Benutzer';
    const u = this.state.users.find((x) => x.id === Number(id)) as Record<string, unknown> | undefined;
    return u ? `Benutzer „${decode(u.username ?? u.forename)}“` : `Benutzer #${id}`;
  }
}

const triggerOps: Record<number, string> = { 1: 'steigt über', 2: 'fällt unter', 3: 'wird gleich', 4: 'ändert sich um mehr als' };
const conditionOps: Record<number, string> = { 1: '=', 2: '≤', 3: '≥', 4: '<', 5: '>', 6: '≠' };
const hgEvents: Record<number, string> = { 1: 'aktiviert', 2: 'deaktiviert', 3: 'abgespielt', 4: 'gestoppt' };
const hgActionEvents: Record<number, string> = { 1: 'aktivieren', 2: 'deaktivieren', 3: 'abspielen', 4: 'stoppen' };
const checkMoments: Record<number, string> = { 1: 'beim Start', 2: 'am Ende', 3: 'bei Start und Ende' };

function formatDtstart(v: unknown): string {
  const m = typeof v === 'string' ? v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/) : null;
  if (!m) return String(v ?? '');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });
}

function formatRrule(v: unknown): string {
  const r = decode(v);
  return r ? ` (Wiederholung: ${r})` : '';
}

const weekdays: Record<string, string> = { MO: 'Mo', TU: 'Di', WE: 'Mi', TH: 'Do', FR: 'Fr', SA: 'Sa', SU: 'So' };

/**
 * homee speichert Zeitpläne als iCal-RRULE mit BYHOUR/BYMINUTE in UTC.
 * Ergibt z. B. „täglich um 11:45“ (deutsche Ortszeit) oder null, wenn die Regel nicht einfach lesbar ist.
 */
function describeSchedule(dtstart: unknown, rruleRaw: unknown): string | null {
  const rule = Object.fromEntries(
    decode(rruleRaw).split(';').filter(Boolean).map((p) => p.split('=') as [string, string]),
  );
  if (!rule.FREQ) return null;
  const hour = rule.BYHOUR !== undefined ? Number(rule.BYHOUR) : null;
  const minute = rule.BYMINUTE !== undefined ? Number(rule.BYMINUTE) : 0;
  let time = '';
  if (hour !== null && !Number.isNaN(hour)) {
    const d = new Date();
    d.setUTCHours(hour, minute, 0, 0);
    time = ` um ${d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })}`;
  }
  const interval = Number(rule.INTERVAL ?? 1);
  const days = rule.BYDAY ? rule.BYDAY.split(',').map((d: string) => weekdays[d] ?? d).join(', ') : '';
  switch (rule.FREQ) {
    case 'DAILY':
      return `${interval > 1 ? `alle ${interval} Tage` : 'täglich'}${time}`;
    case 'WEEKLY':
      return `${interval > 1 ? `alle ${interval} Wochen` : 'wöchentlich'}${days ? ` ${days}` : ''}${time}`;
    case 'MONTHLY':
      return `monatlich${rule.BYMONTHDAY ? ` am ${rule.BYMONTHDAY}.` : ''}${time}`;
    case 'HOURLY':
      return interval > 1 ? `alle ${interval} Stunden` : 'stündlich';
    case 'MINUTELY':
      return interval > 1 ? `alle ${interval} Minuten` : 'jede Minute';
    default:
      return `${formatDtstart(dtstart)}${formatRrule(rruleRaw)}`;
  }
}

function formatNextInvocation(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  const d = new Date(`${v}Z`);
  return Number.isNaN(d.getTime())
    ? ''
    : `, nächste Ausführung ${d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' })}`;
}

function withDelay(text: string, item: HomeegramItem): string {
  const delay = Number(item.delay ?? 0);
  return delay > 0 ? `${text} (nach ${delay} s)` : text;
}

function genericDescription(item: HomeegramItem): string {
  return Object.entries(item)
    .filter(([k]) => !['id', 'homeegram_id'].includes(k))
    .map(([k, v]) => `${k}=${typeof v === 'string' ? decode(v) : JSON.stringify(v)}`)
    .join(', ');
}

function describeItem(kind: ItemKind, group: string, i: HomeegramItem, l: Lookup): string {
  const value = (attrId: unknown) => `${i.value}${l.unit(attrId)}`;

  if (kind === 'triggers') {
    switch (group) {
      case 'switch_triggers':
        return 'Manuell (Abspielen)';
      case 'time_triggers':
        return i.rrule
          ? `Zeit: ${describeSchedule(i.dtstart, i.rrule)}${formatNextInvocation(i.next_invocation)}`
          : `Zeit: einmalig ${formatDtstart(i.dtstart)}`;
      case 'attribute_triggers': {
        const target = Number(i.operand) === 2 ? l.attribute(undefined, i.source_attribute_id) : value(i.attribute_id);
        return `${l.attribute(i.node_id, i.attribute_id)} ${triggerOps[Number(i.operator)] ?? `op${i.operator}`} ${target}`;
      }
      case 'webhook_triggers':
        return `Webhook „${decode(i.event)}“`;
      case 'homeegram_triggers':
        return `${l.homeegram(i.source_homeegram_id)} wurde ${hgEvents[Number(i.homeegram_event)] ?? i.homeegram_event}`;
      case 'celestial_triggers': {
        // time_offset in Minuten (z. B. 213 = 3 h 33 min nach Sonnenuntergang)
        const off = Number(i.time_offset ?? 0);
        const offText = off ? ` ${off > 0 ? '+' : '−'}${Math.abs(off)} min` : '';
        return `${Number(i.celestial_type) === 1 ? 'Sonnenaufgang' : 'Sonnenuntergang'}${offText}`;
      }
      case 'group_triggers':
        return `${l.group(i.group_id)}: ${enumName('CAAttributeType', i.attribute_type)} ${triggerOps[Number(i.operator)] ?? `op${i.operator}`} ${i.value}`;
      case 'user_triggers':
        return `${l.user(i.user_id)} Wert ${i.value}`;
    }
  }

  if (kind === 'conditions') {
    const when = checkMoments[Number(i.check_moment)] ? `, geprüft ${checkMoments[Number(i.check_moment)]}` : '';
    switch (group) {
      case 'time_conditions':
        return `Zeitraum ${i.rrule ? describeSchedule(i.dtstart, i.rrule) : `ab ${formatDtstart(i.dtstart)}`}, Dauer ${decode(i.duration)}${when}`;
      case 'attribute_conditions': {
        const target = Number(i.operand) === 2 ? l.attribute(undefined, i.source_attribute_id) : value(i.attribute_id);
        return `${l.attribute(i.node_id, i.attribute_id)} ${conditionOps[Number(i.operator)] ?? `op${i.operator}`} ${target}${when}`;
      }
      case 'homeegram_conditions':
        return `${l.homeegram(i.source_homeegram_id)} ist ${hgEvents[Number(i.homeegram_event)] ?? i.homeegram_event}${when}`;
      case 'celestial_conditions':
        return `Tageszeit: ${enumName('CATimeOfDay', i.time_of_day)}${when}`;
      case 'group_conditions':
        return `${l.group(i.group_id)}: ${enumName('CAAttributeType', i.attribute_type)} ${conditionOps[Number(i.operator)] ?? `op${i.operator}`} ${i.value}${when}`;
      case 'user_conditions':
        return `${l.user(i.user_id)} Wert ${i.value}${when}`;
    }
  }

  if (kind === 'actions') {
    switch (group) {
      case 'attribute_actions':
        return withDelay(
          Number(i.command) === 3
            ? `${l.attribute(i.node_id, i.attribute_id)} umschalten`
            : `${l.attribute(i.node_id, i.attribute_id)} auf ${value(i.attribute_id)} setzen`,
          i,
        );
      case 'group_actions':
        return withDelay(`${l.group(i.group_id)}: ${enumName('CAAttributeType', i.attribute_type)} auf ${i.value} setzen`, i);
      case 'homeegram_actions':
        return withDelay(`${l.homeegram(i.target_homeegram_id)} ${hgActionEvents[Number(i.homeegram_event)] ?? i.homeegram_event}`, i);
      case 'notification_actions':
        return withDelay(`Benachrichtigung (${enumName('CANotificationStyle', i.style)}): „${decode(i.message)}“`, i);
      case 'tts_actions':
        return withDelay(`Sprachausgabe: „${decode(i.message)}“`, i);
      case 'webhook_actions':
        return withDelay(`Webhook ${decode(i.method) || 'GET'} ${decode(i.url)}`, i);
    }
  }

  return genericDescription(i);
}

function itemViews(hg: Homeegram, kind: ItemKind, l: Lookup): ItemView[] {
  return Object.entries(hg[kind] ?? {}).flatMap(([group, items]) =>
    (items ?? []).map((item) => ({ id: item.id, kind, group, description: describeItem(kind, group, item, l), raw: item })),
  );
}

export function homeegramView(hg: Homeegram, state: HomeeState): HomeegramView {
  const l = new Lookup(state);
  const triggers = itemViews(hg, 'triggers', l);
  const conditions = itemViews(hg, 'conditions', l);
  const actions = itemViews(hg, 'actions', l);
  const join = (xs: ItemView[]) => xs.map((x) => x.description).join(' ODER ') || '—';
  const summary =
    `WENN ${join(triggers)}` +
    (conditions.length ? ` UND ${conditions.map((c) => c.description).join(' UND ')}` : '') +
    ` DANN ${actions.map((a) => a.description).join('; ') || '(keine Aktionen)'}`;
  return {
    id: hg.id,
    name: decode(hg.name),
    active: hg.active === 1,
    playing: hg.play === 1,
    favorite: hg.favorite === 1,
    note: decode(hg.note),
    lastTriggered: isoFromUnix(hg.last_triggered),
    triggers,
    conditions,
    actions,
    summary,
  };
}

export function homeegramSummary(hg: Homeegram, state: HomeeState): HomeegramSummary {
  const v = homeegramView(hg, state);
  return {
    id: v.id,
    name: v.name,
    active: v.active,
    lastTriggered: v.lastTriggered,
    triggerCount: v.triggers.length,
    conditionCount: v.conditions.length,
    actionCount: v.actions.length,
    summary: v.summary,
  };
}

/** Die Enum-Tabellen, die man zum Anlegen von Auslösern, Bedingungen und Aktionen braucht. */
export function homeegramEnumCatalog() {
  const pick = (g: EnumGroup) => Object.fromEntries(Object.entries(Enums[g]).map(([k, v]) => [k.replace(g, '') || k, v]));
  return {
    triggerTypes: pick('CATriggerType'),
    triggerOperators: pick('CATriggerOperator'),
    triggerOperands: pick('CATriggerOperand'),
    triggerHomeegramEvents: pick('CATriggerHomeegramEvent'),
    conditionTypes: pick('CAConditionType'),
    conditionOperators: pick('CAConditionOperator'),
    conditionOperands: pick('CAConditionOperand'),
    conditionCheckMoments: pick('CAConditionCheckMoment'),
    conditionHomeegramEvents: pick('CAConditionHomeegramEvent'),
    actionTypes: pick('CAActionType'),
    actionHomeegramEvents: pick('CAActionHomeegramEvent'),
    notificationStyles: pick('CANotificationStyle'),
    celestialTypes: pick('CACelestialType'),
    timeOfDay: pick('CATimeOfDay'),
  };
}

export function attributeTypeCatalog(): Record<string, number> {
  return Object.fromEntries(Object.entries(Enums.CAAttributeType).map(([k, v]) => [k.replace('CAAttributeType', ''), v]));
}
