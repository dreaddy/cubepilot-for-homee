import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { secureApi } from '../backend/src/security.ts';

function server(token = '') {
  const app = Fastify();
  secureApi(app, token);
  app.get('/api/status', async () => ({ ok: true }));
  app.post('/api/setup', async () => ({ ok: true }));
  app.get('/api/events', async () => ({ ok: true }));
  return app;
}

test('local API rejects foreign browser origins and DNS rebinding hosts', async (t) => {
  const app = server();
  t.after(() => app.close());
  for (const headers of [
    { host: 'localhost:5311', origin: 'https://evil.example' },
    { host: 'evil.example:5311' },
    { host: 'localhost:5311', origin: 'null' },
    { host: 'localhost:5311', 'sec-fetch-site': 'cross-site' },
  ]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/setup', headers })).statusCode, 403);
  }
});

test('same-host production, local CLI and Angular development requests work', async (t) => {
  const app = server();
  t.after(() => app.close());
  for (const headers of [
    { host: 'localhost:5311' },
    { host: '127.0.0.1:5311', origin: 'http://localhost:5310' },
    { host: 'localhost:5311', origin: 'http://localhost:5311' },
    { host: '[::1]:5311', origin: 'http://[::1]:5310' },
  ]) {
    assert.equal((await app.inject({ url: '/api/status', headers })).statusCode, 200);
  }
});

test('API key protects encoded routes; query keys work only for EventSource', async (t) => {
  const token = 'test-only-secret';
  const app = server(token);
  t.after(() => app.close());
  for (const url of ['/api/status', '/%61pi/status', `/api/status?key=${token}`]) {
    assert.equal((await app.inject({ url })).statusCode, 401, url);
  }
  assert.equal((await app.inject({ url: '/api/status', headers: { 'x-api-key': token } })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/events?key=${token}` })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/events?key=wrong' })).statusCode, 401);
});
