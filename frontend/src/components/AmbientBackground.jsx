/**
 * Very subtle, GPU-cheap ambient layer: three slowly drifting gradient blobs,
 * a faint grid and a handful of rising particles. Pure CSS (transform/opacity
 * only), fixed behind the app, hidden for prefers-reduced-motion.
 */
const PARTICLES = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  duration: `${18 + ((i * 7) % 14)}s`,
  delay: `${-((i * 5) % 20)}s`,
  drift: `${((i % 5) - 2) * 18}px`,
  size: i % 4 === 0 ? 4 : 3,
}));

export default function AmbientBackground() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-blob b1" />
      <div className="ambient-blob b2" />
      <div className="ambient-blob b3" />
      <div className="ambient-grid" />
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="particle"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animationDuration: p.duration,
            animationDelay: p.delay,
            '--drift': p.drift,
          }}
        />
      ))}
    </div>
  );
}
