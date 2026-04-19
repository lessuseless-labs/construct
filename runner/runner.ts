// runner.ts — Deno sandbox script for construct
// Reads an `initialize` JSON-RPC message from stdin, evaluates the code,
// and writes an `execute/result` message to stdout.

interface InitializeParams {
  code: string;
  providers: Array<{
    name: string;
    tools: string[];
    positionalArgs?: boolean;
  }>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  id?: number | string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

// --- stdio helpers ---

const encoder = new TextEncoder();

function writeLine(obj: unknown): void {
  Deno.stdout.writeSync(encoder.encode(JSON.stringify(obj) + "\n"));
}

// deno-lint-ignore no-explicit-any
type ReadLinesFn = (r: any) => AsyncIterableIterator<string>;

async function* readJsonLines(
  readLines: ReadLinesFn,
): AsyncGenerator<JsonRpcRequest | JsonRpcResponse> {
  for await (const line of readLines(Deno.stdin)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    yield JSON.parse(trimmed);
  }
}

// --- exec built-in (runs binaries inside the sandbox) ---

export async function exec(
  cmd: string,
  args: string[],
  opts?: { stdin?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const command = new Deno.Command(cmd, {
    args,
    stdin: opts?.stdin ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();

  if (opts?.stdin) {
    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(opts.stdin));
    await writer.close();
  }

  const output = await process.output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    code: output.code,
  };
}

// --- console capture ---

export function captureConsole(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const capture = (prefix: string) => (...args: unknown[]) => {
    const msg = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    logs.push(prefix ? `[${prefix}] ${msg}` : msg);
  };
  console.log = capture("");
  console.info = capture("info");
  console.warn = capture("warn");
  console.error = capture("error");
  console.debug = capture("debug");
  return {
    logs,
    restore: () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
    },
  };
}

// --- provider proxy ---

/**
 * Build a proxy where `proxy.tool(args)` invokes `call(tool, serializedArgs)`.
 * Decoupled from stdio so it's unit-testable with a stubbed `call`.
 */
export function createProviderProxy(
  positionalArgs: boolean,
  call: (tool: string, serializedArgs: string) => Promise<unknown>,
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
    get: (_target, prop: string | symbol) => {
      if (typeof prop !== "string") return undefined;
      return async (...args: unknown[]) => {
        const serializedArgs = positionalArgs
          ? JSON.stringify(args)
          : JSON.stringify(args[0] ?? {});
        return call(prop, serializedArgs);
      };
    },
  });
}

// --- code evaluation ---

/**
 * Evaluate a normalized async-arrow-function code string with the given
 * globals injected as positional arguments of an AsyncFunction.
 */
export async function evaluateCode(
  code: string,
  globals: Record<string, unknown>,
): Promise<{ result: unknown; error?: string }> {
  try {
    const argNames = Object.keys(globals);
    const argValues = Object.values(globals);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction(...argNames, `return (${code})()`);
    const result = await fn(...argValues);
    return { result };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- main ---

async function main(): Promise<void> {
  const { readLines } = await import(
    "https://deno.land/std@0.224.0/io/read_lines.ts"
  );
  const stdinReader = readJsonLines(readLines);

  // 1. Read initialize message
  const first = await stdinReader.next();
  if (first.done) {
    writeLine({
      jsonrpc: "2.0",
      method: "execute/result",
      params: { result: null, error: "No initialize message received", logs: [] },
    });
    return;
  }

  const msg = first.value as JsonRpcRequest;
  if (msg.method !== "initialize") {
    writeLine({
      jsonrpc: "2.0",
      method: "execute/result",
      params: { result: null, error: `Expected initialize, got ${msg.method}`, logs: [] },
    });
    return;
  }

  const params = msg.params as InitializeParams;

  // 2. Build tool-call dispatch state
  let nextId = 1;
  const pending = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  const dispatchToolCall = (
    providerName: string,
    tool: string,
    serializedArgs: string,
  ): Promise<unknown> => {
    const id = nextId++;
    writeLine({
      jsonrpc: "2.0",
      method: "tool/call",
      id,
      params: { provider: providerName, tool, args: serializedArgs },
    });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  // 3. Build globals — exec is always available, providers are proxied
  const globals: Record<string, unknown> = { exec };
  for (const p of params.providers ?? []) {
    const providerName = p.name;
    globals[providerName] = createProviderProxy(
      p.positionalArgs ?? false,
      (tool, args) => dispatchToolCall(providerName, tool, args),
    );
  }

  // 4. Start stdin dispatch loop for tool call responses (runs in background)
  (async () => {
    for await (const m of stdinReader) {
      const resp = m as JsonRpcResponse;
      if (resp.id != null && pending.has(resp.id)) {
        const p = pending.get(resp.id)!;
        pending.delete(resp.id);
        if (resp.error) {
          p.reject(new Error(resp.error.message));
        } else {
          p.resolve((resp.result as { value: unknown })?.value ?? resp.result);
        }
      }
    }
  })();

  // 5. Capture console
  const { logs } = captureConsole();

  // 6. Evaluate the code
  const { result, error } = await evaluateCode(params.code, globals);

  // 7. Send result
  writeLine({
    jsonrpc: "2.0",
    method: "execute/result",
    params: { result: result ?? null, error, logs },
  });

  // 8. Clean up — stop the stdin loop
  Deno.exit(0);
}

if (import.meta.main) {
  main();
}
