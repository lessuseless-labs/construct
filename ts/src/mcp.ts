#!/usr/bin/env node
// construct MCP server — exposes the sandbox as a single tool
//
// Usage:
//   GUN_PATH=/path/to/gun node --experimental-strip-types src/mcp.ts
//
// Or via .mcp.json:
//   { "mcpServers": { "construct": { "command": "npx", "args": ["tsx", "src/mcp.ts"], "env": { "GUN_PATH": "..." } } } }

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NixExecutor } from "./executor.ts";

const executor = new NixExecutor({
  gunPath: process.env.GUN_PATH,
});

const description = executor.getToolDescription();

const server = new McpServer({
  name: "construct",
  version: "0.1.0",
});

server.registerTool(
  "execute",
  {
    title: "Execute code in sandbox",
    description,
    inputSchema: z.object({
      code: z
        .string()
        .describe("JavaScript async arrow function to execute in the sandbox"),
    }),
  },
  async ({ code }) => {
    const result = await executor.execute(code, []);

    const output: Record<string, unknown> = {
      result: result.result ?? null,
    };
    if (result.error) output.error = result.error;
    if (result.logs?.length) output.logs = result.logs;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(output),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
