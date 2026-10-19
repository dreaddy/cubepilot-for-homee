import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRestore, planSwap } from '../packages/homee-client/src/operations.ts';
import type { HomeeState, Homeegram } from '../packages/homee-client/src/types.ts';

const state = {
  nodes: [1, 2, 3].map((id) => ({ id, name: `device-${id}`, profile: 10, attributes: [] })),
  groups: [{ id: 1, name: 'group' }],
  relationships: [{ id: 7, group_id: 1, node_id: 1 }],
  homeegrams: [], plans: [], users: [], settings: null,
} as unknown as HomeeState;

test('device swap rejects invalid pairs before planning destructive group changes', () => {
  for (const pairs of [
    [], [{ from: 1, to: 1 }], [{ from: 1, to: 999 }], [{ from: -1, to: 2 }],
    [{ from: 1, to: 3 }, { from: 2, to: 3 }],
    [{ from: 1, to: 2 }, { from: 2, to: 3 }],
    [{ from: 1, to: 2 }, { from: 1, to: 3 }],
  ]) {
    assert.throws(() => planSwap(state, pairs, { groups: true, rename: true }), { statusCode: 400 });
  }
});

test('valid device swap adds the replacement before removing the old membership', () => {
  const plan = planSwap(state, [{ from: 1, to: 2 }], { groups: true, rename: true });
  assert.deepEqual(plan.groups[0].add, [2]);
  assert.deepEqual(plan.groups[0].removeRelationships, [{ id: 7, nodeId: 1 }]);
  assert.deepEqual(plan.renames.map((r) => r.nodeId), [2, 1]);
});

test('restore remaps references to recreated homeegrams and decodes text once', () => {
  const backup = { id: 1, name: 'Evening%20lights', active: 1,
    triggers: {}, conditions: {}, actions: { homeegram_actions: [{ id: 9, target_homeegram_id: 2, active: 1 }] },
  } as unknown as Homeegram;
  const plan = planRestore(backup, undefined, new Map([[2, 20]]));
  assert.equal(plan.add?.[0].params.target_homeegram_id, 20);
  assert.equal(plan.add?.[0].params.type, 6);
  assert.equal(plan.fields?.name, 'Evening lights');
  assert.equal(plan.fields?.active, 1);
});
