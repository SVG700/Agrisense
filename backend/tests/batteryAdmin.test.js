/**
 * Battery-only portal: its own ID + password, a session token that can change trap battery
 * levels and nothing else.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_KEY, DEVICE, startApp } from './helpers.js';

const PASSWORD = 'battery-pass-12345';
const env = { ADMIN_API_KEY: ADMIN_KEY, BATTERY_ADMIN_ID: 'battery-admin', BATTERY_ADMIN_PASSWORD: PASSWORD };
const login = (app, id = 'battery-admin', password = PASSWORD) => app.request('POST', '/api/battery-admin/login', { body: { id, password } });

describe('Battery admin portal', () => {
  test('is off until a password is configured', async () => {
    const app = await startApp({ env: { ADMIN_API_KEY: ADMIN_KEY } });
    try {
      const r = await login(app, 'battery-admin', 'anything-at-all');
      assert.equal(r.status, 503);
      assert.equal(r.body.code, 'battery_admin_disabled');
    } finally {
      await app.close();
    }
  });

  test('wrong ID or password is refused; the right one gets a session token', async () => {
    const app = await startApp({ env });
    try {
      assert.equal((await login(app, 'battery-admin', 'wrong-password-1')).status, 401);
      assert.equal((await login(app, 'someone-else', PASSWORD)).status, 401);
      const ok = await login(app);
      assert.equal(ok.status, 200);
      assert.match(ok.body.token, /^battery\.\d+\./);
      assert.ok(Date.parse(ok.body.expires_at) > Date.now());
      assert.ok(!JSON.stringify(ok.body).includes(PASSWORD));
    } finally {
      await app.close();
    }
  });

  test('a signed-in user can list traps and set a battery level (stored as a manual override)', async () => {
    const app = await startApp({ env });
    try {
      const { token } = (await login(app)).body;
      const auth = { Authorization: `Bearer ${token}` };
      assert.equal((await app.request('GET', '/api/battery-admin/devices')).status, 401);
      const list = await app.request('GET', '/api/battery-admin/devices', { headers: auth });
      assert.equal(list.status, 200);
      assert.ok(list.body.some((d) => d.id === DEVICE));

      const r = await app.request('PATCH', `/api/battery-admin/devices/${DEVICE}/battery`, { headers: auth, body: { battery_level: 12 } });
      assert.equal(r.status, 200);
      assert.equal(r.body.device.battery_level, 12);
      assert.equal(r.body.device.battery_source, 'manual');
      assert.equal(r.body.alert, 'LOW_BATTERY');
      // the dashboard sees the new level
      const devices = (await app.request('GET', '/api/devices')).body;
      assert.equal(devices.find((d) => d.id === DEVICE).battery_level, 12);

      const bad = await app.request('PATCH', `/api/battery-admin/devices/${DEVICE}/battery`, { headers: auth, body: { battery_level: 150 } });
      assert.equal(bad.status, 422); // outside 0-100
    } finally {
      await app.close();
    }
  });

  test('the battery login cannot do anything else, and a tampered token is refused', async () => {
    const app = await startApp({ env });
    try {
      const { token } = (await login(app)).body;
      const auth = { Authorization: `Bearer ${token}` };
      // other admin actions refuse it
      assert.equal((await app.request('PATCH', '/api/device/battery', { headers: auth, body: { device_id: DEVICE, battery_level: 50 } })).status, 403);
      assert.equal((await app.request('POST', '/api/devices', { headers: auth, body: { name: 'x' } })).status, 403);
      assert.equal((await app.request('POST', '/api/admin/demo/reset', { headers: auth })).status, 403);
      // a changed signature or expiry is rejected
      const [scope, exp, sig] = token.split('.');
      const forged = `${scope}.${Number(exp) + 999999}.${sig}`;
      assert.equal((await app.request('GET', '/api/battery-admin/devices', { headers: { Authorization: `Bearer ${forged}` } })).status, 401);
    } finally {
      await app.close();
    }
  });
});
