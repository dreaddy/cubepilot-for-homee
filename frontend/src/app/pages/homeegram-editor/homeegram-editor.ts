import { JsonPipe } from '@angular/common';
import { Component, ElementRef, HostListener, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { relativeTime } from '../../core/format';
import {
  ITEM_DEFS,
  KIND_META,
  changeCount,
  defFor,
  describeItem,
  draftFromView,
  duplicateDraft,
  emptyDraft,
  itemState,
  newItem,
  toChangeSet,
  validateItem,
  type Draft,
  type DraftItem,
  type ItemDef,
} from '../../core/homeegram-model';
import { t } from '../../core/i18n';
import { Live } from '../../core/live';
import { ModelCtx } from '../../core/model-context';
import type { HomeegramView, ItemKind } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';
import { ItemEditor } from './item-editor';

@Component({
  selector: 'app-homeegram-editor',
  imports: [RouterLink, Icon, ItemEditor, JsonPipe],
  templateUrl: './homeegram-editor.html',
  styleUrl: './homeegram-editor.scss',
})
export class HomeegramEditor {
  /** Routenparameter: Zahl oder „neu“ */
  readonly id = input.required<string>();

  protected readonly live = inject(Live);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  protected readonly ctx = inject(ModelCtx);

  protected readonly draft = signal<Draft | null>(null);
  protected readonly view = signal<HomeegramView | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly expanded = signal<string | null>(null);
  protected readonly adding = signal<ItemKind | null>(null);
  protected readonly saving = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly raw = signal<unknown>(null);
  /** Bei neuen Homeegrammen: wurde schon etwas eingegeben? */
  private readonly touched = signal(false);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly kinds: ItemKind[] = ['triggers', 'conditions', 'actions'];
  protected readonly KIND_META = KIND_META;
  protected readonly relativeTime = relativeTime;
  protected readonly t = t;
  protected readonly defFor = defFor;
  protected readonly itemState = itemState;

  protected readonly isNew = computed(() => this.id() === 'neu');
  protected readonly numericId = computed(() => (this.isNew() ? null : Number(this.id())));
  protected readonly changes = computed(() => (this.draft() ? changeCount(this.draft()!) : 0));
  protected readonly dirty = computed(() => (this.isNew() ? this.touched() : this.changes() > 0));

  protected readonly errors = computed(() => {
    const map = new Map<string, string>();
    for (const item of this.draft()?.items ?? []) {
      const e = validateItem(item, this.ctx);
      if (e) map.set(item.key, e);
    }
    return map;
  });

  protected readonly canSave = computed(
    () => !!this.draft()?.name.trim() && this.errors().size === 0 && this.dirty() && !this.saving() && !this.live.readOnly(),
  );

  protected readonly addable = computed(() => {
    const kind = this.adding();
    return kind ? ITEM_DEFS.filter((d) => d.kind === kind && d.addable) : [];
  });

  constructor() {
    // Laden, sobald Route und Daten da sind
    effect(() => {
      const id = this.id();
      const loaded = this.live.loaded();
      untracked(() => {
        if (id === 'neu') {
          if (!this.draft()) {
            const d = emptyDraft();
            const trigger = newItem(defFor('time_triggers')!);
            d.items.push(trigger);
            this.draft.set(d);
            this.expanded.set(trigger.key);
          }
          return;
        }
        if (loaded) void this.load(Number(id));
      });
    });

    // Bei neuen Homeegrammen direkt ins Namensfeld
    effect(() => {
      const el = this.nameInput()?.nativeElement;
      if (el && this.isNew()) untracked(() => setTimeout(() => el.focus()));
    });

    // Änderungen von außen (homee-App, KI) übernehmen, solange hier nichts geändert wurde
    effect(() => {
      const id = this.numericId();
      const remote = this.live.homeegrams().find((h) => h.id === id);
      untracked(() => {
        if (remote && this.view() && !this.dirty() && !this.saving() && JSON.stringify(remote) !== JSON.stringify(this.view())) {
          this.view.set(remote);
          this.draft.set(draftFromView(remote));
        }
      });
    });
  }

  private async load(id: number): Promise<void> {
    try {
      const v = await this.api.homeegram(id);
      this.view.set(v);
      this.draft.set(draftFromView(v));
      this.error.set(null);
    } catch (err) {
      this.error.set((err as Error).message);
    }
  }

  // ---------------------------------------------------------------- Entwurf bearbeiten

  private updateDraft(fn: (d: Draft) => Draft): void {
    const d = this.draft();
    if (d) {
      this.draft.set(fn(d));
      this.touched.set(true);
    }
  }

  protected setName(name: string): void {
    this.updateDraft((d) => ({ ...d, name }));
  }

  protected setActive(active: boolean): void {
    this.updateDraft((d) => ({ ...d, active }));
  }

  protected items(kind: ItemKind): DraftItem[] {
    return this.draft()?.items.filter((i) => i.kind === kind) ?? [];
  }

  protected visibleCount(kind: ItemKind): number {
    return this.items(kind).filter((i) => !i.removed).length;
  }

  protected describe(item: DraftItem): string {
    return describeItem(item, this.ctx);
  }

  protected toggle(item: DraftItem): void {
    this.expanded.set(this.expanded() === item.key ? null : item.key);
  }

  protected patchItem(item: DraftItem, patch: Record<string, unknown>): void {
    this.updateDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === item.key ? { ...i, data: { ...i.data, ...patch } } : i)) }));
  }

  protected replaceItem(item: DraftItem, data: Record<string, unknown>): void {
    this.updateDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === item.key ? { ...i, data } : i)) }));
  }

  protected add(def: ItemDef): void {
    const item = newItem(def);
    this.updateDraft((d) => ({ ...d, items: [...d.items, item] }));
    this.adding.set(null);
    this.expanded.set(item.key);
  }

  protected remove(item: DraftItem): void {
    this.updateDraft((d) => ({
      ...d,
      items: item.id === undefined ? d.items.filter((i) => i.key !== item.key) : d.items.map((i) => (i.key === item.key ? { ...i, removed: true } : i)),
    }));
    if (this.expanded() === item.key) this.expanded.set(null);
  }

  protected restore(item: DraftItem): void {
    this.updateDraft((d) => ({
      ...d,
      items: d.items.map((i) => (i.key === item.key ? { ...i, removed: false, data: structuredClone(i.original ?? i.data) } : i)),
    }));
  }

  protected discard(): void {
    if (this.isNew()) {
      this.touched.set(false);
      void this.router.navigate(['/homeegramme']);
      return;
    }
    const v = this.view();
    if (v) this.draft.set(draftFromView(v));
    this.expanded.set(null);
  }

  // ---------------------------------------------------------------- Speichern & Aktionen

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || !this.canSave()) return;
    this.saving.set(true);
    try {
      const cs = toChangeSet(d);
      const res = d.id === null ? await this.api.createHomeegram(d.name.trim(), { active: d.active ? 1 : 0 }, cs.add) : await this.api.saveChanges(d.id, cs);
      if (res.homeegram) {
        this.view.set(res.homeegram);
        this.draft.set(draftFromView(res.homeegram));
        this.live.applyHomeegram(res.homeegram);
      }
      if (res.error) {
        this.toasts.error(t('Teilweise gespeichert ({n} Schritte): {error}', { n: res.applied, error: res.error }));
      } else {
        this.toasts.ok(t('Gespeichert'));
      }
      this.expanded.set(null);
      this.touched.set(false);
      if (d.id === null && res.id) await this.router.navigate(['/homeegramme', res.id], { replaceUrl: true });
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  protected async play(test = false): Promise<void> {
    const id = this.numericId();
    if (id === null) return;
    const name = this.view()?.name ?? t('Homeegramm');
    const hint = this.dirty() ? `\n\n${t('Hinweis: Ausgeführt wird die gespeicherte Version, nicht deine ungespeicherten Änderungen.')}` : '';
    const question = test ? t('„{name}“ jetzt als Testlauf ausführen?', { name }) : t('„{name}“ jetzt ausführen?', { name });
    if (!confirm(`${question}\n\n${t('Die Aktionen werden sofort ausgelöst.')}${hint}`)) return;
    await this.toasts.run(() => (test ? this.api.test(id) : this.api.play(id)), test ? t('Testlauf gestartet') : t('Wird ausgeführt'));
  }

  protected async duplicate(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    this.menuOpen.set(false);
    const copy = duplicateDraft(d);
    const res = await this.toasts.run(() => this.api.createHomeegram(copy.name, { active: 0 }, toChangeSet(copy).add), t('Kopie angelegt (inaktiv)'));
    if (res?.homeegram) {
      this.live.applyHomeegram(res.homeegram);
      await this.router.navigate(['/homeegramme', res.homeegram.id]);
    }
  }

  protected async deleteHomeegram(): Promise<void> {
    const d = this.draft();
    this.menuOpen.set(false);
    if (!d || d.id === null) return;
    if (!confirm(`${t('„{name}“ wirklich löschen?', { name: d.name })}\n\n${t('Vorher wird automatisch eine Sicherung angelegt.')}`)) return;
    const ok = await this.toasts.run(() => this.api.deleteHomeegram(d.id!), t('Gelöscht'));
    if (ok) {
      this.live.removeHomeegram(d.id);
      this.draft.set(null);
      await this.router.navigate(['/homeegramme']);
    }
  }

  protected async toggleRaw(): Promise<void> {
    this.menuOpen.set(false);
    const id = this.numericId();
    if (this.raw() || id === null) {
      this.raw.set(null);
      return;
    }
    this.raw.set(await this.api.homeegramRaw(id));
  }

  // ---------------------------------------------------------------- Ungespeicherte Änderungen

  canLeave(): boolean {
    return !this.dirty() || confirm(t('Es gibt ungespeicherte Änderungen. Trotzdem verlassen?'));
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) e.preventDefault();
  }

  @HostListener('document:keydown', ['$event'])
  protected keydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void this.save();
    }
    if (e.key === 'Escape') {
      this.adding.set(null);
      this.menuOpen.set(false);
    }
  }
}
