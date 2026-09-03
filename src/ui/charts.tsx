import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import type { Model } from '../domain/types';
import { usd } from '../domain/cost';

const INK = '#ffffff';
const INK2 = '#c3c2b7';
const MUTED = '#898781';
const S1 = '#3987e5';
const S2 = '#d95926';
const SURFACE = '#1a1a19';

const tipStyle: React.CSSProperties = {
  background: SURFACE,
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
  fontSize: 12,
  padding: '8px 10px',
  color: INK,
};

/**
 * Cost per 1000 delivered outputs against measured p95 latency, one dot per
 * model. Identity is gate-pass vs gate-fail: two validated categorical slots,
 * reinforced by marker shape and a legend, so hue never carries it alone.
 * Models that never returned a success have no latency or cost to plot and are
 * reported as a count instead of as dots at the origin.
 */
export function CostLatencyScatter({ models, highlightIds }: { models: Model[]; highlightIds: string[] }) {
  const plottable = models.filter(
    (m) => m.measured && m.measured.requestSuccessRate > 0 && (m.measured.costPer1kSuccessfulUsd ?? 0) > 0,
  );
  const dead = models.filter((m) => m.measured && m.measured.requestSuccessRate === 0).length;
  const unmeasured = models.filter((m) => !m.measured).length;

  const toPoint = (m: Model) => ({
    x: m.measured!.costPer1kSuccessfulUsd!,
    y: m.measured!.p95LatencyMs,
    z: Math.round(m.measured!.requestSuccessRate * 100),
    name: m.displayName,
    id: m.id,
    routed: highlightIds.includes(m.id),
  });

  const passes = plottable.filter((m) => m.measured!.meetsQualityGates).map(toPoint);
  const fails = plottable.filter((m) => !m.measured!.meetsQualityGates).map(toPoint);

  return (
    <div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 8 }}>
            <CartesianGrid strokeDasharray="0" vertical={false} />
            <XAxis
              type="number" dataKey="x" scale="log" domain={['auto', 'auto']}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              label={{ value: 'cost per 1k delivered outputs (log)', position: 'insideBottom', offset: -18, fill: MUTED, fontSize: 11 }}
            />
            <YAxis
              type="number" dataKey="y"
              tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}s`}
              label={{ value: 'p95 latency', angle: -90, position: 'insideLeft', fill: MUTED, fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="z" range={[64, 260]} />
            <Tooltip
              contentStyle={tipStyle}
              formatter={(_v, _n, p: any) => [
                `${usd(p.payload.x)} / 1k · p95 ${(p.payload.y / 1000).toFixed(1)}s · ${p.payload.z}% success`,
                p.payload.name,
              ]}
              labelFormatter={() => ''}
            />
            {/* Fixed order, and each swatch is the mark's own shape, so identity
                never rests on hue alone. Recharts' auto legend renders dots for
                every series and does not preserve declaration order here. */}
            <Legend
              verticalAlign="top" align="left" height={24}
              content={() => (
                <ul className="flex gap-4 text-[11px]" style={{ color: INK2, listStyle: 'none', margin: 0, padding: 0 }}>
                  <li className="flex items-center gap-1.5">
                    <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4.5" fill={S1} /></svg>
                    passes quality gates ({passes.length})
                  </li>
                  <li className="flex items-center gap-1.5">
                    <svg width="10" height="10" aria-hidden><polygon points="5,0.5 9.5,9.5 0.5,9.5" fill={S2} /></svg>
                    fails quality gates ({fails.length})
                  </li>
                </ul>
              )}
            />
            <Scatter name="passes quality gates" data={passes} fill={S1} shape="circle" legendType="circle">
              {passes.map((p) => (
                <Cell key={p.id} fill={S1} stroke={SURFACE} strokeWidth={2} />
              ))}
            </Scatter>
            <Scatter name="fails quality gates" data={fails} fill={S2} shape="triangle" legendType="triangle">
              {fails.map((p) => (
                <Cell key={p.id} fill={p.routed ? S2 : 'transparent'} stroke={S2} strokeWidth={2} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
        Dot area is success rate. Down and to the left is better. Filled triangles are models the live policy
        routes to. {dead} model{dead === 1 ? '' : 's'} returned zero successes and {unmeasured} have no
        measurements, so neither can be plotted.
      </p>
    </div>
  );
}

/**
 * Per-class monthly cost, live policy against the candidate on screen.
 * Two series, validated adjacent slots, legend always present.
 */
export function BeforeAfterBars({ data }: {
  data: { className: string; before: number; after: number }[];
}) {
  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }} barGap={2}>
          <CartesianGrid strokeDasharray="0" vertical={false} />
          <XAxis dataKey="className" tickLine={false} />
          <YAxis tickFormatter={(v: number) => `$${v}`} />
          <Tooltip
            contentStyle={tipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            formatter={(v, n) => [usd(Number(v ?? 0)), n === 'before' ? 'live policy' : 'candidate']}
          />
          <Legend verticalAlign="top" align="left" height={24}
            wrapperStyle={{ fontSize: 11, color: INK2 }} iconSize={8}
            formatter={(v) => (v === 'before' ? 'live policy' : 'candidate')} />
          <Bar dataKey="before" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="after" fill={S2} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
