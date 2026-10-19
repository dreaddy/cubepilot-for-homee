// Entwurfsmodell des Homeegramm-Editors: Eintragsarten, Beschreibung, Prüfung und Änderungspaket.

import { lang, t } from './i18n';
import { attributeLabel, formatValue, typeLabel, valueLabels } from './labels';
import type { AttributeView, ChangeSet, GroupView, HomeegramView, ItemKind, NodeView, Params } from './models';
import { describeSchedule, emptySchedule, scheduleFromFields, scheduleToFields } from './schedule';

export type EditorType =
  | 'switch'
  | 'time'
  | 'attribute'
  | 'group'
  | 'celestial'
  | 'timeofday'
  | 'homeegram'
  | 'webhook-in'
  | 'webhook-out'
  | 'notification'
  | 'raw';

export interface ItemDef {
  kind: ItemKind;
  group: string;
  type: number;
  label: string;
  hint: string;
  icon: string;
  editor: EditorType;
  /** Im „Hinzufügen“-Menü anbieten */
  addable: boolean;
  defaults: () => Record<string, unknown>;
}

const T = (group: string, type: number, label: string, icon: string, editor: EditorType, hint: string, defaults: () => Record<string, unknown> = () => ({}), addable = true): ItemDef => ({
  kind: 'triggers', group, type, label, icon, editor, hint, defaults, addable,
});
const C = (group: string, type: number, label: string, icon: string, editor: EditorType, hint: string, defaults: () => Record<string, unknown> = () => ({}), addable = true): ItemDef => ({
  kind: 'conditions', group, type, label, icon, editor, hint, defaults, addable,
});
const A = (group: string, type: number, label: string, icon: string, editor: EditorType, hint: string, defaults: () => Record<string, unknown> = () => ({}), addable = true): ItemDef => ({
  kind: 'actions', group, type, label, icon, editor, hint, defaults, addable,
});

export const ITEM_DEFS: ItemDef[] = [
  T('time_triggers', 1, 'Zeitplan', 'clock', 'time', 'Zu einer Uhrzeit, an Wochentagen oder im Intervall', () => scheduleToFields(emptySchedule())),
  T('attribute_triggers', 2, 'Gerätewert', 'gauge', 'attribute', 'Wenn sich ein Wert ändert, z. B. Taste gedrückt, Tür geöffnet', () => ({ node_id: null, attribute_id: null, operator: 3, operand: 1, value: 1 })),
  T('celestial_triggers', 6, 'Sonnenstand', 'sunset', 'celestial', 'Bei Sonnenauf- oder -untergang, optional versetzt', () => ({ celestial_type: 2, time_offset: 0 })),
  T('group_triggers', 8, 'Gruppenwert', 'layers', 'group', 'Wenn sich ein Wert in einer Gruppe ändert', () => ({ group_id: null, attribute_type: null, operator: 3, value: 1 })),
  T('homeegram_triggers', 5, 'Anderes Homeegramm', 'zap', 'homeegram', 'Wenn ein Homeegramm abgespielt oder (de)aktiviert wird', () => ({ source_homeegram_id: null, homeegram_event: 3 })),
  T('webhook_triggers', 4, 'Webhook', 'link', 'webhook-in', 'Per Aufruf einer URL, z. B. aus Kurzbefehlen oder IFTTT', () => ({ event: '' })),
  T('switch_triggers', 3, 'Manuell', 'hand', 'switch', 'Nur per Abspielen in der App oder hier'),
  T('plan_triggers', 7, 'Plan', 'calendar', 'raw', '', undefined, false),
  T('user_triggers', 9, 'Benutzer', 'users', 'raw', '', undefined, false),

  C('attribute_conditions', 2, 'Gerätewert', 'gauge', 'attribute', 'Nur wenn ein Gerät einen bestimmten Wert hat', () => ({ node_id: null, attribute_id: null, operator: 1, operand: 1, value: 1, check_moment: 1 })),
  C('celestial_conditions', 4, 'Tageszeit', 'sun', 'timeofday', 'Nur tagsüber oder nur nachts', () => ({ time_of_day: 2, check_moment: 1 })),
  C('group_conditions', 6, 'Gruppenwert', 'layers', 'group', 'Nur wenn eine Gruppe einen bestimmten Wert hat', () => ({ group_id: null, attribute_type: null, operator: 1, value: 1, check_moment: 1, scope: 3 })),
  C('homeegram_conditions', 3, 'Anderes Homeegramm', 'zap', 'homeegram', 'Nur wenn ein anderes Homeegramm aktiv/inaktiv ist', () => ({ source_homeegram_id: null, homeegram_event: 1, check_moment: 1 })),
  C('time_conditions', 1, 'Zeitraum', 'clock', 'raw', '', undefined, false),
  C('user_conditions', 7, 'Anwesenheit', 'users', 'raw', '', undefined, false),
  C('plan_conditions', 5, 'Plan', 'calendar', 'raw', '', undefined, false),

  A('attribute_actions', 1, 'Gerät steuern', 'power', 'attribute', 'Licht, Rollladen, Heizung, Steckdose …', () => ({ node_id: null, attribute_id: null, value: 1, command: 1, delay: 0, source_attribute_id: 0 })),
  A('group_actions', 4, 'Gruppe steuern', 'layers', 'group', 'Alle Geräte einer Gruppe gleichzeitig', () => ({ group_id: null, attribute_type: null, value: 1, command: 1, delay: 0, source_attribute_id: 0 })),
  A('homeegram_actions', 6, 'Homeegramm steuern', 'zap', 'homeegram', 'Anderes Homeegramm abspielen oder (de)aktivieren', () => ({ target_homeegram_id: null, homeegram_event: 3, delay: 0 })),
  A('notification_actions', 3, 'Benachrichtigung', 'bell', 'notification', 'Push-Nachricht an alle Benutzer', () => ({ message: '', style: 1, critical: false, user_ids: [0], delay: 0 })),
  A('webhook_actions', 5, 'Webhook aufrufen', 'link', 'webhook-out', 'Eine URL aufrufen (HTTP)', () => ({ method: 'GET', url: '', body: '', content_type: '', delay: 0 })),
  A('tts_actions', 2, 'Sprachausgabe', 'bell', 'raw', '', undefined, false),
  A('plan_actions', 7, 'Plan', 'calendar', 'raw', '', undefined, false),
  A('user_actions', 8, 'Benutzer', 'users', 'raw', '', undefined, false),
];

export function defFor(group: string): ItemDef | undefined {
  return ITEM_DEFS.find((d) => d.group === group);
}

export const KIND_META: Record<ItemKind, { title: string; subtitle: string; add: string; empty: string }> = {
  triggers: { title: 'Wenn', subtitle: 'Einer dieser Auslöser startet das Homeegramm', add: 'Auslöser', empty: 'Ohne Auslöser läuft das Homeegramm nur beim manuellen Abspielen.' },
  conditions: { title: 'Und nur wenn', subtitle: 'Alle Bedingungen müssen erfüllt sein', add: 'Bedingung', empty: 'Keine Bedingungen – die Aktionen laufen immer.' },
  actions: { title: 'Dann', subtitle: 'Diese Aktionen werden ausgeführt', add: 'Aktion', empty: 'Noch keine Aktionen.' },
};

// ---------------------------------------------------------------- Auswahllisten

export const TRIGGER_OPERATORS = [
  { value: 3, label: 'wird gleich' },
  { value: 1, label: 'steigt über' },
  { value: 2, label: 'fällt unter' },
  { value: 4, label: 'ändert sich um mehr als' },
];

export const CONDITION_OPERATORS = [
  { value: 1, label: 'ist gleich', short: '=' },
  { value: 6, label: 'ist ungleich', short: '≠' },
  { value: 5, label: 'ist größer als', short: '>' },
  { value: 3, label: 'ist mindestens', short: '≥' },
  { value: 4, label: 'ist kleiner als', short: '<' },
  { value: 2, label: 'ist höchstens', short: '≤' },
];

/** Text-Vergleiche (homee ≥ 2.41) – nur zur Anzeige, der Editor bietet sie (noch) nicht an. */
export const TEXT_CONDITION_OPERATORS = [
  { value: 7, label: 'ist (Text) gleich' },
  { value: 8, label: 'ist (Text) ungleich' },
];

/** Für welche Geräte einer Gruppe eine Gruppen-Bedingung gelten muss (CAGroupScope). */
export const GROUP_SCOPES = [
  { value: 3, label: 'mindestens ein Gerät' },
  { value: 2, label: 'alle Geräte' },
  { value: 4, label: 'nicht alle Geräte' },
  { value: 1, label: 'kein Gerät' },
];

export const CHECK_MOMENTS = [
  { value: 1, label: 'beim Start' },
  { value: 2, label: 'am Ende (vor verzögerten Aktionen)' },
  { value: 3, label: 'beim Start und am Ende' },
];

export const HG_TRIGGER_EVENTS = [
  { value: 3, label: 'abgespielt wird' },
  { value: 1, label: 'aktiviert wird' },
  { value: 2, label: 'deaktiviert wird' },
  { value: 4, label: 'gestoppt wird' },
];

export const HG_CONDITION_EVENTS = [
  { value: 1, label: 'aktiv ist' },
  { value: 2, label: 'inaktiv ist' },
  { value: 3, label: 'gerade läuft' },
  { value: 4, label: 'nicht läuft' },
];

export const HG_ACTION_EVENTS = [
  { value: 3, label: 'abspielen' },
  { value: 1, label: 'aktivieren' },
  { value: 2, label: 'deaktivieren' },
  { value: 4, label: 'stoppen' },
];

/** homee nimmt bei Bedingungen nur Tag (1) und Nacht (2) an (getestet mit 2.41.6); die übrigen nur zur Anzeige. */
export const TIMES_OF_DAY_SELECTABLE = [
  { value: 1, label: 'Tag' },
  { value: 2, label: 'Nacht' },
];

export const TIMES_OF_DAY = [
  ...TIMES_OF_DAY_SELECTABLE,
  { value: 3, label: 'Morgen' },
  { value: 4, label: 'Mittag' },
  { value: 5, label: 'Nachmittag' },
  { value: 6, label: 'Abend' },
  { value: 7, label: 'Mitternacht' },
];

export const ACTION_COMMANDS = [
  { value: 1, label: 'setzen auf' },
  { value: 3, label: 'umschalten' },
];

// ---------------------------------------------------------------- Entwurf

export interface DraftItem {
  key: string;
  id?: number;
  kind: ItemKind;
  group: string;
  data: Record<string, any>;
  original: Record<string, any> | null;
  removed: boolean;
}

export interface Draft {
  id: number | null;
  name: string;
  active: boolean;
  items: DraftItem[];
  original: { name: string; active: boolean } | null;
}

const ENCODED_FIELDS = ['message', 'url', 'body', 'event', 'content_type'];
let keyCounter = 0;
export const newKey = () => `k${++keyCounter}`;

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function cleanRaw(raw: Record<string, unknown>): Record<string, any> {
  const { id, homeegram_id, next_invocation, ...rest } = raw;
  for (const f of ENCODED_FIELDS) if (typeof rest[f] === 'string') rest[f] = safeDecode(rest[f] as string);
  return rest;
}

export function draftFromView(v: HomeegramView): Draft {
  const items: DraftItem[] = [...v.triggers, ...v.conditions, ...v.actions].map((i) => {
    const data = cleanRaw(i.raw);
    return { key: newKey(), id: i.id, kind: i.kind, group: i.group, data, original: structuredClone(data), removed: false };
  });
  return { id: v.id, name: v.name, active: v.active, items, original: { name: v.name, active: v.active } };
}

export function emptyDraft(): Draft {
  return { id: null, name: '', active: true, items: [], original: null };
}

export function newItem(def: ItemDef): DraftItem {
  return { key: newKey(), kind: def.kind, group: def.group, data: def.defaults(), original: null, removed: false };
}

/** Kopie eines Homeegramms als neuer Entwurf. */
export function duplicateDraft(d: Draft): Draft {
  return {
    id: null,
    name: t('{name} (Kopie)', { name: d.name }),
    active: false,
    original: null,
    items: d.items.filter((i) => !i.removed).map((i) => ({ ...i, key: newKey(), id: undefined, original: null, data: structuredClone(i.data) })),
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function changedKeys(item: DraftItem): string[] {
  if (!item.original) return [];
  return Object.keys(item.data).filter((k) => !same(item.data[k], item.original![k]));
}

export function itemState(item: DraftItem): 'new' | 'changed' | 'removed' | 'unchanged' {
  if (item.removed) return 'removed';
  if (item.id === undefined) return 'new';
  return changedKeys(item).length ? 'changed' : 'unchanged';
}

export function toChangeSet(d: Draft): ChangeSet {
  const cs: Required<ChangeSet> = { fields: {}, remove: [], update: [], add: [] };
  for (const item of d.items) {
    const state = itemState(item);
    if (state === 'removed' && item.id !== undefined) cs.remove.push({ kind: item.kind, itemId: item.id });
    if (state === 'changed') {
      let keys = changedKeys(item);
      // Zeitpläne immer vollständig senden, sonst rechnet homee mit dem alten Startzeitpunkt
      if (keys.includes('rrule') || keys.includes('dtstart')) keys = [...new Set([...keys, 'rrule', 'dtstart'])];
      cs.update.push({ kind: item.kind, itemId: item.id!, params: pick(item.data, keys) });
    }
    if (state === 'new') {
      const def = defFor(item.group);
      cs.add.push({ kind: item.kind, params: { type: def?.type ?? 0, ...withoutNulls(item.data) } });
    }
  }
  if (!d.original || d.name !== d.original.name) cs.fields['name'] = d.name;
  if (!d.original || d.active !== d.original.active) cs.fields['active'] = d.active ? 1 : 0;
  return cs;
}

export function changeCount(d: Draft): number {
  const cs = toChangeSet(d);
  return cs.remove!.length + cs.update!.length + cs.add!.length + Object.keys(cs.fields!).length;
}

function pick(o: Record<string, any>, keys: string[]): Params {
  return Object.fromEntries(keys.map((k) => [k, o[k] ?? ''])) as Params;
}

function withoutNulls(o: Record<string, any>): Params {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as Params;
}

// ---------------------------------------------------------------- Kontext, Beschreibung, Prüfung

export interface ModelContext {
  node(id: number): NodeView | undefined;
  attribute(id: number): AttributeView | undefined;
  group(id: number): GroupView | undefined;
  homeegramName(id: number): string | undefined;
  /** Attributtypen, die in einer Gruppe vorkommen */
  groupTypes(groupId: number): { type: number; typeName: string; sample: AttributeView }[];
}

const q = (s: string) => (lang() === 'en' ? `“${s}”` : `„${s}“`);
const label = <T extends { value: number; label: string }>(list: T[], v: unknown) => {
  const l = list.find((x) => x.value === Number(v))?.label;
  return l ? t(l) : `#${v}`;
};

function attrText(ctx: ModelContext, nodeId: unknown, attrId: unknown): string {
  const node = ctx.node(Number(nodeId));
  const attr = ctx.attribute(Number(attrId));
  if (!node || !attr) return t('Gerät wählen');
  return node.id === -1 ? attributeLabel(attr) : `${q(node.name)} · ${attributeLabel(attr)}`;
}

/** Vergleich in natürlicher Sprache; bei Werten mit Klartext (z. B. „Abwesend“) ohne „wird gleich“. */
function comparison(kind: 'trigger' | 'condition', operator: unknown, valueText: string, labelled: boolean): string {
  const op = Number(operator);
  if (labelled && kind === 'trigger' && op === 3) return `: ${valueText}`;
  if (labelled && kind === 'condition' && op === 1) return ' ' + t('ist {v}', { v: valueText });
  if (labelled && kind === 'condition' && op === 6) return ' ' + t('ist nicht {v}', { v: valueText });
  return ` ${label(kind === 'trigger' ? TRIGGER_OPERATORS : [...CONDITION_OPERATORS, ...TEXT_CONDITION_OPERATORS], operator)} ${valueText}`;
}

function hasLabel(sample: { typeName: string } | undefined, value: unknown): boolean {
  return !!sample && valueLabels(sample.typeName)?.[Number(value)] !== undefined;
}

function valueText(ctx: ModelContext, attrId: unknown, value: unknown): string {
  const attr = ctx.attribute(Number(attrId));
  return attr ? formatValue(attr, Number(value)) : String(value);
}

function groupValueText(ctx: ModelContext, groupId: unknown, type: unknown, value: unknown): string {
  const gt = ctx.groupTypes(Number(groupId)).find((x) => x.type === Number(type));
  return gt ? formatValue(gt.sample, Number(value)) : String(value);
}

function delayText(d: Record<string, any>): string {
  const s = Number(d['delay'] ?? 0);
  if (!s) return '';
  if (s < 60) return ' · ' + t('nach {n} s', { n: s });
  if (s % 60 === 0) return ' · ' + t('nach {n} min', { n: s / 60 });
  return ' · ' + t('nach {m} min {s} s', { m: Math.floor(s / 60), s: s % 60 });
}

export function describeItem(item: DraftItem, ctx: ModelContext): string {
  const d = item.data;
  const def = defFor(item.group);
  const hgName = (id: unknown) => q(ctx.homeegramName(Number(id)) ?? t('Homeegramm wählen'));
  switch (item.group) {
    case 'switch_triggers':
      return t('Manuell abspielen');
    case 'time_triggers':
      return describeSchedule(scheduleFromFields(d['dtstart'], d['rrule']));
    case 'attribute_triggers':
    case 'attribute_conditions': {
      const labelled = hasLabel(ctx.attribute(Number(d['attribute_id'])), d['value']);
      const kind = item.group === 'attribute_triggers' ? 'trigger' : 'condition';
      return `${attrText(ctx, d['node_id'], d['attribute_id'])}${comparison(kind, d['operator'], valueText(ctx, d['attribute_id'], d['value']), labelled)}`;
    }
    case 'attribute_actions':
      return Number(d['command']) === 3
        ? `${attrText(ctx, d['node_id'], d['attribute_id'])} ${t('umschalten')}${delayText(d)}`
        : `${attrText(ctx, d['node_id'], d['attribute_id'])} → ${valueText(ctx, d['attribute_id'], d['value'])}${delayText(d)}`;
    case 'group_triggers':
    case 'group_conditions':
    case 'group_actions': {
      const g = ctx.group(Number(d['group_id']));
      if (!g || d['attribute_type'] == null) return t('Gruppe wählen');
      const gt = ctx.groupTypes(g.id).find((x) => x.type === Number(d['attribute_type']));
      const head = `${t('Gruppe')} ${q(g.name)} · ${gt ? typeLabel(gt.typeName) : t('Typ {n}', { n: d['attribute_type'] })}`;
      const val = groupValueText(ctx, d['group_id'], d['attribute_type'], d['value']);
      if (item.group === 'group_actions') return `${head} → ${val}${delayText(d)}`;
      const scope = item.group === 'group_conditions' && d['scope'] != null ? ` (${label(GROUP_SCOPES, d['scope'])})` : '';
      return `${head}${comparison(item.group === 'group_triggers' ? 'trigger' : 'condition', d['operator'], val, hasLabel(gt?.sample, d['value']))}${scope}`;
    }
    case 'celestial_triggers': {
      const off = Number(d['time_offset'] ?? 0);
      const base = Number(d['celestial_type']) === 1 ? t('Sonnenaufgang') : t('Sonnenuntergang');
      if (!off) return t('Bei {event}', { event: base });
      return t(off > 0 ? '{n} min nach {event}' : '{n} min vor {event}', { n: Math.abs(off), event: base });
    }
    case 'celestial_conditions':
      return t('Es ist {tod}', { tod: label(TIMES_OF_DAY, d['time_of_day']) });
    case 'homeegram_triggers':
      return `${hgName(d['source_homeegram_id'])} ${label(HG_TRIGGER_EVENTS, d['homeegram_event'])}`;
    case 'homeegram_conditions':
      return `${hgName(d['source_homeegram_id'])} ${label(HG_CONDITION_EVENTS, d['homeegram_event'])}`;
    case 'homeegram_actions':
      return `${hgName(d['target_homeegram_id'])} ${label(HG_ACTION_EVENTS, d['homeegram_event'])}${delayText(d)}`;
    case 'webhook_triggers':
      return d['event'] ? `Webhook ${q(d['event'])}` : t('Webhook – Namen vergeben');
    case 'webhook_actions':
      return d['url'] ? `${d['method'] || 'GET'} ${d['url']}${delayText(d)}` : t('URL eingeben');
    case 'notification_actions':
      return d['message'] ? `${t('Nachricht')} ${q(d['message'])}${d['critical'] ? ' ' + t('(kritisch)') : ''}${delayText(d)}` : t('Text eingeben');
    case 'user_conditions':
      return t('Anwesenheit: {who} = {v}', {
        who: Number(d['user_id']) === 0 ? t('alle Benutzer') : t('Benutzer #{n}', { n: d['user_id'] }),
        v: d['value'],
      });
    default:
      return `${def ? t(def.label) : item.group}: ${Object.entries(d)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ')}`;
  }
}

/** Kurzfassung „WENN … UND … DANN …“ (englisch “WHEN … AND … THEN …”) für eine Homeegramm-Ansicht. */
export function summarizeView(v: HomeegramView, ctx: ModelContext): string {
  const items = draftFromView(v).items;
  const part = (kind: ItemKind, sep: string) =>
    items
      .filter((i) => i.kind === kind)
      .map((i) => describeItem(i, ctx))
      .join(sep);
  const triggers = part('triggers', ` ${t('ODER')} `) || t('nur manuell');
  const conditions = part('conditions', ` ${t('UND')} `);
  const actions = part('actions', '; ') || t('(keine Aktionen)');
  return `${t('WENN')} ${triggers}${conditions ? ` ${t('UND')} ${conditions}` : ''} ${t('DANN')} ${actions}`;
}

/** Liefert eine Fehlermeldung, wenn der Eintrag nicht gespeichert werden kann. */
export function validateItem(item: DraftItem, ctx: ModelContext): string | null {
  if (item.removed) return null;
  const d = item.data;
  const num = (v: unknown) => v !== null && v !== '' && Number.isFinite(Number(v));
  switch (defFor(item.group)?.editor) {
    case 'attribute':
      if (!ctx.node(Number(d['node_id']))) return t('Gerät auswählen');
      if (!ctx.attribute(Number(d['attribute_id']))) return t('Wert/Funktion auswählen');
      if (Number(d['command']) !== 3 && !num(d['value'])) return t('Wert eingeben');
      return null;
    case 'group':
      if (!ctx.group(Number(d['group_id']))) return t('Gruppe auswählen');
      if (d['attribute_type'] == null) return t('Funktion auswählen');
      if (!num(d['value'])) return t('Wert eingeben');
      return null;
    case 'homeegram': {
      const id = d['target_homeegram_id'] ?? d['source_homeegram_id'];
      return ctx.homeegramName(Number(id)) ? null : t('Homeegramm auswählen');
    }
    case 'webhook-in':
      return /^[\w-]+$/.test(String(d['event'] ?? '')) ? null : t('Namen aus Buchstaben, Ziffern, - oder _ vergeben');
    case 'webhook-out':
      return /^https?:\/\//.test(String(d['url'] ?? '')) ? null : t('URL mit http:// oder https:// eingeben');
    case 'notification':
      return String(d['message'] ?? '').trim() ? null : t('Nachricht eingeben');
    case 'time':
      if (!d['dtstart']) return t('Zeit wählen');
      if (String(d['rrule']).includes('BYDAY=;')) return t('Mindestens einen Wochentag wählen');
      return null;
    default:
      return null;
  }
}
