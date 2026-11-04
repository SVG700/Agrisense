/**
 * Hardware controls for each trap box: fan, trap light (UV lure) and the Raspberry Pi.
 *
 * The dashboard sets the *desired* state and queues one-off commands; the Pi
 * polls GET /api/devices/:id/commands, applies them and acknowledges each one.
 * Until the Pi checks in, everything shows as "waiting for the Pi" - nothing
 * claims a switch was flipped that the hardware has not confirmed.
 *
 * State is kept in memory (it resets when the backend restarts; the Pi simply
 * receives the defaults again on its next poll).
 */
import { randomUUID } from 'node:crypto';

export const SWITCHES = ['fan', 'trap_light'];
export const COMMANDS = ['capture_now', 'restart_camera', 'reboot', 'start_stream', 'stop_stream'];
const FRAME_FRESH_MS = 10_000; // a live-view frame older than this counts as "not streaming"
const DEFAULTS = { fan: false, trap_light: true };
const ONLINE_MS = 2 * 60_000; // the Pi counts as online if it polled in the last 2 minutes
const KEEP_COMMANDS = 20;

export function createControls({ now = () => Date.now() } = {}) {
  const byDevice = new Map();

  const entry = (deviceId) => {
    if (!byDevice.has(deviceId)) {
      const switches = Object.fromEntries(SWITCHES.map((k) => [k, { on: DEFAULTS[k], updated_at: null, applied: null }]));
      byDevice.set(deviceId, { switches, commands: [], lastSeen: null, frame: null });
    }
    return byDevice.get(deviceId);
  };

  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

  /** What the dashboard shows. */
  function describe(deviceId) {
    const e = entry(deviceId);
    return {
      device_id: deviceId,
      switches: e.switches,
      commands: e.commands.slice(0, 10),
      pi: { last_seen: iso(e.lastSeen), online: Boolean(e.lastSeen && now() - e.lastSeen < ONLINE_MS) },
    };
  }

  return {
    describe,

    /** Admin: set desired switch states, e.g. {fan: true}. */
    setSwitches(deviceId, patch) {
      const e = entry(deviceId);
      for (const [k, on] of Object.entries(patch)) {
        // applied=false until the Pi reports it has switched
        e.switches[k] = { on, updated_at: iso(now()), applied: e.switches[k].on === on ? e.switches[k].applied : false };
      }
      return describe(deviceId);
    },

    /** Admin: queue a one-off command for the Pi. */
    queue(deviceId, command) {
      const e = entry(deviceId);
      const cmd = { id: randomUUID(), command, status: 'pending', created_at: iso(now()), acked_at: null, message: null };
      e.commands.unshift(cmd);
      e.commands.length = Math.min(e.commands.length, KEEP_COMMANDS);
      return cmd;
    },

    /** Pi poll: marks it online and returns the desired switches + pending commands. */
    poll(deviceId) {
      const e = entry(deviceId);
      e.lastSeen = now();
      return {
        switches: Object.fromEntries(SWITCHES.map((k) => [k, e.switches[k].on])),
        commands: e.commands.filter((c) => c.status === 'pending').map(({ id, command, created_at }) => ({ id, command, created_at })),
      };
    },

    /**
     * Pi: latest live-view frame from its OpenCV pipeline (kept in memory, one per trap).
     * frame = {image, stages: [{name, image}], boxes, fps, width, height, pipeline}
     */
    setFrame(deviceId, frame) {
      const e = entry(deviceId);
      e.lastSeen = now();
      e.frame = { ...frame, received_at: iso(now()), seq: (e.frame?.seq ?? 0) + 1 };
      return { ok: true, seq: e.frame.seq };
    },

    /** Dashboard: the latest frame and whether the Pi is streaming right now. */
    getFrame(deviceId) {
      const e = entry(deviceId);
      const age = e.frame ? now() - Date.parse(e.frame.received_at) : null;
      return { frame: e.frame, age_ms: age, streaming: age !== null && age < FRAME_FRESH_MS };
    },

    /** Pi: confirms a command (or a switch state) was carried out. */
    ack(deviceId, { commandId, ok = true, message = null, switches } = {}) {
      const e = entry(deviceId);
      e.lastSeen = now();
      if (switches) {
        for (const k of SWITCHES) if (typeof switches[k] === 'boolean') e.switches[k].applied = switches[k] === e.switches[k].on;
      }
      if (!commandId) return { ok: true };
      const cmd = e.commands.find((c) => c.id === commandId);
      if (!cmd) return null;
      Object.assign(cmd, { status: ok ? 'done' : 'failed', acked_at: iso(now()), message });
      return cmd;
    },
  };
}
