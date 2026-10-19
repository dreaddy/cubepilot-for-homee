// Sicherungen des homee-Zustands und Protokoll aller schreibenden Aktionen (unter data/).

import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HomeeState } from '@cubepilot/client';
import { config } from './config.ts';

const backupDir = join(config.dataDir, 'backups');
const auditFile = join(config.dataDir, 'audit.jsonl');
const AUTO_BACKUP_INTERVAL_MS = 2 * 60 * 1000;
/** So viele automatische Sicherungen bleiben erhalten (manuelle und importierte werden nie gelöscht). */
const KEEP_AUTO_BACKUPS = Number(process.env.KEEP_AUTO_BACKUPS || 200);

let lastBackupAt = 0;

export interface BackupInfo {
  file: string;
  createdAt: string;
  reason: string;
  size: number;
}

export async function createBackup(state: HomeeState, reason: string): Promise<BackupInfo> {
  await mkdir(backupDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const safeReason = reason.replace(/[^a-z0-9-]+/gi, '-').slice(0, 40);
  const file = `${createdAt.replace(/[:.]/g, '-')}_${safeReason}.json`;
  const content = JSON.stringify(
    {
      createdAt,
      reason,
      homeegrams: state.homeegrams,
      nodes: state.nodes,
      groups: state.groups,
      relationships: state.relationships,
      plans: state.plans,
    },
    null,
    2,
  );
  await writeFile(join(backupDir, file), content);
  lastBackupAt = Date.now();
  return { file, createdAt, reason, size: content.length };
}

/** Legt vor Änderungen eine Sicherung an, höchstens alle 2 Minuten (außer force). */
export async function autoBackup(state: HomeeState, reason: string, force = false): Promise<void> {
  if (!force && Date.now() - lastBackupAt < AUTO_BACKUP_INTERVAL_MS) return;
  await createBackup(state, `auto-${reason}`);
  await pruneAutoBackups();
}

async function pruneAutoBackups(): Promise<void> {
  const auto = (await readdir(backupDir)).filter((f) => /_auto-.*\.json$/.test(f)).sort().reverse();
  for (const f of auto.slice(KEEP_AUTO_BACKUPS)) await rm(join(backupDir, f), { force: true });
}

export async function listBackups(): Promise<BackupInfo[]> {
  await mkdir(backupDir, { recursive: true });
  const files = (await readdir(backupDir)).filter((f) => f.endsWith('.json')).sort().reverse();
  return Promise.all(
    files.map(async (file) => {
      const raw = await readFile(join(backupDir, file), 'utf8');
      const { createdAt, reason } = JSON.parse(raw);
      return { file, createdAt, reason, size: raw.length };
    }),
  );
}

export async function readBackup(file: string): Promise<unknown> {
  if (!/^[\w.-]+\.json$/.test(file)) throw Object.assign(new Error('Ungültiger Dateiname'), { statusCode: 400 });
  return JSON.parse(await readFile(join(backupDir, file), 'utf8'));
}

/** Übernimmt eine hochgeladene Sicherung (z. B. von einem anderen Rechner) in data/backups/. */
export async function importBackup(content: unknown): Promise<BackupInfo> {
  const c = content as { homeegrams?: unknown; createdAt?: string; reason?: string };
  if (!c || !Array.isArray(c.homeegrams)) {
    throw Object.assign(new Error('Keine gültige Sicherung (homeegrams fehlt)'), { statusCode: 400 });
  }
  await mkdir(backupDir, { recursive: true });
  const createdAt = typeof c.createdAt === 'string' ? c.createdAt : new Date().toISOString();
  const reason = `import${c.reason ? ` (${c.reason})` : ''}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `${stamp}_import.json`;
  const text = JSON.stringify({ ...c, createdAt, reason }, null, 2);
  await writeFile(join(backupDir, file), text);
  return { file, createdAt, reason, size: text.length };
}

export interface AuditEntry {
  at: string;
  source: string;
  action: string;
  details: unknown;
  ok: boolean;
  error?: string;
}

export async function audit(entry: Omit<AuditEntry, 'at'>): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  await appendFile(auditFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

export async function readAudit(limit = 100): Promise<AuditEntry[]> {
  try {
    const lines = (await readFile(auditFile, 'utf8')).trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
