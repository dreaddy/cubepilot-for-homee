import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { relativeTime } from '../../core/format';
import { locale, t } from '../../core/i18n';
import type { BackupInfo } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

/** Technische Aktionsnamen (aus dem Backend) → lesbare Bezeichnung */
const ACTION_LABELS: Record<string, string> = {
  'save-homeegram': 'Homeegramm gespeichert',
  'create-homeegram': 'Homeegramm angelegt',
  'delete-homeegram': 'Homeegramm gelöscht',
  'update-homeegram': 'Homeegramm geändert',
  'set-homeegram-active': 'Homeegramm (de)aktiviert',
  'restore-homeegrams': 'Wiederherstellen',
  'swap-devices': 'Gerätetausch',
  'add-triggers': 'Auslöser hinzugefügt',
  'add-conditions': 'Bedingung hinzugefügt',
  'add-actions': 'Aktion hinzugefügt',
  'update-triggers': 'Auslöser geändert',
  'update-conditions': 'Bedingung geändert',
  'update-actions': 'Aktion geändert',
  'delete-triggers': 'Auslöser gelöscht',
  'delete-conditions': 'Bedingung gelöscht',
  'delete-actions': 'Aktion gelöscht',
  raw: 'Rohbefehl',
};

@Component({
  selector: 'app-backups',
  imports: [RouterLink, Icon],
  templateUrl: './backups.html',
  styleUrl: './backups.scss',
})
export class Backups {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  protected readonly t = t;
  protected readonly relativeTime = relativeTime;
  protected readonly backups = signal<BackupInfo[] | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    const list = await this.toasts.run(() => this.api.backups());
    this.backups.set(list ?? []);
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Grund der Sicherung in lesbarer Form. */
  protected reason(r: string): string {
    if (r.startsWith('auto-')) return t('automatisch vor „{action}“', { action: t(ACTION_LABELS[r.slice(5)] ?? r.slice(5)) });
    if (r === 'manuell') return t('manuell');
    return r;
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    await this.toasts.run(() => this.api.createBackup('manuell'), t('Sicherung angelegt'));
    this.busy.set(false);
    await this.load();
  }

  protected async upload(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const content = JSON.parse(await file.text());
      await this.toasts.run(() => this.api.importBackup(content), t('Sicherung hochgeladen'));
      await this.load();
    } catch {
      this.toasts.error(t('Die Datei ist keine gültige Sicherung.'));
    }
  }

  protected async download(b: BackupInfo): Promise<void> {
    const data = await this.toasts.run(() => this.api.backup(b.file));
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `homee-${b.file}`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
