// Beendet ein im Hintergrund laufendes Backend (z. B. vom MCP-Server automatisch gestartet).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const pidFile = resolve(import.meta.dirname, '../data/backend.pid');
if (!existsSync(pidFile)) {
  console.log('Kein laufendes Backend gefunden (data/backend.pid fehlt).');
  process.exit(0);
}
const pid = Number(readFileSync(pidFile, 'utf8'));
try {
  process.kill(pid);
  console.log(`Backend (PID ${pid}) beendet.`);
} catch {
  console.log(`Backend (PID ${pid}) lief nicht mehr.`);
}
rmSync(pidFile, { force: true });
