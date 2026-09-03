/**
 * WebMCP moved its imperative getter from Navigator to Document in the
 * 2026-05-27 spec draft (Chrome 150+). `use-webmcp-tool` targets
 * document.modelContext only, so we resolve both and expose whichever the
 * host browser actually implements. ChatGPT's in-app browser and Chrome
 * behind chrome://flags/#enable-webmcp-testing are the two supported hosts.
 */
type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (args: any, ctx: { signal?: AbortSignal }) => Promise<unknown> | unknown;
};

export type ModelContextLike = {
  registerTool: (t: ToolDescriptor, o?: { signal?: AbortSignal }) => Promise<void> | void;
  getTools?: () => Promise<any[]> | any[];
  executeTool?: (tool: any, inputJson: string, o?: { signal?: AbortSignal }) => Promise<any>;
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
};

export function resolveModelContext(): { ctx: ModelContextLike | null; surface: string } {
  if (typeof document !== 'undefined' && (document as any).modelContext) {
    return { ctx: (document as any).modelContext as ModelContextLike, surface: 'document.modelContext' };
  }
  if (typeof navigator !== 'undefined' && (navigator as any).modelContext) {
    return { ctx: (navigator as any).modelContext as ModelContextLike, surface: 'navigator.modelContext (legacy)' };
  }
  return { ctx: null, surface: 'unavailable' };
}

/** True when the page can expose tools to an agent at all. */
export const webmcpAvailable = (): boolean => resolveModelContext().ctx !== null;
