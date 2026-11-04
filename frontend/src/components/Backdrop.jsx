/**
 * Misty field landscape behind the app window (pure SVG + CSS, no image download):
 * far ridges fading into fog, a mid hill, a warm grass foreground and drifting mist.
 */
export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <span className="mist" style={{ width: '60vw', height: '30vh', left: '-10vw', top: '18vh' }} />
      <span className="mist" style={{ width: '50vw', height: '26vh', right: '-12vw', top: '34vh', animationDelay: '-12s' }} />
      <svg viewBox="0 0 1440 700" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="bd-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b9bfbd" />
            <stop offset="1" stopColor="#d9dcd8" />
          </linearGradient>
          <linearGradient id="bd-mid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9aa19c" />
            <stop offset="1" stopColor="#c8c9c0" />
          </linearGradient>
          <linearGradient id="bd-grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c9ab78" />
            <stop offset="0.55" stopColor="#a98a5a" />
            <stop offset="1" stopColor="#7d6a4c" />
          </linearGradient>
          <linearGradient id="bd-fog" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <filter id="bd-soft">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <path d="M0 330 L160 230 L300 290 L460 170 L620 280 L760 210 L920 300 L1080 190 L1260 270 L1440 220 V700 H0 Z" fill="url(#bd-far)" filter="url(#bd-soft)" opacity="0.8" />
        <rect x="0" y="250" width="1440" height="160" fill="url(#bd-fog)" />
        <path d="M0 450 C180 380 340 420 520 400 C720 378 860 440 1040 410 C1220 380 1330 420 1440 400 V700 H0 Z" fill="url(#bd-mid)" opacity="0.85" />
        <rect x="0" y="380" width="1440" height="140" fill="url(#bd-fog)" opacity="0.7" />
        <path d="M0 560 C220 520 420 545 640 532 C880 518 1080 560 1440 528 V700 H0 Z" fill="url(#bd-grass)" />
        {/* grass strokes */}
        <g stroke="#6f5c40" strokeOpacity="0.35" strokeWidth="1.2">
          {Array.from({ length: 70 }, (_, i) => {
            const x = (i * 211) % 1440;
            const y = 560 + ((i * 37) % 120);
            return <line key={i} x1={x} y1={y} x2={x + ((i % 5) - 2) * 3} y2={y - 10 - (i % 4) * 4} />;
          })}
        </g>
      </svg>
    </div>
  );
}
