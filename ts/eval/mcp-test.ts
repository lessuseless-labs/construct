// mcp-test.ts — End-to-end test of the MCP server
//
// Connects as an MCP client, lists tools, executes code, verifies results.
// This tests the real transport, not just the executor.
//
// Usage: GUN_PATH=... pnpm eval:mcp

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const gunPath = process.env.GUN_PATH;
if (!gunPath) {
  console.error("Set GUN_PATH");
  process.exit(1);
}

// --- Connect to MCP server ---

console.log("Connecting to construct MCP server...\n");

const client = new Client({ name: "eval-client", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath, // node
  args: [new URL("../src/mcp.ts", import.meta.url).pathname, "--import", "tsx"],
  env: { ...process.env, GUN_PATH: gunPath },
});

// tsx needs to be loaded as a loader for the .ts file
const tsxTransport = new StdioClientTransport({
  command: new URL("../node_modules/.bin/tsx", import.meta.url).pathname,
  args: [new URL("../src/mcp.ts", import.meta.url).pathname],
  env: { ...process.env, GUN_PATH: gunPath },
});

await client.connect(tsxTransport);

// --- Test 1: List tools ---

console.log("Test 1: list tools");
const { tools } = await client.listTools();
console.assert(tools.length === 1, `Expected 1 tool, got ${tools.length}`);
console.assert(tools[0].name === "execute", `Expected "execute", got ${tools[0].name}`);
console.assert(
  tools[0].description.includes("exec()"),
  "Description should mention exec()",
);
console.log(`  found: ${tools[0].name} (${tools[0].description.length} char description)`);

// --- Test 2: Simple execution ---

console.log("Test 2: simple exec");
const r2 = await client.callTool({
  name: "execute",
  arguments: { code: "async () => 1 + 1" },
});
const o2 = JSON.parse((r2.content as Array<{ text: string }>)[0].text);
console.log(`  result: ${JSON.stringify(o2)}`);
console.assert(o2.result === 2, `Expected 2, got ${o2.result}`);

// --- Test 3: exec() built-in through MCP ---

console.log("Test 3: exec through MCP");
const r3 = await client.callTool({
  name: "execute",
  arguments: {
    code: 'async () => { const { stdout } = await exec("echo", ["hello MCP"]); return stdout.trim(); }',
  },
});
const o3 = JSON.parse((r3.content as Array<{ text: string }>)[0].text);
console.log(`  result: ${JSON.stringify(o3)}`);
console.assert(o3.result === "hello MCP", `Expected "hello MCP", got ${o3.result}`);

// --- Test 4: Error handling through MCP ---

console.log("Test 4: error through MCP");
const r4 = await client.callTool({
  name: "execute",
  arguments: {
    code: 'async () => { throw new Error("mcp boom") }',
  },
});
const o4 = JSON.parse((r4.content as Array<{ text: string }>)[0].text);
console.log(`  result: ${JSON.stringify(o4)}`);
console.assert(o4.error === "mcp boom", `Expected "mcp boom", got ${o4.error}`);

// --- Test 5: Console capture through MCP ---

console.log("Test 5: console capture through MCP");
const r5 = await client.callTool({
  name: "execute",
  arguments: {
    code: 'async () => { console.log("logged"); return "done" }',
  },
});
const o5 = JSON.parse((r5.content as Array<{ text: string }>)[0].text);
console.log(`  result: ${JSON.stringify(o5)}`);
console.assert(o5.result === "done", `Expected "done", got ${o5.result}`);
console.assert(o5.logs?.[0] === "logged", `Expected "logged" in logs`);

// --- Done ---

console.log("\nAll MCP tests passed!");
await client.close();
process.exit(0);
