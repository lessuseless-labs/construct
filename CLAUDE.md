# construct

Agents write code. nixpkgs is the API. gun runs it.

## Why

The MCP server explosion: every tool needs a wrapper, a server, a protocol. construct's answer — if it's in nixpkgs, it's already a tool. Just write code.

Same idea as Cloudflare's [codemode](https://github.com/cloudflare/agents/tree/main/packages/codemode) (LLMs write scripts against Cloudflare's API surface instead of calling tools one at a time), but the API surface is nixpkgs — 100k+ packages as capabilities.

## How it works

1. Agent gets a tool that accepts code
2. Agent writes a script orchestrating multiple packages (jq, ffmpeg, curl, ripgrep, etc)
3. `gun` runs it in a sandnix-sandboxed environment
4. One tool call replaces N MCP tool calls

## Architecture

```
Client (Node.js / AI SDK)
  │  execute(code, providers)
  ▼
NixExecutor (ts/src/executor.ts)
  │  spawn gun, JSON-RPC over stdin/stdout
  ▼
gun (crates/gun/src/main.rs)
  │  spawn Deno with runner.ts, relay tool calls
  ▼
runner.ts (runner/runner.ts)
  │  evaluate user code, proxy tool calls, capture logs
  ▼
Nix Sandbox (sandnix)
  │  exec() calls → jq, rg, nu, coreutils, etc.
```

### Components

- **gun** (`crates/gun/`): Rust binary. JSON-RPC server that spawns Deno inside a Nix closure, relays tool calls between the TS adapter and the Deno sandbox
- **runner.ts** (`runner/runner.ts`): Deno script embedded in gun at build time. Evaluates user code, creates provider proxies, captures console output
- **NixExecutor** (`ts/src/executor.ts`): TypeScript adapter. Spawns gun, manages the JSON-RPC request/response lifecycle, dispatches tool calls to provider functions
- **sandnix**: External Nix module (github:srid/sandnix). Kernel-level sandboxing via Landlock (Linux) or sandbox-exec (macOS)
- **codemode** (`ts/src/codemode/`): Vendored from Cloudflare. Normalizes LLM code output (strips markdown fences, wraps expressions in async IIFEs)
- **MCP server** (`ts/src/mcp.ts`): Exposes gun as a single "execute" MCP tool

### Layered sandboxing

1. **sandnix** (kernel): Landlock/sandbox-exec — no network, no TTY, only /nix/store and /tmp
2. **Deno** (process): `--deny-env`, `--deny-ffi`, `--allow-run`, `--allow-read={runner,/nix/store}`
3. **gun** (application): Input validation, timeout enforcement (max 300s), 256MB V8 heap limit

## Repository structure

```
construct/
├── crates/gun/                # Rust binary
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs            # JSON-RPC loop, tool call relay, timeout handling
│       ├── protocol.rs        # Request/response types (serde)
│       └── sandbox.rs         # Deno child process spawn/management
├── runner/
│   └── runner.ts              # Deno runtime: eval, exec(), provider proxies, log capture
├── ts/                        # TypeScript package (@construct/nix-executor)
│   ├── src/
│   │   ├── index.ts           # Package exports
│   │   ├── executor.ts        # NixExecutor class — core adapter
│   │   ├── mcp.ts             # MCP server (single "execute" tool)
│   │   └── codemode/
│   │       ├── index.ts       # Codemode exports
│   │       ├── types.ts       # ExecuteResult, ResolvedProvider, Executor interfaces
│   │       └── normalize.ts   # Code normalization (vendored from Cloudflare)
│   ├── test/
│   │   ├── e2e.ts             # 11 end-to-end tests (gun + executor)
│   │   └── integration.ts     # 6 integration tests (normalizeCode + execution)
│   ├── eval/
│   │   ├── runner.ts          # LLM eval orchestrator
│   │   ├── cases.ts           # 14 eval cases (jq, rg, coreutils, nushell)
│   │   ├── checks.ts          # Eval check functions
│   │   └── mcp-test.ts        # MCP-specific eval
│   ├── examples/
│   │   ├── basic.ts           # No-API-key demo
│   │   └── demo.ts            # Full LLM demo (GitHub Models)
│   ├── bench/
│   │   └── context-cost.ts    # Context window cost comparison
│   ├── package.json
│   ├── tsconfig.json
│   └── tsup.config.ts         # Two entry points: index + mcp
├── flake.nix                  # Nix flake: builds, devshell, sandnix config
├── Cargo.toml                 # Workspace root
├── .github/workflows/ci.yml   # CI pipeline
└── .mcp.json.example          # MCP client config template
```

## Stack

- **Rust** — gun binary (tokio, serde, serde_json, tempfile)
- **Nix** — build system, sandbox closure, sandnix isolation
- **Deno** — runtime inside sandbox for user code
- **TypeScript** — NixExecutor adapter, MCP server, codemode normalization
- **Node.js 22** — runs the TS adapter (tsx for dev, tsup for build)
- **pnpm** — package manager for ts/

## Development

### Prerequisites

```bash
nix develop              # devshell with deno, rust-analyzer, node 22, pnpm, jq, rg
```

This sets `GUN_PATH=$PWD/target/release/gun` automatically.

### Build

```bash
cargo build --release              # build gun binary
cd ts && pnpm install              # install TS deps
pnpm build                         # build TS package (tsup)
```

Nix builds (reproducible):
```bash
nix build .#gun-unwrapped          # just the Rust binary
nix build .#gun-with-tools         # gun + deno + all sandbox tools on PATH
nix build .#construct-mcp          # full MCP server wrapper
nix build .#tool-manifest          # auto-generated tool manifest JSON
```

### Test

All tests run from `ts/` and require `GUN_PATH` to point at the gun binary.

```bash
cd ts
pnpm test                # e2e tests (11 cases — arithmetic, console, errors, tools, exec)
pnpm test:integration    # integration tests (6 cases — normalizeCode + execution)
pnpm eval:mcp            # MCP server eval
pnpm demo:basic          # no-API-key demo (validates basic execution)
```

Tests use `console.assert()` directly — no test framework. Each test file is a standalone script run via tsx.

### Eval (requires API key)

```bash
cd ts
pnpm eval                # LLM eval — 14 cases, configurable via EVAL_RUNS, EVAL_MODEL, EVAL_FILTER
pnpm demo                # full LLM demo with GitHub Models
```

### CI

GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to `main`:
1. Build gun via `nix build .#gun-unwrapped`
2. Install deno, Node.js 22, pnpm
3. Run e2e tests, integration tests, MCP tests, basic demo
4. Build TS package

## Key conventions

### Rust (gun)

- JSON-RPC 2.0 protocol over stdin/stdout (line-delimited JSON)
- Standard error codes: -32600 (invalid request), -32700 (parse error), -32602 (invalid params), -32601 (method not found), -32000 (execution error)
- Async via tokio with full features
- runner.ts is embedded at build time — the Nix build copies `tool-manifest.json` into the source tree before `cargo build`
- Provider names must be valid JS identifiers (validated via `is_valid_js_identifier()`)

### TypeScript

- ESM only (`"type": "module"`)
- Target: ES2022, moduleResolution: bundler
- No test framework — raw `console.assert()` in standalone scripts
- `NixExecutor` is the primary public API — spawns gun, handles JSON-RPC lifecycle
- `normalizeCode()` strips markdown fences and wraps code for evaluation
- MCP server registers a single "execute" tool with Zod schema validation

### Nix

- Uses flake-parts for multi-system support (x86_64/aarch64, linux/darwin)
- crane for Rust builds
- Sandbox tools defined in `sandboxTools` list in flake.nix: jq, ripgrep, coreutils, nushell, tealdeer
- Tool manifest auto-generated from package metadata at Nix build time

### JSON-RPC message flow

```
Adapter → gun:    { method: "execute", params: { code, providers, timeout } }
gun → Deno:       { method: "initialize", params: { code, providers } }
Deno → gun:       { method: "tool/call", params: { provider, tool, args } }
gun → Adapter:    (relayed tool/call)
Adapter → gun:    { id, result: { value } }
gun → Deno:       (relayed response)
Deno → gun:       { method: "execute/result", params: { result, error?, logs } }
gun → Adapter:    (relayed result)
```

## Important environment variables

| Variable | Purpose |
|----------|---------|
| `GUN_PATH` | Path to the gun binary (required for tests, auto-set in devshell) |
| `EVAL_RUNS` | Number of LLM runs per eval case (default: 3) |
| `EVAL_MODEL` | Model to use for evals (default: gpt-4o) |
| `EVAL_FILTER` | Filter eval cases by name substring |
