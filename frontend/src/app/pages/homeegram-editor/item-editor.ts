import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Api } from '../../core/api';
import {
  ACTION_COMMANDS,
  CHECK_MOMENTS,
  CONDITION_OPERATORS,
  GROUP_SCOPES,
  HG_ACTION_EVENTS,
  HG_CONDITION_EVENTS,
  HG_TRIGGER_EVENTS,
  TIMES_OF_DAY_SELECTABLE,
  TRIGGER_OPERATORS,
  defFor,
  type DraftItem,
} from '../../core/homeegram-model';
import { CATEGORIES, OTHER_CATEGORY, TECHNICAL, attributeLabel, categoryOf, typeLabel } from '../../core/labels';
import { locale, t } from '../../core/i18n';
import { Live } from '../../core/live';
import { ModelCtx } from '../../core/model-context';
import type { AttributeView, NodeView } from '../../core/models';
import { WEEKDAYS, scheduleFromFields, scheduleToFields, type Schedule } from '../../core/schedule';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';
import { ValueInput, type ValueMeta } from '../../shared/value-input';

/** Bevorzugte Funktion, wenn ein Gerät gewählt wird. */
const PREFERRED = ['ButtonState', 'OnOff', 'Position', 'TargetTemperature', 'DimmingLevel', 'LockState', 'HomeeMode', 'OpenClose', 'MotionAlarm', 'PresenceAlarm', 'Temperature'];

@Component({
  selector: 'app-item-editor',
  imports: [Icon, ValueInput],
  templateUrl: './item-editor.html',
  styleUrl: './item-editor.scss',
})
export class ItemEditor {
  readonly item = input.required<DraftItem>();
  readonly homeegramId = input<number | null>(null);
  readonly disabled = input(false);
  readonly patch = output<Record<string, unknown>>();
  readonly replace = output<Record<string, unknown>>();

  private readonly live = inject(Live);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly ctx = inject(ModelCtx);

  protected readonly def = computed(() => defFor(this.item().group));
  protected readonly d = computed(() => this.item().data);
  protected readonly kind = computed(() => this.item().kind);

  protected readonly TRIGGER_OPERATORS = TRIGGER_OPERATORS;
  protected readonly CONDITION_OPERATORS = CONDITION_OPERATORS;
  protected readonly GROUP_SCOPES = GROUP_SCOPES;
  protected readonly CHECK_MOMENTS = CHECK_MOMENTS;
  protected readonly TIMES_OF_DAY = TIMES_OF_DAY_SELECTABLE;
  protected readonly ACTION_COMMANDS = ACTION_COMMANDS;
  protected readonly WEEKDAYS = WEEKDAYS;
  protected readonly t = t;
  protected readonly attributeLabel = attributeLabel;
  protected readonly typeLabel = typeLabel;

  protected readonly hgEvents = computed(() =>
    this.kind() === 'triggers' ? HG_TRIGGER_EVENTS : this.kind() === 'conditions' ? HG_CONDITION_EVENTS : HG_ACTION_EVENTS,
  );
  protected readonly hgField = computed(() => (this.kind() === 'actions' ? 'target_homeegram_id' : 'source_homeegram_id'));

  // ---------------------------------------------------------------- Geräte

  /** Geräte nach Kategorie; Aktionen nur mit steuerbaren Funktionen. */
  protected readonly deviceGroups = computed(() => {
    const forAction = this.kind() === 'actions';
    const usable = (n: NodeView) => this.attributesFor(n).length > 0;
    const nodes = this.live.nodes().filter(usable);
    const groups = [...CATEGORIES, OTHER_CATEGORY]
      .map((c) => ({ name: t(c.name), nodes: nodes.filter((n) => categoryOf(n).key === c.key).sort((a, b) => a.name.localeCompare(b.name, locale())) }))
      .filter((g) => g.nodes.length);
    const homee = this.live.node(-1);
    if (homee && (!forAction || this.attributesFor(homee).length)) groups.unshift({ name: 'homee', nodes: [homee] });
    return groups;
  });

  protected attributesFor(n: NodeView | undefined): AttributeView[] {
    if (!n) return [];
    const forAction = this.kind() === 'actions';
    return n.attributes.filter((a) => (forAction ? a.editable : true) && !TECHNICAL.has(a.typeName) && !/Revision$/.test(a.typeName));
  }

  protected readonly node = computed(() => this.live.node(Number(this.d()['node_id'])));
  protected readonly attributes = computed(() => this.attributesFor(this.node()));
  protected readonly attribute = computed(() => this.live.attribute(Number(this.d()['attribute_id'])));
  protected readonly isBinary = computed(() => {
    const a = this.attribute();
    return !!a && a.min === 0 && a.max === 1;
  });

  protected nodeLabel(n: NodeView): string {
    return n.id === -1 ? t('homee (Modus, Wetter, …)') : n.name;
  }

  protected selectNode(id: string): void {
    const n = this.live.node(Number(id));
    const attrs = this.attributesFor(n);
    const best = PREFERRED.map((t) => attrs.find((a) => a.typeName === t)).find(Boolean) ?? attrs[0];
    this.patch.emit({ node_id: Number(id), attribute_id: best?.id ?? null, value: best ? this.defaultValue(best) : 1 });
  }

  protected selectAttribute(id: string): void {
    const a = this.live.attribute(Number(id));
    this.patch.emit({ attribute_id: Number(id), value: a ? this.defaultValue(a) : 1, ...(a && !(a.min === 0 && a.max === 1) && { command: 1 }) });
  }

  private defaultValue(a: AttributeView): number {
    if (a.typeName === 'ButtonState') return 1;
    if (this.kind() === 'actions' && a.min === 0 && a.max === 1) return a.value === 1 ? 0 : 1;
    return a.target ?? a.value ?? a.min ?? 0;
  }

  // ---------------------------------------------------------------- Gruppen

  protected readonly groups = computed(() => [...this.live.groups()].sort((a, b) => a.name.localeCompare(b.name, locale())));
  protected readonly groupTypes = computed(() => {
    const types = this.ctx.groupTypes(Number(this.d()['group_id']));
    return types.filter((t) => (this.kind() === 'actions' ? t.sample.editable : true) && !TECHNICAL.has(t.typeName));
  });
  protected readonly groupType = computed(() => this.groupTypes().find((t) => t.type === Number(this.d()['attribute_type'])));

  protected selectGroup(id: string): void {
    const types = this.ctx.groupTypes(Number(id)).filter((t) => (this.kind() === 'actions' ? t.sample.editable : true) && !TECHNICAL.has(t.typeName));
    const best = PREFERRED.map((p) => types.find((t) => t.typeName === p)).find(Boolean) ?? types[0];
    this.patch.emit({ group_id: Number(id), attribute_type: best?.type ?? null, value: best ? this.defaultValue(best.sample) : 1 });
  }

  protected groupMeta(): ValueMeta {
    const s = this.groupType()?.sample;
    return s ?? { typeName: '', min: NaN, max: NaN, step: 1, unit: '' };
  }

  // ---------------------------------------------------------------- Homeegramme

  protected readonly homeegrams = computed(() =>
    [...this.live.homeegrams()].filter((h) => this.kind() === 'actions' || h.id !== this.homeegramId()).sort((a, b) => a.name.localeCompare(b.name, locale())),
  );

  // ---------------------------------------------------------------- Zeitplan

  /** „Erweitert“ bleibt gewählt, auch wenn sich die Regel als einfacher Zeitplan lesen ließe. */
  private readonly forceAdvanced = signal(false);

  protected readonly schedule = computed(() => {
    const s = scheduleFromFields(this.d()['dtstart'], this.d()['rrule']);
    return this.forceAdvanced() ? { ...s, mode: 'advanced' as const } : s;
  });

  protected setSchedule(patch: Partial<Schedule>): void {
    if (patch.mode) this.forceAdvanced.set(patch.mode === 'advanced');
    const s = { ...this.schedule(), ...patch };
    this.patch.emit(scheduleToFields(s));
  }

  protected setHomeegram(id: string): void {
    this.patch.emit({ [this.hgField()]: Number(id) });
  }

  protected toggleDay(code: string): void {
    const days = this.schedule().days;
    this.setSchedule({ days: days.includes(code) ? days.filter((d) => d !== code) : [...days, code] });
  }

  // ---------------------------------------------------------------- Sonnenstand & Verzögerung

  protected readonly offsetAbs = computed(() => Math.abs(Number(this.d()['time_offset'] ?? 0)));
  protected readonly offsetSign = computed(() => (Number(this.d()['time_offset'] ?? 0) < 0 ? -1 : 1));

  protected setOffset(abs: string | number, sign: number): void {
    this.patch.emit({ time_offset: Math.round(Math.abs(Number(abs) || 0)) * sign });
  }

  protected readonly delayUnit = signal<'s' | 'min'>('s');
  protected readonly delayShown = computed(() => {
    const s = Number(this.d()['delay'] ?? 0);
    return this.delayUnit() === 'min' ? s / 60 : s;
  });

  protected setDelay(v: string | number, unit = this.delayUnit()): void {
    const n = Math.max(0, Number(v) || 0);
    this.patch.emit({ delay: Math.round(unit === 'min' ? n * 60 : n) });
  }

  protected switchDelayUnit(unit: 's' | 'min'): void {
    this.delayUnit.set(unit);
  }

  // ---------------------------------------------------------------- Webhook

  protected readonly webhookUrls = signal<{ local: string | null; remote: string | null } | null>(null);

  constructor() {
    // Minuten als Einheit vorwählen, wenn die Verzögerung glatte Minuten sind
    effect(() => {
      const s = Number(this.item().data['delay'] ?? 0);
      if (s >= 60 && s % 60 === 0) this.delayUnit.set('min');
    });
    effect(() => {
      const ev = this.item().group === 'webhook_triggers' ? String(this.item().data['event'] ?? '') : '';
      if (!ev) {
        this.webhookUrls.set(null);
        return;
      }
      this.api.webhookUrl(ev).then(
        (u) => this.webhookUrls.set(u),
        () => this.webhookUrls.set(null),
      );
    });
  }

  protected async copy(text: string): Promise<void> {
    await this.toasts.run(() => navigator.clipboard.writeText(text), t('URL kopiert'));
  }

  // ---------------------------------------------------------------- Roh

  protected readonly rawText = computed(() => JSON.stringify(this.d(), null, 2));

  protected applyRaw(text: string): void {
    try {
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      this.replace.emit(data);
    } catch {
      this.toasts.error(t('Kein gültiges JSON-Objekt'));
    }
  }

  protected num(v: string): number {
    return Number(v);
  }
}
