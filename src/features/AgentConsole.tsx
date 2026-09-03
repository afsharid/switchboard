import { useEffect, useState } from 'react';
import { Badge, Card, Empty } from '../ui/primitives';
import { resolveModelContext } from '../webmcp/shim';
import type { ToolSpec, ToolStatus } from '../webmcp/useTool';

/**
 * Two independent signals that the tool layer works:
 *  - what the browser reports back through modelContext.getTools()
 *  - direct invocation of the page's own handlers
 * The first proves registration; the second lets a human exercise a tool
 * exactly as an agent would, which is also how a judge without a WebMCP
 * client can verify the project.
 */
export function AgentConsole({ specs, status }: { specs: ToolSpec[]; status: ToolStatus }) {
  const [reported, setReported] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string>(specs[0]?.name ?? '');
  const [argsText, setArgsText] = useState('{}');
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const { ctx } = resolveModelContext();
      if (!ctx?.getTools) return setReported(null);
      try {
        const tools = await ctx.getTools();
        if (alive) setReported((tools ?? []).map((t: any) => t.name).sort());
      } catch {
        if (alive) setReported(null);
      }
    };
    read();
    const { ctx } = resolveModelContext();
    ctx?.addEventListener?.('toolchange', read);
    return () => {
      alive = false;
      ctx?.removeEventListener?.('toolchange', read);
    };
  }, [status.registered.length]);

  const spec = specs.find((s) => s.name === selected);

  const run = async () => {
    if (!spec) return;
    setBusy(true);
    try {
      let parsed: unknown = {};
      if (argsText.trim()) {
        try {
          parsed = JSON.parse(argsText);
        } catch {
          setOutput('Arguments must be valid JSON.');
          setBusy(false);
          return;
        }
      }
      setOutput(await spec.execute(parsed));
    } catch (e) {
      setOutput(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Agent console"
      subtitle="Invoke any tool by hand, exactly as an agent would."
      right={
        status.supported
          ? (
            <Badge tone={status.registering ? 'info' : 'good'} title={status.surface}>
              {status.registering ? `registering ${status.registered.length}/${status.total}…` : `✓ ${status.registered.length} tools live`}
            </Badge>
          )
          : <Badge tone="warning">⚠ no WebMCP host</Badge>
      }
    >
      <dl className="mb-3 space-y-1 text-[11px]">
        <div className="flex justify-between gap-2">
          <dt style={{ color: 'var(--ink-muted)' }}>API surface</dt>
          <dd className="tnum">{status.surface}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt style={{ color: 'var(--ink-muted)' }}>registered by this page</dt>
          <dd className="tnum">{status.registered.length}/{status.total}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt style={{ color: 'var(--ink-muted)' }}>reported by getTools()</dt>
          <dd className="tnum">{reported === null ? 'unavailable' : reported.length}</dd>
        </div>
      </dl>

      {!status.supported && (
        <p className="mb-3 rounded p-2 text-[11px] leading-relaxed" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
          This browser does not expose <code>modelContext</code>, so no agent can discover the tools. Open the page in
          ChatGPT's in-app browser, or in Chrome with <code>chrome://flags/#enable-webmcp-testing</code> enabled. The
          console below still works — it calls the same handlers directly.
        </p>
      )}
      {status.error && (
        <p className="mb-3 rounded p-2 text-[11px]" style={{ background: 'var(--surface-2)', color: 'var(--critical-text)' }}>
          Registration error: {status.error}
        </p>
      )}

      <label className="block text-[11px]" style={{ color: 'var(--ink-muted)' }}>tool</label>
      <select
        value={selected}
        onChange={(e) => { setSelected(e.target.value); setArgsText('{}'); setOutput(null); }}
        className="mt-1 w-full rounded border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-white/25"
        style={{ borderColor: 'var(--hairline)', color: 'var(--ink)' }}
      >
        {specs.map((s) => (
          <option key={s.name} value={s.name} style={{ background: 'var(--surface-1)' }}>
            {s.name}
            {s.effect === 'proposal' ? '  · needs your approval'
              : s.effect === 'writes-now' ? '  · applies immediately'
                : ''}
          </option>
        ))}
      </select>

      {spec && (
        <p className="mt-2 max-h-24 overflow-auto text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          {spec.description}
        </p>
      )}

      <label className="mt-3 block text-[11px]" style={{ color: 'var(--ink-muted)' }}>arguments (JSON)</label>
      <textarea
        value={argsText} onChange={(e) => setArgsText(e.target.value)} rows={3} spellCheck={false}
        className="mt-1 w-full rounded border bg-transparent px-2 py-1.5 font-mono text-[11px] outline-none focus:border-white/25"
        style={{ borderColor: 'var(--hairline)', color: 'var(--ink)' }}
      />
      <button
        onClick={run} disabled={busy || !spec}
        className="mt-2 rounded px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
        style={{ background: 'var(--series-1)' }}
      >
        {busy ? 'running…' : 'Invoke'}
      </button>

      {output !== null && (
        <pre className="mt-3 max-h-64 overflow-auto rounded p-2 text-[10px] leading-tight whitespace-pre-wrap break-words"
          style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
{output}
        </pre>
      )}

      {reported !== null && reported.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            tools the browser reports
          </summary>
          <ul className="mt-1 grid grid-cols-2 gap-x-3 text-[10px] tnum" style={{ color: 'var(--ink-muted)' }}>
            {reported.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </details>
      )}
      {specs.length === 0 && <Empty>No tools built.</Empty>}
    </Card>
  );
}
