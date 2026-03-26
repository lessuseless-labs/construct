// nixRun tool — run allowlisted Nix packages safely
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export interface NixRunOptions {
  /** Allowed flake references. e.g. ["nixpkgs#jq", "nixpkgs#ripgrep"] */
  allowlist: string[];
  /** Execution timeout in ms. Default 30000. */
  timeout?: number;
  /** Max output size in bytes. Default 1MiB. */
  maxOutput?: number;
}

async function nixRun(
  pkg: string,
  args: string[],
  allowlist: Set<string>,
  timeout: number,
  maxOutput: number,
): Promise<{ stdout: string; stderr: string }> {
  if (!allowlist.has(pkg)) {
    throw new Error(`Package "${pkg}" is not in the allowlist`);
  }

  for (const arg of args) {
    if (typeof arg !== "string") throw new Error("Args must be strings");
    if (arg.length > 10_000) throw new Error("Arg too long");
    if (arg.includes("\0")) throw new Error("Null bytes not allowed");
  }

  const { stdout, stderr } = await execFileAsync(
    "nix",
    ["run", pkg, "--", ...args],
    { timeout, maxBuffer: maxOutput },
  );

  return { stdout, stderr };
}

/**
 * Create a ToolProvider for running allowlisted Nix packages.
 *
 * Usage with createCodeTool:
 * ```ts
 * const tools = nixRunProvider(["nixpkgs#jq", "nixpkgs#ripgrep"]);
 * const codeTool = createCodeTool({ tools: [tools], executor });
 * ```
 *
 * In sandbox code:
 * ```js
 * const result = await nix.run({ package: "nixpkgs#jq", args: ["-n", "1+1"] });
 * // result.stdout === "2\n"
 * ```
 */
export function nixRunProvider(
  allowlist: string[],
  options: Omit<NixRunOptions, "allowlist"> = {},
) {
  const allowed = new Set(allowlist);
  const timeout = options.timeout ?? 30_000;
  const maxOutput = options.maxOutput ?? 1024 * 1024;

  return {
    name: "nix",
    tools: {
      run: {
        description: `Run a Nix package. Allowed: ${allowlist.join(", ")}`,
        inputSchema: z.object({
          package: z.string().describe("Nix flake reference, e.g. nixpkgs#jq"),
          args: z.array(z.string()).describe("Command-line arguments"),
        }),
        execute: async (input: { package: string; args: string[] }) =>
          nixRun(input.package, input.args, allowed, timeout, maxOutput),
      },
    },
  };
}
