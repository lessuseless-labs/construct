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

- **gun**: Rust binary. Spawns Deno inside a Nix closure, relays tool calls over JSON-RPC stdin/stdout
- **sandnix**: OS-level sandboxing (Landlock on Linux, sandbox-exec on macOS). Wraps the entire gun process
- **exec()**: Built-in for sandbox code. Runs any binary in the closure: `await exec("jq", ["-n", "1+1"])`
- **Nix closure**: Defines what's available inside the sandbox. Tools = packages in the closure
- **runner.ts**: Deno script embedded in gun. Evaluates code, proxies tool calls, captures output

## Stack

- Rust (gun binary)
- Nix (sandbox closure, sandnix isolation)
- Deno (runtime inside sandbox)
- TypeScript (NixExecutor adapter for AI SDK / codemode integration)

## Development

```
nix develop              # devshell with deno, rust, node, pnpm
cargo build --release    # build gun
cd ts && pnpm install    # TS deps
pnpm test                # e2e tests (needs deno on PATH)
pnpm test:integration    # codemode integration tests
pnpm demo:basic          # no-API-key demo
```

Set `GUN_PATH` to point at the gun binary for tests.
