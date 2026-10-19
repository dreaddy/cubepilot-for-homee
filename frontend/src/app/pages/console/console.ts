import { JsonPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { t } from '../../core/i18n';
import { Toasts } from '../../core/toast';

const EXAMPLES = ['GET:settings', 'GET:homeegrams/5', 'GET:nodes/26', 'GET:groups', 'GET:users', 'GET:diary?limit=10'];

@Component({
  selector: 'app-console',
  imports: [JsonPipe],
  templateUrl: './console.html',
  styles: `
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    .row input { flex: 1; min-width: 240px; font-family: ui-monospace, Consolas, monospace; }
    .entry { margin-top: 14px; }
    .entry code { font-weight: 600; }
  `,
})
export class Console {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  protected readonly examples = EXAMPLES;
  protected readonly t = t;
  protected readonly command = signal('GET:settings');
  protected readonly busy = signal(false);
  protected readonly results = signal<{ command: string; received: unknown[] }[]>([]);

  protected async send(): Promise<void> {
    const cmd = this.command().trim();
    if (!cmd) return;
    if (!cmd.startsWith('GET:') && !confirm(`${t('Schreibender Befehl:')}\n${cmd}\n\n${t('Wirklich an homee senden?')}`)) return;
    this.busy.set(true);
    const res = await this.toasts.run(() => this.api.raw(cmd));
    this.busy.set(false);
    if (res) this.results.update((r) => [res, ...r].slice(0, 20));
  }
}
