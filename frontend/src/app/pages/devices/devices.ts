import { Component, computed, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { CATEGORIES, OTHER_CATEGORY, TECHNICAL, attributeLabel, categoryOf, formatValue, nodeIcon } from '../../core/labels';
import { locale, t } from '../../core/i18n';
import { Live } from '../../core/live';
import type { AttributeView, NodeView } from '../../core/models';
import { Toasts } from '../../core/toast';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/icon';
import { DeviceDialog } from './device-dialog';

type Kind = 'shutter' | 'light' | 'heating' | 'plug' | 'lock' | 'info';

@Component({
  selector: 'app-devices',
  imports: [Icon, DeviceDialog, RouterLink],
  templateUrl: './devices.html',
  styleUrl: './devices.scss',
})
export class Devices {
  protected readonly live = inject(Live);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  protected readonly search = signal('');
  protected readonly category = signal<string>('all');
  protected readonly busy = signal<Set<number>>(new Set());
  protected readonly selected = signal<NodeView | null>(null);
  /** Zwischenwerte beim Ziehen eines Reglers (attributeId -> Wert) */
  protected readonly dragging = signal<Record<number, number>>({});

  protected readonly categories = computed(() => {
    const counts = new Map<string, number>();
    for (const n of this.live.nodes()) counts.set(categoryOf(n).key, (counts.get(categoryOf(n).key) ?? 0) + 1);
    return [...CATEGORIES, OTHER_CATEGORY].filter((c) => counts.has(c.key)).map((c) => ({ ...c, count: counts.get(c.key)! }));
  });

  protected readonly sections = computed(() => {
    const q = this.search().trim().toLowerCase();
    const cat = this.category();
    const nodes = this.live
      .nodes()
      .filter((n) => cat === 'all' || categoryOf(n).key === cat)
      .filter((n) => !q || n.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, locale()));
    return this.categories()
      .map((c) => ({ ...c, nodes: nodes.filter((n) => categoryOf(n).key === c.key) }))
      .filter((s) => s.nodes.length);
  });

  protected readonly t = t;
  protected readonly icon = nodeIcon;
  protected readonly attributeLabel = attributeLabel;
  protected readonly formatValue = formatValue;

  protected attr(n: NodeView, typeName: string): AttributeView | undefined {
    return n.attributes.find((a) => a.typeName === typeName);
  }

  protected kind(n: NodeView): Kind {
    if (this.attr(n, 'Position')?.editable) return 'shutter';
    if (this.attr(n, 'TargetTemperature')?.editable) return 'heating';
    if (this.attr(n, 'LockState')?.editable) return 'lock';
    if (this.attr(n, 'OnOff')?.editable) return /Light|Dimmable/.test(n.profileName) ? 'light' : 'plug';
    return 'info';
  }

  protected offline(n: NodeView): boolean {
    return n.state !== 'Available';
  }

  protected isOn(n: NodeView): boolean {
    const k = this.kind(n);
    if (k === 'light' || k === 'plug') return this.attr(n, 'OnOff')?.value === 1;
    if (k === 'shutter') return (this.attr(n, 'Position')?.value ?? 100) < 100;
    if (k === 'heating') return true;
    return false;
  }

  /** Läuft gerade eine Änderung (Ziel ≠ Ist)? */
  protected pending(a: AttributeView | undefined): boolean {
    return !!a && a.editable && a.target !== a.value;
  }

  protected status(n: NodeView): string {
    if (this.offline(n)) return t('Nicht erreichbar');
    switch (this.kind(n)) {
      case 'shutter': {
        const p = this.attr(n, 'Position')!;
        if (this.pending(p)) return t('fährt auf {n} %', { n: p.target });
        return p.value === 0 ? t('Offen') : p.value === 100 ? t('Geschlossen') : t('{n} % geschlossen', { n: p.value });
      }
      case 'light':
      case 'plug': {
        const on = this.attr(n, 'OnOff')!;
        const dim = this.attr(n, 'DimmingLevel');
        const power = this.attr(n, 'CurrentEnergyUse');
        const parts = [on.value === 1 ? t('An') : t('Aus')];
        if (on.value === 1 && dim) parts.push(`${Math.round(dim.value)} %`);
        if (power) parts.push(formatValue(power, power.value));
        return parts.join(' · ');
      }
      case 'heating': {
        const cur = this.attr(n, 'Temperature');
        return cur ? t('Ist {v}', { v: formatValue(cur, cur.value) }) : '';
      }
      case 'lock': {
        const l = this.attr(n, 'LockState')!;
        return this.pending(l) ? t('wird geändert …') : formatValue(l, l.value);
      }
      default:
        return this.readings(n)
          .slice(0, 2)
          .map((a) => formatValue(a, a.value))
          .join(' · ');
    }
  }

  /** Läuft bei diesem Gerät gerade etwas (Rollladen fährt, Schloss schaltet)? */
  protected isPending(n: NodeView): boolean {
    if (this.offline(n)) return false;
    const k = this.kind(n);
    return (k === 'shutter' && this.pending(this.attr(n, 'Position'))) || (k === 'lock' && this.pending(this.attr(n, 'LockState')));
  }

  protected readings(n: NodeView): AttributeView[] {
    return n.attributes.filter((a) => !a.editable && !TECHNICAL.has(a.typeName) && !/Forecast|Alarm$|Revision|Time$/.test(a.typeName)).slice(0, 4);
  }

  protected shownValue(a: AttributeView): number {
    return this.dragging()[a.id] ?? a.target;
  }

  protected drag(a: AttributeView, v: string): void {
    this.dragging.update((d) => ({ ...d, [a.id]: Number(v) }));
  }

  protected async set(a: AttributeView | undefined, value: number | string): Promise<void> {
    if (!a) return;
    const v = Math.min(a.max, Math.max(a.min, Number(value)));
    if (!Number.isFinite(v)) return;
    this.busy.update((s) => new Set(s).add(a.id));
    await this.toasts.run(() => this.api.setValue(a.nodeId, a.id, v));
    this.busy.update((s) => {
      const n = new Set(s);
      n.delete(a.id);
      return n;
    });
    this.dragging.update((d) => {
      const { [a.id]: _, ...rest } = d;
      return rest;
    });
  }

  protected step(a: AttributeView, dir: 1 | -1): void {
    void this.set(a, Math.round((a.target + dir * (a.step || 0.5)) * 10) / 10);
  }

  protected toggleLock(a: AttributeView): void {
    const lock = a.value !== 1;
    if (!confirm(lock ? t('Tür verriegeln?') : t('Tür entriegeln?'))) return;
    void this.set(a, lock ? 1 : 0);
  }
}
