/**
 * Trap-box hardware controls: fan, trap light, Raspberry Pi commands.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createControls } from '../src/services/controls.js';
import { ADMIN_KEY, DEVICE, DEVICE_KEY, startApp } from './helpers.js';

const env = { ADMIN_API_KEY: ADMIN_KEY, DEVICE_API_KEYS: `${DEVICE}:${DEVICE_KEY}` };
const admin = { 'X-Admin-Key': ADMIN_KEY };
const pi = { 'X-Device-Key': DEVICE_KEY };

describe('hardware controls', () => {
  test('admin sets switches and queues a command; the Pi polls and acknowledges', async () => {
    const app = await startApp({ env });
    try {
      await app.request('POST', '/api/telemetry', { body: { temperature: 25 }, headers: admin }); // creates the trap

      const start = (await app.request('GET', `/api/devices/${DEVICE}/controls`)).body;
      assert.equal(start.switches.fan.on, false);
      assert.equal(start.switches.trap_light.on, true);
      assert.equal(start.pi.online, false);

      // Switching needs the admin key
      assert.equal((await app.request('PATCH', `/api/devices/${DEVICE}/controls`, { body: { fan: true } })).status, 401);
      const set = await app.request('PATCH', `/api/devices/${DEVICE}/controls`, { body: { fan: true }, headers: admin });
      assert.equal(set.status, 200);
      assert.equal(set.body.switches.fan.on, true);
      assert.equal(set.body.switches.fan.applied, false); // not confirmed by the Pi yet

      const cmd = await app.request('POST', `/api/devices/${DEVICE}/commands`, { body: { command: 'capture_now' }, headers: admin });
      assert.equal(cmd.status, 201);
      assert.equal(cmd.body.status, 'pending');

      // The Pi polls with its device key
      assert.equal((await app.request('GET', `/api/devices/${DEVICE}/commands/pending`)).status, 401);
      const poll = (await app.request('GET', `/api/devices/${DEVICE}/commands/pending`, { headers: pi })).body;
      assert.deepEqual(poll.switches, { fan: true, trap_light: true });
      assert.deepEqual(poll.commands.map((c) => c.command), ['capture_now']);

      const ack = await app.request('POST', `/api/devices/${DEVICE}/commands/ack`, {
        body: { command_id: cmd.body.id, ok: true, message: 'photo sent', switches: { fan: true, trap_light: true } },
        headers: pi,
      });
      assert.equal(ack.status, 200);
      assert.equal(ack.body.status, 'done');

      const after = (await app.request('GET', `/api/devices/${DEVICE}/controls`)).body;
      assert.equal(after.pi.online, true);
      assert.equal(after.switches.fan.applied, true);
      assert.equal(after.commands[0].message, 'photo sent');
      assert.equal((await app.request('GET', `/api/devices/${DEVICE}/commands/pending`, { headers: pi })).body.commands.length, 0);
    } finally {
      await app.close();
    }
  });

  test('validation: bad switch value, unknown command, unknown trap, wrong device key', async () => {
    const app = await startApp({ env });
    try {
      await app.request('POST', '/api/telemetry', { body: { temperature: 25 }, headers: admin });
      const patch = (b) => app.request('PATCH', `/api/devices/${DEVICE}/controls`, { body: b, headers: admin });
      assert.equal((await patch({ fan: 'yes' })).status, 422);
      assert.equal((await patch({})).status, 422);
      assert.equal((await app.request('POST', `/api/devices/${DEVICE}/commands`, { body: { command: 'self_destruct' }, headers: admin })).status, 422);
      assert.equal((await app.request('GET', '/api/devices/aaaaaaaa-0000-4000-8000-0000000000ff/controls')).status, 404);
      assert.equal((await app.request('GET', '/api/devices/nope/controls')).status, 400);
      const ack = await app.request('POST', `/api/devices/${DEVICE}/commands/ack`, { body: { command_id: 'aaaaaaaa-0000-4000-8000-0000000000ff' }, headers: pi });
      assert.equal(ack.status, 404);
    } finally {
      await app.close();
    }
  });

  test('the Pi counts as offline two minutes after its last poll', () => {
    let t = 1_000_000;
    const c = createControls({ now: () => t });
    c.poll(DEVICE);
    assert.equal(c.describe(DEVICE).pi.online, true);
    t += 2 * 60_000 + 1;
    assert.equal(c.describe(DEVICE).pi.online, false);
  });
});
