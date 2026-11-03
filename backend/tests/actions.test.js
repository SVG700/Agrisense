/**
 * Action log: Sprayed / Released / Not yet, with the advice at the time.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/db/memoryStore.js';
import { StoreError } from '../src/utils/validate.js';
import { DEMO_TRAPS } from '../src/services/demoData.js';
import { ADMIN_KEY, DEVICE, mockTrapUrl, startApp } from './helpers.js';

const env = { ADMIN_API_KEY: ADMIN_KEY };
const admin = { 'X-Admin-Key': ADMIN_KEY };

describe('action log', () => {
  test('log needs admin; advice is recorded server-side; newest first; undo', async () => {
    const app = await startApp({ env });
    try {
      // A dense card -> the trap's advice is SPRAY
      await app.request('POST', '/api/telemetry', { body: { temperature: 26, image_url: mockTrapUrl('act', 0.9) }, headers: admin });
      const body = { device_id: DEVICE, action: 'not_yet', note: 'waiting for dry weather', decision: 'WAIT' };
      assert.equal((await app.request('POST', '/api/actions', { body })).status, 401);

      const first = await app.request('POST', '/api/actions', { body, headers: admin });
      assert.equal(first.status, 201);
      assert.equal(first.body.action, 'not_yet');
      assert.equal(first.body.decision, 'SPRAY'); // computed, the client's "WAIT" is ignored
      assert.equal(first.body.note, 'waiting for dry weather');

      const second = await app.request('POST', '/api/actions', { body: { device_id: DEVICE, action: 'sprayed' }, headers: admin });
      const list = (await app.request('GET', `/api/actions?device_id=${DEVICE}`)).body;
      assert.deepEqual(list.map((a) => a.action), ['sprayed', 'not_yet']);

      const del = await app.request('DELETE', `/api/actions/${second.body.id}`, { headers: admin });
      assert.equal(del.status, 200);
      assert.equal((await app.request('GET', `/api/actions?device_id=${DEVICE}`)).body.length, 1);
      assert.equal((await app.request('DELETE', `/api/actions/${second.body.id}`, { headers: admin })).status, 404);
    } finally {
      await app.close();
    }
  });

  test('validation: action, note length, future time, unknown trap', async () => {
    const app = await startApp({ env });
    try {
      const post = (b) => app.request('POST', '/api/actions', { body: { device_id: DEVICE, action: 'sprayed', ...b }, headers: admin });
      await app.request('POST', '/api/telemetry', { body: { temperature: 25 }, headers: admin }); // creates the device
      assert.equal((await post({ action: 'burned' })).status, 422);
      assert.equal((await post({ note: 'x'.repeat(281) })).status, 422);
      assert.equal((await post({ acted_at: new Date(Date.now() + 86_400_000).toISOString() })).status, 422);
      assert.equal((await post({ acted_at: '2026-10-30T08:00:00Z' })).status, 201);
      assert.equal((await post({ device_id: 'aaaaaaaa-0000-4000-8000-0000000000ff' })).status, 404);
      assert.equal((await app.request('GET', '/api/actions?device_id=nope')).status, 400);
    } finally {
      await app.close();
    }
  });

  test('without schema v4 the API says exactly what to apply (503)', async () => {
    const store = createMemoryStore();
    const missing = async () => {
      throw new StoreError('listActions', new Error('relation "trap_actions" does not exist'));
    };
    store.listActions = missing;
    store.addActions = missing;
    const app = await startApp({ env, store });
    try {
      const res = await app.request('GET', '/api/actions');
      assert.equal(res.status, 503);
      assert.equal(res.body.code, 'actions_unavailable');
      assert.match(res.body.error, /v4_action_log\.sql/);
      // Demo reset still works without the table
      const demo = await app.request('POST', '/api/admin/demo/reset', { headers: admin });
      assert.equal(demo.status, 201);
      assert.equal(demo.body.actions, null);
    } finally {
      await app.close();
    }
  });

  test('demo reset seeds the story actions', async () => {
    const app = await startApp({ env });
    try {
      const demo = await app.request('POST', '/api/admin/demo/reset', { headers: admin });
      assert.equal(demo.body.actions, 2);
      const p2 = (await app.request('GET', `/api/actions?device_id=${DEMO_TRAPS[1].id}`)).body;
      assert.equal(p2[0].action, 'released');
      assert.equal(p2[0].decision, 'BIOCONTROL');
      // Removing the demo removes its actions
      await app.request('DELETE', '/api/admin/demo', { headers: admin });
      assert.equal((await app.request('GET', '/api/actions')).body.length, 0);
    } finally {
      await app.close();
    }
  });
});
