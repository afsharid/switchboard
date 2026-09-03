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
        'Explain where the numbers on this dashboard come from and how far they can be trusted. Call this before making a recommendation so you can state the limits of your evidence. Returns the measurement date, the run and call counts, and per-model sample sizes. Read samplingCaveat: the measurements are spread across a whole catalogue on a single structured-output task, so per-model sample counts are small — treat medianLatencyMs as indicative and p95LatencyMs as coarse, and say so when a recommendation turns on a latency margin of a second or less. Every field here is prose and counts for you to paraphrase, not a machine-readable prohibition list.',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        JSON.stringify({
          ...seed.provenance,
          samplingCaveat:
            'Per-model sample sizes are small: see observedCalls on each model via list_models. A p95 computed from tens of calls is coarse. Do not present latency differences smaller than roughly a second as decisive, and prefer requestSuccessRate and cost, which are less sensitive to sample size.',
          medianObservedCallsPerMeasuredModel: (() => {
            const xs = get().models.map((m) => m.measured?.observedCalls ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
            return xs.length ? xs[Math.floor(xs.length / 2)] ?? 0 : 0;
          })(),
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
        "List every LLM provider with its monthly budget cap in USD and its projected monthly spend under the policy currently in force, plus the total cap across all providers. Provider ids are kebab-case, e.g. 'opencode-go', 'openai'. Caps are NOT writable by you — there is no set_budget tool; use propose_budget_change, which the operator must approve. Projected spend is derived from operator-declared call volumes and published prices, not from a billing API: there is no billing history, actuals or time series anywhere on this surface, so never describe these figures as what was spent.",
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
        "List the traffic classes this workload is split into, with the constraints each must satisfy, and how many models are currently eligible for each. Read this before proposing any routing change — the constraints are the whole point and several are not about money. Per class: monthlyCalls and average token counts, which are OPERATOR-DECLARED estimates and not measured (you cannot change them; only the human can, in the UI). Then the constraints: maxP95Ms, minSuccessRate (judged against the chain-level delivery rate, not one model's success rate), requireQualityGates, maxDataRetentionDays (null here means UNCONSTRAINED — the opposite of null on a model, where it means undocumented and therefore not clearable), allowTrainingOnData (false means never route to a model that trains on submitted data, in any chain position, including fallbacks), requireMeasured. You cannot write these constraints — but the operator can, under 'relax constraints' on each class in the UI. So when a class has zero eligible models, the useful move is to name precisely which constraint is emptying the set and what it would cost to relax each one, then let them choose. Do not route around a constraint you were not given permission to relax.",
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
        "List the priced model catalogue joined with this operator's own measurements. Prices are per million tokens from published provider documentation. Call get_provenance for how the measurements were produced and how coarse they are. Per model: requestSuccessRate (0-1), medianLatencyMs, p95LatencyMs, observedCalls (the sample size behind those latencies — check it before trusting a small latency gap), costPer1kSuccessfulUsd (cost per 1000 DELIVERED outputs, i.e. price divided by success rate; prefer it over raw price, because a cheap model that fails half its calls is not cheap), and meetsQualityGates. GOVERNANCE, and read this carefully: on a MODEL, dataRetentionDays and trainsOnData are null when the provider does not document them, and null means UNKNOWN, which is not the same as safe. On a TRAFFIC CLASS the same-named constraints being null means UNCONSTRAINED. The two nulls are opposites, so do not carry one across the join. Every governance filter here excludes undocumented models rather than assuming the best. If you only need a set of models that is legal for a class, pass eligibleForClassId and skip the individual filters — it applies the class's real constraints, including the ones these filters cannot express.",
      inputSchema: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: "Restrict to one provider, e.g. 'opencode-go'." },
          measuredOnly: { type: 'boolean', description: 'Only models with measurements. Default false.' },
          excludeDead: { type: 'boolean', description: 'Drop models that returned zero successful calls in every run. Unmeasured models are kept — use measuredOnly to drop those. Default false.' },
          maxDataRetentionDays: { type: 'number', description: 'Only models documented to retain data for at most this many days. Models with undocumented retention are excluded.' },
          excludeTrainsOnData: { type: 'boolean', description: 'Drop models that train on submitted data AND models where this is undocumented, since undocumented is not safe. Default false.' },
          minSuccessRate: { type: 'number', description: 'Only models with a measured request success rate at or above this (0-1). Excludes unmeasured models.' },
          maxCostPer1kDeliveredUsd: { type: 'number', description: 'Only models at or below this cost per 1000 delivered outputs, in USD. Excludes unmeasured models.' },
          limit: { type: 'number', description: 'Cap the number of models returned, cheapest per delivered output first. Omit for all matches.' },
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
        if (typeof a.minSuccessRate === 'number') {
          ms = ms.filter((m) => m.measured && m.measured.requestSuccessRate >= a.minSuccessRate);
        }
        if (typeof a.maxCostPer1kDeliveredUsd === 'number') {
          ms = ms.filter((m) => {
            const c = m.measured?.costPer1kSuccessfulUsd;
            return typeof c === 'number' && c > 0 && c <= a.maxCostPer1kDeliveredUsd;
          });
        }
        const matchedCount = ms.length;
        ms = [...ms].sort(
          (x, y) => (x.measured?.costPer1kSuccessfulUsd ?? Infinity) - (y.measured?.costPer1kSuccessfulUsd ?? Infinity),
        );
        if (typeof a.limit === 'number' && a.limit > 0) ms = ms.slice(0, Math.floor(a.limit));

        return JSON.stringify({
          matched: matchedCount,
          returned: ms.length,
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
        "Rank candidate models for one traffic class, using that class's own token profile and declared volume, so the money figures are comparable to each other and to get_routing_policy. Note this differs from the costPer1kSuccessfulUsd in list_models, which uses the measurement task's own token profile — do not quote the two side by side. Only models satisfying every HARD constraint of the class are ranked; the rest come back under rejected with the blocking codes. Ranking: 'cost' = lowest cost per delivered output; 'latency' = lowest measured p95; 'reliability' = highest success rate; 'balanced' (default) = costPerDelivered × (1 + p95ms/10000) × 1.5 if it fails quality gates. Fallbacks: performance constraints (quality gates, latency) soften to warnings for a fallback because a slow answer beats none, but governance constraints (retention, training) never soften — so a model rejected on RETENTION or TRAINING cannot serve this class in any position. Call this before proposing a routing change.",
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
        'Project what a candidate routing policy would cost and deliver, WITHOUT applying it. Classes you omit keep their current routing. Definitions: deliveredRatePct is the chain-level probability that some link succeeds, i.e. 1 minus the product of every link failing — this, not a single model\'s requestSuccessRate, is what a class\'s minSuccessRate is judged against. expectedLatencyMs is the probability-weighted median across the chain. worstCaseLatencyMs is the SUM of p95 across every link likely to be attempted, i.e. the tail once fallbacks are exhausted; judge a latency ceiling against this, not the expected value. Cost counts every attempt, since a failed call is still billed. The candidate\'s compliance verdict is returned here too and is the same computation check_compliance runs, so you do not need both — call check_compliance only when you want to audit the LIVE policy. One side effect: this repaints the projection on the operator\'s screen so they can follow your reasoning, so iterate deliberately rather than sweeping dozens of candidates.',
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
          totalMonthlyBudgetUsd: s.totalBudgetUsd, providers: s.providers,
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
        'Audit the live policy — or a candidate rule set if you pass one — against every constraint at once: latency ceilings, success-rate floors, quality gates, data-retention limits, the no-training-on-data requirement, AND the spend caps (TOTAL_BUDGET and PROVIDER_BUDGET blockers when projected spend exceeds a cap). Blockers mean the routing is not permissible as configured; warnings mean permissible but fragile. An empty blockers list is the bar a proposal should clear. Because spend is included, a clean result does mean the plan fits the operator\'s declared budget — but only the budget that is actually recorded, so if they stated a target in conversation, propose it via propose_budget_change first so it becomes auditable. simulate_policy returns this same verdict for a candidate; use this tool for the live policy.',
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
          totalMonthlyBudgetUsd: s.totalBudgetUsd, providers: s.providers,
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
        'Lint the live policy against the measurements and report everything wrong with it. Each finding carries a kind: "spend" means money is being wasted right now (a routed model that never succeeds, a class routed to something dearer than a compliant alternative, a model over $1 per 1000 delivered outputs that still fails its gates); "risk" means a fragility rather than a cost (a class with one or zero eligible models); "hygiene" means a data gap (catalogue entries priced but never measured). Only "spend" findings carry estimatedMonthlySavingsUsd — do not present risk or hygiene findings as costs. Every finding cites the numbers behind it. Start here when the operator asks an open question like "where is my money going", but say plainly that these are projections from declared volumes, not billed spend.',
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
            code: f.code, kind: f.kind, title: f.title, detail: f.detail,
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
          totalMonthlyBudgetUsd: s.totalBudgetUsd, providers: s.providers,
        });
        const blockers = vs.filter((v) => v.severity === 'blocker');

        const p = s.createProposal({
          kind: 'policy', rationale: a.rationale, rules,
          scope: null, providerId: null, monthlyBudgetUsd: null,
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
        "Ask the operator to change a monthly spend cap — either the total across all providers (scope 'total') or one provider's cap (scope 'provider'). Like routing, this is not applied directly: a budget is a spending authorisation, so only the human can grant it. WHAT A CAP DOES: it is advisory in the sense that nothing here proxies traffic, but it is enforced as a compliance blocker — check_compliance and simulate_policy both report TOTAL_BUDGET and PROVIDER_BUDGET blockers when projected spend exceeds a cap, so a routing proposal that busts a cap will not come back clean. If the operator states a spending target in conversation, propose it as the total cap so it becomes an auditable constraint rather than something you have to remember. Returns a proposal id to poll with get_proposal_status.",
      inputSchema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['total', 'provider'],
            description: "'total' changes the cap across all providers; 'provider' changes one provider's cap and requires providerId.",
          },
          providerId: { type: 'string', description: "Required when scope is 'provider'. Call list_providers for valid ids." },
          monthlyBudgetUsd: { type: 'number', description: 'Proposed new monthly cap in USD.' },
          rationale: { type: 'string', description: 'Why this cap, tied to projected spend.' },
        },
        required: ['scope', 'monthlyBudgetUsd', 'rationale'],
      },
      execute: (a) => {
        const s = get();
        const scope = a.scope === 'total' ? 'total' : a.scope === 'provider' ? 'provider' : null;
        if (!scope) return "scope must be 'total' or 'provider'. Nothing was proposed.";
        if (typeof a.monthlyBudgetUsd !== 'number' || !Number.isFinite(a.monthlyBudgetUsd) || a.monthlyBudgetUsd < 0) {
          return 'monthlyBudgetUsd must be a non-negative number. Nothing was proposed.';
        }
        if (typeof a.rationale !== 'string' || a.rationale.trim().length < 10) {
          return 'A rationale of at least 10 characters is required. Nothing was proposed.';
        }

        let label: string;
        let fromUsd: number;
        let providerId: string | null = null;
        if (scope === 'provider') {
          const pr = s.providers.find((x) => x.id === a.providerId);
          if (!pr) return `Unknown providerId "${a.providerId}". Valid: ${s.providers.map((x) => x.id).join(', ')}. Nothing was proposed.`;
          label = `${pr.name} monthly cap`;
          fromUsd = pr.monthlyBudgetUsd;
          providerId = pr.id;
        } else {
          label = 'total monthly cap';
          fromUsd = s.totalBudgetUsd;
        }

        const p = s.createProposal({
          kind: 'budget', rationale: a.rationale, rules: null,
          scope, providerId, monthlyBudgetUsd: a.monthlyBudgetUsd,
          projectionBefore: currentProjection(), projectionAfter: null,
        });
        const proj = currentProjection().totalMonthlyCostUsd;
        const fits = scope === 'total' ? proj <= a.monthlyBudgetUsd : true;
        return [
          `Proposal ${p.id} created and shown to the operator: change ${label} from $${fromUsd} to $${a.monthlyBudgetUsd}. Not applied.`,
          scope === 'total' && !fits
            ? `Note: the live policy already projects $${proj.toFixed(2)}/mo, so this cap would be breached immediately — pair it with a routing proposal.`
            : '',
          `Call get_proposal_status with proposalId "${p.id}" for the decision.`,
        ].filter(Boolean).join(' ');
      },
    },
    {
      name: 'withdraw_proposal',
      description:
        'Retract a proposal you submitted that is still pending, because you have thought better of it or are about to submit a corrected version. Only pending proposals can be withdrawn; an approved one has already been applied and a rejected one is already closed. Prefer this over leaving a stale proposal in the operator\'s queue.',
      inputSchema: {
        type: 'object',
        properties: { proposalId: { type: 'string', description: "Proposal id such as 'P-1'." } },
        required: ['proposalId'],
      },
      execute: (a) => {
        const s = get();
        const existing = s.proposals.find((x) => x.id === a.proposalId);
        if (!existing) return `Unknown proposalId "${a.proposalId}". Call get_proposal_status with no arguments to list all proposals.`;
        if (existing.status !== 'pending') {
          return `Proposal ${existing.id} is already ${existing.status} and cannot be withdrawn.`;
        }
        s.withdrawProposal(existing.id);
        return `Proposal ${existing.id} withdrawn and removed from the operator's queue.`;
      },
    },
    {
      name: 'get_proposal_status',
      readOnly: true,
      description:
        "Check what the operator decided about a proposal you submitted. Status is 'pending' (still on their screen), 'approved' (applied; re-read get_routing_policy to see the new state), 'rejected', or 'withdrawn' (you retracted it). A human decision can take minutes or hours: if it is still pending, report the proposal id to the user and stop rather than looping — do not resubmit the same rules, and use withdraw_proposal if you want to replace it. A rejection usually carries decisionNote explaining what was wrong; read it and propose a corrected version addressing that specific objection. Omit proposalId to list every proposal and its status.",
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
