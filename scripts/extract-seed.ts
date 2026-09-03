/**
 * Derives src/data/seed.json from the author's own multi-provider LLM
 * evaluation runs. Run once locally; the output is committed.
 *
 * STRICT ALLOWLIST: only the fields named in ALLOWED_* below are emitted.
 * Prompts, fixture ids, response text, evidence refs and every credential
 * stay out of this repo.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'data', 'seed.json');
const VW = process.env.VOLTWISE_ROOT ?? '/Users/mini/Projects/voltwise';
const EVAL = join(VW, 'apps/api/src/ai/evaluation');
const REPORTS = join(VW, 'reports/ai-evaluation');

// --- allowlists -------------------------------------------------------------
const ALLOWED_MODEL_KEYS = new Set([
  'id', 'displayName', 'providerId', 'protocol', 'inputUsdPerM', 'outputUsdPerM',
  'pricingEffectiveDate', 'pricingSource', 'dataRetentionDays', 'trainsOnData', 'measured',
]);
const ALLOWED_MEASURED_KEYS = new Set([
  'runs', 'requestSuccessRate', 'structuredOutputPassRate', 'medianLatencyMs', 'p95LatencyMs',
  'meanInputTokens', 'meanOutputTokens', 'costPer1kSuccessfulUsd', 'meetsQualityGates',
  'gateFailureReasons', 'observedCalls',
]);

type Measured = {
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

async function main() {
  // 1. gateway catalog (19 models, priced, with governance metadata)
  const cat: any = await import(join(EVAL, 'opencode-go/opencode-go.catalog.ts'));
  const gateway: any[] = cat.OPENCODE_GO_DOCUMENTED_PROTOCOL_METADATA;
  if (!Array.isArray(gateway) || gateway.length === 0) throw new Error('gateway catalog empty');

  // 2. direct-provider candidates (public price snapshots)
  const cnd: any = await import(join(EVAL, 'candidates.ts'));
  const direct: any[] = cnd.EVALUATION_CANDIDATES;
  if (!Array.isArray(direct) || direct.length === 0) throw new Error('candidates empty');

  // 3. measured behaviour, merged across every completed run
  const runDirs = readdirSync(REPORTS).filter((d) => existsSync(join(REPORTS, d, 'results.json')));
  const acc = new Map<string, { s: any[]; calls: number }>();
  const evalRuns: any[] = [];

  for (const d of runDirs.sort()) {
    const r = JSON.parse(readFileSync(join(REPORTS, d, 'results.json'), 'utf8'));
    if (r.evaluationValidity && r.evaluationValidity !== 'VALID') continue;
    evalRuns.push({
      id: d,
      startedAt: r.startedAt,
      profile: r.profile,
      candidateCount: r.candidateCount,
      fixtureCount: r.fixtureCount,
      repetitionsPerFixture: r.repetitionsPerFixture,
      actualTotalNetworkCalls: r.actualTotalNetworkCalls,
      budgetCapUsd: r.budgetCapUsd,
      estimatedTotalCostUsd: r.estimatedTotalCostUsd,
      pricingSnapshotDate: r.pricingSnapshotDate,
    });
    const callsByCandidate = new Map<string, number>();
    for (const a of r.attempts ?? []) {
      callsByCandidate.set(a.candidateId, (callsByCandidate.get(a.candidateId) ?? 0) + 1);
    }
    for (const m of r.modelSummaries ?? []) {
      if (!acc.has(m.candidateId)) acc.set(m.candidateId, { s: [], calls: 0 });
      const e = acc.get(m.candidateId)!;
      e.s.push(m);
      e.calls += callsByCandidate.get(m.candidateId) ?? 0;
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const num = (xs: any[]) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x)) as number[];

  function measuredFor(candidateId: string): Measured | null {
    const e = acc.get(candidateId);
    if (!e || e.s.length === 0) return null;
    // only runs that actually issued calls for this candidate carry signal
    const withData = e.s.filter((m) => typeof m.medianLatencyMs === 'number' && m.medianLatencyMs > 0);
    const pool = withData.length ? withData : e.s;
    return {
      runs: pool.length,
      requestSuccessRate: mean(num(pool.map((m) => m.requestSuccessRate))) ?? 0,
      structuredOutputPassRate: mean(num(pool.map((m) => m.structuredOutputPassRate))) ?? 0,
      medianLatencyMs: Math.round(mean(num(pool.map((m) => m.medianLatencyMs))) ?? 0),
      p95LatencyMs: Math.round(mean(num(pool.map((m) => m.p95LatencyMs))) ?? 0),
      meanInputTokens: mean(num(pool.map((m) => m.meanInputTokens))),
      meanOutputTokens: mean(num(pool.map((m) => m.meanOutputTokens))),
      costPer1kSuccessfulUsd: mean(num(pool.map((m) => m.costPer1000SuccessfulExplanationsEstimate))),
      meetsQualityGates: pool.some((m) => m.meetsMinimumQualityGates === true),
      gateFailureReasons: Array.from(
        new Set(pool.flatMap((m) => (Array.isArray(m.gateFailureReasons) ? m.gateFailureReasons : []))),
      ),
      observedCalls: e.calls,
    };
  }

  const models: any[] = [];

  for (const m of gateway) {
    models.push({
      id: `opencode-go/${m.id}`,
      displayName: m.displayName,
      providerId: 'opencode-go',
      protocol: m.protocol,
      inputUsdPerM: m.pricing.inputUsdPerM,
      outputUsdPerM: m.pricing.outputUsdPerM,
      pricingEffectiveDate: m.pricing.effectiveDate,
      pricingSource: 'dev.opencode.ai/docs/go/ (retrieved 2026-08-20)',
      dataRetentionDays: m.dataRetentionDays,
      trainsOnData: m.modelTraining === true ? true : m.modelTraining === false ? false : null,
      measured: measuredFor(`opencode-go/${m.id}`),
    });
  }

  for (const c of direct) {
    models.push({
      id: c.candidateId,
      displayName: c.displayName ?? c.model,
      providerId: c.provider,
      protocol: null,
      inputUsdPerM: c.pricing.inputUsdPerM,
      outputUsdPerM: c.pricing.outputUsdPerM,
      pricingEffectiveDate: c.pricing.effectiveDate,
      pricingSource: 'provider public pricing page',
      dataRetentionDays: null,
      trainsOnData: null,
      measured: measuredFor(c.candidateId),
    });
  }

  // --- allowlist enforcement ------------------------------------------------
  for (const m of models) {
    for (const k of Object.keys(m)) {
      if (!ALLOWED_MODEL_KEYS.has(k)) throw new Error(`model key not allowlisted: ${k}`);
    }
    if (m.measured) {
      for (const k of Object.keys(m.measured)) {
        if (!ALLOWED_MEASURED_KEYS.has(k)) throw new Error(`measured key not allowlisted: ${k}`);
      }
    }
  }

  const runCount = evalRuns.length;
  const callCount = evalRuns.reduce((a, r) => a + (r.actualTotalNetworkCalls ?? 0), 0);

  const out = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    provenance: {
      summary:
        `Prices and governance metadata are transcribed from published provider/gateway documentation. Latency, success rates, token means and cost-per-successful-output are the author’s own measurements from ${runCount} valid live evaluation runs on 2026-08-20 covering ${callCount} real API calls.`,
      measurementDate: '2026-08-20',
      caveat:
        'Usage-value estimates for planning, not production billing. Measured on one structured-output task; treat as indicative, not a general capability benchmark.',
      runs: runCount,
      totalMeasuredCalls: callCount,
      totalMeasuredCostUsd: Number(
        evalRuns.reduce((a, r) => a + (r.estimatedTotalCostUsd ?? 0), 0).toFixed(6),
      ),
    },
    evalRuns,
    models,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  const json = JSON.stringify(out, null, 2);

  // --- secret scan ---------------------------------------------------------
  for (const pat of [/sk-[A-Za-z0-9]/, /AKIA[0-9A-Z]{6}/, /Bearer\s+\S/, /API_KEY/, /BEGIN [A-Z ]*PRIVATE KEY/]) {
    if (pat.test(json)) throw new Error(`possible secret matched ${pat} — refusing to write`);
  }

  writeFileSync(OUT, json + '\n');
  const measured = models.filter((m) => m.measured).length;
  console.log(`wrote ${OUT}`);
  console.log(`  models: ${models.length} (${measured} with measurements)`);
  console.log(`  runs: ${evalRuns.length}, calls: ${out.provenance.totalMeasuredCalls}, cost: $${out.provenance.totalMeasuredCostUsd}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
