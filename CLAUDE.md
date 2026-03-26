# construct

Nix-based code executor for [codemode](https://github.com/cloudflare/agents/tree/main/packages/codemode). The loading program — hermetic sandboxed code execution via `nix run`.

## Concept

LLMs write code, codemode normalizes it, construct runs it in a Nix sandbox. Tools are Nix derivations. Environments are flake closures. No containers, no VMs — just Nix.

## Architecture

- **Executor**: Implements codemode's `Executor` interface, shells out to `nix run`
- **Runtime**: Deno (or Node/Bun) provided by a Nix flake per execution
- **Tools**: Functions available inside the sandbox, injected as a generated module
- **Isolation**: Nix sandbox provides hermetic execution — no network, no ambient state

## Stack

- TypeScript (codemode core)
- Nix (executor sandbox)
- Deno (default runtime inside sandbox)
