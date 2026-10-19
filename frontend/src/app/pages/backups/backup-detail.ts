import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { locale, t } from '../../core/i18n';
import { Live } from '../../core/live';
import { summarizeView } from '../../core/homeegram-model';
import { ModelCtx } from '../../core/model-context';
import type { BackupComparison, BackupHomeegram, HomeegramView, RestoreStatus } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

const STATUS_ORDER: RestoreStatus[] = ['deleted', 'changed', 'new', 'unchanged'];

/** Sicherung mit dem aktuellen Stand vergleichen und Homeegramme wiederherstellen. */
@Component({
  selector: 'app-backup-detail',
  imports: [RouterLink, Icon],
  templateUrl: './backup-detail.html',
  styleUrl: './backup-detail.scss',
})
export class BackupDetail {
  /** Routenparameter: Dateiname ohne „.json“ (sonst hält der Dev-Server die Adresse für eine Datei) */
  readonly id = input.required<string>();
  protected readonly file = computed(() => (this.id().endsWith('.json') ? this.id() : `${this.id()}.json`));

  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly live = inject(Live);

  protected readonly t = t;
  private readonly ctx = inject(ModelCtx);

  protected summary(v: HomeegramView): string {
    return summarizeView(v, this.ctx);
  }
  protected readonly data = signal<BackupComparison | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly filter = signal<'diff' | 'all'>('diff');
  protected readonly selected = signal<Set<number>>(new Set());
  protected readonly open = signal<number | null>(null);
  protected readonly busy = signal(false);

  protected readonly counts = computed(() => {
    const c: Record<RestoreStatus, number> = { unchanged: 0, changed: 0, deleted: 0, new: 0 };
    for (const h of this.data()?.homeegrams ?? []) c[h.status]++;
    return c;
  });

  protected readonly rows = computed(() =>
    [...(this.data()?.homeegrams ?? [])]
      .filter((h) => this.filter() === 'all' || h.status !== 'unchanged')
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name, locale())),
  );

  protected readonly restorable = computed(() => this.rows().filter((h) => this.canRestore(h)));

  constructor() {
    effect(() => {
      void this.load(this.file());
    });
  }

  private async load(file: string): Promise<void> {
    try {
      this.data.set(await this.api.compareBackup(file));
      this.error.set(null);
      this.selected.set(new Set());
    } catch (err) {
      this.error.set((err as Error).message);
    }
  }

  protected title(): string {
    const d = this.data();
    return d ? t('Sicherung vom {date}', { date: new Date(d.createdAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('Sicherung');
  }

  protected statusLabel(s: RestoreStatus): string {
    return { unchanged: t('unverändert'), changed: t('geändert'), deleted: t('gelöscht'), new: t('neu seit Sicherung') }[s];
  }

  protected canRestore(h: BackupHomeegram): boolean {
    return h.status === 'changed' || h.status === 'deleted';
  }

  protected toggle(h: BackupHomeegram): void {
    const s = new Set(this.selected());
    if (s.has(h.id)) s.delete(h.id);
    else s.add(h.id);
    this.selected.set(s);
  }

  protected toggleAll(): void {
    const all = this.restorable().map((h) => h.id);
    this.selected.set(all.every((id) => this.selected().has(id)) ? new Set() : new Set(all));
  }

  protected async restore(ids: number[]): Promise<void> {
    const names = this.data()!.homeegrams.filter((h) => ids.includes(h.id)).map((h) => `• ${h.name}`);
    if (!confirm(`${t('Diese Homeegramme auf den Stand der Sicherung zurücksetzen?')}\n\n${names.join('\n')}\n\n${t('Der aktuelle Stand wird vorher automatisch gesichert.')}`)) return;
    this.busy.set(true);
    const res = await this.toasts.run(() => this.api.restoreHomeegrams(this.file(), ids));
    this.busy.set(false);
    if (res) {
      const failed = res.results.filter((r) => r.error);
      if (failed.length) this.toasts.error(failed.map((f) => `${f.name}: ${f.error}`).join('; '));
      else this.toasts.ok(t('{n} Homeegramm(e) wiederhergestellt', { n: res.results.length }));
      await this.live.load();
      await this.load(this.file());
    }
  }
}
