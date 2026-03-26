// Integration test: NixExecutor with normalizeCode
import { NixExecutor, normalizeCode } from "../src/index.ts";
import type { ResolvedProvider } from "../src/index.ts";

const gunPath = process.env.GUN_PATH || undefined;
const executor = new NixExecutor(gunPath ? { gunPath } : {});
console.log(`Using gun: ${gunPath ?? "(default)"}\n`);

// Test 1: normalizeCode handles raw expressions
console.log("Integration Test 1: normalizeCode");
const n1 = normalizeCode("1 + 1");
console.log("  normalized:", n1);
console.assert(n1.includes("return"), "Should add return");
console.assert(n1.includes("async"), "Should be async");

// Test 2: normalizeCode strips markdown fences
const n2 = normalizeCode("```js\nconsole.log('hi')\n```");
console.log("  fenced:", n2);
console.assert(!n2.includes("```"), "Should strip fences");

// Test 3: normalizeCode passes through arrow functions
const n3 = normalizeCode("async () => 42");
console.log("  arrow:", n3);
console.assert(n3 === "async () => 42", "Should pass through");

// Test 4: normalized code executes correctly
console.log("Integration Test 4: normalized code execution");
const code = normalizeCode("1 + 1");
const r4 = await executor.execute(code, []);
console.log("  result:", JSON.stringify(r4));
console.assert(r4.result === 2, `Expected 2, got ${r4.result}`);

// Test 5: exec through normalized code
console.log("Integration Test 5: exec through normalizeCode");
const code5 = normalizeCode('await exec("echo", ["hello normalized"])');
const r5 = await executor.execute(code5, []);
console.log("  result:", JSON.stringify(r5));
console.assert(
  (r5.result as { stdout: string })?.stdout?.trim() === "hello normalized",
  `Unexpected result: ${JSON.stringify(r5.result)}`,
);

// Test 6: provider tools still work
console.log("Integration Test 6: provider tools");
const provider: ResolvedProvider = {
  name: "math",
  fns: {
    add: async (args: unknown) => {
      const { a, b } = args as { a: number; b: number };
      return a + b;
    },
  },
};
const r6 = await executor.execute(
  "async () => await math.add({ a: 10, b: 20 })",
  [provider],
);
console.log("  result:", JSON.stringify(r6));
console.assert(r6.result === 30, `Expected 30, got ${r6.result}`);

console.log("\nAll integration tests passed!");
