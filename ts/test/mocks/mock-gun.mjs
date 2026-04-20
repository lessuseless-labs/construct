#!/usr/bin/env node
// Test double for the `gun` binary. Behavior controlled by MOCK_GUN_MODE.
// Used by NixExecutor unit tests to exercise the adapter in isolation
// from the real Rust/Nix sandbox.

import { createInterface } from "node:readline";

const mode = process.env.MOCK_GUN_MODE ?? "result";
const rl = createInterface({ input: process.stdin });
const write = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

let requestId = null;
let toolCallId = 1;
let pendingToolResponse = null;

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  // Tool response path: resolve any pending tool call
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    if (pendingToolResponse) {
      pendingToolResponse(msg);
      pendingToolResponse = null;
    }
    return;
  }

  // Initial execute request
  if (msg.method === "execute") {
    requestId = msg.id;
    runScenario(msg).catch((e) => {
      write({
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32000, message: `mock failure: ${e.message}` },
      });
      process.exit(1);
    });
  }
});

function waitForToolResponse() {
  return new Promise((resolve) => {
    pendingToolResponse = resolve;
  });
}

async function runScenario(executeRequest) {
  const { params } = executeRequest;

  switch (mode) {
    case "result":
      write(successResponse({ result: params.code }));
      process.exit(0);
      break;

    case "error":
      write({
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32000, message: "mock error" },
      });
      process.exit(0);
      break;

    case "result-with-logs":
      write(successResponse({ result: "done", logs: ["one", "two"] }));
      process.exit(0);
      break;

    case "result-with-error-field":
      // sandbox-side error, not JSON-RPC error — surfaces in `error` of
      // the ExecuteResult.
      write(successResponse({ result: null, error: "sandbox boom" }));
      process.exit(0);
      break;

    case "hang":
      // Never respond — tests timeout
      await new Promise(() => {});
      break;

    case "exit-error":
      process.stderr.write("mock gun stderr: something broke\n");
      process.exit(1);
      break;

    case "malformed-then-result":
      process.stdout.write("not-json-at-all\n");
      process.stdout.write("{broken json\n");
      write(successResponse({ result: 42 }));
      process.exit(0);
      break;

    case "tool-call-then-result": {
      const id = toolCallId++;
      write({
        jsonrpc: "2.0",
        method: "tool/call",
        id,
        params: {
          provider: "codemode",
          tool: "ping",
          args: JSON.stringify({ who: "world" }),
        },
      });
      const response = await waitForToolResponse();
      const echoed = response.result?.value ?? response.error?.message ?? null;
      write(successResponse({ result: echoed }));
      process.exit(0);
      break;
    }

    case "tool-call-unknown-provider": {
      const id = toolCallId++;
      write({
        jsonrpc: "2.0",
        method: "tool/call",
        id,
        params: {
          provider: "does_not_exist",
          tool: "anything",
          args: "{}",
        },
      });
      const response = await waitForToolResponse();
      write(successResponse({
        result: null,
        error: response.error ? response.error.message : "no error received",
      }));
      process.exit(0);
      break;
    }

    case "tool-call-throws": {
      const id = toolCallId++;
      write({
        jsonrpc: "2.0",
        method: "tool/call",
        id,
        params: { provider: "codemode", tool: "fail", args: "{}" },
      });
      const response = await waitForToolResponse();
      write(successResponse({
        result: null,
        error: response.error ? response.error.message : "no error received",
      }));
      process.exit(0);
      break;
    }

    case "multiple-tool-calls": {
      // Call add(1,2), then add(result, 10), return final
      write({
        jsonrpc: "2.0",
        method: "tool/call",
        id: toolCallId++,
        params: {
          provider: "codemode",
          tool: "add",
          args: JSON.stringify({ a: 1, b: 2 }),
        },
      });
      const r1 = await waitForToolResponse();
      const first = r1.result.value;

      write({
        jsonrpc: "2.0",
        method: "tool/call",
        id: toolCallId++,
        params: {
          provider: "codemode",
          tool: "add",
          args: JSON.stringify({ a: first, b: 10 }),
        },
      });
      const r2 = await waitForToolResponse();
      const second = r2.result.value;

      write(successResponse({ result: second }));
      process.exit(0);
      break;
    }

    default:
      throw new Error(`unknown MOCK_GUN_MODE: ${mode}`);
  }
}

function successResponse(inner) {
  return {
    jsonrpc: "2.0",
    id: requestId,
    result: inner,
  };
}
