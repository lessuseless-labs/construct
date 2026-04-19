// Unit tests for NixExecutor using a mock gun binary.
// Run: pnpm test:executor-unit

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NixExecutor } from "../src/index.ts";
import type { ResolvedProvider } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const MOCK_GUN = resolve(here, "mocks", "mock-gun.mjs");

function withMode(mode: string): () => void {
  const prev = process.env.MOCK_GUN_MODE;
  process.env.MOCK_GUN_MODE = mode;
  return () => {
    if (prev === undefined) delete process.env.MOCK_GUN_MODE;
    else process.env.MOCK_GUN_MODE = prev;
  };
}

function newExecutor(timeout = 5000): NixExecutor {
  return new NixExecutor({ gunPath: MOCK_GUN, timeout });
}

// --- happy path ---

test("result is propagated from mock gun", async () => {
  const restore = withMode("result");
  try {
    const r = await newExecutor().execute("async () => 1", []);
    // "result" mode echoes params.code back as the result
    assert.equal(r.result, "async () => 1");
    assert.ok(!r.error);
  } finally {
    restore();
  }
});

test("logs field is surfaced from mock gun", async () => {
  const restore = withMode("result-with-logs");
  try {
    const r = await newExecutor().execute("async () => {}", []);
    assert.deepEqual(r.logs, ["one", "two"]);
  } finally {
    restore();
  }
});

test("sandbox-side error field is surfaced without aborting", async () => {
  const restore = withMode("result-with-error-field");
  try {
    const r = await newExecutor().execute("async () => {}", []);
    assert.equal(r.result, null);
    assert.equal(r.error, "sandbox boom");
  } finally {
    restore();
  }
});

// --- JSON-RPC error responses ---

test("JSON-RPC error response is surfaced as error", async () => {
  const restore = withMode("error");
  try {
    const r = await newExecutor().execute("async () => {}", []);
    assert.equal(r.result, null);
    assert.equal(r.error, "mock error");
  } finally {
    restore();
  }
});

// --- tool call loop ---

test("tool/call is dispatched to provider and response relayed back", async () => {
  const restore = withMode("tool-call-then-result");
  const provider: ResolvedProvider = {
    name: "codemode",
    fns: {
      ping: async (args: unknown) => {
        const { who } = args as { who: string };
        return `hi ${who}`;
      },
    },
  };
  try {
    const r = await newExecutor().execute("async () => {}", [provider]);
    assert.equal(r.result, "hi world");
  } finally {
    restore();
  }
});

test("tool/call to unknown provider returns -32601 to mock", async () => {
  const restore = withMode("tool-call-unknown-provider");
  try {
    const r = await newExecutor().execute("async () => {}", []);
    assert.match(r.error ?? "", /Unknown tool: does_not_exist\.anything/);
  } finally {
    restore();
  }
});

test("tool/call that throws is wrapped as -32000 error", async () => {
  const restore = withMode("tool-call-throws");
  const provider: ResolvedProvider = {
    name: "codemode",
    fns: {
      fail: async () => {
        throw new Error("the provider blew up");
      },
    },
  };
  try {
    const r = await newExecutor().execute("async () => {}", [provider]);
    assert.equal(r.error, "the provider blew up");
  } finally {
    restore();
  }
});

test("multiple sequential tool calls all resolve", async () => {
  const restore = withMode("multiple-tool-calls");
  const provider: ResolvedProvider = {
    name: "codemode",
    fns: {
      add: async (args: unknown) => {
        const { a, b } = args as { a: number; b: number };
        return a + b;
      },
    },
  };
  try {
    const r = await newExecutor().execute("async () => {}", [provider]);
    // add(1,2)=3, then add(3,10)=13
    assert.equal(r.result, 13);
  } finally {
    restore();
  }
});

// --- failure modes ---

test("stderr is surfaced when gun exits non-zero", async () => {
  const restore = withMode("exit-error");
  try {
    const r = await newExecutor().execute("async () => {}", []);
    assert.ok(r.error, "expected error");
    assert.match(r.error!, /mock gun stderr/);
  } finally {
    restore();
  }
});

test("malformed JSON lines from gun are ignored, valid result still resolves", async () => {
  const restore = withMode("malformed-then-result");
  try {
    const r = await newExecutor().execute("async () => {}", []);
    assert.equal(r.result, 42);
  } finally {
    restore();
  }
});

test("timeout fires when gun hangs", async () => {
  const restore = withMode("hang");
  try {
    const r = await newExecutor(200).execute("async () => {}", []);
    assert.equal(r.result, null);
    assert.match(r.error ?? "", /timed out/i);
  } finally {
    restore();
  }
});

test("nonexistent gun binary produces helpful error", async () => {
  const executor = new NixExecutor({
    gunPath: "/nonexistent/path/gun-abc123",
    timeout: 2000,
  });
  const r = await executor.execute("async () => 1", []);
  assert.equal(r.result, null);
  assert.match(r.error ?? "", /gun binary not found|ENOENT/);
});
