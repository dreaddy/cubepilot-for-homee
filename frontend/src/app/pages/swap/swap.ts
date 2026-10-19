import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { locale, t } from '../../core/i18n';
import { categoryOf, nodeIcon } from '../../core/labels';
import { Live } from '../../core/live';
import type { NodeView, SwapPlan } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

interface Row {
  from: number | null;
  to: number | null;
}

/**
 * Gerät tauschen: altes Gerät in allen Homeegrammen (und optional Gruppen/Namen) durch ein neues ersetzen,
 * z. B. nach dem Neuanlernen aller Heizkörper oder dem Austausch eines Sensors.
 */
@Component({
  selector: 'app-swap',
  imports: [RouterLink, Icon],
  templateUrl: './swap.html',
  styleUrl: './swap.scss',
})
export class Swap {
  protected readonly live = inject(Live);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  protected readonly t = t;
  protected readonly icon = nodeIcon;
  protected readonly rows = signal<Row[]>([{ from: null, to: null }]);
  protected readonly groups = signal(true);
  protected readonly rename = signal(true);
  protected readonly plan = signal<SwapPlan | null>(null);
  protected readonly busy = signal(false);
  protected readonly done = signal<{ plan: SwapPlan; errors: string[] } | null>(null);

  constructor() {
    const from = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('from'));
    if (from) this.rows.set([{ from, to: null }]);
  }

  /** Wo kommt ein Gerät vor? (Homeegramme, Gruppen) */
  protected readonly usage = computed(() => {
    const map = new Map<number, { homeegrams: number; groups: number }>();
    const get = (id: number) => map.get(id) ?? (map.set(id, { homeegrams: 0, groups: 0 }), map.get(id)!);
    for (const h of this.live.homeegrams()) {
      const ids = new Set([...h.triggers, ...h.conditions, ...h.actions].map((i) => Number(i.raw['node_id'])).filter((x) => x > 0));
      for (const id of ids) get(id).homeegrams++;
    }
    for (const g of this.live.groups()) for (const id of g.nodeIds) get(id).groups++;
    return map;
  });

  protected readonly devices = computed(() => [...this.live.nodes()].sort((a, b) => a.name.localeCompare(b.name, locale())));

  protected node(id: number | null): NodeView | undefined {
    return id ? this.live.node(id) : undefined;
  }

  protected usageText(id: number): string {
    const u = this.usage().get(id);
    if (!u || (!u.homeegrams && !u.groups)) return t('nirgends verwendet');
    return [u.homeegrams ? t('{n} Homeegramm(e)', { n: u.homeegrams }) : '', u.groups ? t('{n} Gruppe(n)', { n: u.groups }) : ''].filter(Boolean).join(', ');
  }

  protected isUnused(id: number): boolean {
    const u = this.usage().get(id);
    return !u || (!u.homeegrams && !u.groups);
  }

  /** Neue Geräte: passende (gleicher Typ, unbenutzt) zuerst. */
  protected candidates(row: Row): { node: NodeView; suggested: boolean }[] {
    const from = this.node(row.from);
    const taken = new Set(this.rows().filter((r) => r !== row).map((r) => r.to));
    return this.devices()
      .filter((n) => n.id !== row.from && !taken.has(n.id))
      .map((n) => ({ node: n, suggested: !!from && n.profile === from.profile && this.isUnused(n.id) }))
      .sort((a, b) => Number(b.suggested) - Number(a.suggested));
  }

  protected setRow(i: number, patch: Partial<Row>): void {
    this.rows.update((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    this.plan.set(null);
    this.done.set(null);
  }

  protected addRow(): void {
    this.rows.update((r) => [...r, { from: null, to: null }]);
    this.plan.set(null);
  }

  protected removeRow(i: number): void {
    this.rows.update((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [{ from: null, to: null }]));
    this.plan.set(null);
  }

  protected setOption(which: 'groups' | 'rename', v: boolean): void {
    (which === 'groups' ? this.groups : this.rename).set(v);
    this.plan.set(null);
  }

  protected readonly pairs = computed(() => this.rows().filter((r) => r.from && r.to).map((r) => ({ from: r.from!, to: r.to! })));
  protected readonly ready = computed(() => this.pairs().length > 0 && this.pairs().length === this.rows().length);

  protected readonly totalChanges = computed(() => {
    const p = this.plan();
    if (!p) return 0;
    return p.homeegrams.reduce((n, h) => n + h.changes.length, 0) + p.groups.length + p.renames.length;
  });

  protected nodeName(id: number): string {
    return this.live.node(id)?.name ?? `#${id}`;
  }

  protected category(n: NodeView): string {
    return t(categoryOf(n).name);
  }

  protected async preview(): Promise<void> {
    this.busy.set(true);
    this.done.set(null);
    const p = await this.toasts.run(() => this.api.swapPreview(this.pairs(), this.groups(), this.rename()));
    this.busy.set(false);
    if (p) this.plan.set(p);
  }

  protected async apply(): Promise<void> {
    const list = this.pairs().map((p) => `• ${this.nodeName(p.from)} → ${this.nodeName(p.to)}`).join('\n');
    if (!confirm(`${t('Geräte jetzt tauschen?')}\n\n${list}\n\n${t('{n} Änderungen. Vorher wird automatisch gesichert.', { n: this.totalChanges() })}`)) return;
    this.busy.set(true);
    const res = await this.toasts.run(() => this.api.swapApply(this.pairs(), this.groups(), this.rename()));
    this.busy.set(false);
    if (res) {
      this.done.set(res);
      this.plan.set(null);
      if (res.errors.length) this.toasts.error(res.errors.join('; '));
      else this.toasts.ok(t('Geräte getauscht'));
      await this.live.load();
    }
  }

  protected reset(): void {
    this.rows.set([{ from: null, to: null }]);
    this.plan.set(null);
    this.done.set(null);
  }
}
