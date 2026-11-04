/**
 * Per-trap farm economics (crop, acres, price, yield, costs), remembered on
 * this device, and the live estimate for the trap's current decision.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const key = (deviceId) => `agrisense.econ.${deviceId}`;
const read = (deviceId) => {
  try {
    return JSON.parse(localStorage.getItem(key(deviceId)) ?? '{}') ?? {};
  } catch {
    return {};
  }
};

const CROP_WORDS = ['tomato', 'capsicum', 'cucumber', 'chilli', 'brinjal'];
/** 'DEMO · Net-house (capsicum)' -> 'capsicum' (used only until a crop is chosen). */
export const cropFromName = (name) => CROP_WORDS.find((c) => String(name ?? '').toLowerCase().includes(c));

export const inr = (n) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n))}`;

/** {data, settings, setSettings, reset, loading} for one trap; refetches when the decision may have changed. */
export function useEconomics(deviceId, refreshKey, deviceName) {
  const [settings, setState] = useState(() => (deviceId ? read(deviceId) : {}));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setState(deviceId ? read(deviceId) : {}), [deviceId]);

  useEffect(() => {
    if (!deviceId) return undefined;
    let off = false;
    setLoading(true);
    const id = setTimeout(() => {
      api
        .economics(deviceId, { crop: cropFromName(deviceName), ...settings })
        .then((d) => !off && setData(d?.settings && d?.kind ? d : null))
        .catch(() => !off && setData(null))
        .finally(() => !off && setLoading(false));
    }, 250); // settle while typing in the settings form
    return () => {
      off = true;
      clearTimeout(id);
    };
  }, [deviceId, refreshKey, deviceName, JSON.stringify(settings)]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSettings = useCallback(
    (next) => {
      setState(next);
      try {
        localStorage.setItem(key(deviceId), JSON.stringify(next));
      } catch {
        /* not remembered */
      }
    },
    [deviceId]
  );
  const reset = useCallback(() => setSettings({}), [setSettings]);
  return { data, settings, setSettings, reset, loading };
}
