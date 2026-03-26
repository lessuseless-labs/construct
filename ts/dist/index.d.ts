import { Executor, ResolvedProvider, ExecuteResult } from '@cloudflare/codemode';
export { ExecuteResult, Executor, ResolvedProvider } from '@cloudflare/codemode';
export { createCodeTool } from '@cloudflare/codemode/ai';

interface ToolManifest {
    tools: Array<{
        attr: string;
        description: string;
        mainProgram: string | null;
        homepage: string;
        binaries: string[];
    }>;
}
interface NixExecutorOptions {
    /** Path to the gun binary. Defaults to finding bin/gun relative to this file. */
    gunPath?: string;
    /** Execution timeout in ms. Default 30000. */
    timeout?: number;
}
declare class NixExecutor implements Executor {
    #private;
    constructor(options?: NixExecutorOptions);
    /** Get the tool manifest embedded in the gun binary */
    getManifest(): ToolManifest;
    /** Generate a tool description string for LLM consumption */
    getToolDescription(): string;
    execute(code: string, providersOrFns: ResolvedProvider[] | Record<string, (...args: unknown[]) => Promise<unknown>>): Promise<ExecuteResult>;
}

export { NixExecutor, type NixExecutorOptions };
