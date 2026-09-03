import type { ClassProjection, Model, Policy, Projection, Rule, TrafficClass } from './types';

export const byId = <T extends { id: string }>(xs: T[]): Map<string, T> =>
  new Map(xs.map((x) => [x.id, x]));

/** Cost of a single attempt against one model, at this class's token profile. */
export function costPerAttemptUsd(m: Model, avgIn: number, avgOut: number): number {
  return (avgIn / 1e6) * m.inputUsdPerM + (avgOut / 1e6) * m.outputUsdPerM;
}

/** Success probability of one attempt. Unmeasured models are treated as unknown → 0. */
export function successRate(m: Model): number {
  return m.measured ? m.measured.requestSuccessRate : 0;
}

export function chainOf(rule: Rule): string[] {
  return [rule.primaryModelId, ...rule.fallbackModelIds].filter(Boolean);
}

/**
 * Walks the fallback chain. Every attempt costs money whether or not it
 * succeeds, so cost accumulates weighted by the probability of reaching that
 * link. Delivery stops at the first success.
 */
export function projectClass(
  cls: TrafficClass,
  rule: Rule | undefined,
  models: Map<string, Model>,
): ClassProjection {
  const chain = rule ? chainOf(rule) : [];
  let reach = 1;
  let costPerCall = 0;
  let expectedLatency = 0;
  let worstCase = 0;
  let failAll = 1;

  let tailRisk = 0;
  let link = 0;

  for (const id of chain) {
    const m = models.get(id);
    if (!m) continue;
    costPerCall += reach * costPerAttemptUsd(m, cls.avgInputTokens, cls.avgOutputTokens);
    const p50 = m.measured?.medianLatencyMs ?? 0;
    const p95 = m.measured?.p95LatencyMs ?? 0;
    expectedLatency += reach * p50;
    // Worst case means worst case: if the primary fails you pay its latency
    // AND the fallback's. Summing the whole chain unconditionally, with the
    // probability of getting past the primary reported separately, so the
    // number never understates the tail and the reader can weigh it.
    worstCase += p95;
    if (link === 0) tailRisk = 1 - successRate(m);
    link += 1;
    const s = successRate(m);
    failAll *= 1 - s;
    reach *= 1 - s;
  }

  const deliveredRate = 1 - failAll;
  const monthlyCostUsd = costPerCall * cls.monthlyCalls;
  const deliveredPerMonth = cls.monthlyCalls * deliveredRate;

  return {
    classId: cls.id,
    chain,
    monthlyCostUsd,
    deliveredRate,
    costPerDeliveredUsd: deliveredRate > 0 ? costPerCall / deliveredRate : Infinity,
    expectedLatencyMs: Math.round(expectedLatency),
    worstCaseLatencyMs: Math.round(worstCase),
    tailRiskProbability: tailRisk,
    deliveredPerMonth,
  };
}

export function project(
  classes: TrafficClass[],
  policy: Policy,
  modelList: Model[],
): Projection {
  const models = byId(modelList);
  const ruleFor = new Map(policy.rules.map((r) => [r.classId, r]));
  const perClass = classes.map((c) => projectClass(c, ruleFor.get(c.id), models));

  const perProviderUsd: Record<string, number> = {};
  for (const c of classes) {
    const rule = ruleFor.get(c.id);
    if (!rule) continue;
    let reach = 1;
    for (const id of chainOf(rule)) {
      const m = models.get(id);
      if (!m) continue;
      const spend = reach * costPerAttemptUsd(m, c.avgInputTokens, c.avgOutputTokens) * c.monthlyCalls;
      perProviderUsd[m.providerId] = (perProviderUsd[m.providerId] ?? 0) + spend;
      reach *= 1 - successRate(m);
    }
  }

  return {
    totalMonthlyCostUsd: perClass.reduce((a, p) => a + p.monthlyCostUsd, 0),
    perClass,
    perProviderUsd,
  };
}

/** Money for display. Precision scales with magnitude; thousands are grouped. */
export const usd = (n: number): string => {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '$0';
  const abs = Math.abs(n);
  const dp = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};

export const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;
export const ms = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
