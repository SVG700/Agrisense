/**
 * The deck.gl scene behind Field3D (lazy-loaded). Plain cartesian units:
 * traps sit on a grid SPACING apart; pillar height is pests/day * scale.
 */
import { useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { COORDINATE_SYSTEM, OrbitView } from '@deck.gl/core';
import { ColumnLayer, PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';

const SPACING = 14;
const COLORS = {
  SPRAY: [225, 29, 72],
  BIOCONTROL: [217, 119, 6],
  WAIT: [22, 163, 74],
  CHECK_TRAP: [100, 116, 139],
};
const NO_DATA = [203, 213, 225];
const LABELS = { SPRAY: 'SPRAY', BIOCONTROL: 'RELEASE BIOCONTROL', WAIT: 'WAIT', CHECK_TRAP: 'CHECK TRAP' };

export default function Field3DScene({ traps, activeId, threshold, onSelect }) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(traps.length)));
  const rows = Math.max(1, Math.ceil(traps.length / cols));
  const width = (cols - 1) * SPACING;
  const depth = (rows - 1) * SPACING;
  const margin = SPACING * 0.75;
  const field = { x0: -margin, y0: -margin, x1: width + margin, y1: depth + margin };
  const span = Math.max(field.x1 - field.x0, field.y1 - field.y0);

  // Tallest pillar about 40% of the field size; the threshold always fits
  const maxPests = Math.max(threshold * 1.3, ...traps.map((t) => t.pests ?? 0));
  const scale = (span * 0.4) / maxPests;
  const planeZ = threshold * scale;

  const placed = useMemo(
    () =>
      traps.map((t, i) => ({
        ...t,
        position: [(i % cols) * SPACING, Math.floor(i / cols) * SPACING, 0],
        height: t.pests !== null ? Math.max(0.6, t.pests * scale) : 0.6,
        color: t.decision ? COLORS[t.decision] ?? NO_DATA : NO_DATA,
      })),
    [traps, cols, scale]
  );

  const initialViewState = useMemo(
    () => ({
      target: [width / 2, depth / 2, span * 0.12],
      rotationX: 32,
      rotationOrbit: -28,
      zoom: Math.log2(460 / (span * 1.2)),
      minZoom: Math.log2(460 / (span * 5)),
      maxZoom: Math.log2(460 / (span * 0.2)),
    }),
    [width, depth, planeZ, span]
  );
  const [viewState, setViewState] = useState(initialViewState);

  // Crop rows across the field
  const cropRows = useMemo(() => {
    const out = [];
    for (let y = field.y0 + 2; y < field.y1; y += 2.4) out.push({ path: [[field.x0 + 1, y, 0.02], [field.x1 - 1, y, 0.02]] });
    return out;
  }, [field.x0, field.x1, field.y0, field.y1]);

  const layers = [
    new SolidPolygonLayer({
      id: 'ground',
      data: [{ polygon: [[field.x0, field.y0], [field.x1, field.y0], [field.x1, field.y1], [field.x0, field.y1]] }],
      getPolygon: (d) => d.polygon,
      getFillColor: [214, 226, 205],
      extruded: true,
      getElevation: -0.01,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      material: false,
    }),
    new PathLayer({
      id: 'crop-rows',
      data: cropRows,
      getPath: (d) => d.path,
      getColor: [134, 168, 112],
      getWidth: 0.5,
      widthUnits: 'common',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    }),
    new ColumnLayer({
      id: 'traps',
      data: placed,
      getPosition: (d) => d.position,
      getElevation: (d) => d.height,
      getFillColor: (d) => d.color,
      getLineColor: [14, 27, 18],
      getLineWidth: (d) => (d.id === activeId ? 0.5 : 0),
      lineWidthUnits: 'common',
      stroked: true,
      radius: 2.4,
      diskResolution: 32,
      extruded: true,
      elevationScale: 1,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 90],
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      onClick: ({ object }) => object && onSelect?.(object.id),
      updateTriggers: { getLineWidth: activeId },
      transitions: { getElevation: { duration: 700 } },
    }),
    // The action level: a translucent sheet across the field
    new SolidPolygonLayer({
      id: 'action-level',
      data: [{ polygon: [[field.x0, field.y0, planeZ], [field.x1, field.y0, planeZ], [field.x1, field.y1, planeZ], [field.x0, field.y1, planeZ]] }],
      getPolygon: (d) => d.polygon,
      getFillColor: [225, 29, 72, 38],
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      parameters: { depthWriteEnabled: false },
    }),
    new TextLayer({
      id: 'labels',
      data: placed,
      getPosition: (d) => [d.position[0], d.position[1], d.height + 2.2],
      getText: (d) => `${shortName(d.name)} · ${d.pests !== null ? `${Math.round(d.pests)}/day` : 'no data'}`,
      getSize: 11,
      getColor: (d) => (d.id === activeId ? [14, 27, 18] : [51, 65, 85]),
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: 600,
      background: true,
      getBackgroundColor: [255, 255, 255, 220],
      backgroundPadding: [4, 2],
      billboard: true,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      updateTriggers: { getColor: activeId },
      characterSet: 'auto',
    }),
  ];

  return (
    <>
      <DeckGL
        views={new OrbitView({ orbitAxis: 'Z' })}
        viewState={viewState}
        onViewStateChange={({ viewState: v }) => setViewState(v)}
        controller={{ dragRotate: true, inertia: 300 }}
        layers={layers}
        getCursor={({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')}
        getTooltip={({ object }) =>
          object && {
            html: `<b>${escapeHtml(object.name)}</b><br/>${object.decision ? LABELS[object.decision] : 'No decision yet'}${object.borderline ? ' (borderline)' : ''}<br/>${
              object.pests !== null ? `${object.pests} pests/day` : 'No counted photos'
            }${object.perPredator !== null ? ` · ${object.perPredator} per predator` : ''}`,
            style: { background: '#fff', color: '#0e1b12', borderRadius: '10px', fontSize: '12px', padding: '8px 10px', boxShadow: '0 8px 24px rgba(15,46,29,.18)' },
          }
        }
      />
      <button
        type="button"
        className="btn btn-ghost absolute right-4 top-4 min-h-0 px-3 py-1.5 text-xs"
        onClick={() => setViewState({ ...initialViewState, transitionDuration: 600 })}
      >
        Reset view
      </button>
    </>
  );
}

/** "DEMO · Polyhouse 1 (tomato)" -> "Polyhouse 1": keeps labels short so they don't collide. */
const shortName = (name) => String(name).replace(/^DEMO\s*·\s*/, '').replace(/\s*\(.*\)$/, '').slice(0, 22);

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
