// runner.ts — eval orchestrator
//
// Usage:
//   GITHUB_TOKEN=$(gh auth token) GUN_PATH=... pnpm eval
//   EVAL_FILTER=jq pnpm eval         # run subset
//   EVAL_RUNS=5 pnpm eval            # more samples
//   EVAL_MODEL=gpt-4o-mini pnpm eval # different model

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { NixExecutor, normalizeCode } from "../src/index.ts";
import { cases } from "./cases.ts";
import type { EvalContext } from "./checks.ts";
import type { EvalCase } from "./cases.ts";

// --- Config ---
const RUNS = parseInt(process.env.EVAL_RUNS ?? "3", 10);
const MODEL = process.env.EVAL_MODEL ?? "gpt-4o";
const FILTER = process.env.EVAL_FILTER;

const token =
  process.env.GITHUB_TOKEN ??
  execSync("gh auth token", { encoding: "utf-8" }).trim();

if (!token) {
  console.error("No GITHUB_TOKEN (try: GITHUB_TOKEN=$(gh auth token))");
  process.exit(1);
}

// --- Setup ---
const github = createOpenAI({
  baseURL: "https://models.inference.ai.azure.com",
  apiKey: token,
  compatibility: "compatible",
});

const executor = new NixExecutor({ gunPath: process.env.GUN_PATH });
const description = executor.getToolDescription();
const codeTool = tool({
  description,
  parameters: z.object({
    code: z.string().describe("JavaScript async arrow function to execute"),
  }),
  execute: async ({ code }) => {
    const normalized = normalizeCode(code);
    const result = await executor.execute(normalized, []);
    if (result.error) throw new Error(result.error);
    return { code: normalized, result: result.result, logs: result.logs };
  },
});

const system =
  "You are a helpful assistant. Use the codemode tool to accomplish tasks by writing JavaScript code. Do NOT prefix calls with 'functions.' — use exec() directly.";

// --- Types ---
interface RunResult {
  run: number;
  code: string | null;
  result: unknown;
  error?: string;
  checks: Array<{ name: string; passed: boolean }>;
}

interface CaseResult {
  id: string;
  prompt: string;
  tags?: string[];
  runs: RunResult[];
  passRate: number;
}

// --- Run a single case ---
async function runCase(evalCase: EvalCase, runIndex: number): Promise<RunResult> {
  try {
    const result = await generateText({
      model: github.chat(MODEL),
      system,
      prompt: evalCase.prompt,
      tools: { codemode: codeTool },
      maxSteps: 10,
      temperature: 0,
    });

    // Extract code and result from tool calls
    let code: string | null = null;
    let execResult: unknown = null;
    let execError: string | undefined;
    let logs: string[] | undefined;

    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        const input = tc as { input?: { code?: string } };
        code = input.input?.code ?? code;
      }
      for (const tr of step.toolResults) {
        const output = tr.output as { result?: unknown; logs?: string[]; code?: string };
        if (output) {
          execResult = output.result;
          // If result was an error that codemode threw, it won't be here
        }
      }
    }

    const ctx: EvalContext = {
      code: code ?? "",
      result: execResult,
      error: execError,
      logs,
      text: result.text,
    };

    return {
      run: runIndex,
      code,
      result: execResult,
      error: execError,
      checks: evalCase.checks.map((check) => ({
        name: check.name,
        passed: check.fn(ctx),
      })),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      run: runIndex,
      code: null,
      result: null,
      error: msg,
      checks: evalCase.checks.map((check) => ({
        name: check.name,
        passed: false,
      })),
    };
  }
}

// --- Main ---
const filtered = FILTER
  ? cases.filter(
      (c) =>
        c.id.includes(FILTER) || c.tags?.some((t) => t.includes(FILTER)),
    )
  : cases;

console.log(`Model: ${MODEL} | Runs: ${RUNS} | Cases: ${filtered.length}\n`);

const results: CaseResult[] = [];

for (const evalCase of filtered) {
  process.stdout.write(`${evalCase.id} `);
  const runs: RunResult[] = [];

  for (let i = 0; i < RUNS; i++) {
    const run = await runCase(evalCase, i);
    const allPassed = run.checks.every((c) => c.passed);
    process.stdout.write(allPassed ? "." : "x");
    runs.push(run);
  }

  const passRate =
    runs.filter((r) => r.checks.every((c) => c.passed)).length / RUNS;
  results.push({
    id: evalCase.id,
    prompt: evalCase.prompt,
    tags: evalCase.tags,
    runs,
    passRate,
  });
  console.log(` ${Math.round(passRate * 100)}%`);

  // Show failures inline
  for (const run of runs) {
    const failed = run.checks.filter((c) => !c.passed);
    if (failed.length > 0) {
      console.log(`    failed: ${failed.map((c) => c.name).join(", ")}`);
      if (run.code) console.log(`    code: ${run.code.slice(0, 120)}...`);
      if (run.error) console.log(`    error: ${run.error.slice(0, 120)}`);
      break; // only show first failure per case
    }
  }
}

// --- Summary ---
console.log("\n--- Summary ---");
for (const r of results) {
  const icon = r.passRate === 1 ? "PASS" : r.passRate > 0 ? "FLAKY" : "FAIL";
  console.log(`  ${icon} ${r.id} (${Math.round(r.passRate * 100)}%)`);
}

const overall =
  results.reduce((sum, r) => sum + r.passRate, 0) / results.length;
console.log(`\nOverall: ${Math.round(overall * 100)}%`);

// --- Write JSON ---
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = new URL("./results", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}/${timestamp}.json`;
writeFileSync(
  outPath,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      model: MODEL,
      runs: RUNS,
      cases: results,
      overall,
    },
    null,
    2,
  ),
);
console.log(`Results: ${outPath}`);
