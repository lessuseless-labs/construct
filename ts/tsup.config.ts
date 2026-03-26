import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    external: ["@cloudflare/codemode", "ai", "zod"],
  },
  {
    entry: { "construct-mcp": "src/mcp.ts" },
    format: ["esm"],
    clean: false,
    noExternal: [/.*/],
  },
]);
