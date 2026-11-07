/** Display metadata per detectable species (colors double as chart series colors). */
export const PESTS = {
  aphid: { name: 'Aphid', color: '#22c55e' },
  whitefly: { name: 'Whitefly', color: '#38bdf8' },
  thrips: { name: 'Thrips', color: '#f97316' },
  fungus_gnat: { name: 'Fungus gnat', color: '#e879f9' },
  // natural enemies (predators) - counted separately by the decision rule
  macrolophus: { name: 'Macrolophus (predator)', color: '#a3e635', predator: true },
  nesidiocoris: { name: 'Nesidiocoris (predator)', color: '#65a30d', predator: true },
  // AgroPest-12 field-pest model (phone / Telegram photos) - categories match backend/config/pests.json
  ants: { name: 'Ants', color: '#b45309' },
  beetles: { name: 'Beetles', color: '#7c3aed' },
  caterpillars: { name: 'Caterpillars', color: '#16a34a' },
  earwigs: { name: 'Earwigs', color: '#a16207' },
  grasshoppers: { name: 'Grasshoppers', color: '#65a30d' },
  moths: { name: 'Moths', color: '#a8a29e' },
  slugs: { name: 'Slugs', color: '#78716c' },
  snails: { name: 'Snails', color: '#d97706' },
  weevils: { name: 'Weevils', color: '#be123c' },
  wasps: { name: 'Wasps (natural enemy)', color: '#eab308', predator: true },
  bees: { name: 'Bees (pollinator)', color: '#facc15', beneficial: true },
  earthworms: { name: 'Earthworms (soil helper)', color: '#f472b6', beneficial: true },
  // EXPERIMENTAL 29-class YOLO11s model (PHONE_VISION_CLASS_GROUP=pest29) - names from backend/config/pests.json
  pest_unidentified: { name: "Pest (unidentified)", color: '#ef4444' },
  agrotis: { name: "Cutworm moth (Agrotis)", color: '#f97316' },
  athetis_lepigone: { name: "Athetis lepigone (moth)", color: '#f59e0b' },
  athetis_lineosa: { name: "Athetis lineosa (moth)", color: '#84cc16' },
  chilo_suppressalis: { name: "Rice stem borer (Chilo suppressalis)", color: '#10b981' },
  cnaphalocrocis_medinalis: { name: "Rice leaf folder (Cnaphalocrocis medinalis)", color: '#06b6d4' },
  creatonotus_transiens: { name: "Creatonotus transiens (tiger moth)", color: '#3b82f6' },
  diaphania_indica: { name: "Cucumber moth (Diaphania indica)", color: '#8b5cf6' },
  endotricha_consocia: { name: "Endotricha consocia (moth)", color: '#d946ef' },
  euproctis_sparsa: { name: "Tussock moth (Euproctis sparsa)", color: '#f43f5e' },
  gryllidae: { name: "Crickets (Gryllidae)", color: '#a16207' },
  gryllotalpidae: { name: "Mole crickets (Gryllotalpidae)", color: '#0f766e' },
  helicoverpa_armigera: { name: "Cotton bollworm / fruit borer (Helicoverpa armigera)", color: '#ef4444' },
  holotrichia_oblita: { name: "White grub beetle (Holotrichia oblita)", color: '#f97316' },
  loxostege_sticticalis: { name: "Beet webworm (Loxostege sticticalis)", color: '#f59e0b' },
  mamestra_brassicae: { name: "Cabbage moth (Mamestra brassicae)", color: '#84cc16' },
  maruca_testulalis: { name: "Legume pod borer (Maruca testulalis)", color: '#10b981' },
  mythimna_separata: { name: "Oriental armyworm (Mythimna separata)", color: '#06b6d4' },
  naranga_aenescens: { name: "Rice green caterpillar moth (Naranga aenescens)", color: '#3b82f6' },
  nilaparvata: { name: "Brown planthopper (Nilaparvata)", color: '#8b5cf6' },
  paracymoriza_taiwanalis: { name: "Paracymoriza taiwanalis (moth)", color: '#d946ef' },
  sesamia_inferens: { name: "Pink stem borer (Sesamia inferens)", color: '#f43f5e' },
  sirthenea_flavipes: { name: "Assassin bug (Sirthenea flavipes, predator)", color: '#22c55e', predator: true },
  sogatella_furcifera: { name: "White-backed planthopper (Sogatella furcifera)", color: '#0f766e' },
  spodoptera_exigua: { name: "Beet armyworm (Spodoptera exigua)", color: '#ef4444' },
  spoladea_recurvalis: { name: "Beet webworm moth (Spoladea recurvalis)", color: '#f97316' },
  staurophora_celsia: { name: "Staurophora celsia (moth)", color: '#f59e0b' },
  timandra_recompta: { name: "Timandra recompta (moth)", color: '#84cc16' },
  trichoptera: { name: "Caddisflies (Trichoptera, not a crop pest)", color: '#94a3b8', neutral: true },
};

/** True when a capture is simulated in any way (synthetic readings or demo detections). */
export const isSimulated = (capture) =>
  Boolean(capture) &&
  (['simulator', 'dashboard'].includes(capture.data_source) || capture.detection?.vision_meta?.status === 'simulated');

export const pestMeta = (label) =>
  PESTS[label] ?? { name: String(label).replace(/_/g, ' '), color: '#facc15' };

export const RISK_STYLES = {
  Low: { text: 'text-emerald-700', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/40', dot: 'bg-emerald-400' },
  Medium: { text: 'text-amber-800', bg: 'bg-amber-500/15', ring: 'ring-amber-500/40', dot: 'bg-amber-400' },
  High: { text: 'text-rose-700', bg: 'bg-rose-500/15', ring: 'ring-rose-500/50', dot: 'bg-rose-400' },
};

export const totalOf = (counts) => Object.values(counts ?? {}).reduce((a, b) => a + Number(b || 0), 0);

/** Must match the backend's LOW_BATTERY_THRESHOLD (also reported by /api/health). */
export const LOW_BATTERY = 15;

/** A capture older than this is shown as stale. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** How a detection was produced (backend vision_meta.status). */
export const VISION_STATES = {
  ok: { label: 'Model inference', tone: 'good', help: 'Detections from the configured vision model.' },
  simulated: {
    label: 'Demo detector (simulated)',
    tone: 'warn',
    help: 'Synthetic trap image; the boxes were generated by the demo detector, not found by a real model.',
  },
  failed: { label: 'Detection failed', tone: 'bad', help: 'The vision provider failed; insects were not counted.' },
  not_configured: { label: 'Not analysed', tone: 'muted', help: 'No vision provider configured; insects were not counted.' },
  skipped: { label: 'No image', tone: 'muted', help: 'This capture had no image.' },
  legacy: { label: 'Unlabelled', tone: 'muted', help: 'Recorded before detection sources were tracked.' },
};

export const visionStatus = (det) => (det ? det.vision_meta?.status ?? 'legacy' : null);

/** True when the detection's counts are meaningful (real, simulated or legacy). */
export const hasCounts = (det) => ['ok', 'simulated', 'legacy'].includes(visionStatus(det));

/** Who produced the sensor readings. */
export const DATA_SOURCES = {
  hardware: { label: 'Sensor', tone: 'good' },
  simulator: { label: 'Simulated readings', tone: 'warn' },
  dashboard: { label: 'Simulated readings', tone: 'warn' },
  unknown: { label: 'Source unknown', tone: 'muted' },
};

/** Formats a possibly-missing reading. */
export const fmtReading = (n, digits, unit) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : `${Number(n).toFixed(digits)}${unit}`;

export const TONES = {
  good: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/40',
  warn: 'bg-amber-500/15 text-amber-800 ring-amber-500/40',
  bad: 'bg-rose-500/15 text-rose-700 ring-rose-500/40',
  muted: 'bg-slate-200 text-slate-700 ring-slate-300',
};

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
