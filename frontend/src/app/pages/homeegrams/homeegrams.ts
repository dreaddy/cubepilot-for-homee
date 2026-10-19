import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { relativeTime } from '../../core/format';
import { defFor, describeItem, draftFromView } from '../../core/homeegram-model';
import { locale, t } from '../../core/i18n';
import { Live } from '../../core/live';
import { ModelCtx } from '../../core/model-context';
import type { HomeegramView } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

type Filter = 'all' | 'active' | 'inactive';
type Sort = 'name' | 'recent';

interface Row {
  hg: HomeegramView;
  triggers: { icon: string; text: string }[];
  conditionCount: number;
  actions: { icon: string; text: string }[];
}

@Component({
  selector: 'app-homeegrams',
  imports: [RouterLink, Icon],
  templateUrl: './homeegrams.html',
  styleUrl: './homeegrams.scss',
})
export class Homeegrams {
  protected readonly live = inject(Live);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly ctx = inject(ModelCtx);

  protected readonly search = signal('');
  protected readonly filter = signal<Filter>('all');
  protected readonly sort = signal<Sort>('name');
  protected readonly relativeTime = relativeTime;
  protected readonly t = t;

  protected readonly counts = computed(() => {
    const all = this.live.homeegrams();
    return { all: all.length, active: all.filter((h) => h.active).length, inactive: all.filter((h) => !h.active).length };
  });

  protected readonly rows = computed<Row[]>(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filter();
    const rows = this.live
      .homeegrams()
      .filter((h) => (f === 'all' ? true : f === 'active' ? h.active : !h.active))
      .map((hg) => this.toRow(hg))
      .filter(
        (r) =>
          !q ||
          r.hg.name.toLowerCase().includes(q) ||
          [...r.triggers, ...r.actions].some((x) => x.text.toLowerCase().includes(q)),
      );
    return this.sort() === 'recent'
      ? rows.sort((a, b) => (b.hg.lastTriggered ?? '').localeCompare(a.hg.lastTriggered ?? ''))
      : rows.sort((a, b) => a.hg.name.localeCompare(b.hg.name, locale()));
  });

  private toRow(hg: HomeegramView): Row {
    const items = draftFromView(hg).items;
    const map = (kind: string) =>
      items.filter((i) => i.kind === kind).map((i) => ({ icon: defFor(i.group)?.icon ?? 'box', text: describeItem(i, this.ctx) }));
    return { hg, triggers: map('triggers'), conditionCount: items.filter((i) => i.kind === 'conditions').length, actions: map('actions') };
  }

  protected async play(h: HomeegramView, e: Event): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`${t('„{name}“ jetzt ausführen?', { name: h.name })}\n\n${t('Die Aktionen werden sofort ausgelöst.')}`)) return;
    await this.toasts.run(() => this.api.play(h.id), t('„{name}“ wird ausgeführt', { name: h.name }));
  }

  protected async toggle(h: HomeegramView, active: boolean, e: Event): Promise<void> {
    e.stopPropagation();
    const v = await this.toasts.run(() => this.api.setActive(h.id, active), t(active ? '„{name}“ aktiviert' : '„{name}“ deaktiviert', { name: h.name }));
    if (v) this.live.applyHomeegram(v);
  }
}
