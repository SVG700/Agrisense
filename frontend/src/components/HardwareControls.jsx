import { useCallback, useEffect, useState } from 'react';
import { Camera, Cpu, Fan, Lightbulb, Loader2, Power, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { timeAgo } from '../lib/pests.js';
import Badge from './Badge.jsx';

const POLL_MS = 5000;

const SWITCH_INFO = {
  fan: { icon: Fan, name: 'Fan', help: 'Cools the trap box and keeps the camera lens dry.' },
  trap_light: { icon: Lightbulb, name: 'Trap light', help: 'UV lure light that attracts insects to the sticky card.' },
};

const COMMANDS = [
  { id: 'capture_now', icon: Camera, label: 'Capture now', help: 'Take a trap photo immediately' },
  { id: 'restart_camera', icon: RefreshCw, label: 'Restart camera', help: 'Restart the camera service' },
  { id: 'reboot', icon: Power, label: 'Reboot Pi', help: 'Restart the Raspberry Pi', confirm: true },
];

const COMMAND_LABEL = Object.fromEntries(COMMANDS.map((c) => [c.id, c.label]));
const STATUS_TONE = { pending: 'warn', done: 'good', failed: 'bad' };

/**
 * Fan, trap light and Raspberry Pi for the selected trap box.
 * The Pi applies changes on its next poll; until it confirms, they show as "waiting for the Pi".
 */
export default function HardwareControls({ device, log }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirmReboot, setConfirmReboot] = useState(false);

  const load = useCallback(async () => {
    if (!device?.id) return;
    try {
      const r = await api.controls(device.id);
      if (r?.switches) setState(r);
    } catch (err) {
      setError(err.message);
    }
  }, [device?.id]);

  useEffect(() => {
    setState(null);
    setError(null);
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const explain = (err) => (err.status === 401 ? 'Admin key required - enter it above.' : err.status === 403 ? 'Admin key rejected - check ADMIN_API_KEY.' : err.message);

  const toggle = async (key) => {
    const on = !state.switches[key].on;
    setBusy(key);
    setError(null);
    try {
      const r = await api.setControls(device.id, { [key]: on });
      if (r?.switches) setState(r);
      log?.(`${SWITCH_INFO[key].name} switched ${on ? 'ON' : 'OFF'} for ${device.name} (waiting for the Pi)`);
    } catch (err) {
      setError(explain(err));
      log?.(`${SWITCH_INFO[key].name}: ${explain(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const send = async (command) => {
    setBusy(command);
    setError(null);
    setConfirmReboot(false);
    try {
      await api.sendCommand(device.id, command);
      log?.(`Sent "${COMMAND_LABEL[command]}" to ${device.name}'s Pi`);
      await load();
    } catch (err) {
      setError(explain(err));
      log?.(`${COMMAND_LABEL[command]}: ${explain(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const pi = state?.pi;

  return (
    <section className="card" aria-labelledby="hw-title" data-testid="hardware-controls">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="hw-title" className="card-title">
          <span className="icon-chip h-8! w-8! rounded-lg!">
            <Cpu className="h-4 w-4" aria-hidden="true" />
          </span>
          Trap box controls
        </h2>
        {pi && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
              pi.online ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${pi.online ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
            Raspberry Pi {pi.online ? 'online' : 'offline'}
            {pi.last_seen && ` · seen ${timeAgo(pi.last_seen)}`}
          </span>
        )}
      </div>
      <p className="mb-5 text-sm text-slate-600">
        {device ? (
          <>
            For <b className="text-ink">{device.name}</b>. The Pi picks up changes on its next check-in and confirms them.
          </>
        ) : (
          'Select a trap to control its hardware.'
        )}
      </p>

      {device && !state && !error && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </p>
      )}

      {state && (
        <div className="flex flex-col gap-5">
          <ul className="grid gap-3 sm:grid-cols-2">
            {Object.entries(SWITCH_INFO).map(([key, info]) => {
              const s = state.switches[key];
              const Icon = info.icon;
              return (
                <li key={key} className="flex items-start gap-3 rounded-2xl bg-canvas p-4 ring-1 ring-line">
                  <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.on ? 'text-brand' : 'text-slate-400'}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span id={`sw-${key}`} className="font-medium text-ink">
                        {info.name}
                      </span>
                      <Switch on={s.on} busy={busy === key} labelledBy={`sw-${key}`} onClick={() => toggle(key)} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{info.help}</p>
                    <p className="mt-2 text-xs">
                      {s.applied === false ? (
                        <Badge tone="warn">Waiting for the Pi</Badge>
                      ) : s.applied ? (
                        <Badge tone="good">Confirmed by the Pi</Badge>
                      ) : (
                        <Badge tone="muted">Default</Badge>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Raspberry Pi</div>
            <div className="flex flex-wrap gap-2">
              {COMMANDS.map((c) => {
                const Icon = c.icon;
                const onClick = c.confirm && !confirmReboot ? () => setConfirmReboot(true) : () => send(c.id);
                return (
                  <button key={c.id} className="btn btn-ghost" onClick={onClick} disabled={Boolean(busy)} title={c.help}>
                    {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
                    {c.confirm && confirmReboot ? 'Confirm reboot' : c.label}
                  </button>
                );
              })}
              {confirmReboot && (
                <button className="btn btn-ghost" onClick={() => setConfirmReboot(false)}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          {state.commands.length > 0 && (
            <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line" aria-label="Recent commands">
              {state.commands.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="text-ink">{COMMAND_LABEL[c.command] ?? c.command}</span>
                  <span className="text-xs text-slate-500">{timeAgo(c.created_at)}</span>
                  {c.message && <span className="truncate text-xs text-slate-500">· {c.message}</span>}
                  <Badge tone={STATUS_TONE[c.status]} className="ml-auto">
                    {c.status === 'pending' ? 'waiting for the Pi' : c.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">
          {error}
        </p>
      )}
    </section>
  );
}

function Switch({ on, busy, labelledBy, onClick }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      onClick={onClick}
      disabled={busy}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-60 ${on ? 'bg-brand' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-[#fff] shadow transition-transform duration-200 ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}
