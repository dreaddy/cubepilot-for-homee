import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HomeeClient } from '../packages/homee-client/src/client.ts';

const client = () => new HomeeClient({ host: '127.0.0.1', user: 'test', password: 'test' });
const receive = (c: HomeeClient, payload: object) => (c as any).handleRaw(JSON.stringify(payload));

test('failed send leaves no waiter or later unhandled rejection', async () => {
  const c = client();
  await assert.rejects(c.request('GET:all', ['all']), /Keine Verbindung/);
  assert.equal((c as any).waiters.length, 0);
});

test('disconnect rejects outstanding requests immediately', async () => {
  const c = client();
  c.send = () => {};
  const result = assert.rejects(c.request('GET:all', ['all']), /getrennt/);
  c.disconnect();
  await result;
  assert.equal((c as any).waiters.length, 0);
});

test('device writes wait for the requested attribute, ignoring unrelated live updates', async () => {
  const c = client();
  c.send = () => {
    receive(c, { attribute: { id: 99, node_id: 1, current_value: 0 } });
    receive(c, { attribute: { id: 42, node_id: 1, current_value: 1 } });
  };
  assert.equal((await c.setValue(1, 42, 1))?.id, 42);
});

test('homee errors reject the request and are emitted as Error objects', async () => {
  const c = client();
  let error: unknown;
  c.on('error', (e) => { error = e; });
  c.send = () => receive(c, { error: { message: 'denied' } });
  await assert.rejects(c.request('GET:all', ['all']), /denied/);
  assert.ok(error instanceof Error);
});
