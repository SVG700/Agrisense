/**
 * App-wide interaction polish, implemented with ONE delegated listener each
 * (no per-card handlers):
 *   - card spotlight: a soft glow follows the pointer over any `.card`
 *   - button ripple: a ripple spreads from the press point on any `.btn`
 *   - scroll progress bar and a back-to-top button
 * Everything is skipped when the user prefers reduced motion.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { EASE } from '../lib/motion.jsx';

export function InteractionEffects() {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return undefined;
    let current = null;
    let frame = 0;
    let last = null;

    const onMove = (e) => {
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const card = last.target instanceof Element ? last.target.closest('.card') : null;
        if (card !== current) {
          current?.classList.remove('is-spotlit');
          card?.classList.add('is-spotlit');
          current = card;
        }
        if (card) {
          const r = card.getBoundingClientRect();
          card.style.setProperty('--mx', `${last.clientX - r.left}px`);
          card.style.setProperty('--my', `${last.clientY - r.top}px`);
        }
      });
    };
    const onLeave = () => {
      current?.classList.remove('is-spotlit');
      current = null;
    };
    const onDown = (e) => {
      const btn = e.target instanceof Element ? e.target.closest('.btn') : null;
      if (!btn || btn.disabled) return;
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - r.left}px`;
      ripple.style.top = `${e.clientY - r.top}px`;
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
      btn.appendChild(ripple);
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      onLeave();
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [reduce]);

  return null;
}

/** Thin gradient bar showing how far down the page you are. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 180, damping: 30, mass: 0.4 });
  return (
    <motion.div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-40 h-0.5 origin-left bg-gradient-to-r from-emerald-400 via-lime-300 to-emerald-400"
      style={{ scaleX }}
    />
  );
}

/** Appears after scrolling down; smooth-scrolls back to the top. */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed bottom-6 right-6 z-40"
          initial={{ opacity: 0, y: 16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.9 }}
          transition={{ duration: 0.3, ease: EASE }}
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.92 }}
        >
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="btn btn-primary h-11 w-11 rounded-full p-0 shadow-xl"
            aria-label="Back to top"
            title="Back to top"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
