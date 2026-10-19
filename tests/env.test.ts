import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { envValue } from '../backend/src/env-file.ts';

test('credentials round-trip through the Node env parser without changing passwords', () => {
  for (const value of ['', 'simple', 'with spaces # and =', 'single\'quote', 'both\'and"quotes', 'back`tick', '$variable\\path']) {
    assert.equal(parseEnv(`PASSWORD=${envValue(value)}\n`).PASSWORD, value);
  }
});

test('credentials that could inject env lines or break quoting are rejected', () => {
  for (const value of ['pass\nAPI_TOKEN=', 'pass\rAPI_TOKEN=', '\0', '\'"`']) {
    assert.throws(() => envValue(value));
  }
});
