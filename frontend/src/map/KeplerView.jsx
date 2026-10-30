/**
 * The kepler.gl map itself. Lazy-loaded by PestMapPage, so kepler.gl, deck.gl,
 * MapLibre and Redux are only downloaded when the map can actually be shown.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Provider } from 'react-redux';
import KeplerGl from '@kepler.gl/components';
import { addDataToMap } from '@kepler.gl/actions';
import 'maplibre-gl/dist/maplibre-gl.css';
import { createMapStore } from './store.js';
import { MAP_ID, buildCustomMapStyles, buildMapConfig, toKeplerDataset } from './keplerConfig.js';

/** Optional satellite basemap: only when a (public, URL-restricted) Mapbox token is configured. */
const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim();
const SATELLITE_STYLES = buildCustomMapStyles(MAPBOX_TOKEN);

function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export default function KeplerView({ rows }) {
  const store = useMemo(() => createMapStore(), []);
  const box = useRef(null);
  const { width, height } = useSize(box);
  const loadedSignature = useRef(null);

  // kepler registers the map instance only once <KeplerGl> mounts (after we know its size).
  // addDataToMap dispatched before that reaches no instance and is silently dropped, so wait.
  const instanceReady = useSyncExternalStore(store.subscribe, () => Boolean(store.getState().keplerGl?.[MAP_ID]));

  // (Re)load the dataset only when the rows actually change, keeping the user's view otherwise
  useEffect(() => {
    if (!instanceReady) return;
    const signature = `${rows.length}:${rows.at(0)?.date}:${rows.at(-1)?.date}:${rows.reduce((s, r) => s + r.pest_count, 0)}`;
    if (signature === loadedSignature.current) return;
    const first = loadedSignature.current === null;
    loadedSignature.current = signature;
    store.dispatch(
      addDataToMap({
        datasets: toKeplerDataset(rows),
        options: { centerMap: first, readOnly: true, keepExistingConfig: !first },
        config: first ? buildMapConfig(rows) : undefined,
      })
    );
  }, [rows, store, instanceReady]);

  return (
    <Provider store={store}>
      <div ref={box} className="absolute inset-0" data-testid="kepler-container">
        {width > 0 && height > 0 && (
          <KeplerGl
            id={MAP_ID}
            width={width}
            height={height}
            appName="Agrisense"
            mapboxApiAccessToken={MAPBOX_TOKEN || undefined}
            mapStyles={SATELLITE_STYLES}
            mapStylesReplaceDefault={false}
          />
        )}
      </div>
    </Provider>
  );
}
