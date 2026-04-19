import { test } from "node:test";
import { strict as assert } from "node:assert";
import { NixExecutor } from "../src/index.ts";
import type { ResolvedProvider } from "../src/index.ts";

const gunPath = process.env.GUN_PATH || undefined;
const executor = new NixExecutor(gunPath ? { gunPath } : {});

const addProvider: ResolvedProvider = {
  name: "codemode",
  fns: {
    add: async (args: unknown) => {
      const { a, b } = args as { a: number; b: number };
      return a + b;
    },
  },
};

test("simple arithmetic", async () => {
  const r = await executor.execute("async () => 1 + 1", []);
  assert.equal(r.result, 2);
  assert.ok(!r.error, `unexpected error: ${r.error}`);
});

test("console capture", async () => {
  const r = await executor.execute(
    'async () => { console.log("hello"); console.warn("careful"); return "done" }',
    [],
  );
  assert.equal(r.result, "done");
  assert.equal(r.logs?.length, 2);
});

test("error propagation", async () => {
  const r = await executor.execute(
    'async () => { throw new Error("boom") }',
    [],
  );
  assert.equal(r.error, "boom");
});

test("single tool call", async () => {
  const r = await executor.execute(
    "async () => await codemode.add({ a: 1, b: 2 })",
    [addProvider],
  );
  assert.equal(r.result, 3);
  assert.ok(!r.error, `unexpected error: ${r.error}`);
});

test("multiple sequential tool calls", async () => {
  const r = await executor.execute(
    "async () => { const x = await codemode.add({ a: 10, b: 20 }); return await codemode.add({ a: x, b: 5 }); }",
    [addProvider],
  );
  assert.equal(r.result, 35);
});

test("tool error surfaces to caller", async () => {
  const errorProvider: ResolvedProvider = {
    name: "codemode",
    fns: {
      fail: async () => {
        throw new Error("tool broke");
      },
    },
  };
  const r = await executor.execute(
    'async () => { try { await codemode.fail(); } catch (e) { return e.message; } }',
    [errorProvider],
  );
  assert.equal(r.result, "tool broke");
});

test("multiple providers in one script", async () => {
  const mathProvider: ResolvedProvider = {
    name: "math",
    fns: {
      multiply: async (args: unknown) => {
        const { a, b } = args as { a: number; b: number };
        return a * b;
      },
    },
  };
  const r = await executor.execute(
    "async () => { const sum = await codemode.add({ a: 3, b: 4 }); return await math.multiply({ a: sum, b: 2 }); }",
    [addProvider, mathProvider],
  );
  assert.equal(r.result, 14);
});

test("exec runs local binaries", async () => {
  const r = await executor.execute(
    'async () => { const { stdout } = await exec("echo", ["hello"]); return stdout.trim(); }',
    [],
  );
  assert.equal(r.result, "hello");
});

test("exec accepts stdin", async () => {
  const r = await executor.execute(
    'async () => { const { stdout } = await exec("cat", [], { stdin: "piped input" }); return stdout; }',
    [],
  );
  assert.equal(r.result, "piped input");
});

test("exec nonexistent binary rejects", async () => {
  const r = await executor.execute(
    'async () => { try { await exec("nonexistent_binary_12345", []); return "should not reach"; } catch (e) { return e.message; } }',
    [],
  );
  assert.notEqual(r.result, "should not reach");
});

test("env access denied (defense-in-depth)", async () => {
  const r = await executor.execute(
    'async () => { return Deno.env.get("HOME") }',
    [],
  );
  assert.ok(r.error != null, "expected env error");
});
