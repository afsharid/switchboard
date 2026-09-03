import type { Model, Policy, TrafficClass, Violation } from './types';
import { byId, chainOf, projectClass } from './cost';

/** Does this model satisfy a class's constraints on its own? */
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
  if (c.requireQualityGates && m.measured && !m.measured.meetsQualityGates) {
    const why = m.measured.gateFailureReasons.slice(0, 2).join('; ');
    add(role === 'primary' ? 'blocker' : 'warning', 'QUALITY_GATE',
      `${m.displayName} fails the quality gates${why ? ` (${why})` : ''}.`);
  }
  if (c.minSuccessRate !== null && m.measured && m.measured.requestSuccessRate < c.minSuccessRate) {
    add('blocker', 'SUCCESS_RATE',
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
      add('warning', 'TRAINING_UNKNOWN',
        `${m.displayName} does not document whether it trains on submitted data.`);
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
  budgets: { totalMonthlyBudgetUsd: number | null },
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
    if (proj.deliveredRate < 0.9) {
      out.push({ severity: 'warning', classId: cls.id, modelId: null, code: 'DELIVERY',
        message: `"${cls.name}" only delivers ${(proj.deliveredRate * 100).toFixed(0)}% of calls even after fallbacks.` });
    }
    if (cls.constraints.maxP95Ms !== null && proj.worstCaseLatencyMs > cls.constraints.maxP95Ms) {
      out.push({ severity: 'warning', classId: cls.id, modelId: null, code: 'CHAIN_LATENCY',
        message: `"${cls.name}" can take up to ${proj.worstCaseLatencyMs}ms once fallbacks are exhausted, over its ${cls.constraints.maxP95Ms}ms ceiling.` });
    }
  }

  return out;
}

export function eligibleModels(cls: TrafficClass, modelList: Model[]): Model[] {
  return modelList.filter((m) => modelViolations(m, cls, 'primary').every((v) => v.severity !== 'blocker'));
}
