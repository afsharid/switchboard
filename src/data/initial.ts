import seedJson from './seed.json';
import type { Policy, Provider, Seed, TrafficClass } from '../domain/types';

export const seed = seedJson as unknown as Seed;

/**
 * Traffic classes are the routing dimension. They deliberately differ by
 * *constraint*, not by assumed model capability — the measurements cover one
 * structured-output task, so inventing per-task quality scores would be
 * fabrication. Volumes and token profiles are declared by the operator and
 * are editable in the UI; nothing here is presented as measured.
 */
export const INITIAL_CLASSES: TrafficClass[] = [
  {
    id: 'realtime',
    name: 'Realtime explanations',
    description: 'User is waiting on screen. Tail latency is the binding constraint.',
    monthlyCalls: 40_000,
    avgInputTokens: 490,
    avgOutputTokens: 114,
    constraints: {
      maxP95Ms: 4000,
      minSuccessRate: 0.8,
      requireQualityGates: false,
      maxDataRetentionDays: null,
      allowTrainingOnData: true,
      requireMeasured: true,
    },
  },
  {
    id: 'batch',
    name: 'Overnight batch',
    description: 'Nobody is waiting. Cost per delivered output is all that matters.',
    monthlyCalls: 120_000,
    avgInputTokens: 516,
    avgOutputTokens: 70,
    constraints: {
      maxP95Ms: null,
      minSuccessRate: 0.5,
      requireQualityGates: false,
      maxDataRetentionDays: null,
      allowTrainingOnData: true,
      requireMeasured: true,
    },
  },
  {
    id: 'sensitive',
    name: 'Customer-data explanations',
    description:
      'Payload contains customer records. Must not be retained and must not be trained on, whatever it costs.',
    monthlyCalls: 8_000,
    avgInputTokens: 560,
    avgOutputTokens: 160,
    constraints: {
      maxP95Ms: 8000,
      minSuccessRate: 0.9,
      requireQualityGates: true,
      maxDataRetentionDays: 0,
      allowTrainingOnData: false,
      requireMeasured: true,
    },
  },
];

/**
 * The starting policy is the one an operator drifts into: whatever looked
 * cheap or capable at the time, never revisited against the measurements.
 * Every problem in it is real and provable from seed.json.
 */
export const INITIAL_POLICY: Policy = {
  updatedAt: seed.generatedAt,
  rules: [
    // p95 of 9340ms against a 4000ms ceiling.
    { classId: 'realtime', primaryModelId: 'opencode-go/deepseek-v4-flash', fallbackModelIds: ['opencode-go/kimi-k2.6'] },
    // $2.24 per 1k successful outputs at a 45% success rate.
    { classId: 'batch', primaryModelId: 'opencode-go/qwen3.8-max', fallbackModelIds: ['opencode-go/glm-5.2'] },
    // The only model that passes quality gates — and it retains data for 30 days.
    { classId: 'sensitive', primaryModelId: 'opencode-go/gpt-5.6-luna', fallbackModelIds: [] },
  ],
};

export const INITIAL_PROVIDERS: Provider[] = (() => {
  const ids = Array.from(new Set(seed.models.map((m) => m.providerId)));
  const budgets: Record<string, number> = {
    'opencode-go': 40,
    openai: 25,
    google: 15,
    anthropic: 15,
    deepseek: 10,
  };
  const names: Record<string, string> = {
    'opencode-go': 'OpenCode Go (gateway)',
    openai: 'OpenAI',
    google: 'Google',
    anthropic: 'Anthropic',
    deepseek: 'DeepSeek',
  };
  return ids.map((id) => ({
    id,
    name: names[id] ?? id,
    kind: id === 'opencode-go' ? ('gateway' as const) : ('direct' as const),
    monthlyBudgetUsd: budgets[id] ?? 10,
  }));
})();

/** Operator-declared, editable. Not measured. */
export const INITIAL_TOTAL_BUDGET_USD = 60;
