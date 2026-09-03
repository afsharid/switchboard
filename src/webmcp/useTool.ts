import { useEffect, useRef, useState } from 'react';
import { resolveModelContext, type ModelContextLike } from './shim';

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  execute: (args: any) => Promise<string> | string;
};

export type ToolStatus = {
  supported: boolean;
  surface: string;
  registered: string[];
  total: number;
  registering: boolean;
  error: string | null;
};

/**
 * Registers every tool against whichever modelContext surface the host
 * exposes, and unregisters them on unmount via one AbortController — so the
 * tool list an agent sees always matches what is actually mounted.
 *
 * Support is reported the moment the surface is found, not after the last
 * registration resolves: each registerTool is an IPC round trip, so waiting
 * for all of them left the UI claiming there was no WebMCP host while
 * registration was in fact already under way.
 */
export function useTools(specs: ToolSpec[]): ToolStatus {
  const [status, setStatus] = useState<ToolStatus>(() => {
    const { ctx, surface } = resolveModelContext();
    return {
      supported: ctx !== null, surface, registered: [],
      total: specs.length, registering: ctx !== null, error: null,
    };
  });

  // specs are rebuilt every render; keep the latest without re-registering
  const specsRef = useRef(specs);
  specsRef.current = specs;

  const names = specs.map((s) => s.name).join(',');

  useEffect(() => {
    const { ctx, surface } = resolveModelContext();
    const total = specsRef.current.length;

    if (!ctx) {
      setStatus({ supported: false, surface, registered: [], total, registering: false, error: null });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setStatus({ supported: true, surface, registered: [], total, registering: true, error: null });

    const register = async (spec: ToolSpec) => {
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
      if (!cancelled) {
        setStatus((prev) => ({ ...prev, registered: [...prev.registered, spec.name] }));
      }
    };

    // registered in parallel: each call is an IPC round trip, and the host
    // returns getTools() alphabetically regardless of registration order
    Promise.allSettled(specsRef.current.map(register)).then((results) => {
      if (cancelled) return;
      const failed = results.filter((r) => r.status === 'rejected');
      setStatus((prev) => ({
        ...prev,
        registering: false,
        error: failed.length
          ? `${failed.length} of ${total} tools failed to register: ${
              (failed[0] as PromiseRejectedResult).reason instanceof Error
                ? (failed[0] as PromiseRejectedResult).reason.message
                : String((failed[0] as PromiseRejectedResult).reason)
            }`
          : null,
      }));
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [names]);

  return status;
}
