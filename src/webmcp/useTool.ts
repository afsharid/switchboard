import { useEffect, useRef, useState } from 'react';
import { resolveModelContext, type ModelContextLike } from './shim';

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  execute: (args: any) => Promise<string> | string;
};

export type ToolStatus = { supported: boolean; surface: string; registered: string[]; error: string | null };

/**
 * Registers every tool against whichever modelContext surface the host
 * exposes, and unregisters them on unmount via one AbortController — so the
 * tool list an agent sees always matches what is actually mounted.
 */
export function useTools(specs: ToolSpec[]): ToolStatus {
  const [status, setStatus] = useState<ToolStatus>({
    supported: false, surface: 'unavailable', registered: [], error: null,
  });
  // specs are rebuilt every render; keep the latest without re-registering
  const specsRef = useRef(specs);
  specsRef.current = specs;

  const names = specs.map((s) => s.name).join(',');

  useEffect(() => {
    const { ctx, surface } = resolveModelContext();
    if (!ctx) {
      setStatus({ supported: false, surface, registered: [], error: null });
      return;
    }
    const controller = new AbortController();
    const registered: string[] = [];
    let cancelled = false;

    (async () => {
      try {
        for (const spec of specsRef.current) {
          await (ctx as ModelContextLike).registerTool(
            {
              name: spec.name,
              description: spec.description,
              inputSchema: spec.inputSchema,
              annotations: { readOnlyHint: spec.readOnly === true, untrustedContentHint: false },
              execute: async (args: unknown) => {
                const live = specsRef.current.find((s) => s.name === spec.name);
                if (!live) return `Tool ${spec.name} is no longer available.`;
                return await live.execute(args ?? {});
              },
            },
            { signal: controller.signal },
          );
          registered.push(spec.name);
        }
        if (!cancelled) setStatus({ supported: true, surface, registered, error: null });
      } catch (e) {
        if (!cancelled) {
          setStatus({
            supported: true, surface, registered,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [names]);

  return status;
}
