// Unit tests for runner.ts primitives.
// Run: deno test --allow-run=echo,cat,false,sh --allow-read runner/runner_test.ts

import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  captureConsole,
  createProviderProxy,
  evaluateCode,
  exec,
} from "./runner.ts";

// --- exec ---

Deno.test("exec: echo returns stdout and exit code 0", async () => {
  const r = await exec("echo", ["hello"]);
  assertEquals(r.stdout.trim(), "hello");
  assertEquals(r.stderr, "");
  assertEquals(r.code, 0);
});

Deno.test("exec: stdin is piped through to cat", async () => {
  const r = await exec("cat", [], { stdin: "piped input" });
  assertEquals(r.stdout, "piped input");
  assertEquals(r.code, 0);
});

Deno.test("exec: nonzero exit code is returned, not thrown", async () => {
  const r = await exec("false", []);
  assertNotEquals(r.code, 0);
});

Deno.test("exec: nonexistent binary rejects", async () => {
  await assertRejects(() => exec("nonexistent_binary_abc123", []));
});

Deno.test("exec: stderr is captured", async () => {
  const r = await exec("sh", ["-c", "echo oops 1>&2"]);
  assertEquals(r.stdout, "");
  assertStringIncludes(r.stderr, "oops");
  assertEquals(r.code, 0);
});

Deno.test("exec: stdin is closed when not provided", async () => {
  // If stdin were left open, cat would hang. Explicit "null" stdin ensures
  // cat reads EOF immediately.
  const r = await exec("cat", []);
  assertEquals(r.stdout, "");
  assertEquals(r.code, 0);
});

// --- captureConsole ---

Deno.test("captureConsole: log captured without prefix", () => {
  const { logs, restore } = captureConsole();
  try {
    console.log("hello");
    assertEquals(logs, ["hello"]);
  } finally {
    restore();
  }
});

Deno.test("captureConsole: level prefixes applied", () => {
  const { logs, restore } = captureConsole();
  try {
    console.log("a");
    console.info("b");
    console.warn("c");
    console.error("d");
    console.debug("e");
    assertEquals(logs, ["a", "[info] b", "[warn] c", "[error] d", "[debug] e"]);
  } finally {
    restore();
  }
});

Deno.test("captureConsole: preserves call order across levels", () => {
  const { logs, restore } = captureConsole();
  try {
    console.warn("first");
    console.log("second");
    console.error("third");
    assertEquals(logs, ["[warn] first", "second", "[error] third"]);
  } finally {
    restore();
  }
});

Deno.test("captureConsole: non-string args serialized as JSON", () => {
  const { logs, restore } = captureConsole();
  try {
    console.log("obj is", { a: 1, b: [2, 3] });
    console.log(42, true, null);
    assertEquals(logs, [`obj is {"a":1,"b":[2,3]}`, "42 true null"]);
  } finally {
    restore();
  }
});

Deno.test("captureConsole: restore reverts all console methods", () => {
  const origLog = console.log;
  const origWarn = console.warn;
  const { restore } = captureConsole();
  assertNotEquals(console.log, origLog);
  assertNotEquals(console.warn, origWarn);
  restore();
  assertEquals(console.log, origLog);
  assertEquals(console.warn, origWarn);
});

// --- createProviderProxy ---

Deno.test("createProviderProxy: keyword args serialize first arg only", async () => {
  const calls: Array<{ tool: string; args: string }> = [];
  const proxy = createProviderProxy(false, async (tool, args) => {
    calls.push({ tool, args });
    return "ok";
  });
  await proxy.doThing({ a: 1, b: 2 });
  assertEquals(calls, [{ tool: "doThing", args: `{"a":1,"b":2}` }]);
});

Deno.test("createProviderProxy: positional args serialize full args array", async () => {
  const calls: Array<{ tool: string; args: string }> = [];
  const proxy = createProviderProxy(true, async (tool, args) => {
    calls.push({ tool, args });
    return null;
  });
  await proxy.add(1, 2, 3);
  assertEquals(calls, [{ tool: "add", args: "[1,2,3]" }]);
});

Deno.test("createProviderProxy: no args serializes as {}", async () => {
  const calls: Array<{ tool: string; args: string }> = [];
  const proxy = createProviderProxy(false, async (tool, args) => {
    calls.push({ tool, args });
    return null;
  });
  await proxy.ping();
  assertEquals(calls, [{ tool: "ping", args: "{}" }]);
});

Deno.test("createProviderProxy: return value from call propagates", async () => {
  const proxy = createProviderProxy(false, async () => ({ answer: 42 }));
  const r = await proxy.anything({ x: 1 });
  assertEquals(r, { answer: 42 });
});

Deno.test("createProviderProxy: errors from call propagate to awaiter", async () => {
  const proxy = createProviderProxy(false, async () => {
    throw new Error("tool broke");
  });
  await assertRejects(() => proxy.fail({}), Error, "tool broke");
});

Deno.test("createProviderProxy: tool name equals property name", async () => {
  const seenTools: string[] = [];
  const proxy = createProviderProxy(false, async (tool) => {
    seenTools.push(tool);
    return null;
  });
  await proxy.firstTool({});
  await proxy.secondTool({});
  await proxy["third-tool"]({});
  assertEquals(seenTools, ["firstTool", "secondTool", "third-tool"]);
});

// --- evaluateCode ---

Deno.test("evaluateCode: async arrow returning a value", async () => {
  const r = await evaluateCode("async () => 1 + 1", {});
  assertEquals(r.result, 2);
  assertEquals(r.error, undefined);
});

Deno.test("evaluateCode: thrown error captured as string", async () => {
  const r = await evaluateCode('async () => { throw new Error("boom") }', {});
  assertEquals(r.result, null);
  assertEquals(r.error, "boom");
});

Deno.test("evaluateCode: rejected promise captured as error", async () => {
  const r = await evaluateCode(
    'async () => { return Promise.reject(new Error("rejected")) }',
    {},
  );
  assertEquals(r.error, "rejected");
});

Deno.test("evaluateCode: globals injected as positional parameters", async () => {
  const r = await evaluateCode("async () => await math.double(21)", {
    math: { double: async (n: number) => n * 2 },
  });
  assertEquals(r.result, 42);
});

Deno.test("evaluateCode: multiple globals available simultaneously", async () => {
  const r = await evaluateCode(
    "async () => { const x = await a.one(); const y = await b.two(); return x + y; }",
    {
      a: { one: async () => 1 },
      b: { two: async () => 2 },
    },
  );
  assertEquals(r.result, 3);
});

Deno.test("evaluateCode: syntax error captured as error, not thrown", async () => {
  const r = await evaluateCode("this is not valid javascript", {});
  assertEquals(r.result, null);
  assertNotEquals(r.error, undefined);
});

Deno.test("evaluateCode: non-Error thrown values stringified", async () => {
  const r = await evaluateCode('async () => { throw "string err" }', {});
  assertEquals(r.error, "string err");
});
