import { useMemo, useState } from 'react';
import { buildTools } from './webmcp/tools';
import { useTools, type ToolSpec } from './webmcp/useTool';
import { useSwitchboard } from './store/useSwitchboard';
import { Badge } from './ui/primitives';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { AgentConsole } from './features/AgentConsole';
import {
  ActivityPanel, ClassesPanel, InsightsPanel, KpiRow, ModelsPanel, ProposalsPanel,
  ProvenanceFooter, ProvidersPanel, SimulationBanner, WastePanel,
} from './features/Panels';

/** Every agent tool call lands in the activity feed, so the human can audit it. */
function withLogging(specs: ToolSpec[]): ToolSpec[] {
  return specs.map((spec) => ({
    ...spec,
    execute: async (args: unknown) => {
      const t0 = performance.now();
      try {
        const result = await spec.execute(args);
        useSwitchboard.getState().logActivity({
          tool: spec.name, args, result, ok: true, durationMs: Math.round(performance.now() - t0),
        });
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        useSwitchboard.getState().logActivity({
          tool: spec.name, args, result: msg, ok: false, durationMs: Math.round(performance.now() - t0),
        });
        return `Tool ${spec.name} failed: ${msg}`;
      }
    },
  }));
}

export function App() {
  const resetDemo = useSwitchboard((s) => s.resetDemo);
  const proposals = useSwitchboard((s) => s.proposals);
  const specs = useMemo(() => withLogging(buildTools()), []);
  const [confirmReset, setConfirmReset] = useState(false);
  const status = useTools(specs);
  const pending = proposals.filter((p) => p.status === 'pending').length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Switchboard</h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            LLM spend &amp; routing control center — operated by a human and an agent at the same board.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.supported
            ? (
              <Badge tone={status.registering ? 'info' : 'good'} title={status.surface}>
                {status.registering
                  ? `registering ${status.registered.length}/${status.total} tools…`
                  : `✓ agent-ready · ${status.registered.length} tools`}
              </Badge>
            )
            : <Badge tone="warning" title="Open in ChatGPT's in-app browser or Chrome with WebMCP enabled">⚠ no WebMCP host</Badge>}
          {pending > 0 && <Badge tone="warning">{pending} awaiting approval</Badge>}
          <button
            onClick={() => setConfirmReset(true)}
            className="rounded border px-2 py-1 text-xs hover:bg-white/5"
            style={{ borderColor: 'var(--hairline)', color: 'var(--ink-muted)' }}
          >
            Reset demo
          </button>
        </div>
      </header>

      <KpiRow />

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_360px]">
        {/* min-w-0: grid items are min-width:auto by default, so the 640px
            model table inside this column stretched the whole page and gave
            phones 292px of horizontal scroll */}
        <div className="min-w-0 space-y-3">
          <SimulationBanner />
          <ProposalsPanel />
          <ClassesPanel />
          <ModelsPanel />
        </div>
        <div className="min-w-0 space-y-3">
          <ProvidersPanel />
          <InsightsPanel />
          <WastePanel />
          <AgentConsole specs={specs} status={status} />
          <ActivityPanel />
        </div>
      </div>

      <ProvenanceFooter />

      <ConfirmDialog
        open={confirmReset}
        title="Reset to the seeded demo state?"
        body="This clears the routing policy, budget caps, traffic-class constraints, proposals, pinned insights and the activity feed, and restores everything to the state a first-time visitor sees."
        confirmLabel="Reset demo"
        onConfirm={() => { resetDemo(); setConfirmReset(false); }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
