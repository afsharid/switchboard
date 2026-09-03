import type { Model, Policy, TrafficClass, Violation } from './types';
import { byId, chainOf, project, projectClass } from './cost';

/**
 * Does this model satisfy a class's constraints on its own?
 *
 * `role` encodes the one asymmetry in the model: performance constraints
 * (quality gates, latency) degrade to warnings on a fallback, because a
 * fallback only runs when the primary already failed and a slower answer beats
 * no answer. Governance constraints (retention, training) never degrade — a
 * fallback that leaks customer data leaks it just as thoroughly.
 */
export function modelViolations(
  m: Model,
  cls: TrafficClass,
  role: 'primary' | 'fallback',
): Violation[] {
  const c = cls.constraints;
  const out: Violation[] = [];
  const add = (severity: Violation['severity'], code: string, message: string) =>
    out.push({ severity, classId: cls.id, modelId: m.id, code, message });

  if (c.requireMeasured && !m.measured) {
    add('blocker', 'UNMEASURED', `${m.displayName} has no measurements, so its behaviour on this task is unknown.`);
  }
  if (m.measured && m.measured.requestSuccessRate === 0) {
    add('blocker', 'DEAD_MODEL', `${m.displayName} returned zero successful calls in every run — it is effectively unavailable.`);
  }
  // A performance constraint on a model with no measurements cannot be
  // checked. Previously every one of these tests was guarded by `m.measured &&`
  // and so passed in silence — the same "unknown means safe" mistake the
  // governance checks below were already written to avoid. If the class also
  // sets requireMeasured, UNMEASURED above already blocks; otherwise the
  // operator has accepted unmeasured models, so this warns rather than blocks,
  // but it never says nothing.
  if (!m.measured) {
    const unverifiable: string[] = [];
    if (c.requireQualityGates) unverifiable.push('quality gates');
    if (c.minSuccessRate !== null) unverifiable.push(`the ${(c.minSuccessRate * 100).toFixed(0)}% success floor`);
    if (c.maxP95Ms !== null) unverifiable.push(`the ${c.maxP95Ms}ms p95 ceiling`);
    if (unverifiable.length > 0) {
      add('warning', 'UNVERIFIABLE',
        `${m.displayName} has no measurements, so ${unverifiable.join(', ')} cannot be checked against it — it is neither passing nor failing them.`);
    }
  }

  if (c.requireQualityGates && m.measured && !m.measured.meetsQualityGates) {
    const why = m.measured.gateFailureReasons.slice(0, 2).join('; ');
    add(role === 'primary' ? 'blocker' : 'warning', 'QUALITY_GATE',
      `${m.displayName} fails the quality gates${why ? ` (${why})` : ''}.`);
  }
  if (c.minSuccessRate !== null && m.measured && m.measured.requestSuccessRate < c.minSuccessRate) {
    // Softens for a fallback for the same reason latency and quality gates do:
    // a fallback only runs when the primary has already failed, and something
    // unreliable beats nothing. Leaving this one a hard blocker while the other
    // two softened was an inconsistency in the rule, not a decision.
    add(role === 'primary' ? 'blocker' : 'warning', 'SUCCESS_RATE',
      `${m.displayName} succeeds on ${(m.measured.requestSuccessRate * 100).toFixed(0)}% of calls, below the ${(c.minSuccessRate * 100).toFixed(0)}% floor.`);
  }
  if (c.maxP95Ms !== null && m.measured && m.measured.p95LatencyMs > c.maxP95Ms) {
    add(role === 'primary' ? 'blocker' : 'warning', 'LATENCY',
      `${m.displayName} has a p95 of ${m.measured.p95LatencyMs}ms, over the ${c.maxP95Ms}ms ceiling.`);
  }
  if (c.maxDataRetentionDays !== null) {
    if (m.dataRetentionDays === null) {
      add('blocker', 'RETENTION_UNKNOWN',
        `${m.displayName} does not document a data retention period, so it cannot be cleared for this class.`);
    } else if (m.dataRetentionDays > c.maxDataRetentionDays) {
      add('blocker', 'RETENTION',
        `${m.displayName} retains data for ${m.dataRetentionDays} days, over the ${c.maxDataRetentionDays}-day limit.`);
    }
  }
  if (!c.allowTrainingOnData) {
    if (m.trainsOnData === null) {
      // Symmetric with RETENTION_UNKNOWN: on a class that forbids training,
      // "not documented" cannot be cleared. Unknown is not safe.
      add('blocker', 'TRAINING_UNKNOWN',
        `${m.displayName} does not document whether it trains on submitted data, so it cannot be cleared for this class.`);
    } else if (m.trainsOnData) {
      add('blocker', 'TRAINING', `${m.displayName} trains on submitted data.`);
    }
  }
  return out;
}

export function checkCompliance(
  classes: TrafficClass[],
  policy: Policy,
  modelList: Model[],
  budgets: { totalMonthlyBudgetUsd: number | null; providers?: { id: string; name: string; monthlyBudgetUsd: number }[] },
): Violation[] {
  const models = byId(modelList);
  const ruleFor = new Map(policy.rules.map((r) => [r.classId, r]));
  const out: Violation[] = [];

  for (const cls of classes) {
    const rule = ruleFor.get(cls.id);
    if (!rule) {
      out.push({ severity: 'blocker', classId: cls.id, modelId: null, code: 'NO_RULE',
        message: `Traffic class "${cls.name}" has no routing rule.` });
      continue;
    }
    const chain = chainOf(rule);
    chain.forEach((id, i) => {
      const m = models.get(id);
      if (!m) {
        out.push({ severity: 'blocker', classId: cls.id, modelId: id, code: 'UNKNOWN_MODEL',
          message: `Rule for "${cls.name}" references unknown model ${id}.` });
        return;
      }
      out.push(...modelViolations(m, cls, i === 0 ? 'primary' : 'fallback'));
    });

    const proj = projectClass(cls, rule, models);
    // The class's own floor, not a hardcoded 0.9. This is the chain-level
    // check the tool descriptions promised: what the whole chain delivers,
    // which is the number that actually matters to the workload.
    if (cls.constraints.minSuccessRate !== null && proj.deliveredRate < cls.constraints.minSuccessRate) {
      out.push({ severity: 'blocker', classId: cls.id, modelId: null, code: 'CHAIN_DELIVERY',
        message: `"${cls.name}" delivers ${(proj.deliveredRate * 100).toFixed(0)}% of calls once fallbacks are exhausted, below its ${(cls.constraints.minSuccessRate * 100).toFixed(0)}% floor.` });
    }
    if (proj.unmeasuredLinks.length > 0) {
      out.push({ severity: 'warning', classId: cls.id, modelId: null, code: 'UNMEASURED_LINK',
        message: `"${cls.name}" routes to ${proj.unmeasuredLinks.length} model(s) with no latency measurements, so its worst-case latency of ${proj.worstCaseLatencyMs}ms is a lower bound, not a ceiling.` });
    }
    if (cls.constraints.maxP95Ms !== null && proj.worstCaseLatencyMs > cls.constraints.maxP95Ms) {
      out.push({ severity: 'warning', classId: cls.id, modelId: null, code: 'CHAIN_LATENCY',
        message: `"${cls.name}" can take up to ${proj.worstCaseLatencyMs}ms once fallbacks are exhausted, over its ${cls.constraints.maxP95Ms}ms ceiling.` });
    }
  }

  // Spend caps, audited alongside everything else so that an empty blocker
  // list actually is the bar a proposal has to clear.
  const proj = project(classes, policy, modelList);
  if (budgets.totalMonthlyBudgetUsd !== null && proj.totalMonthlyCostUsd > budgets.totalMonthlyBudgetUsd) {
    out.push({
      severity: 'blocker', classId: null, modelId: null, code: 'TOTAL_BUDGET',
      message: `Projected spend is $${proj.totalMonthlyCostUsd.toFixed(2)}/mo against a total cap of $${budgets.totalMonthlyBudgetUsd}/mo.`,
    });
  }
  for (const pr of budgets.providers ?? []) {
    const spend = proj.perProviderUsd[pr.id] ?? 0;
    if (spend > pr.monthlyBudgetUsd) {
      out.push({
        severity: 'blocker', classId: null, modelId: null, code: 'PROVIDER_BUDGET',
        message: `${pr.name} is projected at $${spend.toFixed(2)}/mo against its $${pr.monthlyBudgetUsd}/mo cap.`,
      });
    }
  }

  return out;
}

export function eligibleModels(cls: TrafficClass, modelList: Model[]): Model[] {
  return modelList.filter((m) => modelViolations(m, cls, 'primary').every((v) => v.severity !== 'blocker'));
}
