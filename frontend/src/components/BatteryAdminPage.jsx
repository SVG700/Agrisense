import { useEffect, useState } from 'react';
import { BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, KeyRound, Loader2, LogOut, Save } from 'lucide-react';
import { api } from '../api.js';
import { LOW_BATTERY } from '../lib/pests.js';
import Badge from './Badge.jsx';

/**
 * Battery-only admin portal at /battery-admin: sign in with BATTERY_ADMIN_ID / BATTERY_ADMIN_PASSWORD
 * (backend/.env) and set each trap's battery level. Nothing else can be changed from here.
 * The session token lives in sessionStorage (this tab only) and expires on the server.
 */
const SESSION = 'agrisense.batterySession';

function readSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION) ?? 'null');
    return s && Date.parse(s.expires_at) > Date.now() ? s : null;
  } catch {
    return null;
  }
}
function writeSession(s) {
  try {
    s ? sessionStorage.setItem(SESSION, JSON.stringify(s)) : sessionStorage.removeItem(SESSION);
  } catch {
    /* storage unavailable: the session just won't survive a reload */
  }
}

function batteryIcon(level) {
  if (level == null) return { Icon: BatteryMedium, cls: 'text-slate-400' };
  if (level < LOW_BATTERY) return { Icon: BatteryWarning, cls: 'text-rose-600' };
  if (level < 40) return { Icon: BatteryLow, cls: 'text-amber-600' };
  if (level < 75) return { Icon: BatteryMedium, cls: 'text-lime-600' };
  return { Icon: BatteryFull, cls: 'text-emerald-600' };
}

export default function BatteryAdminPage() {
  const [session, setSession] = useState(readSession);
  const signOut = () => {
    writeSession(null);
    setSession(null);
  };

  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">AgriSense</p>
            <h1 className="text-2xl font-semibold text-slate-900">Battery admin</h1>
            <p className="text-sm text-slate-600">Set the battery level shown in Trap Health. Nothing else can be changed here.</p>
          </div>
          {session && (
            <button type="button" className="btn btn-ghost text-sm" onClick={signOut}>
              <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
            </button>
          )}
        </header>
        {session ? <BatteryList session={session} onExpired={signOut} /> : <LoginCard onLogin={(s) => (writeSession(s), setSession(s))} />}
      </div>
    </div>
  );
}

function LoginCard({ onLogin }) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.batteryLogin(id.trim(), password));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card flex flex-col gap-4" onSubmit={submit} aria-label="Battery admin sign in">
      <div className="flex items-center gap-2 text-slate-800">
        <KeyRound className="h-5 w-5" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Sign in</h2>
      </div>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Admin ID
        <input className="field px-3 py-2" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Password
        <input className="field px-3 py-2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </p>
      )}
      <button className="btn btn-primary justify-center py-2" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Sign in
      </button>
    </form>
  );
}

function BatteryList({ session, onExpired }) {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.batteryDevices(session.token)
      .then(setDevices)
      .catch((err) => (err.status === 401 ? onExpired() : setError(err.message)));
  }, [session.token, onExpired]);

  if (error) return <p role="alert" className="card text-sm text-rose-700">{error}</p>;
  if (!devices) return <p className="card text-sm text-slate-500">Loading traps…</p>;

  return (
    <section className="flex flex-col gap-3" aria-label="Trap batteries">
      {devices.map((d) => (
        <BatteryRow key={d.id} device={d} token={session.token} onExpired={onExpired}
          onSaved={(saved) => setDevices((list) => list.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)))} />
      ))}
      <p className="text-xs text-slate-500">Saved values are marked "manual" on the dashboard, with the time they were set. Below {LOW_BATTERY}% the dashboard shows a low-battery alert.</p>
    </section>
  );
}

function BatteryRow({ device, token, onSaved, onExpired }) {
  const [value, setValue] = useState(device.battery_level ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const level = value === '' ? null : Number(value);
  const valid = level != null && Number.isInteger(level) && level >= 0 && level <= 100;
  const changed = valid && level !== device.battery_level;
  const { Icon, cls } = batteryIcon(device.battery_level);

  const save = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.batterySet(token, device.id, level);
      onSaved(r.device);
      setMsg({ tone: r.alert ? 'warn' : 'good', text: r.alert ? `Saved ${level}% - low battery alert on` : `Saved ${level}%` });
    } catch (err) {
      if (err.status === 401) return onExpired();
      setMsg({ tone: 'bad', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card flex flex-wrap items-center gap-3" onSubmit={save} aria-label={`Battery for ${device.name}`}>
      <Icon className={`h-6 w-6 shrink-0 ${cls}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">{device.name}</p>
        <p className="text-xs text-slate-500">
          Now {device.battery_level == null ? 'not reported' : `${device.battery_level}%`}
          {device.battery_source === 'manual' && device.battery_updated_at ? ` · set manually ${new Date(device.battery_updated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <span className="sr-only">Battery percent for {device.name}</span>
        <input className="field w-20 px-2 py-1.5 text-right tabular-nums" type="number" min="0" max="100" step="1" inputMode="numeric"
          value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!valid} />
        %
      </label>
      <button className="btn btn-primary py-1.5" disabled={!changed || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />} Save
      </button>
      {msg && <Badge tone={msg.tone}>{msg.text}</Badge>}
    </form>
  );
}
