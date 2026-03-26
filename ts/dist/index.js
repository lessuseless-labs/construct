// src/executor.ts
import { spawn, execFileSync } from "child_process";
import { createInterface } from "readline";
var TOOL_HINTS = {
  nushell: `  Usage: exec("nu", ["-c", "<nushell code>"])
  IMPORTANT nushell syntax (v0.90+):
    Arithmetic: nu -c "2 + 3"  (NOT "math eval")
    Parse JSON: nu -c "'{\\"key\\":\\"val\\"}' | from json | get key"
    Split string: nu -c "'a-b-c' | split row '-' | get 1"  (NOT "split '-'")
    CSV from stdin: exec("nu", ["-c", "$in | from csv | ..."], { stdin: csvData })
    List + filter: nu -c "ls /tmp | where type == dir | length"
    Sort table: nu -c "[[name age]; [Alice 30] [Bob 25]] | sort-by age"
    String interpolation: nu -c "let x = 5; $\\"result: ($x)\\""`
};
var NixExecutor = class {
  #gunPath;
  #timeout;
  #manifestCache = null;
  constructor(options = {}) {
    this.#gunPath = options.gunPath ?? "gun";
    this.#timeout = options.timeout ?? 3e4;
  }
  /** Get the tool manifest embedded in the gun binary */
  getManifest() {
    if (!this.#manifestCache) {
      const output = execFileSync(this.#gunPath, ["manifest"], {
        encoding: "utf-8",
        timeout: 5e3
      });
      this.#manifestCache = JSON.parse(output);
    }
    return this.#manifestCache;
  }
  /** Generate a tool description string for LLM consumption */
  getToolDescription() {
    const manifest = this.getManifest();
    let toolCards = "";
    for (const tool of manifest.tools) {
      const binary = tool.mainProgram ?? tool.binaries[0] ?? tool.attr;
      if (tool.binaries.length > 20) {
        const common = tool.binaries.filter((b) => !["[", "test", "true", "false", "coreutils"].includes(b)).slice(0, 25).join(", ");
        toolCards += `
## ${tool.attr} \u2014 ${tool.description}
`;
        toolCards += `  Binaries: ${common}, ...
`;
        toolCards += `  (run exec("<cmd>", ["--help"]) for usage)
`;
      } else {
        toolCards += `
## ${binary} \u2014 ${tool.description}
`;
        if (binary !== tool.attr) {
          toolCards += `  Package: ${tool.attr}
`;
        }
        toolCards += `  Example: exec("${binary}", [<args>])
`;
      }
      const hints = TOOL_HINTS[tool.attr];
      if (hints) {
        toolCards += hints + "\n";
      }
    }
    return `Execute code to achieve a goal.

Inside the sandbox, use exec() to run CLI tools:
  exec(cmd, args, opts?) \u2192 Promise<{ stdout, stderr, code }>
  opts: { stdin?: string }

Available tools:
${toolCards}
If unsure about a tool's syntax, run exec("tldr", ["<tool>"]) to get usage examples.

Write an async arrow function in JavaScript that returns the result.
Do NOT use TypeScript syntax \u2014 no type annotations, interfaces, or generics.
Do NOT define named functions then call them \u2014 just write the arrow function body directly.

Example: async () => { const { stdout } = await exec("jq", ["-n", "2+3"]); return stdout.trim(); }`;
  }
  async execute(code, providersOrFns) {
    const providers = Array.isArray(providersOrFns) ? providersOrFns : [{ name: "codemode", fns: providersOrFns }];
    const providerDefs = providers.map((p) => ({
      name: p.name,
      tools: Object.keys(p.fns),
      positionalArgs: p.positionalArgs ?? false
    }));
    const fnLookup = /* @__PURE__ */ new Map();
    for (const p of providers) {
      fnLookup.set(p.name, new Map(Object.entries(p.fns)));
    }
    return this.#run(code, providerDefs, fnLookup);
  }
  #run(code, providerDefs, fnLookup) {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        resolve(result);
      };
      const child = spawn(this.#gunPath, [], {
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      const rl = createInterface({ input: child.stdout });
      rl.on("line", async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.method === "tool/call") {
            const { provider, tool, args } = msg.params;
            const providerFns = fnLookup.get(provider);
            const fn = providerFns?.get(tool);
            let response;
            if (!fn) {
              response = JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                error: { code: -32601, message: `Unknown tool: ${provider}.${tool}` }
              });
            } else {
              try {
                const parsed = JSON.parse(args);
                const result = await fn(parsed);
                response = JSON.stringify({
                  jsonrpc: "2.0",
                  id: msg.id,
                  result: { value: result }
                });
              } catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                response = JSON.stringify({
                  jsonrpc: "2.0",
                  id: msg.id,
                  error: { code: -32e3, message: errMsg }
                });
              }
            }
            child.stdin.write(response + "\n");
            return;
          }
          if (msg.id != null && msg.result != null) {
            done({
              result: msg.result.result ?? null,
              error: msg.result.error,
              logs: msg.result.logs
            });
            return;
          }
          if (msg.id != null && msg.error != null) {
            done({ result: null, error: msg.error.message });
            return;
          }
        } catch {
        }
      });
      child.on("error", (err) => {
        done({ result: null, error: `Failed to spawn gun: ${err.message}` });
      });
      child.on("close", (exitCode) => {
        if (exitCode !== 0) {
          done({ result: null, error: stderr || `gun exited with code ${exitCode}` });
        }
      });
      const request = JSON.stringify({
        jsonrpc: "2.0",
        method: "execute",
        id: 1,
        params: {
          code,
          providers: providerDefs,
          timeout: this.#timeout
        }
      });
      child.stdin.write(request + "\n");
      const timer = setTimeout(() => {
        done({ result: null, error: "Execution timed out" });
      }, this.#timeout);
    });
  }
};

// src/index.ts
import { createCodeTool } from "@cloudflare/codemode/ai";
export {
  NixExecutor,
  createCodeTool
};
