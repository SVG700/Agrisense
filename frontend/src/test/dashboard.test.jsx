import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import TrapCanvas, { sanitizeBoxes } from '../components/TrapCanvas.jsx';
import AdvisoryCard from '../components/AdvisoryCard.jsx';
import AdminPanel from '../components/AdminPanel.jsx';
import FarmerDashboard from '../components/FarmerDashboard.jsx';
import DecisionBadge from '../components/DecisionBadge.jsx';

const DEVICE = { id: '11111111-1111-4111-8111-111111111111', name: 'Trap 01', battery_level: 80, status: 'online', battery_source: 'unknown' };

const capture = (over = {}) => ({
  id: 1,
  device_id: DEVICE.id,
  timestamp: new Date().toISOString(),
  temperature: 25,
  humidity: 70,
  data_source: 'simulator',
  image_url: 'http://test/trap.svg',
  detection: {
    pest_counts: { aphid: 2 },
    bounding_boxes: [
      { label: 'aphid', confidence: 0.9, x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
      { label: 'aphid', confidence: 0.8, x: 0.98, y: 0.5, width: 0.1, height: 0.05 },
    ],
    vision_meta: { status: 'simulated', image: { width: 800, height: 600 } },
    ai_advisory: { risk_level: 'Medium', confidence: 'Low', summary: 's', recommendation: 'r', mitigation_strategy: ['a'], source: 'rule-engine', status: 'not_configured' },
  },
  ...over,
});

/** Calls a test made itself (the Admin panel's Telegram card and trap-box controls also poll in the background). */
const ownCalls = (m) => m.mock.calls.filter(([u]) => !String(u).includes('/api/admin/telegram') && !String(u).endsWith('/controls'));

const jsonResponse = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe('App', () => {
  test('renders a useful error when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Cannot reach the Agrisense API'));
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  test('renders capture records from the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (url.includes('/api/devices')) return jsonResponse([DEVICE]);
        if (url.includes('/api/telemetry')) return jsonResponse([capture()]);
        return jsonResponse({ ok: true, mode: 'demo', store: 'memory', integrations: {}, auth: {} });
      })
    );
    render(<App />);
    expect(await screen.findByText('25.0°C')).toBeTruthy();
    expect(screen.getAllByText(/Simulated/).length).toBeGreaterThan(0);
  });

  test('trap cards show each trap’s traffic-light decision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (url.includes('/api/devices')) return jsonResponse([DEVICE]);
        if (url.includes('/api/telemetry')) return jsonResponse([capture()]);
        if (url.includes('/api/decision'))
          return jsonResponse({ decision: 'BIOCONTROL', label: 'RELEASE BIOCONTROL', reason: 'Predators keeping pace.', avg_pests: 40, pests_per_predator: 4, window: { days: 3 }, borderline: true });
        return jsonResponse({ ok: true, mode: 'demo', store: 'memory', integrations: {}, auth: {} });
      })
    );
    render(<App />);
    const card = await screen.findByTestId('trap-card');
    await waitFor(() => expect(card.querySelector('[data-decision="BIOCONTROL"]')).toBeTruthy());
    expect(card.textContent).toContain('◆');
    expect(card.textContent).toContain('BORDERLINE');
    expect(card.textContent).toContain('40 pests/day');
  });
});

describe('DecisionBadge', () => {
  test('every state has its own shape, colour and words', () => {
    const shapes = { SPRAY: '▲', BIOCONTROL: '◆', WAIT: '●', CHECK_TRAP: '■' };
    for (const [d, shape] of Object.entries(shapes)) {
      const { container, unmount } = render(<DecisionBadge decision={d} />);
      const badge = container.querySelector(`[data-decision="${d}"]`);
      expect(badge.textContent).toContain(shape);
      expect(badge.getAttribute('aria-label')).toMatch(/^Decision: /);
      unmount();
    }
    expect(render(<DecisionBadge decision="NOPE" />).container.textContent).toBe('');
  });

  test('uncounted capture shows CHECK TRAP with the last counted advice', () => {
    render(
      <AdvisoryCard
        advisory={{
          risk_level: null,
          summary: 'Pest detection failed.',
          source: 'none',
          status: 'skipped',
          decision: { decision: 'CHECK_TRAP', label: 'CHECK TRAP', reason: 'Check the camera.', check_trap: true, last_counted: { decision: 'SPRAY' } },
        }}
      />
    );
    expect(screen.getByText('CHECK TRAP')).toBeTruthy();
    expect(screen.getByText(/Last counted advice/)).toBeTruthy();
    expect(screen.getByText('SPRAY')).toBeTruthy();
  });
});

describe('TrapCanvas', () => {
  test('bounding boxes use normalized source-image coordinates and are clipped to the frame', () => {
    render(<TrapCanvas capture={capture()} />);
    fireEvent.load(screen.getByAltText('Sticky trap'));
    const rects = screen.getAllByTestId('bbox');
    expect(rects).toHaveLength(2);
    expect(rects[0].getAttribute('x')).toBe('0.1');
    expect(rects[0].getAttribute('y')).toBe('0.2');
    expect(Number(rects[1].getAttribute('x')) + Number(rects[1].getAttribute('width'))).toBeLessThanOrEqual(1);
    // Frame uses the image aspect ratio so the 0..1 viewBox maps 1:1 onto the picture
    expect(parseFloat(screen.getByTestId('trap-frame').style.aspectRatio)).toBeCloseTo(800 / 600);
  });

  test('a re-signed URL for the same stored image does not remount or reload the picture', () => {
    const first = capture({ image_path: 'captures/d/a.png', image_url: 'https://x.supabase.co/sign/a.png?token=1' });
    const { rerender } = render(<TrapCanvas capture={first} />);
    const img = screen.getByAltText('Sticky trap');
    fireEvent.load(img);
    rerender(<TrapCanvas capture={{ ...first, image_url: 'https://x.supabase.co/sign/a.png?token=2' }} />);
    const after = screen.getByAltText('Sticky trap');
    expect(after).toBe(img); // same DOM node
    expect(after.getAttribute('src')).toBe('https://x.supabase.co/sign/a.png?token=1');
    expect(after.className).toContain('opacity-100');
    expect(screen.getAllByTestId('bbox').length).toBeGreaterThan(0);
  });

  test('sanitizeBoxes drops malformed boxes', () => {
    expect(sanitizeBoxes([{ x: 'a', y: 0, width: 1, height: 1, confidence: 1 }, { x: 2, y: 2, width: 1, height: 1, confidence: 1 }])).toEqual([]);
    expect(sanitizeBoxes(null)).toEqual([]);
  });

  test('empty detections from a real model are shown as zero, not an error', () => {
    const c = capture();
    c.detection = { ...c.detection, bounding_boxes: [], pest_counts: {}, vision_meta: { status: 'ok' } };
    render(<TrapCanvas capture={c} />);
    fireEvent.load(screen.getByAltText('Sticky trap'));
    expect(screen.getByText('The model found no insects on this trap.')).toBeTruthy();
    expect(screen.queryAllByTestId('bbox')).toHaveLength(0);
  });

  test('failed detection is labelled and draws nothing', () => {
    const c = capture();
    c.detection = { ...c.detection, bounding_boxes: [], vision_meta: { status: 'failed', error: { code: 'timeout' } } };
    render(<TrapCanvas capture={c} />);
    fireEvent.load(screen.getByAltText('Sticky trap'));
    expect(screen.getAllByText(/Detection failed/).length).toBeGreaterThan(0);
    expect(screen.getByText(/timeout/)).toBeTruthy();
  });

  test('broken image shows a message instead of crashing', () => {
    render(<TrapCanvas capture={capture()} />);
    fireEvent.error(screen.getByAltText('Sticky trap'));
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });
});

describe('Provenance labels', () => {
  test('fallback advice is never shown as Claude', () => {
    render(
      <AdvisoryCard
        advisory={{ risk_level: 'High', summary: 'x', mitigation_strategy: ['a'], source: 'rule-engine', status: 'fallback', error: { code: 'rate_limited' } }}
      />
    );
    expect(screen.getByText(/Rule engine \(Claude failed: rate_limited\)/)).toBeTruthy();
    expect(screen.queryByText(/^Claude$/)).toBeNull();
  });

  test('Gemini advice and Gemini fallbacks are labelled by provider', () => {
    const base = { risk_level: 'Low', summary: 'x', mitigation_strategy: ['a'] };
    const { rerender } = render(<AdvisoryCard advisory={{ ...base, source: 'gemini', status: 'ok', model: 'gemini-3.8-flash' }} />);
    expect(screen.getByText('Gemini · gemini-3.8-flash')).toBeTruthy();
    rerender(
      <AdvisoryCard advisory={{ ...base, source: 'rule-engine', status: 'fallback', error: { provider: 'gemini', code: 'auth_error' } }} />
    );
    expect(screen.getByText(/Rule engine \(Gemini failed: auth_error\)/)).toBeTruthy();
  });

  test('advisory shows the predator-aware decision with BORDERLINE tag', () => {
    const decision = {
      decision: 'BIOCONTROL',
      label: 'RELEASE BIOCONTROL',
      reason: 'Predators are keeping pace.',
      avg_pests: 27,
      avg_predators: 4,
      pests_per_predator: 6.8,
      no_predators: false,
      range: { pests: [23, 31], predators: [3.4, 4.6] },
      borderline: true,
      window: { days: 3, requested: 3 },
      thresholds: { action_threshold_per_day: 25, spray_ratio: 10 },
    };
    render(<AdvisoryCard advisory={{ risk_level: 'Medium', summary: 'x', mitigation_strategy: ['a'], source: 'gemini', status: 'ok', decision }} />);
    expect(screen.getByText('RELEASE BIOCONTROL')).toBeTruthy();
    expect(screen.getByText('BORDERLINE')).toBeTruthy();
    expect(screen.getByText(/range 23-31/)).toBeTruthy();
    expect(screen.getByText(/6.8 pests per predator/)).toBeTruthy();
  });

  test('missing readings render as a dash, not zero', () => {
    render(<FarmerDashboard device={DEVICE} telemetry={[capture({ temperature: null, humidity: null })]} onGoAdmin={() => {}} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Readings: Simulated readings')).toBeTruthy();
  });
});

describe('Action log', () => {
  test('logging posts the action with the note and refreshes; undo deletes the newest', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ id: 7 }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const { default: ActionLogCard } = await import('../components/ActionLogCard.jsx');
    const onChanged = vi.fn();
    const actions = [{ id: 7, action: 'released', decision: 'BIOCONTROL', note: 'Macrolophus', acted_at: new Date().toISOString() }];
    render(<ActionLogCard deviceId={DEVICE.id} decision={{ decision: 'SPRAY' }} actions={actions} onChanged={onChanged} />);

    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'rows 1-4' } });
    fireEvent.click(screen.getByRole('button', { name: /Sprayed/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/actions');
    expect(JSON.parse(opts.body)).toEqual({ device_id: DEVICE.id, action: 'sprayed', note: 'rows 1-4' });
    expect(screen.getByText('Macrolophus')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Undo last action'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, o]) => u.endsWith('/api/actions/7') && o.method === 'DELETE')).toBe(true));
  });

  test('without the admin key the farmer is told where to enter it', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ error: 'Admin key required', code: 'unauthorized' }, 401)));
    const { default: ActionLogCard } = await import('../components/ActionLogCard.jsx');
    render(<ActionLogCard deviceId={DEVICE.id} actions={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Not yet/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/admin key/);
  });

  test('missing schema v4 shows the migration to apply instead of buttons', async () => {
    const { default: ActionLogCard } = await import('../components/ActionLogCard.jsx');
    render(<ActionLogCard deviceId={DEVICE.id} actions={[]} unavailable="Action log unavailable - apply supabase/migrations/v4_action_log.sql" />);
    expect(screen.getByText(/v4_action_log\.sql/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sprayed/ })).toBeNull();
  });

  test('actions inside the chart range get markers (legend shown)', async () => {
    const { default: MicroclimateChart } = await import('../components/MicroclimateChart.jsx');
    const t0 = Date.now() - 3 * 3_600_000;
    const caps = [0, 1, 2].map((i) => capture({ id: i + 1, timestamp: new Date(t0 + i * 3_600_000).toISOString() }));
    const { rerender } = render(<MicroclimateChart telemetry={caps} actions={[]} />);
    expect(screen.queryByTestId('chart-action-legend')).toBeNull();
    rerender(<MicroclimateChart telemetry={caps} actions={[{ id: 1, action: 'sprayed', acted_at: new Date(t0 + 90 * 60_000).toISOString() }]} />);
    expect(screen.getByTestId('chart-action-legend').textContent).toContain('Sprayed');
  });
});

describe('Impact estimate', () => {
  test('is labelled ESTIMATE, flags simulated data and shows its assumptions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse({
          estimate: true,
          days: 30,
          traps: 5,
          calendar_sprays: 20,
          agrisense_sprays: 6,
          sprays_avoided: 14,
          percent_fewer_sprays: 70,
          product_litres_saved: 1.8,
          cost_saved: 10500,
          biocontrol_releases: 2,
          predator_protected_days: 9,
          simulated: true,
          all_simulated: false,
          assumptions: { calendar_spray_interval_days: 7, spray_reapply_days: 7, area_per_trap_acres: 0.5, product_litres_per_acre_per_spray: 0.25, cost_per_acre_per_spray: 1500, placeholder: 'ESTIMATE - assumptions to confirm' },
        })
      )
    );
    const { default: ImpactCard } = await import('../components/ImpactCard.jsx');
    render(<ImpactCard />);
    const card = await screen.findByTestId('impact-card');
    expect(card.textContent).toContain('ESTIMATE');
    expect(card.textContent).toContain('Includes simulated data');
    expect(card.textContent).toContain('70% fewer than calendar');
    expect(card.textContent).toContain('₹10,500');
    expect(card.textContent).toContain('Not a measured result');
  });
});

describe('What-if simulator', () => {
  test('starts from the trap, asks the engine on every change, and draws the decision map', async () => {
    const fetchMock = vi.fn((url) => {
      if (url.includes('/api/decision/regions'))
        return jsonResponse({ pests: [0, 50, 100], predators: [0, 15, 30], cells: [['WAIT', 'SPRAY', 'SPRAY'], ['WAIT', 'BIOCONTROL', 'SPRAY'], ['WAIT', 'BIOCONTROL', 'BIOCONTROL']], thresholds: { action_threshold_per_day: 25, spray_ratio: 10 } });
      if (url.includes('/api/decision/simulate')) {
        const pests = Number(new URL(url, 'http://x').searchParams.get('pests'));
        const decision = pests >= 25 ? 'SPRAY' : 'WAIT';
        return jsonResponse({ decision, label: decision, reason: `engine says ${decision} at ${pests}`, borderline: false, range: { pests: [pests, pests], uncertainty: 0.15 } });
      }
      if (url.includes('/api/decision?')) return jsonResponse({ decision: 'SPRAY', avg_pests: 40, avg_predators: 1, range: { mean_confidence: 0.9 } });
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    const { default: WhatIfCard } = await import('../components/WhatIfCard.jsx');
    render(<WhatIfCard deviceId={DEVICE.id} />);

    await waitFor(() => expect(screen.getByTestId('what-if-result').textContent).toContain('engine says SPRAY at 40'));
    expect(screen.getByTestId('decision-map')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Pests per day (3-day average)'), { target: { value: '10' } });
    await waitFor(() => expect(screen.getByTestId('what-if-result').textContent).toContain('engine says WAIT at 10'));
    fireEvent.click(screen.getByText(/Back to this trap/));
    await waitFor(() => expect(screen.getByTestId('what-if-result').textContent).toContain('at 40'));
    // Every answer came from the backend engine
    expect(fetchMock.mock.calls.some(([u]) => u.includes('/api/decision/simulate?pests=10&predators=1&confidence=0.9'))).toBe(true);
  });
});

describe('Weather card', () => {
  const weather = (over = {}) => ({
    available: true,
    source: 'open-meteo',
    fetched_at: new Date().toISOString(),
    timezone: 'Asia/Kolkata',
    location: { lat: 13.1352, lon: 77.4846, label: 'ICAR-IIHR', default: true },
    current: { temperature: 27.4, humidity: 71, wind_kmh: 9 },
    spray: {
      can_spray_now: false,
      checks: [
        { id: 'rain', ok: false, label: 'Rain likely within 6 h (80% chance, 3 mm) - it would wash the spray off' },
        { id: 'wind', ok: true, label: 'Wind 9 km/h - low drift' },
        { id: 'daylight', ok: true, label: 'Daylight' },
      ],
      cautions: [],
      next_window: { start: new Date(Date.now() + 5 * 3_600_000).toISOString(), end: new Date(Date.now() + 8 * 3_600_000).toISOString(), hours: 3 },
    },
    degree_days: { per_day: 15, generation_degree_days: 300, base_temp_c: 10, days_per_generation: 20, next_adults_around: '2026-11-23', last_14_days: 210 },
    ...over,
  });

  test('not now: says why, when to spray instead, and when the next generation emerges', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(weather())));
    const { default: WeatherCard } = await import('../components/WeatherCard.jsx');
    render(<WeatherCard deviceId={DEVICE.id} decision={{ decision: 'SPRAY' }} />);
    expect((await screen.findByTestId('spray-verdict')).textContent).toBe('Not now');
    expect(screen.getByText(/Rain likely within 6 h/)).toBeTruthy();
    expect(screen.getByTestId('spray-timing').textContent).toMatch(/Spraying is advised for this trap, but wait for the window/);
    expect(screen.getByTestId('degree-days').textContent).toMatch(/~20 days/);
    expect(screen.getByText('Default location')).toBeTruthy();
  });

  test('weather unavailable never blocks: a quiet note only', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ available: false, reason: 'Weather service unreachable right now.' })));
    const { default: WeatherCard } = await import('../components/WeatherCard.jsx');
    render(<WeatherCard deviceId={DEVICE.id} />);
    expect(await screen.findByText(/Pest decisions are not affected/)).toBeTruthy();
  });
});

describe('Phone check', () => {
  test('photo + days hung -> decision, counts and advice; sends days_hung', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close() {} })));
    const ctx = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} });
    const toUrl = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
    // Real Chrome returns a Promise here; an effect that returned it crashed the whole app
    Element.prototype.scrollIntoView = vi.fn(() => Promise.resolve());
    const fetchMock = vi.fn(() =>
      jsonResponse({
        days_hung: 5,
        counts: { whitefly: 150, macrolophus: 2, nesidiocoris: 1 },
        totals: { pests: 150, predators: 3 },
        per_day: { pests: 30, predators: 0.6 },
        decision: { decision: 'SPRAY', label: 'SPRAY', reason: 'Average 30 pests/day over the 5 days the card hung.', pests_per_predator: 50, range: { pests: [25.5, 34.5] }, thresholds: { action_threshold_per_day: 25, spray_ratio: 10 } },
        advisory: { source: 'gemini', recommendation: 'Scout first.', mitigation_strategy: ['Scout first.', 'Spray at label rate.'] },
        quality: { ok: true, issues: [] },
        annotated_image: 'data:image/jpeg;base64,BBBB',
        vision: { status: 'ok', boxes: 153, model: 'yellow-sticky-traps-bwxut-ieond/1', image: { grid: '4x4' } },
        stored: false,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { default: PhoneCheckPage } = await import('../components/PhoneCheckPage.jsx');
    render(<PhoneCheckPage />);

    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [new File(['x'], 'trap.jpg', { type: 'image/jpeg' })] } });
    await screen.findByAltText('Sticky trap photo');
    fireEvent.click(screen.getByRole('button', { name: /One day less/ }));
    fireEvent.click(screen.getByRole('button', { name: /One day less/ }));
    expect(screen.getByTestId('days-value').textContent).toBe('5 days');
    fireEvent.click(screen.getByRole('button', { name: /Check trap/ }));

    const res = await screen.findByTestId('check-result');
    expect(res.querySelector('[data-decision="SPRAY"]')).toBeTruthy();
    expect(res.textContent).toContain('over the 5 days the card hung');
    expect(res.textContent).toContain('MR 2 · NC 1');
    expect(res.textContent).toContain('Spray at label rate.');
    expect(screen.getByAltText('Sticky trap photo').getAttribute('src')).toBe('data:image/jpeg;base64,BBBB'); // annotated
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.days_hung).toBe(5);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/check');
    ctx.mockRestore();
    toUrl.mockRestore();
  });
});

describe('Photo quality', () => {
  test('a rejected photo says what is wrong and that it must be retaken', () => {
    const quality = {
      ok: false,
      issues: ['blurry'],
      advice: ['Hold the phone steady.'],
      metrics: { sharpness: 3, brightness: 190, glare_fraction: 0.01 },
    };
    const bad = capture({
      data_source: 'hardware',
      detection: {
        pest_counts: {},
        bounding_boxes: [],
        vision_meta: { status: 'failed', error: { code: 'poor_image', message: 'The trap photo is too blurry.' }, quality },
        ai_advisory: {
          risk_level: null,
          summary: 'Pest detection failed.',
          source: 'none',
          status: 'skipped',
          decision: { decision: 'CHECK_TRAP', label: 'CHECK TRAP', reason: 'The trap photo is too blurry. Retake it.', check_trap: true },
        },
      },
    });
    render(<FarmerDashboard device={DEVICE} telemetry={[bad]} onGoAdmin={() => {}} />);
    expect(screen.getByText('Photo: blurry - retake')).toBeTruthy();
    expect(screen.getByText('Detections: Photo rejected')).toBeTruthy();
    expect(screen.getAllByText('CHECK TRAP').length).toBeGreaterThan(0);
  });
});

describe('Demo mode', () => {
  test('simulated captures carry a "Simulated data" + "Demo detector" banner', () => {
    render(<FarmerDashboard device={DEVICE} telemetry={[capture()]} onGoAdmin={() => {}} />);
    const banner = screen.getByTestId('simulated-banner');
    expect(banner.textContent).toContain('Simulated data');
    expect(banner.textContent).toContain('Demo detector');
  });

  test('one click resets the demo and lists each trap’s decision', async () => {
    const traps = [
      { id: 'a', name: 'DEMO · Polyhouse 1 (tomato)', decision: 'SPRAY', borderline: false },
      { id: 'b', name: 'DEMO · Net-house (capsicum)', decision: 'WAIT', borderline: true },
    ];
    const fetchMock = vi.fn(() => jsonResponse({ traps, captures: 54, days: 14 }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const onIngested = vi.fn();
    render(<AdminPanel devices={[DEVICE]} activeDeviceId={DEVICE.id} onDevicePatched={() => {}} onIngested={onIngested} />);
    fireEvent.click(screen.getByRole('button', { name: /Reset demo data/ }));
    expect(await screen.findByText('DEMO · Net-house (capsicum)')).toBeTruthy();
    expect(ownCalls(fetchMock)[0][0]).toContain('/api/admin/demo/reset');
    expect(ownCalls(fetchMock)[0][1].method).toBe('POST');
    expect(onIngested).toHaveBeenCalled();
    expect(screen.getByText(/54 simulated captures/)).toBeTruthy();
  });
});

describe('AdminPanel', () => {
  test('manual battery update triggers the low-battery alert and is labelled manual', async () => {
    let devices = [DEVICE];
    const fetchMock = vi.fn((url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      const device = { ...DEVICE, battery_level: body.battery_level, status: 'low_battery', battery_source: 'manual', battery_updated_at: new Date().toISOString() };
      return jsonResponse({ device, alert: 'LOW_BATTERY' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onPatched = vi.fn((d) => {
      devices = devices.map((x) => (x.id === d.id ? { ...x, ...d } : x));
      rerender(<AdminPanel devices={devices} activeDeviceId={DEVICE.id} onDevicePatched={onPatched} onIngested={() => {}} />);
    });
    const { rerender } = render(<AdminPanel devices={devices} activeDeviceId={DEVICE.id} onDevicePatched={onPatched} onIngested={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /14%/ }));
    expect(screen.getByText(/Critical: battery below 15%/)).toBeTruthy();
    await waitFor(() => expect(ownCalls(fetchMock)).toHaveLength(1));
    expect(ownCalls(fetchMock)[0][1].method).toBe('PATCH');
    expect(await screen.findByText(/Manual override/)).toBeTruthy();
    expect(screen.getByTestId('device-status').textContent).toBe('low battery');
  });

  test('admin key is sent when set and errors are explained', async () => {
    sessionStorage.setItem('agrisense.adminKey', 'k'.repeat(20));
    const fetchMock = vi.fn(() => jsonResponse({ error: 'Invalid admin credentials', code: 'forbidden' }, 403));
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminPanel devices={[DEVICE]} activeDeviceId={DEVICE.id} adminAuthRequired onDevicePatched={() => {}} onIngested={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /50%/ }));
    expect(await screen.findByText(/Admin key rejected/)).toBeTruthy();
    expect(ownCalls(fetchMock)[0][1].headers.Authorization).toBe(`Bearer ${'k'.repeat(20)}`);
  });

  test('auto-stream sends captures and stops cleanly', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() =>
      jsonResponse({ telemetry: capture(), duplicate: false, sources: { vision: 'simulated', advisory: 'rule-engine', advisory_status: 'not_configured' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminPanel devices={[DEVICE]} activeDeviceId={DEVICE.id} onDevicePatched={() => {}} onIngested={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Auto-stream/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(ownCalls(fetchMock)).toHaveLength(1);
    expect(JSON.parse(ownCalls(fetchMock)[0][1].body).data_source).toBe('dashboard');

    fireEvent.click(screen.getByRole('button', { name: /Stop stream/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(ownCalls(fetchMock)).toHaveLength(1);
  });
});

describe('Telegram card', () => {
  test('no chats yet: names the exact bot to message, with a link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        url.includes('/chats')
          ? jsonResponse({ ok: true, chats: [], bot: { username: 'Agrisense_new_bot', name: 'Agrisense' } })
          : jsonResponse({ state: 'missing_chat_id', chats: 0, language: 'both', summary_time: '07:00', timezone: 'Asia/Kolkata', last: null })
      )
    );
    const { default: TelegramCard } = await import('../components/TelegramCard.jsx');
    render(<TelegramCard />);
    await screen.findByText(/chat id missing/);
    fireEvent.click(screen.getByRole('button', { name: /Find my chat id/ }));
    const msg = await screen.findByTestId('telegram-no-chats');
    expect(msg.textContent).toContain('Open @Agrisense_new_bot in Telegram (not @BotFather)');
    expect(msg.querySelector('a').getAttribute('href')).toBe('https://t.me/Agrisense_new_bot');
  });


  test('not set up: shows the 3 setup steps; preview works; send buttons stay disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        url.includes('/preview')
          ? jsonResponse({ text: '🌿 <b>AgriSense trap summary</b>\n🔴▲ <b>Polyhouse 1</b>: SPRAY\n────────────\n🌿 <b>ಅಗ್ರಿಸೆನ್ಸ್ ಬಲೆ ಸಾರಾಂಶ</b>' })
          : jsonResponse({ state: 'not_configured', chats: 0, language: 'both', summary_time: '07:00', timezone: 'Asia/Kolkata', last: null })
      )
    );
    const { default: TelegramCard } = await import('../components/TelegramCard.jsx');
    render(<TelegramCard />);
    expect(await screen.findByText('Not set up')).toBeTruthy();
    expect(screen.getByText(/BotFather/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send summary now/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Preview summary/ }));
    const preview = await screen.findByTestId('telegram-preview');
    expect(preview.textContent).toContain('AgriSense trap summary');
    expect(preview.textContent).toContain('ಅಗ್ರಿಸೆನ್ಸ್');
    expect(preview.innerHTML).not.toContain('<b>'); // shown as text, never as HTML
  });
});

describe('EN / ಕನ್ನಡ', () => {
  const appFetch = () =>
    vi.fn((url) => {
      if (url.includes('/api/devices')) return jsonResponse([DEVICE]);
      if (url.includes('/api/telemetry')) return jsonResponse([capture()]);
      if (url.includes('/api/decision?'))
        return jsonResponse({ decision: 'SPRAY', label: 'SPRAY', reason: 'Average 40 pests/day ...', avg_pests: 40, no_predators: true, window: { days: 3 }, thresholds: { action_threshold_per_day: 25 } });
      return jsonResponse({ ok: true, mode: 'demo', store: 'memory', integrations: {}, auth: {} });
    });

  test('toggle switches the farmer pages to Kannada, is remembered, and the map stays English', async () => {
    localStorage.removeItem('agrisense.lang');
    vi.stubGlobal('fetch', appFetch());
    const { unmount } = render(<App />);
    await screen.findByText('25.0°C');
    fireEvent.click(screen.getByRole('button', { name: 'ಕನ್ನಡ' }));
    expect(await screen.findByText('ಸಿಕ್ಕಿಬಿದ್ದ ಕೀಟಗಳು')).toBeTruthy(); // "Insects trapped"
    await waitFor(() => expect(screen.getByTestId('trap-card').textContent).toContain('ಸಿಂಪಡಿಸಿ')); // SPRAY
    expect(screen.getByTestId('trap-card').textContent).toContain('ದಿನಕ್ಕೆ 40 ಕೀಟಗಳು'); // reason rebuilt from numbers
    expect(document.documentElement.lang).toBe('kn');
    expect(localStorage.getItem('agrisense.lang')).toBe('kn');

    // Map page: English only, no toggle
    fireEvent.click(screen.getAllByText(/Pest Surveillance Map|^Map$/)[0]);
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
    expect(screen.queryByRole('button', { name: 'ಕನ್ನಡ' })).toBeNull();
    unmount();

    // Remembered on the next visit
    render(<App />);
    expect(await screen.findByText('ಸಿಕ್ಕಿಬಿದ್ದ ಕೀಟಗಳು')).toBeTruthy();
    localStorage.removeItem('agrisense.lang');
  });

  test('decision reasons are rebuilt in Kannada from the same numbers', async () => {
    const { decisionReason } = await import('../lib/i18n.jsx');
    const d = { decision: 'BIOCONTROL', reason: 'English reason', avg_pests: 49.3, pests_per_predator: 4.2, borderline: true, thresholds: { action_threshold_per_day: 25 } };
    expect(decisionReason('en', d)).toBe('English reason');
    const kn = decisionReason('kn', d);
    expect(kn).toContain('49.3');
    expect(kn).toContain('4.2');
    expect(kn).toContain('ಜೈವಿಕ ನಿಯಂತ್ರಕ');
    expect(kn).toContain('ಗಡಿರೇಖೆ');
  });

  test('every English key has a Kannada translation', async () => {
    const src = await import('../lib/i18n.jsx?raw');
    const block = (lang) => new Set([...src.default.split(`  ${lang}: {`)[1].split('\n  },')[0].matchAll(/^\s+'?([\w.]+)'?:/gm)].map((m) => m[1]));
    const en = block('en');
    const kn = block('kn');
    const missing = [...en].filter((k) => !kn.has(k));
    expect(missing).toEqual([]);
  });
});

describe('Trap cards with a slow database', () => {
  test('a new devices array on every poll does not restart the requests (cards still fill in)', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            calls++;
            setTimeout(() => resolve({ ok: true, status: 200, json: () => Promise.resolve({ decision: 'WAIT', label: 'WAIT', avg_pests: 3, reason: 'ok', window: { days: 3 } }) }), 60);
          })
      )
    );
    const { default: TrapCards } = await import('../components/TrapCards.jsx');
    const { rerender } = render(<TrapCards devices={[{ ...DEVICE }]} activeId={DEVICE.id} />);
    // Poll faster than the answer: same trap, new array objects
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 20));
      rerender(<TrapCards devices={[{ ...DEVICE }]} activeId={DEVICE.id} />);
    }
    await waitFor(() => expect(screen.getByTestId('trap-card').querySelector('[data-decision="WAIT"]')).toBeTruthy());
    expect(calls).toBe(1);
  });
});

describe('Manual spray', () => {
  test('asks first, warns when the advice is not SPRAY, logs with notify and reports the Telegram result', async () => {
    const ManualSprayCard = (await import('../components/ManualSprayCard.jsx')).default;
    const fetchMock = vi.fn(() => jsonResponse({ id: 1, action: 'sprayed', telegram: { ok: true, code: null } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    render(<ManualSprayCard device={DEVICE} decision={{ decision: 'WAIT' }} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /Start manual spray/ }));
    expect(fetchMock).not.toHaveBeenCalled(); // confirmation first
    expect(screen.getByText(/spraying is not recommended/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'rows 1-4' } });
    fireEvent.click(screen.getByRole('button', { name: /Yes, spray and alert/ }));
    expect(await screen.findByText('Spray logged and sent to Telegram.')).toBeTruthy();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ device_id: DEVICE.id, action: 'sprayed', note: 'rows 1-4', notify: true });
    expect(onChanged).toHaveBeenCalled();
  });

  test('a failed Telegram send still shows the spray as logged', async () => {
    const ManualSprayCard = (await import('../components/ManualSprayCard.jsx')).default;
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ id: 2, action: 'sprayed', telegram: { ok: false, code: 'telegram_unreachable' } }, 201)));
    render(<ManualSprayCard device={DEVICE} decision={{ decision: 'SPRAY' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Start manual spray/ }));
    expect(screen.queryByText(/not recommended/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Yes, spray and alert/ }));
    expect(await screen.findByText(/Spray logged, but the Telegram message failed \(telegram_unreachable\)/)).toBeTruthy();
  });
});

describe('Trap box controls', () => {
  const controls = (over = {}) => ({
    device_id: DEVICE.id,
    switches: { fan: { on: false, applied: null }, trap_light: { on: true, applied: null }, ...over },
    commands: [],
    pi: { online: false, last_seen: null },
  });

  test('fan switch sends a PATCH and shows "waiting for the Pi" until confirmed', async () => {
    const HardwareControls = (await import('../components/HardwareControls.jsx')).default;
    const fetchMock = vi.fn((url, opts) =>
      opts?.method === 'PATCH' ? jsonResponse(controls({ fan: { on: true, applied: false } })) : jsonResponse(controls())
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<HardwareControls device={DEVICE} />);
    const fan = await screen.findByRole('switch', { name: 'Fan' });
    expect(fan.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(fan);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Fan' }).getAttribute('aria-checked')).toBe('true'));
    const patch = fetchMock.mock.calls.find(([, o]) => o?.method === 'PATCH');
    expect(patch[0]).toContain(`/api/devices/${DEVICE.id}/controls`);
    expect(JSON.parse(patch[1].body)).toEqual({ fan: true });
    expect(screen.getByText('Waiting for the Pi')).toBeTruthy();
    expect(screen.getByText(/Raspberry Pi offline/)).toBeTruthy();
  });

  test('reboot needs a second click to confirm', async () => {
    const HardwareControls = (await import('../components/HardwareControls.jsx')).default;
    const fetchMock = vi.fn(() => jsonResponse(controls()));
    vi.stubGlobal('fetch', fetchMock);
    render(<HardwareControls device={DEVICE} />);
    fireEvent.click(await screen.findByRole('button', { name: /Reboot Pi/ }));
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Confirm reboot/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, o]) => o?.method === 'POST' && u.endsWith('/commands'))).toBe(true));
    const post = fetchMock.mock.calls.find(([, o]) => o?.method === 'POST');
    expect(JSON.parse(post[1].body)).toEqual({ command: 'reboot' });
  });
});

describe('3D farm view', () => {
  test('without WebGL it lists every trap with its decision, and a click selects the trap', async () => {
    const Field3D = (await import('../components/Field3D.jsx')).default;
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ decision: 'SPRAY', avg_pests: 47, no_predators: true, thresholds: { action_threshold_per_day: 25 } })));
    const onSelect = vi.fn();
    render(<Field3D devices={[DEVICE]} activeId={DEVICE.id} onSelect={onSelect} />);
    expect(screen.getByText(/3D view needs WebGL/)).toBeTruthy(); // jsdom has no WebGL
    expect(await screen.findByText('47 pests/day')).toBeTruthy();
    expect(screen.getByText('SPRAY')).toBeTruthy();
    expect(screen.getByText(/action level \(25\/day\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trap 01' }));
    expect(onSelect).toHaveBeenCalledWith(DEVICE.id);
  });
});

describe('Customize, quick actions, timeline, day strip', () => {
  test('a hidden section is not rendered, and the order is followed', () => {
    const layout = { order: ['log', 'glance', 'timeline', 'detections', 'field3d', 'traps', 'whatif', 'climate'], hidden: ['glance'] };
    render(<FarmerDashboard device={DEVICE} telemetry={[capture()]} onGoAdmin={() => {}} layout={layout} />);
    expect(screen.queryByText('Today at a glance')).toBeNull();
    const log = screen.getByText('Recent Captures');
    const timeline = screen.getByText('Daily timeline');
    expect(log.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('day strip steps through captures with the arrow buttons and keys', () => {
    const rows = [capture({ id: 'c1', timestamp: '2026-11-03T08:00:00Z' }), capture({ id: 'c2', timestamp: '2026-11-03T12:00:00Z' })];
    render(<FarmerDashboard device={DEVICE} telemetry={rows} onGoAdmin={() => {}} />);
    const strip = screen.getByRole('group', { name: /Captures: use the arrows/ });
    expect(strip.textContent).toMatch(/2\s*\/\s*2/);
    expect(screen.getByRole('button', { name: 'Next capture' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous capture' }));
    expect(strip.textContent).toMatch(/1\s*\/\s*2/);
    expect(screen.getByText('Viewing historical capture', { exact: false })).toBeTruthy();
    fireEvent.keyDown(strip, { key: 'ArrowRight' });
    expect(strip.textContent).toMatch(/2\s*\/\s*2/);
  });

  test('timeline lists the day’s captures and actions in time order', async () => {
    const DailyTimeline = (await import('../components/DailyTimeline.jsx')).default;
    const rows = [capture({ id: 'c1', timestamp: '2026-11-03T08:00:00Z' }), capture({ id: 'c2', timestamp: '2026-11-03T12:00:00Z' })];
    const actions = [{ id: 7, action: 'sprayed', acted_at: '2026-11-03T10:00:00Z', note: 'rows 1-4' }];
    const onSelect = vi.fn();
    render(<DailyTimeline telemetry={rows} actions={actions} capture={rows[1]} onSelectCapture={onSelect} />);
    expect(screen.getByText(/3 events/)).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items.findIndex((x) => x.includes('Sprayed'))).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onSelect).toHaveBeenCalledWith('c1');
  });

  test('quick actions filter as you type and run with Enter', async () => {
    const CommandPalette = (await import('../components/CommandPalette.jsx')).default;
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={[
          { id: 'a', group: 'Go to', label: 'Dashboard', run: () => {} },
          { id: 'b', group: 'Appearance', label: 'Light theme', run },
        ]}
      />
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Search actions' }), { target: { value: 'light' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('theme choice is applied to <html> and remembered', async () => {
    const { useTheme } = await import('../lib/theme.js');
    function Probe() {
      const { theme, setTheme } = useTheme();
      return <button onClick={() => setTheme('dark')}>{theme}</button>;
    }
    localStorage.removeItem('agrisense.theme');
    render(<Probe />);
    expect(document.documentElement.dataset.theme).toBe('light'); // default
    fireEvent.click(screen.getByRole('button', { name: 'light' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('agrisense.theme')).toBe('"dark"');
    localStorage.removeItem('agrisense.theme');
  });
});

describe('Live Vision (Raspberry Pi OpenCV)', () => {
  test('without a Pi stream it shows a labelled preview of the last capture', async () => {
    const LiveVision = (await import('../components/LiveVision.jsx')).default;
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ frame: null, streaming: false, age_ms: null })));
    render(<LiveVision open onClose={() => {}} device={DEVICE} capture={capture({ image_url: 'http://x/trap.svg' })} />);
    expect(await screen.findByText(/Pi not streaming/)).toBeTruthy();
    expect(screen.getByText(/not a live frame/)).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['1Raw', '2Grayscale', '3Threshold', '4Detections']);
    fireEvent.click(screen.getByRole('tab', { name: /Threshold/ }));
    expect(screen.getByRole('tab', { name: /Threshold/ }).getAttribute('aria-selected')).toBe('true');
  });

  test('a streaming Pi frame shows its own stages, fps and pipeline', async () => {
    const LiveVision = (await import('../components/LiveVision.jsx')).default;
    const frame = {
      image: 'data:image/jpeg;base64,AAAA',
      stages: [{ name: 'Yellow mask', image: 'data:image/jpeg;base64,BBBB' }],
      boxes: [{ x: 0.1, y: 0.1, width: 0.05, height: 0.05, label: 'whitefly', confidence: 0.9 }],
      fps: 14,
      width: 1280,
      height: 960,
      pipeline: ['HSV mask', 'contours'],
    };
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ frame, streaming: true, age_ms: 400 })));
    render(<LiveVision open onClose={() => {}} device={DEVICE} capture={capture()} />);
    expect(await screen.findByText(/Streaming · 14 fps/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Yellow mask/ })).toBeTruthy();
    expect(screen.getByText('1280×960')).toBeTruthy();
    expect(screen.getByText('HSV mask')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Yellow mask/ }));
    expect(screen.getByRole('img', { name: /Yellow mask/ }).getAttribute('src')).toBe('data:image/jpeg;base64,BBBB');
  });

  test('the trap rail selects a trap and Add creates one', async () => {
    const { TrapStage } = await import('../components/FieldHero.jsx');
    const onSelect = vi.fn();
    const onAdd = vi.fn(() => Promise.resolve());
    const other = { ...DEVICE, id: '22222222-2222-4222-8222-222222222222', name: 'Trap 02' };
    render(<TrapStage device={DEVICE} devices={[DEVICE, other]} capture={capture()} index={0} count={1} onStep={() => {}} onSelectDevice={onSelect} onAddTrap={onAdd} onOpenVision={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Trap 02' }));
    expect(onSelect).toHaveBeenCalledWith(other.id);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByLabelText('New trap name'), { target: { value: 'Polyhouse 4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add trap' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Polyhouse 4'));
  });
});

describe('Natural voice', () => {
  test('advice is split into sentence-sized pieces so the first can play quickly', async () => {
    const { splitForSpeech } = await import('../components/FieldHero.jsx');
    const text = 'Average 47 pests per day. Spray the east rows tonight. Check the trap tomorrow. ' + 'Keep monitoring the west side of the greenhouse every morning before nine. '.repeat(4);
    const parts = splitForSpeech(text);
    expect(parts).toHaveLength(2); // first sentence, then the rest (at most 2 voice calls)
    expect(parts[0]).toBe('Average 47 pests per day.');
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text.trim().replace(/\s+/g, ' '));
  });

  test('play asks the backend for the natural voice of the first piece', async () => {
    const { HeroCards } = await import('../components/FieldHero.jsx');
    const fetchMock = vi.fn((url) =>
      String(url).endsWith('/api/voice')
        ? Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['RIFF'], { type: 'audio/wav' })) })
        : jsonResponse({ switches: { trap_light: { on: true } } })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:voice' }));
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal('Audio', function FakeAudio(src) {
      this.src = src;
      this.play = play;
      this.pause = () => {};
    });
    const c = capture({ detection: { ...capture().detection, ai_advisory: { risk_level: 'High', summary: 'Whitefly pressure is high. Spray tonight.', mitigation_strategy: ['Spray the east rows.'] } } });
    render(<HeroCards device={DEVICE} capture={c} telemetry={[c]} decision={null} events={[]} onSeeAll={() => {}} onSelectCapture={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Read the advice aloud' }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    const voiceCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/voice'));
    expect(JSON.parse(voiceCall[1].body)).toMatchObject({ lang: 'en' });
    expect(screen.getByText(/Natural voice/)).toBeTruthy();
  });
});

describe('Voice picker', () => {
  test('choosing a voice is remembered and used for the next playback', async () => {
    localStorage.removeItem('agrisense.voice');
    const { HeroCards } = await import('../components/FieldHero.jsx');
    const voices = { voice: 'Kore', voices: [{ name: 'Kore', style: 'Firm, clear' }, { name: 'Aoede', style: 'Breezy, warm' }] };
    const fetchMock = vi.fn((url, opts) => {
      if (String(url).endsWith('/api/voice') && opts?.method === 'POST') return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['RIFF'])) });
      if (String(url).endsWith('/api/voice')) return jsonResponse(voices);
      return jsonResponse({ switches: { trap_light: { on: true } } });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:voice' }));
    vi.stubGlobal('Audio', function FakeAudio() {
      this.play = () => Promise.resolve();
      this.pause = () => {};
    });
    const c = capture({ detection: { ...capture().detection, ai_advisory: { risk_level: 'High', summary: 'Pressure is high. Spray tonight.', mitigation_strategy: [] } } });
    render(<HeroCards device={DEVICE} capture={c} telemetry={[c]} decision={null} events={[]} onSeeAll={() => {}} onSelectCapture={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Voice: Kore/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Aoede/ }));
    expect(localStorage.getItem('agrisense.voice')).toBe('Aoede');
    expect(screen.getByRole('button', { name: /Voice: Aoede/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Read the advice aloud' }));
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([u, o]) => String(u).endsWith('/api/voice') && o?.method === 'POST').map(([, o]) => JSON.parse(o.body));
      expect(posts.some((b) => b.voice === 'Aoede')).toBe(true);
    });
    localStorage.removeItem('agrisense.voice');
  });
});
