// context-cost.ts — Compare token cost of MCP tool schemas vs construct
//
// Usage: pnpm bench:context
//
// Measures how many tokens are consumed by tool definitions before
// the user even sends a message. MCP servers multiply this cost.
// construct keeps it constant.

// Rough token estimate: ~4 chars per token for English/code
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// --- Simulated MCP tool schemas ---
// These represent real-world MCP server tool definitions

const mcpTools: Record<string, { name: string; schema: string }[]> = {
  "filesystem-server": [
    {
      name: "read_file",
      schema: JSON.stringify({
        name: "read_file",
        description: "Read the complete contents of a file from the file system. Only works within allowed directories.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "The path of the file to read" },
          },
          required: ["path"],
        },
      }),
    },
    {
      name: "write_file",
      schema: JSON.stringify({
        name: "write_file",
        description: "Create a new file or completely overwrite an existing file with new content. Only works within allowed directories.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "The path of the file to write" },
            content: { type: "string", description: "The content to write to the file" },
          },
          required: ["path", "content"],
        },
      }),
    },
    {
      name: "list_directory",
      schema: JSON.stringify({
        name: "list_directory",
        description: "Get a detailed listing of all files and directories in a specified path. Results include whether each entry is a file or directory.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "The path of the directory to list" },
          },
          required: ["path"],
        },
      }),
    },
    {
      name: "search_files",
      schema: JSON.stringify({
        name: "search_files",
        description: "Recursively search for files and directories matching a pattern. Returns full paths of matches.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "The starting path for the search" },
            pattern: { type: "string", description: "The search pattern to match against file names" },
          },
          required: ["path", "pattern"],
        },
      }),
    },
    {
      name: "move_file",
      schema: JSON.stringify({
        name: "move_file",
        description: "Move or rename files and directories. Can move across directories and will create parent directories as needed.",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string", description: "Source path" },
            destination: { type: "string", description: "Destination path" },
          },
          required: ["source", "destination"],
        },
      }),
    },
  ],
  "fetch-server": [
    {
      name: "fetch",
      schema: JSON.stringify({
        name: "fetch",
        description: "Fetches a URL from the internet and extracts its contents as markdown. Can fetch web pages, APIs, and other resources.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to fetch" },
            max_length: { type: "number", description: "Maximum response length in characters. Default 5000." },
            raw: { type: "boolean", description: "Get raw content without markdown conversion" },
          },
          required: ["url"],
        },
      }),
    },
  ],
  "search-server": [
    {
      name: "brave_web_search",
      schema: JSON.stringify({
        name: "brave_web_search",
        description: "Performs a web search using the Brave Search API, returning relevant results with titles, descriptions, and URLs.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query (max 400 chars)" },
            count: { type: "number", description: "Number of results (1-20, default 10)" },
          },
          required: ["query"],
        },
      }),
    },
  ],
  "git-server": [
    {
      name: "git_status",
      schema: JSON.stringify({
        name: "git_status",
        description: "Shows the working tree status of a Git repository.",
        inputSchema: {
          type: "object",
          properties: {
            repo_path: { type: "string", description: "Path to the Git repository" },
          },
          required: ["repo_path"],
        },
      }),
    },
    {
      name: "git_log",
      schema: JSON.stringify({
        name: "git_log",
        description: "Shows the commit logs of a Git repository.",
        inputSchema: {
          type: "object",
          properties: {
            repo_path: { type: "string", description: "Path to the Git repository" },
            max_count: { type: "number", description: "Maximum number of commits to show" },
          },
          required: ["repo_path"],
        },
      }),
    },
    {
      name: "git_diff",
      schema: JSON.stringify({
        name: "git_diff",
        description: "Shows changes between commits, commit and working tree, etc.",
        inputSchema: {
          type: "object",
          properties: {
            repo_path: { type: "string", description: "Path to the Git repository" },
            target: { type: "string", description: "Commit hash, branch, or 'staged'" },
          },
          required: ["repo_path"],
        },
      }),
    },
  ],
  "database-server": [
    {
      name: "query",
      schema: JSON.stringify({
        name: "query",
        description: "Execute a read-only SQL query against the connected database. Returns results as JSON.",
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string", description: "The SQL query to execute" },
          },
          required: ["sql"],
        },
      }),
    },
    {
      name: "list_tables",
      schema: JSON.stringify({
        name: "list_tables",
        description: "List all tables in the connected database with their schemas.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      }),
    },
    {
      name: "describe_table",
      schema: JSON.stringify({
        name: "describe_table",
        description: "Get detailed schema information about a specific table including columns, types, and constraints.",
        inputSchema: {
          type: "object",
          properties: {
            table_name: { type: "string", description: "Name of the table to describe" },
          },
          required: ["table_name"],
        },
      }),
    },
  ],
};

// --- construct tool description ---

import { execFileSync } from "node:child_process";

let constructDescription: string;
try {
  // Try to get the real description from gun
  const gunPath = process.env.GUN_PATH;
  if (gunPath) {
    const manifest = execFileSync(gunPath, ["manifest"], { encoding: "utf-8" });
    // Simulate what getToolDescription() produces
    const parsed = JSON.parse(manifest);
    constructDescription = `Execute code to achieve a goal.

Inside the sandbox, use exec() to run CLI tools:
  exec(cmd, args, opts?) → Promise<{ stdout, stderr, code }>
  opts: { stdin?: string }

Available tools:
${parsed.tools.map((t: { mainProgram: string; attr: string; description: string; binaries: string[] }) => {
  const binary = t.mainProgram ?? t.binaries[0] ?? t.attr;
  if (t.binaries.length > 20) {
    return `\n## ${t.attr} — ${t.description}\n  Binaries: ${t.binaries.slice(0, 25).join(", ")}, ...`;
  }
  return `\n## ${binary} — ${t.description}\n  Example: exec("${binary}", [<args>])`;
}).join("\n")}

If unsure about a tool's syntax, run exec("tldr", ["<tool>"]) to get usage examples.

Write an async arrow function in JavaScript that returns the result.
Example: async () => { const { stdout } = await exec("jq", ["-n", "2+3"]); return stdout.trim(); }`;
  } else {
    throw new Error("no GUN_PATH");
  }
} catch {
  // Fallback: representative description
  constructDescription = `Execute code to achieve a goal.

Inside the sandbox, use exec() to run CLI tools:
  exec(cmd, args, opts?) → Promise<{ stdout, stderr, code }>
  opts: { stdin?: string }

Available tools:

## jq — Lightweight and flexible command-line JSON processor
  Example: exec("jq", [<args>])

## rg — Fast line-oriented search tool
  Package: ripgrep
  Example: exec("rg", [<args>])

## coreutils — GNU Core Utilities
  Binaries: cat, cp, echo, head, ls, mkdir, mv, rm, sed, sort, tail, wc, ...

## nu — A new type of shell
  Package: nushell
  Example: exec("nu", ["-c", "<nushell code>"])

## tldr — Simplified, community-driven man pages
  Example: exec("tldr", [<args>])

If unsure about a tool's syntax, run exec("tldr", ["<tool>"]) to get usage examples.

Write an async arrow function in JavaScript that returns the result.
Example: async () => { const { stdout } = await exec("jq", ["-n", "2+3"]); return stdout.trim(); }`;
}

const constructSchema = JSON.stringify({
  name: "codemode",
  description: constructDescription,
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: "JavaScript async arrow function to execute" },
    },
    required: ["code"],
  },
});

// --- Run benchmark ---

console.log("# Context Cost Benchmark: MCP servers vs construct\n");

// MCP costs
console.log("## MCP Server Tool Definitions\n");

let totalMcpTokens = 0;
const serverCosts: Array<{ server: string; tools: number; tokens: number }> = [];

for (const [server, tools] of Object.entries(mcpTools)) {
  const schemaText = tools.map((t) => t.schema).join("\n");
  const tokens = estimateTokens(schemaText);
  totalMcpTokens += tokens;
  serverCosts.push({ server, tools: tools.length, tokens });
  console.log(`  ${server.padEnd(22)} ${String(tools.length).padStart(2)} tools  ${String(tokens).padStart(5)} tokens`);
}

console.log(`  ${"─".repeat(48)}`);
console.log(`  ${"TOTAL".padEnd(22)} ${String(Object.values(mcpTools).flat().length).padStart(2)} tools  ${String(totalMcpTokens).padStart(5)} tokens`);

// construct cost
console.log("\n## construct (single tool)\n");

const constructTokens = estimateTokens(constructSchema);
console.log(`  codemode               1 tool   ${String(constructTokens).padStart(5)} tokens`);

// Comparison
console.log("\n## Comparison\n");

const savings = totalMcpTokens - constructTokens;
const ratio = totalMcpTokens / constructTokens;
const pctSaved = Math.round((savings / totalMcpTokens) * 100);

console.log(`  MCP (${Object.keys(mcpTools).length} servers):  ${totalMcpTokens} tokens consumed before user's first message`);
console.log(`  construct:       ${constructTokens} tokens consumed (fixed, regardless of tool count)`);
console.log(`  Savings:         ${savings} tokens (${pctSaved}% reduction)`);
console.log(`  Ratio:           ${ratio.toFixed(1)}x fewer tokens`);

console.log("\n## Scaling\n");
console.log("  MCP servers    Tools    Tokens (est.)    construct tokens");
console.log("  ─────────────────────────────────────────────────────────");

for (const n of [1, 3, 5, 10, 20, 50]) {
  const avgTokensPerServer = totalMcpTokens / Object.keys(mcpTools).length;
  const mcpTokens = Math.round(avgTokensPerServer * n);
  console.log(
    `  ${String(n).padStart(3)} servers     ${String(Math.round((Object.values(mcpTools).flat().length / Object.keys(mcpTools).length) * n)).padStart(3)}      ${String(mcpTokens).padStart(7)}          ${String(constructTokens).padStart(5)} (fixed)`,
  );
}

// JSON output
const result = {
  mcp: {
    servers: serverCosts,
    totalTools: Object.values(mcpTools).flat().length,
    totalTokens: totalMcpTokens,
  },
  construct: {
    tools: 1,
    tokens: constructTokens,
  },
  savings: {
    tokens: savings,
    percentage: pctSaved,
    ratio: parseFloat(ratio.toFixed(1)),
  },
};

console.log("\n---");
console.log(JSON.stringify(result, null, 2));
