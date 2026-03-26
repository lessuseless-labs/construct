// basic.ts — No API key needed. Tests NixExecutor + nixRun tool end-to-end.
import { createCodeTool } from "@cloudflare/codemode/ai";
import { NixExecutor, nixRunProvider } from "../src/index.ts";

const executor = new NixExecutor({
  gunPath: process.env.GUN_PATH,
});

const nixTools = nixRunProvider(["nixpkgs#jq", "nixpkgs#hello"]);

const codeTool = createCodeTool({
  tools: [nixTools],
  executor,
});

// Test 1: jq expression
console.log("1. Running jq via nixRun...");
const r1 = await codeTool.execute(
  {
    code: `async () => {
      const r = await nix.run({ package: "nixpkgs#jq", args: ["-n", "1+1"] });
      return r.stdout.trim();
    }`,
  },
  { toolCallId: "basic-1", messages: [] },
);
console.log("   jq says 1+1 =", r1.result);

// Test 2: jq parsing JSON via --argjson
console.log("2. Parsing JSON with jq...");
const r2 = await codeTool.execute(
  {
    code: `async () => {
      const r = await nix.run({
        package: "nixpkgs#jq",
        args: ["-n", "--argjson", "data", '{"name":"construct","version":"0.1.0"}', "$data.name"]
      });
      return r.stdout.trim();
    }`,
  },
  { toolCallId: "basic-2", messages: [] },
);
console.log("   name:", r2.result);

// Test 3: hello world
console.log("3. Running hello...");
const r3 = await codeTool.execute(
  {
    code: `async () => {
      const r = await nix.run({ package: "nixpkgs#hello", args: [] });
      return r.stdout.trim();
    }`,
  },
  { toolCallId: "basic-3", messages: [] },
);
console.log("   hello says:", r3.result);

// Test 4: denied package
console.log("4. Trying denied package...");
try {
  await codeTool.execute(
    {
      code: `async () => {
        return await nix.run({ package: "nixpkgs#curl", args: ["https://example.com"] });
      }`,
    },
    { toolCallId: "basic-4", messages: [] },
  );
  console.log("   ERROR: should have been denied");
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log("   correctly denied:", msg);
}

console.log("\nDone!");
