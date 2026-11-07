/**
 * Explains WHY the AgriSense API can't be reached, instead of a generic "is the backend running?".
 *
 * Health check against `${base}/api/health` (then `${base}/api/` if /health is missing). On failure
 * it reports one cause with the exact URL it tried:
 *   wrong_protocol      https page -> http API (mixed content), or an https base URL for a plain-http host
 *   timeout             no answer within the time limit
 *   cors                the host answered, but the browser blocked the response (CORS)
 *   connection_refused  nothing answered at that address/port (host off, wrong IP, firewall)
 *   not_found           the host answered 404 for both /api/health and /api/
 *   not_agrisense       /api/health answered, but not with the AgriSense backend's {ok: true, mode, ...}
 *   http_error          any other HTTP status
 * A browser can't tell "refused" from "CORS" directly, so a second no-cors request decides:
 * if an opaque reply comes back the host is up and CORS is the blocker.
 */
const TIMEOUT_MS = 5000;

const HINTS = {
  wrong_protocol: 'Use plain http:// for the AGRISENSE_BASE_URL (the host serves http), and open this site over http too.',
  timeout: 'The host did not answer in time: check the IP in agrisense.json, that both laptops are on the same Wi-Fi, and the host firewall.',
  cors: "The host is up but blocks this site's origin: add this page's origin to CORS_ORIGINS on the host backend.",
  connection_refused: "Nothing is answering there: check the host's IP (it changes with Wi-Fi), that the backend is running, and its firewall. If it answers in another browser, an ad-blocker or privacy extension here is blocking the request.",
  not_found: 'That address answers but has no AgriSense API: check the port, and that the host proxies /api to its backend.',
  not_agrisense: "That host's /api is a different service, not the AgriSense backend: point AGRISENSE_BASE_URL (agrisense.json) at a machine running the AgriSense backend.",
  http_error: 'The AgriSense backend answered with an error.',
};

function describe(cause, url, detail = '') {
  return {
    ok: false,
    cause,
    url,
    message: `Cannot reach the AgriSense API at ${url}: ${cause.replace('_', ' ')}${detail ? ` (${detail})` : ''}. ${HINTS[cause]}`,
  };
}

/**
 * @param {string} base normalized AGRISENSE_BASE_URL ('' = same origin)
 * @param {{fetchImpl?: typeof fetch, pageProtocol?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, cause?: string, url: string, message?: string, status?: number}>}
 */
export async function checkConnection(base, { fetchImpl = fetch, pageProtocol = globalThis.location?.protocol ?? 'http:', timeoutMs = TIMEOUT_MS } = {}) {
  const health = `${base}/api/health`;
  if (base.startsWith('https://')) return describe('wrong_protocol', health, 'base URL uses https:// but the host serves plain http');
  if (pageProtocol === 'https:' && base.startsWith('http://')) return describe('wrong_protocol', health, 'this page is https, the browser blocks calls to http');

  for (const url of [health, `${base}/api/`]) {
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return describe('timeout', url, `no answer in ${timeoutMs / 1000} s`);
      // "Failed to fetch": refused / unreachable OR blocked by CORS. An opaque no-cors reply means the host is up.
      try {
        await fetchImpl(url, { mode: 'no-cors', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
        return describe('cors', url);
      } catch {
        return describe('connection_refused', url);
      }
    }
    if (res.ok) {
      // The AgriSense backend's /api/health says {ok: true, mode, store, ...}; anything else is another app
      if (url === health) {
        const data = await res.json?.().catch(() => null);
        if (!(data && data.ok === true && 'mode' in data)) {
          const seen = data && typeof data === 'object' ? `it answered ${JSON.stringify(data).slice(0, 80)}…` : 'it did not answer JSON';
          return { ...describe('not_agrisense', url, seen), status: res.status };
        }
      }
      return { ok: true, url, status: res.status };
    }
    if (res.status !== 404) return { ...describe('http_error', url, `HTTP ${res.status}`), status: res.status };
  }
  return { ...describe('not_found', `${base}/api/health`, 'HTTP 404 for /api/health and /api/'), status: 404 };
}
