/**
 * Shared motion vocabulary (Framer Motion). Keep durations 200-600ms with a
 * soft ease-out; group entrances are staggered. <MotionConfig reducedMotion="user">
 * in App disables transform animations for users who prefer reduced motion.
 */
import { useEffect, useId, useMemo, useRef } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';

export const EASE = [0.22, 1, 0.36, 1];

/** Container that staggers its <Item> children. */
export const staggerContainer = (stagger = 0.06, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

/** Fade + rise; the default entrance for cards. */
export const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

export function Stagger({ as = 'div', stagger, delay, className, children, ...rest }) {
  const Comp = motion[as];
  return (
    <Comp variants={staggerContainer(stagger, delay)} initial="hidden" animate="show" className={className} {...rest}>
      {children}
    </Comp>
  );
}

export function Item({ as = 'div', className, children, ...rest }) {
  const Comp = motion[as];
  return (
    <Comp variants={fadeUp} className={className} {...rest}>
      {children}
    </Comp>
  );
}

/** Page-level transition between dashboard views. */
export const pageTransition = {
  initial: { opacity: 0, y: 12, filter: 'blur(4px)' },
  // transitionEnd clears the filter: any CSS filter changes how position:fixed children
  // (e.g. map popovers) are laid out, so none may remain once the page has settled.
  animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.4, ease: EASE }, transitionEnd: { filter: 'none' } },
  exit: { opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.2, ease: EASE } },
};

/**
 * Counts from the previous value to the new one (from 0 on first mount).
 * Non-numeric values (e.g. "—", "Not counted") render as-is.
 */
export function AnimatedNumber({ value, decimals = 0, suffix = '', duration = 0.8, grouping = false }) {
  const ref = useRef(null);
  const prev = useRef(0);
  const reduce = useReducedMotion();
  const numeric = typeof value === 'number' && Number.isFinite(value);
  // grouping: Indian digit grouping (e.g. 2,50,000) for money
  const format = (n) =>
    `${grouping ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n) : n.toFixed(decimals)}${suffix}`;

  useEffect(() => {
    if (!numeric || !ref.current) return undefined;
    const from = prev.current;
    prev.current = value;
    if (reduce || from === value) {
      ref.current.textContent = format(value);
      return undefined;
    }
    const controls = animate(from, value, {
      duration,
      ease: EASE,
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = format(v);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, numeric, reduce, decimals, suffix, duration, grouping]);

  if (!numeric) return <span>{value}</span>;
  // Final value is rendered immediately (SSR/tests/reduced-motion); the effect animates the text in place.
  return <span ref={ref}>{format(reduce ? value : prev.current === value ? value : prev.current)}</span>;
}

/* ------------------------------------------------------------------------- */
/* Scroll-driven and interactive helpers                                      */
/* ------------------------------------------------------------------------- */

/** Fades + rises content into view the first time it scrolls on screen. */
export function Reveal({ as = 'div', delay = 0, y = 24, className, children, ...rest }) {
  const Comp = motion[as];
  return (
    <Comp
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.55, ease: EASE, delay }}
      className={className}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/**
 * Headline that reveals word by word. The full text stays available to
 * assistive tech via aria-label; the animated words are aria-hidden.
 */
export function WordReveal({ text, as = 'span', className, wordClassName = '', delay = 0, stagger = 0.05 }) {
  const Comp = motion[as];
  const words = String(text).split(' ');
  return (
    <Comp
      key={text}
      className={className}
      aria-label={text}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
    >
      {words.map((w, i) => (
        <motion.span
          key={`${w}-${i}`}
          aria-hidden="true"
          // Per-word classes: effects like background-clip:text can't reach through
          // the transformed/filtered word spans from the parent.
          className={`inline-block ${wordClassName}`}
          variants={{
            hidden: { opacity: 0, y: '0.45em', filter: 'blur(6px)' },
            show: {
              opacity: 1,
              y: 0,
              filter: 'blur(0px)',
              transition: { duration: 0.5, ease: EASE },
              transitionEnd: { filter: 'none' },
            },
          }}
        >
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </Comp>
  );
}

/**
 * Subtle 3D tilt that follows the pointer (max ~5deg) with a spring return.
 * Returns props to spread on a motion element. Disabled for reduced motion.
 */
export function useTilt(max = 5) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { stiffness: 260, damping: 22, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [0, 1], [max, -max]), spring);
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), spring);
  if (reduce) return {};
  return {
    style: { rotateX, rotateY, transformPerspective: 900 },
    onPointerMove: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      px.set((e.clientX - r.left) / r.width);
      py.set((e.clientY - r.top) / r.height);
    },
    onPointerLeave: () => {
      px.set(0.5);
      py.set(0.5);
    },
  };
}

/**
 * Tiny trend line drawn from real values. The stroke draws itself in and the
 * area fades up; it re-draws when a new point arrives.
 */
export function Sparkline({ values, color = '#34d399', height = 32, className = '' }) {
  const id = useId().replace(/:/g, '');
  const pts = useMemo(() => values.filter((v) => typeof v === 'number' && Number.isFinite(v)).slice(-20), [values]);
  if (pts.length < 2) return <div style={{ height }} className={className} aria-hidden="true" />;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const W = 100;
  const H = 30;
  const coords = pts.map((v, i) => [(i / (pts.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 6)]);
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const signature = pts.join(',');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} style={{ height, width: '100%' }} aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        key={`a-${signature}`}
        d={area}
        fill={`url(#spark-${id})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.3 }}
      />
      <motion.path
        key={`l-${signature}`}
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: EASE }}
      />
    </svg>
  );
}

/**
 * Liquid + magnetic button behaviour: the ::before fill (CSS .liquid) pours in
 * from the pointer, and the button leans toward the cursor on a spring.
 * Spread the returned props on a motion element. Off for reduced motion.
 */
export function useLiquid(strength = 0.18) {
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 300, damping: 20, mass: 0.5 });
  const y = useSpring(0, { stiffness: 300, damping: 20, mass: 0.5 });
  if (reduce) return { className: 'liquid' };
  return {
    className: 'liquid',
    style: { x, y },
    onPointerMove: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty('--px', `${e.clientX - r.left}px`);
      e.currentTarget.style.setProperty('--py', `${e.clientY - r.top}px`);
      x.set((e.clientX - r.left - r.width / 2) * strength);
      y.set((e.clientY - r.top - r.height / 2) * strength);
    },
    onPointerLeave: () => {
      x.set(0);
      y.set(0);
    },
  };
}
