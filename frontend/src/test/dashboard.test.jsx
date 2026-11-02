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

describe('AdminPanel', () => {
  test('manual battery update triggers the low-battery alert and is labelled manual', async () => {
    let devices = [DEVICE];
    const fetchMock = vi.fn((url, opts) => {
      const body = JSON.parse(opts.body);
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
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
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${'k'.repeat(20)}`);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).data_source).toBe('dashboard');

    fireEvent.click(screen.getByRole('button', { name: /Stop stream/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
