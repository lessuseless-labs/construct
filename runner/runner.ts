// runner.ts — Deno sandbox script for construct
// Reads an `initialize` JSON-RPC message from stdin, evaluates the code,
// and writes an `execute/result` message to stdout.

import { readLines } from "https://deno.land/std@0.224.0/io/read_lines.ts";

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

async function* readJsonLines(): AsyncGenerator<JsonRpcRequest | JsonRpcResponse> {
  for await (const line of readLines(Deno.stdin)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    yield JSON.parse(trimmed);
  }
}

// --- console capture ---

const logs: string[] = [];
const originalConsole = { ...console };

function captureConsole(): void {
  const capture = (prefix: string) => (...args: unknown[]) => {
    const msg = args.map(a =>
      typeof a === "string" ? a : JSON.stringify(a)
    ).join(" ");
    logs.push(prefix ? `[${prefix}] ${msg}` : msg);
  };

  console.log = capture("");
  console.info = capture("info");
  console.warn = capture("warn");
  console.error = capture("error");
  console.debug = capture("debug");
}

// --- tool call proxy (milestone 2 — stubbed for now) ---

let nextId = 1;
const pending = new Map<number | string, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}>();

// stdin reader that dispatches tool call responses to pending promises
let stdinReader: AsyncGenerator<JsonRpcRequest | JsonRpcResponse> | null = null;

function createProviderProxy(
  providerName: string,
  _tools: string[],
  _positionalArgs: boolean,
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
    get: (_target, prop: string) => {
      if (typeof prop !== "string") return undefined;
      return async (...args: unknown[]) => {
        const id = nextId++;
        const serializedArgs = _positionalArgs
          ? JSON.stringify(args)
          : JSON.stringify(args[0] ?? {});

        writeLine({
          jsonrpc: "2.0",
          method: "tool/call",
          id,
          params: {
            provider: providerName,
            tool: prop,
            args: serializedArgs,
          },
        });

        // wait for response with matching id
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
        });
      };
    },
  });
}

// --- main ---

async function main(): Promise<void> {
  stdinReader = readJsonLines();

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

  // 2. Build provider globals
  const globals: Record<string, unknown> = {};
  for (const p of params.providers ?? []) {
    globals[p.name] = createProviderProxy(p.name, p.tools, p.positionalArgs ?? false);
  }

  // 3. Start stdin dispatch loop for tool call responses (runs in background)
  const stdinLoop = (async () => {
    for await (const msg of stdinReader!) {
      const resp = msg as JsonRpcResponse;
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

  // 4. Capture console
  captureConsole();

  // 5. Evaluate the code
  let result: unknown = null;
  let error: string | undefined;

  try {
    // The code is a normalized async arrow function string
    // Build a function that has provider namespaces in scope
    const argNames = Object.keys(globals);
    const argValues = Object.values(globals);

    // Wrap: new AsyncFunction(providerNames..., "return (code)()")
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction(...argNames, `return (${params.code})()`);
    result = await fn(...argValues);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // 6. Send result
  writeLine({
    jsonrpc: "2.0",
    method: "execute/result",
    params: { result: result ?? null, error, logs },
  });

  // 7. Clean up — stop the stdin loop
  // Force exit since the stdin reader may be blocking
  Deno.exit(0);
}

main();
