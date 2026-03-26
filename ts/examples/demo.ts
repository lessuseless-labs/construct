// demo.ts — Full LLM demo via GitHub Models + createCodeTool + NixExecutor
//
// Usage:
//   GITHUB_TOKEN=$(gh auth token) pnpm demo "use jq to calculate 2+3"
//
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { NixExecutor } from "../src/index.ts";

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

// Dynamic tool description from the manifest embedded in gun
const description = executor.getToolDescription();

const codeTool = createCodeTool({
  tools: {},
  executor,
  description,
});

console.log(`Prompt: ${prompt}\n`);

const result = await generateText({
  model: github.chat("gpt-4o"),
  system:
    "You are a helpful assistant. Use the codemode tool to accomplish tasks. Do NOT prefix calls with 'functions.' — use exec() directly. Always explain the result.",
  prompt,
  tools: { codemode: codeTool },
  maxSteps: 10,
});

// Show tool executions
for (const step of result.steps) {
  for (const tc of step.toolCalls) {
    console.log(`> ${tc.toolName}:`, (tc as { input?: { code?: string } }).input?.code);
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
