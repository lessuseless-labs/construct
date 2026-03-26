// demo.ts — Full LLM demo with Anthropic + createCodeTool + NixExecutor
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... pnpm demo "use jq to calculate 2+3"
//
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { NixExecutor, nixRunProvider } from "../src/index.ts";

const prompt = process.argv[2];
if (!prompt) {
  console.error("Usage: pnpm demo \"<prompt>\"");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY first");
  process.exit(1);
}

const executor = new NixExecutor({
  gunPath: process.env.GUN_PATH,
});

const nixTools = nixRunProvider([
  "nixpkgs#jq",
  "nixpkgs#ripgrep",
  "nixpkgs#hello",
  "nixpkgs#cowsay",
]);

const codeTool = createCodeTool({
  tools: [nixTools],
  executor,
});

console.log(`Prompt: ${prompt}\n`);

const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  system:
    "You are a helpful assistant. Use the codemode tool to accomplish tasks by writing JavaScript code that calls the available tools. The nix.run tool lets you run Nix packages.",
  prompt,
  tools: { codemode: codeTool },
  maxSteps: 5,
});

console.log("\nResponse:", result.text);

for (const step of result.steps) {
  for (const tr of step.toolResults) {
    console.log("\nTool output:", JSON.stringify(tr.result, null, 2));
  }
}
