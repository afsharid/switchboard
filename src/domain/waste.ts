import type { Model, Policy, TrafficClass, WasteFinding } from './types';
import { byId, chainOf, costPerAttemptUsd, projectClass, successRate } from './cost';
import { eligibleModels } from './compliance';

/**
 * Detectors over measured behaviour. Every finding must be traceable to a
 * number in the seed data — no heuristics dressed up as insight.
 */
export function findWaste(
  classes: TrafficClass[],
  policy: Policy,
  modelList: Model[],
): WasteFinding[] {
  const models = byId(modelList);
  const ruleFor = new Map(policy.rules.map((r) => [r.classId, r]));
  const out: WasteFinding[] = [];

  // 1. Routing to models that never once succeeded.
  const dead = new Set<string>();
  for (const rule of policy.rules) {
    for (const id of chainOf(rule)) {
      const m = models.get(id);
      if (m?.measured && m.measured.requestSuccessRate === 0) dead.add(id);
    }
  }
  if (dead.size > 0) {
    out.push({
      code: 'DEAD_LINKS',
      kind: 'spend',
      title: `${dead.size} routed model${dead.size > 1 ? 's' : ''} never returned a successful call`,
      detail:
        `The policy routes to ${[...dead].map((d) => models.get(d)?.displayName ?? d).join(', ')}. ` +
        `Across all measurement runs these returned zero successes, so every attempt is latency and spend with no output.`,
      estimatedMonthlySavingsUsd: null,
      modelIds: [...dead],
    });
  }

  // 2. A cheaper eligible model exists for the class.
  for (const cls of classes) {
    const rule = ruleFor.get(cls.id);
    if (!rule) continue;
    const current = projectClass(cls, rule, models);
    if (!Number.isFinite(current.costPerDeliveredUsd)) continue;

    const candidates = eligibleModels(cls, modelList)
      .map((m) => {
        const s = successRate(m);
        const perAttempt = costPerAttemptUsd(m, cls.avgInputTokens, cls.avgOutputTokens);
        return { m, costPerDelivered: s > 0 ? perAttempt / s : Infinity, monthly: perAttempt * cls.monthlyCalls };
      })
      .filter((c) => Number.isFinite(c.costPerDelivered))
      .sort((a, b) => a.costPerDelivered - b.costPerDelivered);

    const best = candidates[0];
    if (best && best.monthly < current.monthlyCostUsd * 0.85) {
      out.push({
        code: 'CHEAPER_ELIGIBLE',
      kind: 'spend',
        title: `"${cls.name}" is routed to a more expensive model than it needs`,
        detail:
          `Current chain projects ${current.monthlyCostUsd.toFixed(2)} USD/mo. ` +
          `${best.m.displayName} satisfies every constraint on this class and projects ` +
          `${best.monthly.toFixed(2)} USD/mo at the same declared volume.`,
        estimatedMonthlySavingsUsd: current.monthlyCostUsd - best.monthly,
        modelIds: [best.m.id],
      });
    }
  }

  // 3. Paying for quality that fails its own gates.
  const failing = modelList.filter((m) => {
    if (!m.measured || m.measured.requestSuccessRate === 0) return false;
    if (m.measured.meetsQualityGates) return false;
    return policy.rules.some((r) => chainOf(r).includes(m.id));
  });
  const expensiveFailing = failing.filter(
    (m) => (m.measured?.costPer1kSuccessfulUsd ?? 0) > 1,
  );
  if (expensiveFailing.length > 0) {
    out.push({
      code: 'EXPENSIVE_AND_FAILING',
      kind: 'spend',
      title:
        expensiveFailing.length > 1
          ? `${expensiveFailing.length} routed models cost over $1 per 1k successful outputs and still fail quality gates`
          : `1 routed model costs over $1 per 1k successful outputs and still fails quality gates`,
      detail: expensiveFailing
        .map((m) => `${m.displayName}: $${(m.measured?.costPer1kSuccessfulUsd ?? 0).toFixed(2)}/1k successful, gates failed`)
        .join('. '),
      estimatedMonthlySavingsUsd: null,
      modelIds: expensiveFailing.map((m) => m.id),
    });
  }

  // 4. Catalogue breadth you cannot actually use.
  const unmeasured = modelList.filter((m) => !m.measured);
  if (unmeasured.length > 0) {
    out.push({
      code: 'UNMEASURED_CATALOGUE',
      kind: 'hygiene',
      title: `${unmeasured.length} models in the catalogue have published prices but no measurements`,
      detail:
        `${unmeasured.map((m) => m.displayName).join(', ')} can be priced but not compared on quality or latency. ` +
        `Any class with requireMeasured set will refuse them, which is why they cannot absorb traffic today.`,
      estimatedMonthlySavingsUsd: null,
      modelIds: unmeasured.map((m) => m.id),
    });
  }

  // 5. Governance constraint that nothing measured can satisfy.
  for (const cls of classes) {
    const ok = eligibleModels(cls, modelList);
    if (ok.length === 0) {
      out.push({
        code: 'NO_ELIGIBLE_MODEL',
      kind: 'risk',
        title: `No model in the catalogue satisfies every constraint on "${cls.name}"`,
        detail:
          `This class is currently unroutable without relaxing a constraint. ` +
          `Loosening the quality gate or the retention limit are the two levers — that is a human decision, not an optimisation.`,
        estimatedMonthlySavingsUsd: null,
        modelIds: [],
      });
    } else if (ok.length <= 2) {
      out.push({
        code: 'THIN_ELIGIBILITY',
      kind: 'risk',
        title: `Only ${ok.length} model${ok.length > 1 ? 's' : ''} can legally serve "${cls.name}"`,
        detail:
          `Eligible: ${ok.map((m) => m.displayName).join(', ')}. ` +
          `There is no real fallback depth here, so an outage on ${ok[0]?.displayName ?? 'the primary'} takes the class down.`,
        estimatedMonthlySavingsUsd: null,
        modelIds: ok.map((m) => m.id),
      });
    }
  }

  return out;
}
