import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const envFile = resolve(rootDir, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Umgebungsvariable ${name} fehlt (siehe .env.example)`);
  return v;
}

const flag = (name: string) => ['1', 'true', 'yes'].includes((process.env[name] ?? '').toLowerCase());

const homeeMode = (process.env.HOMEE_MODE || 'local').toLowerCase();
if (homeeMode !== 'local' && homeeMode !== 'remote') throw new Error('HOMEE_MODE muss "local" oder "remote" sein');

export const config = {
  homee: {
    mode: homeeMode,
    host: homeeMode === 'remote' ? required('HOMEE_ID') : required('HOMEE_IP'),
    user: required('HOMEE_USER'),
    password: required('HOMEE_PASSWORD'),
    deviceName: process.env.HOMEE_DEVICE_NAME || 'cubepilot-for-homee',
  },
  host: process.env.BACKEND_HOST || '127.0.0.1',
  port: Number(process.env.BACKEND_PORT || 5311),
  apiToken: process.env.API_TOKEN || '',
  readOnly: flag('READ_ONLY'),
  allowRaw: flag('ALLOW_RAW'),
  dataDir: resolve(rootDir, 'data'),
  frontendDist: resolve(rootDir, 'frontend/dist/frontend/browser'),
};

const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
if (!isLoopback && !config.apiToken) {
  throw new Error('BACKEND_HOST ist nicht localhost: bitte API_TOKEN setzen, sonst kann jeder im Netz homee steuern.');
}
