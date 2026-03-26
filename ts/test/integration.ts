// Integration test: NixExecutor with createCodeTool from @cloudflare/codemode
import { createCodeTool } from "@cloudflare/codemode/ai";
import { z } from "zod";
import { NixExecutor } from "../src/index.ts";

const gunPath = process.env.GUN_PATH || undefined;
const executor = new NixExecutor(gunPath ? { gunPath } : {});
console.log(`Using gun: ${gunPath ?? "(default shell script)"}\n`);

// Define tools with Zod schemas (as codemode expects)
const tools = {
  add: {
    description: "Add two numbers",
    inputSchema: z.object({
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    }),
    execute: async ({ a, b }: { a: number; b: number }) => a + b,
  },
  multiply: {
    description: "Multiply two numbers",
    inputSchema: z.object({
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    }),
    execute: async ({ a, b }: { a: number; b: number }) => a * b,
  },
};

const codeTool = createCodeTool({ tools, executor });

// Test 1: simple tool call through createCodeTool
console.log("Integration Test 1: createCodeTool with simple tool call");
const r1 = await codeTool.execute(
  { code: "async () => await codemode.add({ a: 3, b: 4 })" },
  { toolCallId: "test-1", messages: [] },
);
console.log("  result:", JSON.stringify(r1));
console.assert(r1.result === 7, `Expected 7, got ${r1.result}`);

// Test 2: chained tool calls
console.log("Integration Test 2: chained tool calls");
const r2 = await codeTool.execute(
  {
    code: "async () => { const sum = await codemode.add({ a: 5, b: 3 }); return await codemode.multiply({ a: sum, b: 2 }); }",
  },
  { toolCallId: "test-2", messages: [] },
);
console.log("  result:", JSON.stringify(r2));
console.assert(r2.result === 16, `Expected 16, got ${r2.result}`);

// Test 3: error propagation
console.log("Integration Test 3: error in code");
try {
  await codeTool.execute(
    { code: 'async () => { throw new Error("integration boom") }' },
    { toolCallId: "test-3", messages: [] },
  );
  console.assert(false, "Should have thrown");
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log("  error:", msg);
  console.assert(msg.includes("integration boom"), `Expected 'integration boom', got '${msg}'`);
}

console.log("\nAll integration tests passed!");
