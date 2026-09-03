export type Measured = {
  runs: number;
  requestSuccessRate: number;
  structuredOutputPassRate: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  meanInputTokens: number | null;
  meanOutputTokens: number | null;
  costPer1kSuccessfulUsd: number | null;
  meetsQualityGates: boolean;
  gateFailureReasons: string[];
  observedCalls: number;
};

export type Model = {
  id: string;
  displayName: string;
  providerId: string;
  protocol: string | null;
  inputUsdPerM: number;
  outputUsdPerM: number;
  pricingEffectiveDate: string;
  pricingSource: string;
  /** null = not documented for this model */
  dataRetentionDays: number | null;
  /** null = not documented */
  trainsOnData: boolean | null;
  measured: Measured | null;
};

export type Provider = {
  id: string;
  name: string;
  kind: 'gateway' | 'direct';
  /** user-declared */
  monthlyBudgetUsd: number;
};

export type Constraints = {
  maxP95Ms: number | null;
  minSuccessRate: number | null;
  requireQualityGates: boolean;
  /** route only to models documented to retain data for <= this many days */
  maxDataRetentionDays: number | null;
  allowTrainingOnData: boolean;
  /** refuse models with no measurements at all */
  requireMeasured: boolean;
};

export type TrafficClass = {
  id: string;
  name: string;
  description: string;
  /** user-declared expected volume */
  monthlyCalls: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  constraints: Constraints;
};

export type Rule = {
  classId: string;
  primaryModelId: string;
  fallbackModelIds: string[];
};

export type Policy = { rules: Rule[]; updatedAt: string };

export type ClassProjection = {
  classId: string;
  chain: string[];
  monthlyCostUsd: number;
  deliveredRate: number;
  costPerDeliveredUsd: number;
  expectedLatencyMs: number;
  /** sum of p95 across the whole chain — what you pay if every link but the last fails */
  worstCaseLatencyMs: number;
  /** probability the primary fails and a fallback is attempted at all */
  tailRiskProbability: number;
  /** chain links with no latency measurements — worstCaseLatencyMs is a lower bound while non-empty */
  unmeasuredLinks: string[];
  deliveredPerMonth: number;
};

export type Projection = {
  totalMonthlyCostUsd: number;
  perClass: ClassProjection[];
  perProviderUsd: Record<string, number>;
};

export type Violation = {
  severity: 'blocker' | 'warning';
  classId: string | null;
  modelId: string | null;
  code: string;
  message: string;
};

export type WasteFinding = {
  code: string;
  /** spend = money is being wasted now; risk = a fragility; hygiene = a data gap */
  kind: 'spend' | 'risk' | 'hygiene';
  title: string;
  detail: string;
  estimatedMonthlySavingsUsd: number | null;
  modelIds: string[];
};

export type ProposalKind = 'policy' | 'budget';

export type Proposal = {
  id: string;
  kind: ProposalKind;
  createdAt: string;
  rationale: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  decidedAt: string | null;
  decisionNote: string | null;
  /** policy proposals */
  rules: Rule[] | null;
  /** budget proposals */
  scope: 'provider' | 'total' | null;
  providerId: string | null;
  monthlyBudgetUsd: number | null;
  projectionBefore: Projection | null;
  projectionAfter: Projection | null;
};

export type ActivityEntry = {
  id: string;
  at: string;
  tool: string;
  args: unknown;
  result: string;
  ok: boolean;
  durationMs: number;
};

export type Insight = { id: string; at: string; title: string; body: string };

export type Provenance = {
  summary: string;
  measurementDate: string;
  caveat: string;
  runs: number;
  totalMeasuredCalls: number;
  totalMeasuredCostUsd: number;
};

export type EvalRun = {
  id: string;
  startedAt: string;
  profile: string;
  candidateCount: number;
  fixtureCount: number;
  repetitionsPerFixture: number;
  actualTotalNetworkCalls: number;
  budgetCapUsd: number;
  estimatedTotalCostUsd: number;
  pricingSnapshotDate: string;
};

export type Seed = {
  schemaVersion: number;
  generatedAt: string;
  provenance: Provenance;
  evalRuns: EvalRun[];
  models: Model[];
};
