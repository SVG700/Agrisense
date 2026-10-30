/**
 * Shared motion vocabulary (Framer Motion). Keep durations 200-600ms with a
 * soft ease-out; group entrances are staggered. <MotionConfig reducedMotion="user">
 * in App disables transform animations for users who prefer reduced motion.
 */
import { useEffect, useRef } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';

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
  animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.4, ease: EASE } },
  exit: { opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.2, ease: EASE } },
};

/**
 * Counts from the previous value to the new one (from 0 on first mount).
 * Non-numeric values (e.g. "—", "Not counted") render as-is.
 */
export function AnimatedNumber({ value, decimals = 0, suffix = '', duration = 0.8 }) {
  const ref = useRef(null);
  const prev = useRef(0);
  const reduce = useReducedMotion();
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const format = (n) => `${n.toFixed(decimals)}${suffix}`;

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
  }, [value, numeric, reduce, decimals, suffix, duration]);

  if (!numeric) return <span>{value}</span>;
  // Final value is rendered immediately (SSR/tests/reduced-motion); the effect animates the text in place.
  return <span ref={ref}>{format(reduce ? value : prev.current === value ? value : prev.current)}</span>;
}
