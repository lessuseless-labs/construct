// demo.ts — Full LLM demo via GitHub Models + createCodeTool + NixExecutor
//
// Usage:
//   GITHUB_TOKEN=$(gh auth token) pnpm demo "use jq to calculate 2+3"
//
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { NixExecutor, nixRunProvider } from "../src/index.ts";

const prompt = process.argv[2];
if (!prompt) {
  console.error('Usage: pnpm demo "<prompt>"');
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Set GITHUB_TOKEN first (try: GITHUB_TOKEN=$(gh auth token))");
  process.exit(1);
}

const github = createOpenAI({
  baseURL: "https://models.inference.ai.azure.com",
  apiKey: token,
  compatibility: "compatible",
});

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
  model: github.chat("gpt-4o"),
  system:
    "You are a helpful assistant. Use the codemode tool to accomplish tasks by writing JavaScript code. Call tools directly by their namespace — for example: `await nix.run({...})`. Do NOT prefix with `functions.` — just use the namespace directly. Always explain the result after running code.",
  prompt,
  tools: { codemode: codeTool },
  maxSteps: 10,
});

// Show tool executions
for (const step of result.steps) {
  for (const tc of step.toolCalls) {
    console.log(`> ${tc.toolName}:`, tc.input.code);
  }
  for (const tr of step.toolResults) {
    const output = tr.output as { result?: unknown };
    if (output?.result) {
      console.log("=", JSON.stringify(output.result));
    }
  }
}

if (result.text) {
  console.log("\n" + result.text);
}
