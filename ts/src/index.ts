export { NixExecutor } from "./executor.ts";
export type { NixExecutorOptions } from "./executor.ts";

// Re-export codemode types
export type { Executor, ResolvedProvider, ExecuteResult } from "@cloudflare/codemode";

// Convenience re-export (requires peer deps)
export { createCodeTool } from "@cloudflare/codemode/ai";

// Tools
export { nixRunProvider } from "./tools/index.ts";
export type { NixRunOptions } from "./tools/index.ts";
