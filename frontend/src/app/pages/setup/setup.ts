import { Component, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { t } from '../../core/i18n';
import type { ConnectionTest, SetupInput } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-setup',
  imports: [Icon],
  templateUrl: './setup.html',
  styles: `
    form { max-width: 560px; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
    .hint { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--warn-soft); color: var(--warn); font-size: 0.88rem; }
    .hint app-icon { flex: none; margin-top: 2px; }
    .result { display: flex; gap: 8px; align-items: flex-start; font-size: 0.9rem; }
    .result.ok { color: var(--ok); }
    .result.fail { color: var(--danger); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  `,
})
export class Setup {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly t = t;

  protected readonly form = signal<SetupInput>({ mode: 'local', ip: '', homeeId: '', user: '', password: '' });
  protected readonly hasPassword = signal(false);
  protected readonly isAdmin = signal<boolean | null>(null);
  protected readonly busy = signal(false);
  protected readonly result = signal<ConnectionTest | null>(null);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    const s = await this.toasts.run(() => this.api.setup());
    if (!s) return;
    this.form.set({ mode: s.mode, ip: s.ip, homeeId: s.homeeId, user: s.user, password: '' });
    this.hasPassword.set(s.hasPassword);
    this.isAdmin.set(s.isAdmin);
  }

  protected set<K extends keyof SetupInput>(key: K, value: SetupInput[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
    this.result.set(null);
  }

  protected async test(): Promise<void> {
    this.busy.set(true);
    const r = await this.toasts.run(() => this.api.testSetup(this.form()));
    this.busy.set(false);
    if (r) this.result.set(r);
  }

  protected async save(force = false): Promise<void> {
    if (force && !confirm(t('Der Verbindungstest ist fehlgeschlagen. Trotzdem speichern?'))) return;
    this.busy.set(true);
    try {
      const r = await this.api.saveSetup(this.form(), force);
      this.result.set(r);
      this.hasPassword.set(true);
      this.isAdmin.set(r.isAdmin ?? null);
      this.form.update((f) => ({ ...f, password: '', homeeId: r.homeeId || f.homeeId }));
      this.toasts.ok(t('Gespeichert, verbinde neu …'));
    } catch (err) {
      this.result.set({ ok: false, error: (err as Error).message });
    } finally {
      this.busy.set(false);
    }
  }
}
