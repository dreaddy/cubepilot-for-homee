import { DatePipe, JsonPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { relativeTime } from '../../core/format';
import { t } from '../../core/i18n';
import { Live } from '../../core/live';
import type { AuditEntry, BackupInfo } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

const ACTIONS: Record<string, { label: string; icon: string }> = {
  'set-value': { label: 'Gerät gesteuert', icon: 'sliders' },
  'play-homeegram': { label: 'Homeegramm ausgeführt', icon: 'play' },
  'test-homeegram': { label: 'Testlauf', icon: 'flask' },
  'set-homeegram-active': { label: 'Homeegramm (de)aktiviert', icon: 'power' },
  'create-homeegram': { label: 'Homeegramm angelegt', icon: 'plus' },
  'save-homeegram': { label: 'Homeegramm gespeichert', icon: 'save' },
  'update-homeegram': { label: 'Homeegramm geändert', icon: 'pencil' },
  'delete-homeegram': { label: 'Homeegramm gelöscht', icon: 'trash' },
  'add-triggers': { label: 'Auslöser hinzugefügt', icon: 'plus' },
  'add-conditions': { label: 'Bedingung hinzugefügt', icon: 'plus' },
  'add-actions': { label: 'Aktion hinzugefügt', icon: 'plus' },
  'update-triggers': { label: 'Auslöser geändert', icon: 'pencil' },
  'update-conditions': { label: 'Bedingung geändert', icon: 'pencil' },
  'update-actions': { label: 'Aktion geändert', icon: 'pencil' },
  'delete-triggers': { label: 'Auslöser gelöscht', icon: 'trash' },
  'delete-conditions': { label: 'Bedingung gelöscht', icon: 'trash' },
  'delete-actions': { label: 'Aktion gelöscht', icon: 'trash' },
  raw: { label: 'Rohbefehl', icon: 'terminal' },
  control: { label: 'Gerät gesteuert (Handy)', icon: 'sliders' },
  setup: { label: 'homee-Zugang geändert', icon: 'key' },
};

const SOURCES: Record<string, string> = { frontend: 'Oberfläche', mcp: 'KI', remote: 'Handy', api: 'API', test: 'Test' };

@Component({
  selector: 'app-log',
  imports: [DatePipe, JsonPipe, RouterLink, Icon],
  templateUrl: './log.html',
  styleUrl: './log.scss',
})
export class Log {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly live = inject(Live);

  protected readonly audit = signal<AuditEntry[]>([]);
  protected readonly backups = signal<BackupInfo[]>([]);
  protected readonly source = signal<string>('all');
  protected readonly open = signal<number | null>(null);
  protected readonly relativeTime = relativeTime;
  protected readonly t = t;

  protected readonly entries = computed(() => this.audit().filter((e) => this.source() === 'all' || e.source === this.source()));

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    await this.toasts.run(async () => {
      const [audit, backups] = await Promise.all([this.api.audit(), this.api.backups()]);
      this.audit.set(audit);
      this.backups.set(backups);
    });
  }

  protected action(e: AuditEntry) {
    return ACTIONS[e.action] ?? { label: e.action, icon: 'box' };
  }

  protected sourceLabel(s: string): string {
    return t(SOURCES[s] ?? s);
  }

  /** Kurzer Kontext: betroffenes Homeegramm oder Gerät. */
  protected subject(e: AuditEntry): { text: string; link: unknown[] | null } {
    const d = (e.details ?? {}) as Record<string, any>;
    const hgId = d['id'] ?? d['before']?.id;
    if (e.action.includes('homeegram') || /triggers|conditions|actions/.test(e.action)) {
      const name = d['name'] ?? d['before']?.name ?? this.live.homeegrams().find((h) => h.id === hgId)?.name;
      const exists = this.live.homeegrams().some((h) => h.id === hgId);
      return { text: name ? decodeSafe(String(name)) : hgId ? `#${hgId}` : '', link: exists ? ['/homeegramme', hgId] : null };
    }
    if (e.action === 'set-value') {
      const node = this.live.node(Number(d['nodeId']));
      return { text: `${node?.name ?? t('Gerät #{n}', { n: d['nodeId'] })} → ${d['value']}`, link: null };
    }
    if (e.action === 'raw') return { text: String(d['command'] ?? ''), link: null };
    return { text: '', link: null };
  }

  protected async createBackup(): Promise<void> {
    await this.toasts.run(() => this.api.createBackup('manuell'), t('Sicherung angelegt'));
    await this.load();
  }

  protected async download(b: BackupInfo): Promise<void> {
    const data = await this.toasts.run(() => this.api.backup(b.file));
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = b.file;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
