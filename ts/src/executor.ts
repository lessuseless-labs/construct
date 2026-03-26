// NixExecutor — implements codemode's Executor interface
// Spawns gun, sends execute request over stdin, reads result from stdout.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Executor, ResolvedProvider, ExecuteResult } from "@cloudflare/codemode";

export interface NixExecutorOptions {
  /** Path to the gun binary. Defaults to finding bin/gun relative to this file. */
  gunPath?: string;
  /** Execution timeout in ms. Default 30000. */
  timeout?: number;
}

export class NixExecutor implements Executor {
  #gunPath: string;
  #timeout: number;

  constructor(options: NixExecutorOptions = {}) {
    this.#gunPath = options.gunPath ?? new URL("../../bin/gun", import.meta.url).pathname;
    this.#timeout = options.timeout ?? 30000;
  }

  async execute(
    code: string,
    providersOrFns:
      | ResolvedProvider[]
      | Record<string, (...args: unknown[]) => Promise<unknown>>,
  ): Promise<ExecuteResult> {
    // Normalize legacy format
    const providers: ResolvedProvider[] = Array.isArray(providersOrFns)
      ? providersOrFns
      : [{ name: "codemode", fns: providersOrFns }];

    // Serialize provider metadata (names + tool names, NOT functions)
    const providerDefs = providers.map((p) => ({
      name: p.name,
      tools: Object.keys(p.fns),
      positionalArgs: p.positionalArgs ?? false,
    }));

    // Build fn lookup for dispatching tool calls
    const fnLookup = new Map<string, Map<string, (...args: unknown[]) => Promise<unknown>>>();
    for (const p of providers) {
      fnLookup.set(p.name, new Map(Object.entries(p.fns)));
    }

    return this.#run(code, providerDefs, fnLookup);
  }

  #run(
    code: string,
    providerDefs: Array<{ name: string; tools: string[]; positionalArgs: boolean }>,
    fnLookup: Map<string, Map<string, (...args: unknown[]) => Promise<unknown>>>,
  ): Promise<ExecuteResult> {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (result: ExecuteResult) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        resolve(result);
      };

      const child = spawn(this.#gunPath, [], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // Set up line reader on stdout
      const rl = createInterface({ input: child.stdout! });

      rl.on("line", async (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const msg = JSON.parse(trimmed);

          // Tool call relay from sandbox
          if (msg.method === "tool/call") {
            const { provider, tool, args } = msg.params;
            const providerFns = fnLookup.get(provider);
            const fn = providerFns?.get(tool);

            let response: string;
            if (!fn) {
              response = JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                error: { code: -32601, message: `Unknown tool: ${provider}.${tool}` },
              });
            } else {
              try {
                const parsed = JSON.parse(args);
                const result = await fn(parsed);
                response = JSON.stringify({
                  jsonrpc: "2.0",
                  id: msg.id,
                  result: { value: result },
                });
              } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                response = JSON.stringify({
                  jsonrpc: "2.0",
                  id: msg.id,
                  error: { code: -32000, message: errMsg },
                });
              }
            }

            child.stdin!.write(response + "\n");
            return;
          }

          // Final result (JSON-RPC response to our execute request)
          if (msg.id != null && msg.result != null) {
            done({
              result: msg.result.result ?? null,
              error: msg.result.error,
              logs: msg.result.logs,
            });
            return;
          }

          // JSON-RPC error response
          if (msg.id != null && msg.error != null) {
            done({ result: null, error: msg.error.message });
            return;
          }
        } catch {
          // ignore malformed lines
        }
      });

      child.on("error", (err: Error) => {
        done({ result: null, error: `Failed to spawn gun: ${err.message}` });
      });

      child.on("close", (exitCode: number | null) => {
        if (exitCode !== 0) {
          done({ result: null, error: stderr || `gun exited with code ${exitCode}` });
        }
      });

      // Send execute request — don't close stdin, we need it for tool responses
      const request = JSON.stringify({
        jsonrpc: "2.0",
        method: "execute",
        id: 1,
        params: {
          code,
          providers: providerDefs,
          timeout: this.#timeout,
        },
      });

      child.stdin!.write(request + "\n");

      // Timeout
      const timer = setTimeout(() => {
        done({ result: null, error: "Execution timed out" });
      }, this.#timeout);
    });
  }
}
