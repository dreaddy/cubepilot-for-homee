// Verbindungstest: meldet sich mit den Daten aus .env an und gibt eine Übersicht aus.
// Aufruf: npm run probe            -> Übersicht
//         npm run probe -- --dump  -> zusätzlich kompletten Zustand nach data/probe-dump.json schreiben

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HomeeClient, decode, homeegramView, nodeView } from '@cubepilot/client';
import { config } from './config.ts';

const homee = new HomeeClient({ ...config.homee, deviceName: `${config.homee.deviceName}-probe` });

console.log(`Verbinde mit ${config.homee.host} als „${config.homee.user}“ (${homee.isRemote ? 'über homee-Cloud' : 'lokal'}) …`);

try {
  await homee.connect();
} catch (err) {
  console.error(`\n✗ Verbindung fehlgeschlagen: ${(err as Error).message}`);
  homee.disconnect();
  process.exit(1);
}

const s = homee.state;
console.log(`\n✓ Verbunden mit „${decode(s.settings?.homee_name) || "homee"}“, Version ${s.settings?.version ?? '?'}`);
console.log(`  ${s.nodes.length} Geräte, ${s.homeegrams.length} Homeegramme, ${s.groups.length} Gruppen\n`);

console.log('Geräte:');
for (const n of s.nodes.filter((x) => x.id !== -1).map(nodeView)) {
  const editable = n.attributes.filter((a) => a.editable).length;
  console.log(`  #${n.id} ${n.name} [${n.profileName}] – ${n.attributes.length} Attribute, ${editable} schreibbar`);
}

console.log('\nHomeegramme:');
for (const v of s.homeegrams.map((h) => homeegramView(h, s))) {
  console.log(`  #${v.id} ${v.active ? '●' : '○'} ${v.name}`);
  console.log(`      ${v.summary}`);
}

if (process.argv.includes('--dump')) {
  await mkdir(config.dataDir, { recursive: true });
  const file = join(config.dataDir, 'probe-dump.json');
  await writeFile(file, JSON.stringify(s, null, 2));
  console.log(`\nKompletter Zustand gespeichert: ${file}`);
}

homee.disconnect();
process.exit(0);
