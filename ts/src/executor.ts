// NixExecutor — implements codemode's Executor interface
// Spawns gun, sends execute request over stdin, reads result from stdout.

import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import type { Executor, ResolvedProvider, ExecuteResult } from "./codemode/types.ts";

interface ToolManifest {
  tools: Array<{
    attr: string;
    description: string;
    mainProgram: string | null;
    homepage: string;
    binaries: string[];
  }>;
}

export interface NixExecutorOptions {
  /** Path to the gun binary. Defaults to finding bin/gun relative to this file. */
  gunPath?: string;
  /** Execution timeout in ms. Default 30000. */
  timeout?: number;
}

/** Tool-specific syntax hints for tools LLMs commonly get wrong */
const TOOL_HINTS: Record<string, string> = {
  nushell: `  Usage: exec("nu", ["-c", "<nushell code>"])
  IMPORTANT nushell syntax (v0.90+):
    Arithmetic: nu -c "2 + 3"  (NOT "math eval")
    Parse JSON: nu -c "'{\\"key\\":\\"val\\"}' | from json | get key"
    Split string: nu -c "'a-b-c' | split row '-' | get 1"  (NOT "split '-'")
    CSV from stdin: exec("nu", ["-c", "$in | from csv | ..."], { stdin: csvData })
    List + filter: nu -c "ls /tmp | where type == dir | length"
    Sort table: nu -c "[[name age]; [Alice 30] [Bob 25]] | sort-by age"
    String interpolation: nu -c "let x = 5; $\\"result: ($x)\\""`,
};

export class NixExecutor implements Executor {
  #gunPath: string;
  #timeout: number;
  #manifestCache: ToolManifest | null = null;

  constructor(options: NixExecutorOptions = {}) {
    this.#gunPath = options.gunPath ?? "gun";
    this.#timeout = options.timeout ?? 30000;
  }

  /** Get the tool manifest embedded in the gun binary */
  getManifest(): ToolManifest {
    if (!this.#manifestCache) {
      const output = execFileSync(this.#gunPath, ["manifest"], {
        encoding: "utf-8",
        timeout: 5000,
      });
      this.#manifestCache = JSON.parse(output);
    }
    return this.#manifestCache!;
  }

  /** Generate a tool description string for LLM consumption */
  getToolDescription(): string {
    const manifest = this.getManifest();

    let toolCards = "";
    for (const tool of manifest.tools) {
      const binary = tool.mainProgram ?? tool.binaries[0] ?? tool.attr;

      if (tool.binaries.length > 20) {
        // Multi-binary package (like coreutils) — summarize
        const common = tool.binaries
          .filter((b) => !["[", "test", "true", "false", "coreutils"].includes(b))
          .slice(0, 25)
          .join(", ");
        toolCards += `\n## ${tool.attr} — ${tool.description}\n`;
        toolCards += `  Binaries: ${common}, ...\n`;
        toolCards += `  (run exec("<cmd>", ["--help"]) for usage)\n`;
      } else {
        toolCards += `\n## ${binary} — ${tool.description}\n`;
        if (binary !== tool.attr) {
          toolCards += `  Package: ${tool.attr}\n`;
        }
        toolCards += `  Example: exec("${binary}", [<args>])\n`;
      }

      // Tool-specific hints for syntax LLMs commonly get wrong
      const hints = TOOL_HINTS[tool.attr];
      if (hints) {
        toolCards += hints + "\n";
      }
    }

    return `Execute code to achieve a goal.

Inside the sandbox, use exec() to run CLI tools:
  exec(cmd, args, opts?) → Promise<{ stdout, stderr, code }>
  opts: { stdin?: string }

Available tools:
${toolCards}
If unsure about a tool's syntax, run exec("tldr", ["<tool>"]) to get usage examples.

Write an async arrow function in JavaScript that returns the result.
Do NOT use TypeScript syntax — no type annotations, interfaces, or generics.
Do NOT define named functions then call them — just write the arrow function body directly.

Example: async () => { const { stdout } = await exec("jq", ["-n", "2+3"]); return stdout.trim(); }`;
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
        const hint =
          err.message.includes("ENOENT")
            ? `gun binary not found at "${this.#gunPath}". Install via: nix build github:lessuseless-labs/construct — or set GUN_PATH to the binary location.`
            : `Failed to spawn gun: ${err.message}`;
        done({ result: null, error: hint });
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
