import { TONES } from '../lib/pests.js';

/** Small status pill used to label data provenance (simulated / live / failed...). */
export default function Badge({ tone = 'muted', title, children, className = '' }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
