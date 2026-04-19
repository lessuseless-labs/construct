import { test } from "node:test";
import { strict as assert } from "node:assert";
import { NixExecutor, normalizeCode } from "../src/index.ts";
import type { ResolvedProvider } from "../src/index.ts";

const gunPath = process.env.GUN_PATH || undefined;
const executor = new NixExecutor(gunPath ? { gunPath } : {});

test("normalizeCode wraps raw expression in async function", () => {
  const n = normalizeCode("1 + 1");
  assert.ok(n.includes("return"), "should add return");
  assert.ok(n.includes("async"), "should be async");
});

test("normalizeCode strips markdown fences", () => {
  const n = normalizeCode("```js\nconsole.log('hi')\n```");
  assert.ok(!n.includes("```"), "should strip fences");
});

test("normalizeCode passes arrow functions through", () => {
  const n = normalizeCode("async () => 42");
  assert.equal(n, "async () => 42");
});

test("normalized raw expression executes correctly", async () => {
  const r = await executor.execute(normalizeCode("1 + 1"), []);
  assert.equal(r.result, 2);
});

test("exec works through normalizeCode wrapping", async () => {
  const r = await executor.execute(
    normalizeCode('await exec("echo", ["hello normalized"])'),
    [],
  );
  const stdout = (r.result as { stdout: string })?.stdout?.trim();
  assert.equal(stdout, "hello normalized");
});

test("provider tools work through normalizeCode", async () => {
  const provider: ResolvedProvider = {
    name: "math",
    fns: {
      add: async (args: unknown) => {
        const { a, b } = args as { a: number; b: number };
        return a + b;
      },
    },
  };
  const r = await executor.execute(
    "async () => await math.add({ a: 10, b: 20 })",
    [provider],
  );
  assert.equal(r.result, 30);
});
