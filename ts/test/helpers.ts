import { NixExecutor } from "../src/index.ts";
import type { ResolvedProvider } from "../src/index.ts";

export function makeExecutor(): NixExecutor {
  const gunPath = process.env.GUN_PATH || undefined;
  return new NixExecutor(gunPath ? { gunPath } : {});
}

export function provider(
  name: string,
  fns: Record<string, (args: unknown) => Promise<unknown>>,
): ResolvedProvider {
  return { name, fns };
}

export const addProvider: ResolvedProvider = provider("codemode", {
  add: async (args) => {
    const { a, b } = args as { a: number; b: number };
    return a + b;
  },
});

export const multiplyProvider: ResolvedProvider = provider("math", {
  multiply: async (args) => {
    const { a, b } = args as { a: number; b: number };
    return a * b;
  },
});
