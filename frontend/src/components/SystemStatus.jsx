import { BrainCircuit, Camera, Database } from 'lucide-react';

const PROVIDER_NAMES = { gemini: 'Gemini', claude: 'Claude' };
const titleCase = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/** Configured integrations (states only, never secrets). */
export function statusRows(health) {
  return [
    { icon: Database, label: 'Database', value: health.store === 'memory' ? 'In-memory' : 'Supabase', ok: health.store !== 'memory' },
    {
      icon: Camera,
      label: 'Vision',
      value: health.integrations?.yolo ? titleCase(health.services?.vision?.provider ?? 'API') : 'Demo traps only',
      ok: Boolean(health.integrations?.yolo),
    },
    {
      icon: BrainCircuit,
      label: 'Advisory',
      value: PROVIDER_NAMES[health.services?.advisor?.provider] ?? 'Rule engine',
      ok: Boolean(PROVIDER_NAMES[health.services?.advisor?.provider]),
    },
  ];
}

/** Compact integration summary (footer). */
export function StatusChips({ health }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {health.mode === 'demo' && <span className="rounded-full bg-amber-50 px-2 py-1 font-bold text-amber-800 ring-1 ring-amber-200">DEMO</span>}
      {statusRows(health).map(({ label, value, ok }) => (
        <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-slate-600 ring-1 ring-line">
          <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
          {label}: <span className={ok ? 'font-medium text-brand' : ''}>{value}</span>
        </span>
      ))}
    </div>
  );
}

/** Card version for the admin page. */
export function SystemStatusCard({ health }) {
  if (!health) return null;
  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="card-title">System</h2>
        {health.mode === 'demo' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-amber-200">DEMO</span>}
      </div>
      <ul className="flex flex-col gap-2.5">
        {statusRows(health).map(({ icon: Icon, label, value, ok }) => (
          <li key={label} className="flex items-center gap-2.5 text-sm">
            <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <span className="text-slate-600">{label}</span>
            <span className={`ml-auto flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-brand' : 'text-slate-500'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
              {value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
