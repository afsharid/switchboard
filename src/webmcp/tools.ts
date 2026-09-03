import type { Rule } from '../domain/types';
import { candidateProjection, currentProjection, useSwitchboard } from '../store/useSwitchboard';
import { costPerAttemptUsd, successRate } from '../domain/cost';
import { checkCompliance, eligibleModels, modelViolations } from '../domain/compliance';
import { findWaste } from '../domain/waste';
import { seed } from '../data/initial';
import type { ToolSpec } from './useTool';

const r2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const r4 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null);

const S = {
  classId: {
    type: 'string',
    description: "Traffic class id. Call list_traffic_classes for valid ids (e.g. 'realtime', 'batch', 'sensitive').",
  },
  rules: {
    type: 'array',
    description:
      'Candidate routing rules. One entry per traffic class you want to change; classes you omit keep their current rule.',
    items: {
      type: 'object',
      properties: {
        classId: { type: 'string', description: 'Traffic class this rule routes.' },
        primaryModelId: { type: 'string', description: "Model tried first, e.g. 'opencode-go/minimax-m3'." },
        fallbackModelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Models tried in order if the primary fails. Pass [] for no fallback.',
        },
      },
      required: ['classId', 'primaryModelId', 'fallbackModelIds'],
    },
  },
} as const;

function parseRules(input: unknown): { rules: Rule[]; error: string | null } {
  const s = useSwitchboard.getState();
  if (!Array.isArray(input)) return { rules: [], error: 'rules must be an array.' };
  const classIds = new Set(s.classes.map((c) => c.id));
  const modelIds = new Set(s.models.map((m) => m.id));
  const rules: Rule[] = [];
  for (const raw of input) {
    const r = raw as Partial<Rule>;
    if (!r.classId || !classIds.has(r.classId)) {
      return { rules: [], error: `Unknown classId "${r.classId}". Valid: ${[...classIds].join(', ')}.` };
    }
    if (!r.primaryModelId || !modelIds.has(r.primaryModelId)) {
      return { rules: [], error: `Unknown primaryModelId "${r.primaryModelId}". Call list_models for valid ids.` };
    }
    const fb = Array.isArray(r.fallbackModelIds) ? r.fallbackModelIds : [];
    for (const f of fb) {
      if (!modelIds.has(f)) {
        return { rules: [], error: `Unknown fallback model "${f}". Call list_models for valid ids.` };
      }
    }
    rules.push({ classId: r.classId, primaryModelId: r.primaryModelId, fallbackModelIds: fb });
  }
  if (rules.length === 0) return { rules: [], error: 'rules was empty — nothing to change.' };
  return { rules, error: null };
}

const projSummary = (p: ReturnType<typeof currentProjection>) => ({
  totalMonthlyCostUsd: r2(p.totalMonthlyCostUsd),
  perClass: p.perClass.map((c) => ({
    classId: c.classId,
    chain: c.chain,
    monthlyCostUsd: r2(c.monthlyCostUsd),
    deliveredRatePct: r2(c.deliveredRate * 100),
    costPer1kDeliveredUsd: r4(c.costPerDeliveredUsd * 1000),
    expectedLatencyMs: c.expectedLatencyMs,
    worstCaseLatencyMs: c.worstCaseLatencyMs,
  })),
  perProviderMonthlyUsd: Object.fromEntries(
    Object.entries(p.perProviderUsd).map(([k, v]) => [k, r2(v)]),
  ),
});

export function buildTools(): ToolSpec[] {
  const get = () => useSwitchboard.getState();

  return [
    // ---------------------------------------------------------------- read
    {
      name: 'get_provenance',
      readOnly: true,
      description:
        'Explain where the numbers on this dashboard come from and what they may not be used for. Call this first if you intend to make a recommendation, so you can state the limits of the evidence you are reasoning from. Returns the measurement date, how many live runs and API calls the measurements cover, and the explicit caveat that these are planning estimates rather than production billing.',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        JSON.stringify({
          ...seed.provenance,
          modelsInCatalogue: get().models.length,
          modelsWithMeasurements: get().models.filter((m) => m.measured).length,
          evalRuns: seed.evalRuns.map((r) => ({
            id: r.id, startedAt: r.startedAt, calls: r.actualTotalNetworkCalls,
            costUsd: r.estimatedTotalCostUsd, models: r.candidateCount,
          })),
        }),
    },
    {
      name: 'list_providers',
      readOnly: true,
      description:
        'List every LLM provider configured here with its operator-declared monthly budget in USD and its projected monthly spend under the routing policy currently in force. Use this to see which providers are over budget before you propose any change. Projected spend is derived from declared call volumes and published prices, not from a billing API.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const s = get();
        const p = currentProjection();
        return JSON.stringify({
          totalMonthlyBudgetUsd: s.totalBudgetUsd,
          totalProjectedMonthlyUsd: r2(p.totalMonthlyCostUsd),
          providers: s.providers.map((pr) => {
            const spend = p.perProviderUsd[pr.id] ?? 0;
            return {
              id: pr.id, name: pr.name, kind: pr.kind,
              monthlyBudgetUsd: pr.monthlyBudgetUsd,
              projectedMonthlyUsd: r2(spend),
              overBudget: spend > pr.monthlyBudgetUsd,
              modelCount: s.models.filter((m) => m.providerId === pr.id).length,
            };
          }),
        });
      },
    },
    {
      name: 'list_traffic_classes',
      readOnly: true,
      description:
        'List the traffic classes this workload is split into, with the constraints each one must satisfy. Read this before proposing any routing change — the constraints are the whole point, and several are not about money. Each class returns: monthlyCalls and average token counts (declared by the operator), plus constraints maxP95Ms, minSuccessRate, requireQualityGates, maxDataRetentionDays (data-governance limit in days, null = unconstrained), allowTrainingOnData (false means never route to a model that trains on submitted data) and requireMeasured (refuse models with no measurements).',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const s = get();
        return JSON.stringify({
          classes: s.classes.map((c) => ({
            ...c,
            eligibleModelCount: eligibleModels(c, s.models).length,
          })),
        });
      },
    },
    {
      name: 'list_models',
      readOnly: true,
      description:
        "List the priced model catalogue joined with this operator's own measurements. Prices are per million tokens from published provider documentation. Measurements come from 4 live evaluation runs over 667 real API calls on one structured-output task: requestSuccessRate (0-1), medianLatencyMs, p95LatencyMs, costPer1kSuccessfulUsd (cost per 1000 successful outputs — prefer this over raw price, because a cheap model that fails half its calls is not cheap), and meetsQualityGates. Governance fields dataRetentionDays and trainsOnData carry null when the provider does not document them; null means unknown, not safe. Filter to narrow the candidate set before comparing.",
      inputSchema: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: "Restrict to one provider, e.g. 'opencode-go'." },
          measuredOnly: { type: 'boolean', description: 'Only models with measurements. Default false.' },
          excludeDead: { type: 'boolean', description: 'Drop models whose measured success rate is 0. Default false.' },
          maxDataRetentionDays: { type: 'number', description: 'Only models documented to retain data for at most this many days. Models with undocumented retention are excluded.' },
          excludeTrainsOnData: { type: 'boolean', description: 'Drop models documented to train on submitted data. Default false.' },
          maxP95Ms: { type: 'number', description: 'Only models with measured p95 latency at or below this many milliseconds.' },
          requireQualityGates: { type: 'boolean', description: 'Only models that passed the quality gates. Default false.' },
          eligibleForClassId: { type: 'string', description: 'Return only models satisfying every constraint of this traffic class. Simplest way to get a legal candidate set.' },
        },
      },
      execute: (a) => {
        const s = get();
        let ms = s.models;
        if (a.eligibleForClassId) {
          const cls = s.classes.find((c) => c.id === a.eligibleForClassId);
          if (!cls) return `Unknown classId "${a.eligibleForClassId}". Valid: ${s.classes.map((c) => c.id).join(', ')}.`;
          ms = eligibleModels(cls, s.models);
        }
        if (a.providerId) ms = ms.filter((m) => m.providerId === a.providerId);
        if (a.measuredOnly) ms = ms.filter((m) => m.measured);
        if (a.excludeDead) ms = ms.filter((m) => !m.measured || m.measured.requestSuccessRate > 0);
        if (typeof a.maxDataRetentionDays === 'number') {
          ms = ms.filter((m) => m.dataRetentionDays !== null && m.dataRetentionDays <= a.maxDataRetentionDays);
        }
        if (a.excludeTrainsOnData) ms = ms.filter((m) => m.trainsOnData === false);
        if (typeof a.maxP95Ms === 'number') ms = ms.filter((m) => m.measured && m.measured.p95LatencyMs <= a.maxP95Ms);
        if (a.requireQualityGates) ms = ms.filter((m) => m.measured?.meetsQualityGates === true);

        return JSON.stringify({
          matched: ms.length,
          ofTotal: s.models.length,
          models: ms.map((m) => ({
            id: m.id, displayName: m.displayName, providerId: m.providerId,
            inputUsdPerM: m.inputUsdPerM, outputUsdPerM: m.outputUsdPerM,
            dataRetentionDays: m.dataRetentionDays, trainsOnData: m.trainsOnData,
            measured: m.measured
              ? {
                  requestSuccessRate: r2(m.measured.requestSuccessRate),
                  medianLatencyMs: m.measured.medianLatencyMs,
                  p95LatencyMs: m.measured.p95LatencyMs,
                  costPer1kSuccessfulUsd: r4(m.measured.costPer1kSuccessfulUsd ?? NaN),
                  meetsQualityGates: m.measured.meetsQualityGates,
                  observedCalls: m.measured.observedCalls,
                }
              : null,
          })),
        });
      },
    },
    {
      name: 'get_model',
      readOnly: true,
      description:
        'Full detail on one model, including why it failed its quality gates if it did (gateFailureReasons), and a per-class verdict listing exactly which constraint each traffic class would reject it on. Use this when you need to justify excluding a model, or to understand whether a rejection is a hard blocker or a warning you can route around with a fallback.',
      inputSchema: {
        type: 'object',
        properties: { modelId: { type: 'string', description: "Model id, e.g. 'opencode-go/gpt-5.6-luna'." } },
        required: ['modelId'],
      },
      execute: (a) => {
        const s = get();
        const m = s.models.find((x) => x.id === a.modelId);
        if (!m) return `Unknown modelId "${a.modelId}". Call list_models for valid ids.`;
        return JSON.stringify({
          ...m,
          perClassVerdict: s.classes.map((c) => {
            const vs = modelViolations(m, c, 'primary');
            return {
              classId: c.id,
              eligibleAsPrimary: vs.every((v) => v.severity !== 'blocker'),
              blockers: vs.filter((v) => v.severity === 'blocker').map((v) => `${v.code}: ${v.message}`),
              warnings: vs.filter((v) => v.severity === 'warning').map((v) => `${v.code}: ${v.message}`),
              costPerAttemptUsd: r4(costPerAttemptUsd(m, c.avgInputTokens, c.avgOutputTokens)),
              projectedMonthlyUsdIfSolePrimary: r2(
                costPerAttemptUsd(m, c.avgInputTokens, c.avgOutputTokens) * c.monthlyCalls,
              ),
            };
          }),
        });
      },
    },
    {
      name: 'compare_models',
      readOnly: true,
      description:
        "Rank candidate models for one traffic class, using that class's own token profile and declared volume so the money figures are directly comparable. Only models that satisfy every hard constraint of the class are ranked; the rest are returned separately under rejected, with the reason. Set optimiseFor to 'cost' (cheapest per delivered output), 'latency' (lowest measured p95), 'reliability' (highest success rate) or 'balanced' (cost per delivered output, penalised by p95 and by failing quality gates). This is the tool to call before proposing a routing change.",
      inputSchema: {
        type: 'object',
        properties: {
          classId: S.classId,
          optimiseFor: {
            type: 'string',
            enum: ['cost', 'latency', 'reliability', 'balanced'],
            description: 'Ranking objective. Default balanced.',
          },
          limit: { type: 'number', description: 'How many ranked candidates to return. Default 8.' },
        },
        required: ['classId'],
      },
      execute: (a) => {
        const s = get();
        const cls = s.classes.find((c) => c.id === a.classId);
        if (!cls) return `Unknown classId "${a.classId}". Valid: ${s.classes.map((c) => c.id).join(', ')}.`;
        const objective: string = a.optimiseFor ?? 'balanced';
        const limit = typeof a.limit === 'number' ? Math.max(1, Math.min(26, a.limit)) : 8;

        const scored = s.models.map((m) => {
          const vs = modelViolations(m, cls, 'primary');
          const blockers = vs.filter((v) => v.severity === 'blocker');
          const sr = successRate(m);
          const perAttempt = costPerAttemptUsd(m, cls.avgInputTokens, cls.avgOutputTokens);
          const perDelivered = sr > 0 ? perAttempt / sr : Infinity;
          const p95 = m.measured?.p95LatencyMs ?? Infinity;
          let score: number;
          if (objective === 'cost') score = perDelivered;
          else if (objective === 'latency') score = p95;
          else if (objective === 'reliability') score = -sr;
          else score = perDelivered * (1 + p95 / 10000) * (m.measured?.meetsQualityGates ? 1 : 1.5);
          return { m, blockers, sr, perAttempt, perDelivered, p95, score };
        });

        const eligible = scored
          .filter((x) => x.blockers.length === 0 && Number.isFinite(x.score))
          .sort((x, y) => x.score - y.score)
          .slice(0, limit);

        return JSON.stringify({
          classId: cls.id,
          className: cls.name,
          optimiseFor: objective,
          declaredMonthlyCalls: cls.monthlyCalls,
          constraints: cls.constraints,
          ranked: eligible.map((x, i) => ({
            rank: i + 1,
            id: x.m.id,
            displayName: x.m.displayName,
            projectedMonthlyUsd: r2(x.perAttempt * cls.monthlyCalls),
            costPer1kDeliveredUsd: r4(x.perDelivered * 1000),
            requestSuccessRate: r2(x.sr),
            medianLatencyMs: x.m.measured?.medianLatencyMs ?? null,
            p95LatencyMs: x.m.measured?.p95LatencyMs ?? null,
            meetsQualityGates: x.m.measured?.meetsQualityGates ?? null,
            dataRetentionDays: x.m.dataRetentionDays,
            trainsOnData: x.m.trainsOnData,
          })),
          rejected: scored
            .filter((x) => x.blockers.length > 0)
            .map((x) => ({ id: x.m.id, displayName: x.m.displayName, blockedBy: x.blockers.map((b) => b.code) })),
          note:
            eligible.length === 0
              ? 'No model satisfies every constraint on this class. This cannot be optimised away — a human has to decide which constraint to relax. Report the trade-off rather than silently picking a non-compliant model.'
              : undefined,
        });
      },
    },
    {
      name: 'get_routing_policy',
      readOnly: true,
      description:
        'The routing policy currently in force, with the resolved primary and fallback chain per traffic class and the projected monthly cost, delivery rate and latency each chain produces. Call this before proposing changes so your proposal is a genuine diff against reality rather than a rewrite from scratch.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const s = get();
        return JSON.stringify({
          updatedAt: s.policy.updatedAt,
          rules: s.policy.rules,
          projection: projSummary(currentProjection()),
        });
      },
    },
    {
      name: 'simulate_policy',
      readOnly: true,
      description:
        'Project what a candidate routing policy would cost and deliver, WITHOUT applying it. Returns before/after monthly cost per class and per provider, delivery rates, expected and worst-case latency, and the compliance verdict on the candidate. Also renders the comparison on the operator\'s screen, so they can follow your reasoning while you iterate. Call this repeatedly to search the trade-off space — it is free and changes nothing. Classes you omit from rules keep their current routing.',
      inputSchema: {
        type: 'object',
        properties: {
          rules: S.rules,
          label: { type: 'string', description: 'Short human-readable name for this candidate, shown on screen.' },
        },
        required: ['rules'],
      },
      execute: (a) => {
        const s = get();
        const { rules, error } = parseRules(a.rules);
        if (error) return `Invalid rules: ${error}`;
        const before = currentProjection();
        const after = candidateProjection(rules);
        const merged = new Map(s.policy.rules.map((r) => [r.classId, r]));
        for (const r of rules) merged.set(r.classId, r);
        const mergedRules = Array.from(merged.values());
        const violations = checkCompliance(s.classes, { rules: mergedRules, updatedAt: '' }, s.models, {
          totalMonthlyBudgetUsd: s.totalBudgetUsd,
        });

        s.setSimulation({
          rules: mergedRules,
          projection: after,
          at: new Date().toISOString(),
          label: typeof a.label === 'string' && a.label ? a.label : 'Agent candidate',
        });

        return JSON.stringify({
          applied: false,
          note: 'Simulation only. Nothing was changed. Use propose_policy_change to put this in front of the operator.',
          before: projSummary(before),
          after: projSummary(after),
          deltaMonthlyUsd: r2(after.totalMonthlyCostUsd - before.totalMonthlyCostUsd),
          totalMonthlyBudgetUsd: s.totalBudgetUsd,
          withinTotalBudget: after.totalMonthlyCostUsd <= s.totalBudgetUsd,
          candidateBlockers: violations.filter((v) => v.severity === 'blocker').map((v) => `${v.code} (${v.classId}): ${v.message}`),
          candidateWarnings: violations.filter((v) => v.severity === 'warning').map((v) => `${v.code} (${v.classId}): ${v.message}`),
        });
      },
    },
    {
      name: 'check_compliance',
      readOnly: true,
      description:
        'Audit the live policy — or a candidate rule set if you pass one — against every constraint: latency ceilings, success-rate floors, quality gates, data-retention limits and the no-training-on-data requirement. Blockers mean the routing is not permissible as configured; warnings mean it is permissible but fragile. An empty blockers list is the bar a proposal should clear before you send it to the operator.',
      inputSchema: { type: 'object', properties: { rules: S.rules } },
      execute: (a) => {
        const s = get();
        let rules = s.policy.rules;
        if (a.rules !== undefined) {
          const parsed = parseRules(a.rules);
          if (parsed.error) return `Invalid rules: ${parsed.error}`;
          const merged = new Map(s.policy.rules.map((r) => [r.classId, r]));
          for (const r of parsed.rules) merged.set(r.classId, r);
          rules = Array.from(merged.values());
        }
        const vs = checkCompliance(s.classes, { rules, updatedAt: '' }, s.models, {
          totalMonthlyBudgetUsd: s.totalBudgetUsd,
        });
        return JSON.stringify({
          target: a.rules === undefined ? 'live policy' : 'candidate rules',
          blockers: vs.filter((v) => v.severity === 'blocker'),
          warnings: vs.filter((v) => v.severity === 'warning'),
          clean: vs.length === 0,
        });
      },
    },
    {
      name: 'find_waste',
      readOnly: true,
      description:
        'Run the waste detectors over the live policy and the measurements: models being routed to that never returned a successful call, classes routed to a model more expensive than a compliant alternative, models costing over $1 per 1000 successful outputs while still failing quality gates, catalogue entries with prices but no measurements, and classes with too few or zero eligible models. Every finding cites the numbers it came from. Start here when the operator asks an open question like "where is my money going".',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const s = get();
        const findings = findWaste(s.classes, s.policy, s.models);
        return JSON.stringify({
          findingCount: findings.length,
          totalIdentifiedMonthlySavingsUsd: r2(
            findings.reduce((a2, f) => a2 + (f.estimatedMonthlySavingsUsd ?? 0), 0),
          ),
          findings: findings.map((f) => ({
            code: f.code, title: f.title, detail: f.detail,
            estimatedMonthlySavingsUsd: f.estimatedMonthlySavingsUsd === null ? null : r2(f.estimatedMonthlySavingsUsd),
            modelIds: f.modelIds,
          })),
        });
      },
    },

    // ------------------------------------------------------- guarded writes
    {
      name: 'propose_policy_change',
      description:
        'Put a routing change in front of the operator for approval. This does NOT apply the change — routing decides where money and customer data go, so it stays a human decision. The proposal appears on their screen as a rule-by-rule diff with the projected cost delta and the compliance verdict. You will get back a proposal id; poll get_proposal_status to learn what the operator decided and read any note they left. If they reject with a reason, address the reason and propose again rather than resubmitting the same rules.',
      inputSchema: {
        type: 'object',
        properties: {
          rules: S.rules,
          rationale: {
            type: 'string',
            description:
              'Why this change is right, in terms the operator can check: which constraint it fixes, what it costs, what it gives up. Cite the numbers you used.',
          },
        },
        required: ['rules', 'rationale'],
      },
      execute: (a) => {
        const s = get();
        const { rules, error } = parseRules(a.rules);
        if (error) return `Invalid rules: ${error} Nothing was proposed.`;
        if (typeof a.rationale !== 'string' || a.rationale.trim().length < 10) {
          return 'A rationale of at least 10 characters is required — the operator has to be able to check your reasoning before approving. Nothing was proposed.';
        }
        const before = currentProjection();
        const after = candidateProjection(rules);
        const merged = new Map(s.policy.rules.map((r) => [r.classId, r]));
        for (const r of rules) merged.set(r.classId, r);
        const vs = checkCompliance(s.classes, { rules: Array.from(merged.values()), updatedAt: '' }, s.models, {
          totalMonthlyBudgetUsd: s.totalBudgetUsd,
        });
        const blockers = vs.filter((v) => v.severity === 'blocker');

        const p = s.createProposal({
          kind: 'policy', rationale: a.rationale, rules,
          providerId: null, monthlyBudgetUsd: null,
          projectionBefore: before, projectionAfter: after,
        });
        s.setSimulation({
          rules: Array.from(merged.values()), projection: after,
          at: new Date().toISOString(), label: `Proposal ${p.id}`,
        });

        const delta = after.totalMonthlyCostUsd - before.totalMonthlyCostUsd;
        return [
          `Proposal ${p.id} created and shown to the operator for approval. Nothing has been applied yet.`,
          `It changes ${rules.length} routing rule${rules.length > 1 ? 's' : ''} and moves projected spend from $${before.totalMonthlyCostUsd.toFixed(2)}/mo to $${after.totalMonthlyCostUsd.toFixed(2)}/mo (${delta >= 0 ? '+' : ''}$${delta.toFixed(2)}).`,
          blockers.length > 0
            ? `Warning: the candidate still has ${blockers.length} compliance blocker(s): ${blockers.map((b) => b.code).join(', ')}. The operator is likely to reject it — consider fixing these first.`
            : 'The candidate has no compliance blockers.',
          `Call get_proposal_status with proposalId "${p.id}" to see the decision and any note the operator leaves.`,
        ].join(' ');
      },
    },
    {
      name: 'propose_budget_change',
      description:
        "Ask the operator to change a provider's monthly budget cap. Like routing, this is not applied directly — a budget is a spending authorisation, so only the human can grant it. Returns a proposal id to poll with get_proposal_status. Use this when a routing plan you believe in cannot fit inside the current cap, and say so in the rationale.",
      inputSchema: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: 'Provider whose cap should change. Call list_providers for valid ids.' },
          monthlyBudgetUsd: { type: 'number', description: 'Proposed new monthly cap in USD.' },
          rationale: { type: 'string', description: 'Why this cap, tied to projected spend.' },
        },
        required: ['providerId', 'monthlyBudgetUsd', 'rationale'],
      },
      execute: (a) => {
        const s = get();
        const pr = s.providers.find((x) => x.id === a.providerId);
        if (!pr) return `Unknown providerId "${a.providerId}". Valid: ${s.providers.map((x) => x.id).join(', ')}. Nothing was proposed.`;
        if (typeof a.monthlyBudgetUsd !== 'number' || !Number.isFinite(a.monthlyBudgetUsd) || a.monthlyBudgetUsd < 0) {
          return 'monthlyBudgetUsd must be a non-negative number. Nothing was proposed.';
        }
        if (typeof a.rationale !== 'string' || a.rationale.trim().length < 10) {
          return 'A rationale of at least 10 characters is required. Nothing was proposed.';
        }
        const p = s.createProposal({
          kind: 'budget', rationale: a.rationale, rules: null,
          providerId: pr.id, monthlyBudgetUsd: a.monthlyBudgetUsd,
          projectionBefore: currentProjection(), projectionAfter: null,
        });
        return `Proposal ${p.id} created and shown to the operator: change ${pr.name} monthly cap from $${pr.monthlyBudgetUsd} to $${a.monthlyBudgetUsd}. Not applied. Call get_proposal_status with proposalId "${p.id}" for the decision.`;
      },
    },
    {
      name: 'get_proposal_status',
      readOnly: true,
      description:
        "Check what the operator decided about a proposal you submitted. Status is 'pending' (still on their screen — wait, do not resubmit), 'approved' (applied; re-read get_routing_policy to see the new state) or 'rejected'. A rejection usually carries decisionNote explaining what was wrong; read it and propose a corrected version addressing that specific objection. Omit proposalId to list every proposal and its status.",
      inputSchema: {
        type: 'object',
        properties: { proposalId: { type: 'string', description: "Proposal id such as 'P-1'. Omit to list all." } },
      },
      execute: (a) => {
        const s = get();
        if (!a.proposalId) {
          return JSON.stringify({
            proposals: s.proposals.map((p) => ({
              id: p.id, kind: p.kind, status: p.status, createdAt: p.createdAt,
              decidedAt: p.decidedAt, decisionNote: p.decisionNote,
            })),
          });
        }
        const p = s.proposals.find((x) => x.id === a.proposalId);
        if (!p) return `Unknown proposalId "${a.proposalId}". Call get_proposal_status with no arguments to list all proposals.`;
        return JSON.stringify({
          id: p.id, kind: p.kind, status: p.status, rationale: p.rationale,
          createdAt: p.createdAt, decidedAt: p.decidedAt, decisionNote: p.decisionNote,
          rules: p.rules, providerId: p.providerId, monthlyBudgetUsd: p.monthlyBudgetUsd,
          guidance:
            p.status === 'pending'
              ? 'Still awaiting the operator. Do not resubmit; poll again shortly or tell the user you are waiting.'
              : p.status === 'rejected'
                ? 'Rejected. Read decisionNote and propose a corrected version that addresses that specific objection.'
                : 'Approved and applied. Call get_routing_policy to confirm the live state.',
        });
      },
    },
    {
      name: 'pin_insight',
      description:
        'Leave a short finding on the operator\'s dashboard. Unlike routing and budget changes this applies immediately and needs no approval, because it only adds a note — nothing is spent and nothing is routed differently. Use it to record a trade-off the operator has to decide, or a conclusion worth keeping after the conversation ends.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'One line, specific. Prefer "Sensitive class has no compliant model" over "Compliance issue".' },
          body: { type: 'string', description: 'Two or three sentences with the numbers behind it.' },
        },
        required: ['title', 'body'],
      },
      execute: (a) => {
        if (typeof a.title !== 'string' || !a.title.trim()) return 'title is required.';
        if (typeof a.body !== 'string' || !a.body.trim()) return 'body is required.';
        const i = get().pinInsight(a.title.trim(), a.body.trim());
        return `Pinned insight ${i.id} to the dashboard: "${i.title}".`;
      },
    },
  ];
}
