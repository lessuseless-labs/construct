import { NixExecutor } from "../src/index.ts";
import type { ResolvedProvider } from "../src/index.ts";

const gunPath = process.env.GUN_PATH || undefined;
const executor = new NixExecutor(gunPath ? { gunPath } : {});
console.log(`Using gun: ${gunPath ?? "(default shell script)"}\n`);

// Test 1: simple arithmetic
console.log("Test 1: simple arithmetic");
const r1 = await executor.execute("async () => 1 + 1", []);
console.log("  result:", JSON.stringify(r1));
console.assert(r1.result === 2, `Expected 2, got ${r1.result}`);
console.assert(!r1.error, `Unexpected error: ${r1.error}`);

// Test 2: console capture
console.log("Test 2: console capture");
const r2 = await executor.execute(
  'async () => { console.log("hello"); console.warn("careful"); return "done" }',
  [],
);
console.log("  result:", JSON.stringify(r2));
console.assert(r2.result === "done", `Expected "done", got ${r2.result}`);
console.assert(r2.logs?.length === 2, `Expected 2 logs, got ${r2.logs?.length}`);

// Test 3: error handling
console.log("Test 3: error handling");
const r3 = await executor.execute(
  'async () => { throw new Error("boom") }',
  [],
);
console.log("  result:", JSON.stringify(r3));
console.assert(r3.error === "boom", `Expected "boom", got ${r3.error}`);

// Test 4: single tool call
console.log("Test 4: single tool call");
const provider: ResolvedProvider = {
  name: "codemode",
  fns: {
    add: async (args: unknown) => {
      const { a, b } = args as { a: number; b: number };
      return a + b;
    },
  },
};
const r4 = await executor.execute(
  "async () => await codemode.add({ a: 1, b: 2 })",
  [provider],
);
console.log("  result:", JSON.stringify(r4));
console.assert(r4.result === 3, `Expected 3, got ${r4.result}`);
console.assert(!r4.error, `Unexpected error: ${r4.error}`);

// Test 5: multiple tool calls
console.log("Test 5: multiple sequential tool calls");
const r5 = await executor.execute(
  "async () => { const x = await codemode.add({ a: 10, b: 20 }); return await codemode.add({ a: x, b: 5 }); }",
  [provider],
);
console.log("  result:", JSON.stringify(r5));
console.assert(r5.result === 35, `Expected 35, got ${r5.result}`);

// Test 6: tool error handling
console.log("Test 6: tool error");
const errorProvider: ResolvedProvider = {
  name: "codemode",
  fns: {
    fail: async () => {
      throw new Error("tool broke");
    },
  },
};
const r6 = await executor.execute(
  'async () => { try { await codemode.fail(); } catch (e) { return e.message; } }',
  [errorProvider],
);
console.log("  result:", JSON.stringify(r6));
console.assert(r6.result === "tool broke", `Expected "tool broke", got ${r6.result}`);

// Test 7: multiple providers
console.log("Test 7: multiple providers");
const mathProvider: ResolvedProvider = {
  name: "math",
  fns: {
    multiply: async (args: unknown) => {
      const { a, b } = args as { a: number; b: number };
      return a * b;
    },
  },
};
const r7 = await executor.execute(
  "async () => { const sum = await codemode.add({ a: 3, b: 4 }); return await math.multiply({ a: sum, b: 2 }); }",
  [provider, mathProvider],
);
console.log("  result:", JSON.stringify(r7));
console.assert(r7.result === 14, `Expected 14, got ${r7.result}`);

// --- exec built-in tests ---

// Test 8: exec runs local binaries
console.log("Test 8: exec built-in");
const r8 = await executor.execute(
  'async () => { const { stdout } = await exec("echo", ["hello"]); return stdout.trim(); }',
  [],
);
console.log("  result:", JSON.stringify(r8));
console.assert(r8.result === "hello", `Expected "hello", got ${r8.result}`);

// Test 9: exec with stdin
console.log("Test 9: exec with stdin");
const r9 = await executor.execute(
  'async () => { const { stdout } = await exec("cat", [], { stdin: "piped input" }); return stdout; }',
  [],
);
console.log("  result:", JSON.stringify(r9));
console.assert(r9.result === "piped input", `Expected "piped input", got ${r9.result}`);

// Test 10: exec error handling
console.log("Test 10: exec nonexistent binary");
const r10 = await executor.execute(
  'async () => { try { await exec("nonexistent_binary_12345", []); return "should not reach"; } catch (e) { return e.message; } }',
  [],
);
console.log("  result:", JSON.stringify(r10));
console.assert(r10.result !== "should not reach", "Should have caught error");

// Test 11: env access still denied (defense-in-depth)
console.log("Test 11: env access denied");
const r11 = await executor.execute(
  'async () => { return Deno.env.get("HOME") }',
  [],
);
console.log("  result:", JSON.stringify(r11));
console.assert(r11.error != null, "Expected env error");

console.log("\nAll tests passed!");
