// Unit tests for normalizeCode — no executor required.
// Run: pnpm test:unit

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeCode } from "../src/index.ts";

// --- passthrough ---

test("async arrow function is returned unchanged", () => {
  const src = "async () => 42";
  assert.equal(normalizeCode(src), src);
});

test("async arrow with block body is unchanged", () => {
  const src = "async () => {\n  return 1 + 1;\n}";
  assert.equal(normalizeCode(src), src);
});

test("leading and trailing whitespace trimmed before passthrough check", () => {
  assert.equal(normalizeCode("  async () => 42  \n"), "async () => 42");
});

// --- empty / whitespace ---

test("empty string produces a no-op async arrow", () => {
  assert.equal(normalizeCode(""), "async () => {}");
});

test("whitespace-only string produces a no-op async arrow", () => {
  assert.equal(normalizeCode("   \n\t  "), "async () => {}");
});

// --- markdown fences ---

test("strips ```js fence", () => {
  const n = normalizeCode("```js\nasync () => 1\n```");
  assert.ok(!n.includes("```"));
  assert.ok(n.includes("async () => 1"));
});

test("strips ```javascript fence", () => {
  const n = normalizeCode("```javascript\nasync () => 1\n```");
  assert.ok(!n.includes("```"));
});

test("strips ```ts fence", () => {
  const n = normalizeCode("```ts\nasync () => 1\n```");
  assert.ok(!n.includes("```"));
});

test("strips ```typescript fence", () => {
  const n = normalizeCode("```typescript\nasync () => 1\n```");
  assert.ok(!n.includes("```"));
});

test("strips ```tsx and ```jsx fences", () => {
  assert.ok(!normalizeCode("```tsx\nasync () => 1\n```").includes("```"));
  assert.ok(!normalizeCode("```jsx\nasync () => 1\n```").includes("```"));
});

test("strips bare ``` fence with no language", () => {
  const n = normalizeCode("```\nasync () => 1\n```");
  assert.ok(!n.includes("```"));
});

test("fence with no matching closing fence is left alone", () => {
  // If the closing fence is missing, we shouldn't strip partially.
  const n = normalizeCode("```js\nasync () => 1");
  // acorn will then fail to parse the backticks, we fall through to the
  // wrap-as-async-body fallback — but the backticks should still be present
  // since no full fence match occurred.
  assert.ok(n.includes("```"));
});

test("fence inside string literal is preserved", () => {
  const n = normalizeCode(
    '```js\nasync () => "has ``` fences inside"\n```',
  );
  assert.ok(!n.startsWith("```"));
  assert.ok(n.includes("async () =>"));
});

// --- raw expressions ---

test("raw arithmetic expression is wrapped with return", () => {
  const n = normalizeCode("1 + 1");
  assert.ok(n.includes("async"));
  assert.ok(n.includes("return (1 + 1)"));
});

test("raw function call is wrapped with return", () => {
  const n = normalizeCode('foo("bar")');
  assert.ok(n.includes("async"));
  assert.ok(n.includes('return (foo("bar"))'));
});

test("await expression on its own line is wrapped and returned", () => {
  const n = normalizeCode('await exec("echo", ["hi"])');
  assert.ok(n.includes("async"));
  assert.ok(n.includes('return (await exec("echo", ["hi"]))'));
});

// --- multi-statement ---

test("multi-statement block with trailing expression gets splice-in return", () => {
  const n = normalizeCode("const x = 1;\nx + 2");
  assert.ok(n.includes("const x = 1;"));
  assert.ok(n.includes("return (x + 2)"));
});

test("multi-statement block ending with non-expression statement wraps as-is", () => {
  // if statement at the end → no return splice, just wrap whole body
  const n = normalizeCode("const x = 1;\nif (x > 0) { x; }");
  assert.ok(n.includes("async"));
  assert.ok(n.includes("if (x > 0)"));
  // No "return (" should be spliced in — the fallback wraps without returns.
  assert.ok(!n.includes("return ("));
});

// --- function declarations ---

test("named function declaration is wrapped and invoked", () => {
  const n = normalizeCode("function foo() { return 42; }");
  assert.ok(n.includes("function foo()"));
  assert.ok(n.includes("return foo();"));
  assert.ok(n.startsWith("async () =>"));
});

test("async named function declaration is wrapped and invoked", () => {
  const n = normalizeCode("async function bar() { return await 1; }");
  assert.ok(n.includes("async function bar()"));
  assert.ok(n.includes("return bar();"));
});

// --- export default ---

test("export default anonymous function is wrapped and invoked", () => {
  const n = normalizeCode("export default function() { return 7; }");
  assert.ok(!n.includes("export default"));
  assert.ok(n.includes("function()"));
  assert.ok(n.match(/return \(function\(\) \{ return 7; \}\)\(\);/));
});

test("export default arrow expression delegates through passthrough", () => {
  const n = normalizeCode("export default async () => 99");
  assert.equal(n, "async () => 99");
});

test("export default anonymous class is wrapped (no invocation)", () => {
  const n = normalizeCode("export default class { foo() {} }");
  assert.ok(!n.includes("export default"));
  assert.ok(n.includes("class"));
});

// --- syntax errors ---

test("invalid JavaScript falls back to wrapping raw body", () => {
  const n = normalizeCode("this is not valid js");
  assert.ok(n.startsWith("async () =>"));
  assert.ok(n.includes("this is not valid js"));
});

test("TypeScript type annotations fall through to raw wrap", () => {
  // acorn does not parse TS — falls back to raw wrap, which will fail at
  // runtime, but normalization must not throw.
  const n = normalizeCode("const x: number = 1; x + 2");
  assert.ok(n.startsWith("async () =>"));
});

test("normalizeCode never throws on arbitrary input", () => {
  const inputs = [
    "}}}",
    "/** comment without anything",
    "`unterminated template",
    "\u0000\u0001\u0002",
    "😀 not code",
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => normalizeCode(input), `failed on: ${input}`);
  }
});

// --- imports ---

test("import statements fall through to async-body wrap", () => {
  // acorn parses imports in sourceType: "module". Since the result isn't a
  // single expression / arrow / function / export default, it wraps as body.
  const n = normalizeCode('import foo from "bar";\nfoo()');
  assert.ok(n.includes("import foo"));
  assert.ok(n.includes("async"));
});

// --- object literals ---

test("bare object literal parses as block, falls through sanely", () => {
  // `{ a: 1 }` is ambiguous — acorn parses as block statement with label.
  // Should not crash.
  assert.doesNotThrow(() => normalizeCode("{ a: 1 }"));
});

// --- complex real-world snippets ---

test("full LLM-style output with fence and arrow survives normalization", () => {
  const input = '```js\nasync () => {\n  const { stdout } = await exec("echo", ["hi"]);\n  return stdout.trim();\n}\n```';
  const n = normalizeCode(input);
  assert.ok(!n.includes("```"));
  assert.ok(n.startsWith("async () =>"));
  assert.ok(n.includes("return stdout.trim()"));
});
