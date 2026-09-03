import { useState } from 'react';
import { useSwitchboard, currentProjection, candidateProjection } from '../store/useSwitchboard';
import { Badge, Card, Empty, Meter, Stat } from '../ui/primitives';
import { BeforeAfterBars, CostLatencyScatter } from '../ui/charts';
import { chainOf, ms, pct, usd } from '../domain/cost';
import { checkCompliance, eligibleModels } from '../domain/compliance';
import { findWaste } from '../domain/waste';
import { seed } from '../data/initial';
import type { Model, TrafficClass } from '../domain/types';

const routedIds = (): string[] => {
  const s = useSwitchboard.getState();
  return s.policy.rules.flatMap(chainOf);
};

export function KpiRow() {
  const { classes, policy, models, totalBudgetUsd } = useSwitchboard();
  const proj = currentProjection();
  const providers = useSwitchboard((st) => st.providers);
  const violations = checkCompliance(classes, policy, models, {
    totalMonthlyBudgetUsd: totalBudgetUsd, providers,
  });
  const blockers = violations.filter((v) => v.severity === 'blocker').length;
  const waste = findWaste(classes, policy, models);
  const savings = waste.reduce((a, w) => a + (w.estimatedMonthlySavingsUsd ?? 0), 0);
  const over = proj.totalMonthlyCostUsd > totalBudgetUsd;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="Projected monthly spend"
        value={usd(proj.totalMonthlyCostUsd)}
        context={`against a $${totalBudgetUsd} declared cap`}
        tone={over ? 'critical' : 'neutral'}
      />
      <Stat
        label="Compliance blockers"
        value={String(blockers)}
        context={blockers ? 'routing is not permissible as configured' : 'policy satisfies every constraint'}
        tone={blockers ? 'critical' : 'good'}
      />
      <Stat
        label="Identified savings"
        value={savings > 0 ? usd(savings) : '—'}
        unit={savings > 0 ? '/mo' : undefined}
        context={`${waste.length} policy finding${waste.length === 1 ? '' : 's'}`}
        tone={savings > 0 ? 'warning' : 'neutral'}
      />
      <Stat
        label="Models measured"
        value={`${models.filter((m) => m.measured).length}/${models.length}`}
        context={`${seed.provenance.totalMeasuredCalls} real API calls, ${seed.provenance.measurementDate}`}
      />
    </div>
  );
}

export function SimulationBanner() {
  const { simulation, classes, setSimulation } = useSwitchboard();
  if (!simulation) return null;
  const before = currentProjection();
  const after = simulation.projection;
  const delta = after.totalMonthlyCostUsd - before.totalMonthlyCostUsd;
  const data = classes.map((c) => ({
    className: c.name.split(' ')[0] ?? c.id,
    before: Math.round((before.perClass.find((p) => p.classId === c.id)?.monthlyCostUsd ?? 0) * 100) / 100,
    after: Math.round((after.perClass.find((p) => p.classId === c.id)?.monthlyCostUsd ?? 0) * 100) / 100,
  }));

  return (
    <Card
      title={`Simulation — ${simulation.label}`}
      subtitle="Projected only. Nothing has been applied."
      right={
        <button onClick={() => setSimulation(null)}
          className="rounded px-2 py-1 text-xs hover:bg-white/5" style={{ color: 'var(--ink-muted)' }}>
          dismiss
        </button>
      }
      className="border-l-2"
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span className="tnum">{usd(before.totalMonthlyCostUsd)}/mo <span style={{ color: 'var(--ink-muted)' }}>live</span></span>
        <span aria-hidden style={{ color: 'var(--ink-muted)' }}>→</span>
        <span className="tnum font-semibold">{usd(after.totalMonthlyCostUsd)}/mo <span style={{ color: 'var(--ink-muted)' }}>candidate</span></span>
        <Badge tone={delta <= 0 ? 'good' : 'critical'}>
          {delta <= 0 ? '↓' : '↑'} {usd(Math.abs(delta))}/mo
        </Badge>
      </div>
      <BeforeAfterBars data={data} />
    </Card>
  );
}

export function ProposalsPanel() {
  const { proposals, decideProposal, providers } = useSwitchboard();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const pending = proposals.filter((p) => p.status === 'pending');
  const decided = proposals.filter((p) => p.status !== 'pending');

  return (
    <Card
      title="Approval queue"
      subtitle="Routing and budget changes are proposed by the agent and applied only here."
      right={pending.length > 0 ? <Badge tone="warning">{pending.length} awaiting you</Badge> : undefined}
    >
      {proposals.length === 0 && (
        <Empty>
          No proposals yet. Ask an agent to change routing and its proposal will land here for approval.
        </Empty>
      )}

      <div className="space-y-3">
        {pending.map((p) => {
          const before = p.projectionBefore?.totalMonthlyCostUsd ?? 0;
          const after = p.projectionAfter?.totalMonthlyCostUsd ?? null;
          return (
            <article key={p.id} className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{p.id} · {p.kind === 'policy' ? 'routing change' : 'budget change'}</span>
                <Badge tone="warning">pending</Badge>
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>{p.rationale}</p>

              {p.kind === 'policy' && p.rules && (
                <ul className="mt-2 space-y-1 text-[11px]">
                  {p.rules.map((r) => (
                    <li key={r.classId} className="tnum">
                      <span style={{ color: 'var(--ink-muted)' }}>{r.classId}</span>{' '}
                      → {r.primaryModelId}
                      {r.fallbackModelIds.length > 0 && (
                        <span style={{ color: 'var(--ink-muted)' }}> → {r.fallbackModelIds.join(' → ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {p.kind === 'budget' && (
                <p className="mt-2 text-[11px] tnum">
                  {p.scope === 'total'
                    ? 'Total monthly cap'
                    : providers.find((x) => x.id === p.providerId)?.name ?? p.providerId}{' '}
                  → ${p.monthlyBudgetUsd}
                </p>
              )}
              {after !== null && (
                <p className="mt-2 text-xs tnum">
                  {usd(before)}/mo → <strong>{usd(after)}/mo</strong>{' '}
                  <span style={{ color: after <= before ? 'var(--good-text)' : 'var(--critical-text)' }}>
                    ({after <= before ? '−' : '+'}{usd(Math.abs(after - before))})
                  </span>
                </p>
              )}

              <input
                value={notes[p.id] ?? ''}
                onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })}
                placeholder="Optional note — the agent reads this and can correct itself"
                className="mt-3 w-full rounded border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-[--ink-muted] focus:border-white/25"
                style={{ borderColor: 'var(--hairline)' }}
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => decideProposal(p.id, 'approved', notes[p.id]?.trim() || null)}
                  className="rounded px-3 py-1.5 text-xs font-medium text-black"
                  style={{ background: 'var(--good)' }}
                >
                  Approve &amp; apply
                </button>
                <button
                  onClick={() => decideProposal(p.id, 'rejected', notes[p.id]?.trim() || null)}
                  className="rounded border px-3 py-1.5 text-xs font-medium"
                  style={{ borderColor: 'var(--critical)', color: 'var(--critical-text)' }}
                >
                  Reject
                </button>
              </div>
            </article>
          );
        })}

        {decided.length > 0 && (
          <ul className="space-y-1 pt-1 text-[11px]">
            {decided.map((p) => (
              <li key={p.id} className="flex items-start gap-2">
                <Badge tone={p.status === 'approved' ? 'good' : p.status === 'withdrawn' ? 'neutral' : 'critical'}>
                  {p.status}
                </Badge>
                <span style={{ color: 'var(--ink-muted)' }}>
                  {p.id}
                  {p.decisionNote ? ` — “${p.decisionNote}”` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ConstraintEditor({ cls }: { cls: TrafficClass }) {
  const setClassConstraint = useSwitchboard((s) => s.setClassConstraint);
  const models = useSwitchboard((s) => s.models);
  const c = cls.constraints;
  const eligible = eligibleModels(cls, models).length;

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] select-none" style={{ color: 'var(--ink-muted)' }}>
        relax constraints ({eligible} model{eligible === 1 ? '' : 's'} eligible)
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded p-2 text-[11px]"
        style={{ background: 'var(--plane)' }}>
        <label className="flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
          <input
            type="checkbox" checked={c.requireQualityGates}
            onChange={(e) => setClassConstraint(cls.id, 'requireQualityGates', e.target.checked)}
          />
          require quality gates
        </label>
        <label className="flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
          <input
            type="checkbox" checked={!c.allowTrainingOnData}
            onChange={(e) => setClassConstraint(cls.id, 'allowTrainingOnData', !e.target.checked)}
          />
          forbid training on data
        </label>
        <label className="flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
          max retention
          <select
            value={c.maxDataRetentionDays === null ? 'none' : String(c.maxDataRetentionDays)}
            onChange={(e) =>
              setClassConstraint(cls.id, 'maxDataRetentionDays',
                e.target.value === 'none' ? null : Number(e.target.value))}
            className="rounded border bg-transparent px-1 py-0.5 text-[11px]"
            style={{ borderColor: 'var(--hairline)', color: 'var(--ink)' }}
          >
            <option value="0" style={{ background: 'var(--surface-1)' }}>0 days</option>
            <option value="7" style={{ background: 'var(--surface-1)' }}>7 days</option>
            <option value="30" style={{ background: 'var(--surface-1)' }}>30 days</option>
            <option value="none" style={{ background: 'var(--surface-1)' }}>no limit</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
          p95 ceiling
          <select
            value={c.maxP95Ms === null ? 'none' : String(c.maxP95Ms)}
            onChange={(e) =>
              setClassConstraint(cls.id, 'maxP95Ms', e.target.value === 'none' ? null : Number(e.target.value))}
            className="rounded border bg-transparent px-1 py-0.5 text-[11px]"
            style={{ borderColor: 'var(--hairline)', color: 'var(--ink)' }}
          >
            <option value="2000" style={{ background: 'var(--surface-1)' }}>2s</option>
            <option value="4000" style={{ background: 'var(--surface-1)' }}>4s</option>
            <option value="8000" style={{ background: 'var(--surface-1)' }}>8s</option>
            <option value="none" style={{ background: 'var(--surface-1)' }}>no limit</option>
          </select>
        </label>
        <p className="w-full leading-snug" style={{ color: 'var(--ink-muted)' }}>
          No agent tool can change these. Deciding which risk to accept is yours.
        </p>
      </div>
    </details>
  );
}

export function ClassesPanel() {
  const { classes, policy, models, setClassVolume } = useSwitchboard();
  const proj = currentProjection();

  return (
    <Card
      title="Traffic classes"
      subtitle="Constraints are the routing problem. Volumes are declared by you and editable — nothing here is measured."
    >
      <div className="space-y-3">
        {classes.map((c) => {
          const rule = policy.rules.find((r) => r.classId === c.id);
          const p = proj.perClass.find((x) => x.classId === c.id);
          const vs = checkCompliance([c], policy, models, { totalMonthlyBudgetUsd: null });
          const blockers = vs.filter((v) => v.severity === 'blocker');
          return (
            <article key={c.id} className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold">{c.name}</h3>
                  <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>{c.description}</p>
                </div>
                {blockers.length > 0
                  ? <Badge tone="critical" title={blockers.map((b) => b.message).join('\n')}>⚠ {blockers.length} blocker{blockers.length > 1 ? 's' : ''}</Badge>
                  : <Badge tone="good">✓ compliant</Badge>}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.constraints.maxP95Ms !== null && <Badge>p95 ≤ {ms(c.constraints.maxP95Ms)}</Badge>}
                {c.constraints.minSuccessRate !== null && <Badge>success ≥ {pct(c.constraints.minSuccessRate)}</Badge>}
                {c.constraints.requireQualityGates && <Badge>quality gates required</Badge>}
                {c.constraints.maxDataRetentionDays !== null && (
                  <Badge tone="info">retention ≤ {c.constraints.maxDataRetentionDays}d</Badge>
                )}
                {!c.constraints.allowTrainingOnData && <Badge tone="info">no training on data</Badge>}
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tnum">
                <label className="flex items-center gap-1.5" style={{ color: 'var(--ink-muted)' }}>
                  monthly calls
                  <input
                    type="number" min={0} step={1000} value={c.monthlyCalls}
                    onChange={(e) => setClassVolume(c.id, Number(e.target.value))}
                    className="w-28 rounded border bg-transparent px-1.5 py-0.5 text-right text-[11px] tnum outline-none focus:border-white/25"
                    style={{ borderColor: 'var(--hairline)', color: 'var(--ink)' }}
                  />
                </label>
                <span style={{ color: 'var(--ink-2)' }}>{usd(p?.monthlyCostUsd ?? 0)}/mo</span>
                <span style={{ color: 'var(--ink-muted)' }}>delivers {pct(p?.deliveredRate ?? 0)}</span>
                <span
                  style={{ color: 'var(--ink-muted)' }}
                  title={
                    (p?.tailRiskProbability ?? 0) > 0
                      ? `Sum of p95 across the whole chain. Reached in the ${pct(p?.tailRiskProbability ?? 0)} of calls where the primary fails.`
                      : 'p95 of the only model in this chain.'
                  }
                >
                  worst case {ms(p?.worstCaseLatencyMs ?? 0)}
                  {(p?.tailRiskProbability ?? 0) > 0 && (p?.chain.length ?? 0) > 1 && (
                    <span> at {pct(p?.tailRiskProbability ?? 0)} risk</span>
                  )}
                </span>
              </div>

              <p className="mt-2 text-[11px] tnum" style={{ color: 'var(--ink-2)' }}>
                {rule ? [rule.primaryModelId, ...rule.fallbackModelIds].join('  →  ') : 'no rule'}
              </p>

              <ConstraintEditor cls={c} />
            </article>
          );
        })}
      </div>
    </Card>
  );
}

export function ProvidersPanel() {
  const { providers, totalBudgetUsd, setTotalBudget } = useSwitchboard();
  const proj = currentProjection();
  return (
    <Card title="Providers" subtitle="Budget caps are spending authorisations — only you can change them.">
      <label className="mb-3 flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        total monthly cap
        <input
          type="number" min={0} value={totalBudgetUsd}
          onChange={(e) => setTotalBudget(Number(e.target.value))}
          className="w-20 rounded border bg-transparent px-1.5 py-0.5 text-right text-[11px] tnum outline-none focus:border-white/25"
          style={{ borderColor: 'var(--hairline)', color: 'var(--ink)' }}
        />
      </label>
      <ul className="space-y-2.5">
        {providers.map((pr) => {
          const spend = proj.perProviderUsd[pr.id] ?? 0;
          const over = spend > pr.monthlyBudgetUsd;
          return (
            <li key={pr.id}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span>{pr.name}</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="tnum" style={{ color: over ? 'var(--critical-text)' : 'var(--ink-2)' }}>
                    {usd(spend)} / ${pr.monthlyBudgetUsd}
                  </span>
                  {over && <Badge tone="critical" title="projected spend exceeds this cap">⚠ over</Badge>}
                </span>
              </div>
              <div className="mt-1"><Meter value={spend} max={pr.monthlyBudgetUsd} over={over} /></div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function WastePanel() {
  const { classes, policy, models } = useSwitchboard();
  const findings = findWaste(classes, policy, models);
  return (
    <Card title="Policy findings" subtitle="Tagged by kind: spend is money, risk is fragility, hygiene is a data gap.">
      {findings.length === 0 && <Empty>No waste detected under the current policy.</Empty>}
      <ul className="space-y-2.5">
        {findings.map((f) => (
          <li key={f.code}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-xs font-medium leading-snug">{f.title}</h3>
              <span className="flex shrink-0 items-center gap-1">
                <Badge
                  tone={f.kind === 'spend' ? 'warning' : f.kind === 'risk' ? 'critical' : 'neutral'}
                  title={
                    f.kind === 'spend' ? 'money is being wasted now'
                      : f.kind === 'risk' ? 'a fragility, not a cost'
                        : 'a gap in the data, not a cost'
                  }
                >
                  {f.kind}
                </Badge>
                {f.estimatedMonthlySavingsUsd !== null && (
                  <Badge tone="warning">{usd(f.estimatedMonthlySavingsUsd)}/mo</Badge>
                )}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>{f.detail}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ModelsPanel() {
  const { models } = useSwitchboard();
  const [showAll, setShowAll] = useState(false);
  const routed = routedIds();
  const sorted = [...models].sort((a, b) => {
    const ca = a.measured?.costPer1kSuccessfulUsd ?? Infinity;
    const cb = b.measured?.costPer1kSuccessfulUsd ?? Infinity;
    return ca - cb;
  });
  const rows = showAll ? sorted : sorted.slice(0, 12);

  return (
    <Card
      title="Model catalogue"
      subtitle="Prices from provider docs. Latency, success and cost-per-delivered are this operator's own measurements."
      right={
        <button onClick={() => setShowAll(!showAll)} className="rounded px-2 py-1 text-xs hover:bg-white/5"
          style={{ color: 'var(--ink-muted)' }}>
          {showAll ? 'show top 12' : `show all ${models.length}`}
        </button>
      }
    >
      <CostLatencyScatter models={models} highlightIds={routed} />

      {/* Below md the table would need 640px in a ~390px column. It did
          scroll horizontally, but with no scrollbar affordance in a narrow
          panel nobody discovers that — the first person to open this in
          ChatGPT's 447px side browser reported the right-hand columns as
          simply clipped. Same data, one block per model, no scrolling. */}
      <ul className="mt-4 space-y-2 md:hidden">
        {rows.map((m: Model) => (
          <li key={m.id} className="rounded-lg p-2.5" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-xs ${routed.includes(m.id) ? 'font-semibold' : 'font-medium'}`}>
                {m.displayName}
              </span>
              {routed.includes(m.id) && <Badge tone="info" title="routed by the live policy">routed</Badge>}
            </div>
            <div className="mt-1 text-[11px] tnum" style={{ color: 'var(--ink-2)' }}>
              ${m.inputUsdPerM.toFixed(2)} in / ${m.outputUsdPerM.toFixed(2)} out per Mtok
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] tnum" style={{ color: 'var(--ink-muted)' }}>
              {m.measured ? (
                <>
                  <span>{pct(m.measured.requestSuccessRate)} success</span>
                  {m.measured.p95LatencyMs > 0 && <span>p95 {ms(m.measured.p95LatencyMs)}</span>}
                  {m.measured.costPer1kSuccessfulUsd
                    ? <span>{usd(m.measured.costPer1kSuccessfulUsd)} per 1k delivered</span>
                    : null}
                </>
              ) : (
                <span>no measurements</span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {m.measured?.meetsQualityGates && <Badge tone="good">✓ gates</Badge>}
              {m.measured && m.measured.requestSuccessRate === 0 && <Badge tone="critical">✕ unavailable</Badge>}
              {!m.measured && <Badge>unmeasured</Badge>}
              {m.dataRetentionDays === 0 && <Badge tone="info">0d retention</Badge>}
              {m.dataRetentionDays !== null && m.dataRetentionDays > 0 && (
                <Badge tone="warning">⚠ {m.dataRetentionDays}d retention</Badge>
              )}
              {m.trainsOnData === true && <Badge tone="critical">⚠ trains on data</Badge>}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 -mx-1 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left text-[11px]">
          <thead style={{ color: 'var(--ink-muted)' }}>
            <tr className="border-b" style={{ borderColor: 'var(--hairline)' }}>
              <th className="py-1.5 pr-2 font-medium">Model</th>
              <th className="py-1.5 pr-2 text-right font-medium">in $/M</th>
              <th className="py-1.5 pr-2 text-right font-medium">out $/M</th>
              <th className="py-1.5 pr-2 text-right font-medium">success</th>
              <th className="py-1.5 pr-2 text-right font-medium">p95</th>
              <th className="py-1.5 pr-2 text-right font-medium">$/1k ok</th>
              <th className="py-1.5 pr-2 font-medium">governance</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {rows.map((m: Model) => (
              <tr key={m.id} className="border-b last:border-0" style={{ borderColor: 'var(--hairline)' }}>
                <td className="py-1.5 pr-2">
                  <span className={routed.includes(m.id) ? 'font-medium' : ''}>{m.displayName}</span>
                  {routed.includes(m.id) && <Badge tone="info" title="routed by the live policy">routed</Badge>}
                </td>
                <td className="py-1.5 pr-2 text-right">{m.inputUsdPerM.toFixed(2)}</td>
                <td className="py-1.5 pr-2 text-right">{m.outputUsdPerM.toFixed(2)}</td>
                <td className="py-1.5 pr-2 text-right">
                  {m.measured ? pct(m.measured.requestSuccessRate) : <span style={{ color: 'var(--ink-muted)' }}>—</span>}
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {m.measured && m.measured.p95LatencyMs > 0 ? ms(m.measured.p95LatencyMs) : <span style={{ color: 'var(--ink-muted)' }}>—</span>}
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {m.measured?.costPer1kSuccessfulUsd
                    ? usd(m.measured.costPer1kSuccessfulUsd)
                    : <span style={{ color: 'var(--ink-muted)' }}>—</span>}
                </td>
                <td className="py-1.5 pr-2">
                  <span className="flex flex-wrap gap-1">
                    {m.measured?.meetsQualityGates && <Badge tone="good">✓ gates</Badge>}
                    {m.measured && m.measured.requestSuccessRate === 0 && <Badge tone="critical">✕ unavailable</Badge>}
                    {!m.measured && <Badge>unmeasured</Badge>}
                    {m.dataRetentionDays === 0 && <Badge tone="info">0d retention</Badge>}
                    {m.dataRetentionDays !== null && m.dataRetentionDays > 0 && <Badge tone="warning">⚠ {m.dataRetentionDays}d retention</Badge>}
                    {m.trainsOnData === true && <Badge tone="critical">⚠ trains on data</Badge>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function InsightsPanel() {
  const { insights } = useSwitchboard();
  if (insights.length === 0) return null;
  return (
    <Card title="Pinned by the agent" subtitle="Notes need no approval — they spend nothing and route nothing.">
      <ul className="space-y-2.5">
        {insights.map((i) => (
          <li key={i.id}>
            <h3 className="text-xs font-medium">{i.title}</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>{i.body}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ActivityPanel() {
  const { activity } = useSwitchboard();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title="Agent activity" subtitle="Every tool call an agent has made on this page.">
      {activity.length === 0 && <Empty>Nothing yet. Tool calls appear here the moment an agent makes one.</Empty>}
      <ul className="space-y-1">
        {activity.slice(0, 40).map((a) => (
          <li key={a.id}>
            <button
              onClick={() => setOpen(open === a.id ? null : a.id)}
              className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left text-[11px] hover:bg-white/5"
            >
              <span style={{ color: a.ok ? 'var(--good-text)' : 'var(--critical-text)' }}>{a.ok ? '●' : '▲'}</span>
              <span className="font-medium">{a.tool}</span>
              <span className="ml-auto tnum" style={{ color: 'var(--ink-muted)' }}>
                {a.durationMs < 1 ? '<1ms' : `${a.durationMs}ms`}
              </span>
            </button>
            {open === a.id && (
              <div className="mb-1 ml-4 space-y-1">
                <pre className="rounded p-2 text-[10px] leading-tight whitespace-pre-wrap break-words"
                  style={{ background: 'var(--surface-2)', color: 'var(--ink-muted)' }}>
{JSON.stringify(a.args, null, 2)}
                </pre>
                <pre className="max-h-40 overflow-auto rounded p-2 text-[10px] leading-tight whitespace-pre-wrap break-words"
                  style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
{a.result}
                </pre>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ProvenanceFooter() {
  return (
    <footer className="px-1 pb-8 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
      <p>{seed.provenance.summary}</p>
      <p className="mt-1">{seed.provenance.caveat}</p>
      <p className="mt-1">
        Declared volumes, budget caps and traffic-class constraints are operator inputs, editable above — they are
        not measurements. Projections are derived from them.
      </p>
    </footer>
  );
}

export { candidateProjection };
