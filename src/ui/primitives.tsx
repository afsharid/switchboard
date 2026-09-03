import type { ReactNode } from 'react';

export function Card({ title, subtitle, right, children, className = '' }: {
  title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || right) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/** Stat tile: hero number, its unit, and one line of context. No plot, so no hover layer. */
export function Stat({ label, value, unit, context, tone = 'neutral' }: {
  label: string; value: string; unit?: string; context?: string;
  tone?: 'neutral' | 'good' | 'warning' | 'critical';
}) {
  const color =
    tone === 'good' ? 'var(--good-text)' : tone === 'warning' ? 'var(--warning-text)'
    : tone === 'critical' ? 'var(--critical-text)' : 'var(--ink)';
  return (
    <div className="card p-4">
      <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight tnum" style={{ color }}>{value}</span>
        {unit && <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>{unit}</span>}
      </div>
      {context && <div className="mt-1 text-xs leading-snug" style={{ color: 'var(--ink-2)' }}>{context}</div>}
    </div>
  );
}

/** Budget meter. Fill is a magnitude, so one hue; over-budget switches to a status colour + label. */
export function Meter({ value, max, over }: { value: number; max: number; over: boolean }) {
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--grid)' }}>
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(2, frac * 100)}%`, background: over ? 'var(--critical)' : 'var(--series-1)' }}
      />
    </div>
  );
}

export function Badge({ children, tone = 'neutral', title }: {
  children: ReactNode; tone?: 'neutral' | 'good' | 'warning' | 'critical' | 'info'; title?: string;
}) {
  // text uses the *-text steps so 11px labels clear 4.5:1 against the chip;
  // the chip fill keeps the status hue
  const map = {
    neutral: ['var(--ink-2)', 'rgba(255,255,255,0.06)'],
    info: ['var(--info-text)', 'rgba(57,135,229,0.14)'],
    good: ['var(--good-text)', 'rgba(12,163,12,0.14)'],
    warning: ['var(--warning-text)', 'rgba(250,178,25,0.14)'],
    critical: ['var(--critical-text)', 'rgba(208,59,59,0.16)'],
  } as const;
  const [fg, bg] = map[tone];
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ color: fg, background: bg }}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>{children}</p>;
}
