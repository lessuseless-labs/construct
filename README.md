<div align="center">

# construct

**every program you've never heard of, one prompt away**

<img src="assets/lots_of_guns.png" alt="Lots of guns." width="600" />

[![CI](https://github.com/lessuseless-labs/construct/actions/workflows/ci.yml/badge.svg)](https://github.com/lessuseless-labs/construct/actions/workflows/ci.yml)

*nixpkgs is the API. gun is the runtime.*

</div>

---

Every AI agent hits the same wall: **tools**. Each one needs a wrapper, a server, a schema, a protocol. Connect ten MCP servers and half your context window is gone before the conversation starts.

construct flips it. Instead of wrapping every tool individually, agents write code against [nixpkgs](https://github.com/NixOS/nixpkgs) — **120,000+ packages, zero wrappers**. One tool call. One sandbox. The number of available tools scales. Your context window doesn't.

```
Before: 10 MCP servers → 10 schemas → 10 tool descriptions in context
After:  1 tool → 1 sandbox → exec("anything", [...])
```

## How it works

1. Agent gets a tool that accepts code
2. Agent writes a script orchestrating CLI tools — jq, ripgrep, ffmpeg, nushell, whatever
3. `gun` runs it in a [sandnix](https://github.com/srid/sandnix)-sandboxed Nix closure
4. One tool call replaces N individual tool calls

If the agent doesn't know a tool's syntax, it asks at runtime:

```js
const { stdout } = await exec("tldr", ["ffmpeg"]);
// The sandbox teaches itself
```

## Quick start

```bash
# Build
nix build github:lessuseless-labs/construct

# Run
echo '{"jsonrpc":"2.0","method":"execute","id":1,"params":{"code":"async () => { const { stdout } = await exec(\"jq\", [\"-n\", \"2+3\"]); return stdout.trim(); }","providers":[]}}' \
  | ./result/bin/gun
# → {"jsonrpc":"2.0","id":1,"result":{"result":"5"}}
```

## With the AI SDK

```typescript
import { createCodeTool } from "@cloudflare/codemode/ai";
import { NixExecutor } from "@construct/nix-executor";

const executor = new NixExecutor();
const description = executor.getToolDescription();

const codeTool = createCodeTool({
  tools: {},
  executor,
  description,
});

// Pass to any AI SDK-compatible model
const result = await generateText({
  model: yourModel,
  tools: { codemode: codeTool },
  prompt: "use jq to parse this JSON and extract the names",
});
```

## What's in the sandbox

The sandbox is a Nix flake closure. Add packages, rebuild, done:

```nix
# flake.nix
sandboxTools = with pkgs; [
  jq           # JSON processing
  ripgrep      # search
  coreutils    # cat, sort, wc, ...
  nushell      # structured shell
  ffmpeg       # media processing      ← add a line
  pandoc       # document conversion   ← add a line
  imagemagick  # image manipulation    ← add a line
];
```

The tool manifest is auto-generated from package metadata. The agent sees what's available without manual schema writing.

## Architecture

```
Agent → NixExecutor → gun (sandnix-wrapped) → Deno → code
                           │                           │
                           │  kernel-level sandbox     │
                           │  (Landlock / sandbox-exec)│
                           │                           │
                           │  jq, rg, nu, etc on PATH  │
                           └───────────────────────────┘
```

- **gun** — Rust binary. Spawns Deno, relays tool calls over JSON-RPC stdin/stdout
- **sandnix** — OS-level sandboxing. Landlock on Linux, sandbox-exec on macOS
- **exec()** — built-in for sandbox code. Runs any binary in the closure
- **tldr** — self-serve docs. The agent can look up any tool's usage at runtime

## Eval results

construct includes an eval harness that tests whether LLMs produce correct code from the tool descriptions:

```
$ pnpm eval

Model: gpt-4o | Runs: 2 | Cases: 14

jq-arithmetic     .. 100%    rg-binary-name    .. 100%
coreutils-date    .. 100%    jq-stdin          .. 100%
jq-flags          .. 100%    chain-echo-jq     .. 100%
multi-step        .. 100%    error-handling    .. 100%
nu-arithmetic     .. 100%    nu-json-parse     .. 100%
nu-pipeline       .. 100%    nu-table          .. 100%
nu-string-ops     .. 100%    nu-csv            .. 100%

Overall: 100%
```

## Development

```bash
nix develop                  # devshell with all tools
cargo build --release        # build gun
cd ts && pnpm install        # TS deps
pnpm test                    # e2e tests (14 cases)
pnpm test:integration        # codemode integration
pnpm eval                    # LLM eval harness
```

## Roadmap

- [x] Core executor (gun + runner.ts + NixExecutor)
- [x] sandnix OS-level sandboxing
- [x] Package discovery (auto-generated tool manifest)
- [x] Eval harness
- [ ] MCP server mode
- [ ] Vendor codemode core (drop Cloudflare dependency)
- [ ] Hosted API
- [ ] A2A/ACP agent-to-agent protocol
- [ ] GPU passthrough
- [ ] Closure marketplace

## Why not just use MCP servers?

| | 10 MCP servers | construct |
|---|---|---|
| **Setup** | 10 repos, 10 configs, 10 processes | 1 flake, 1 binary |
| **Context cost** | 10 tool schemas in every prompt | 1 tool + "run exec() for help" |
| **Adding a tool** | Write a server, deploy, configure | Add a line to `sandboxTools` |
| **Security** | Trust each server individually | Kernel-sandboxed, one boundary |
| **Capability** | Whatever someone wrapped | 120,000+ nixpkgs packages |

### Context window cost at scale

Every MCP tool schema eats tokens before the user says anything. construct's cost is fixed.

```
MCP servers    Tools    Context cost    construct
───────────────────────────────────────────────────
  1 server       3          204 tokens     289 tokens (fixed)
  5 servers     13        1,019 tokens     289 tokens (3.5x less)
 10 servers     26        2,038 tokens     289 tokens (7x less)
 20 servers     52        4,076 tokens     289 tokens (14x less)
 50 servers    130       10,190 tokens     289 tokens (35x less)
```

Run `pnpm bench:context` to reproduce.

## Credits

- [codemode](https://github.com/cloudflare/agents/tree/main/packages/codemode) by Cloudflare — the original insight that LLMs should write code, not call tools one at a time
- [sandnix](https://github.com/srid/sandnix) by Srid — declarative OS-level sandboxing for Nix
- [nixpkgs](https://github.com/NixOS/nixpkgs) — the largest software repository. The API surface.

## License

MIT

</div>
