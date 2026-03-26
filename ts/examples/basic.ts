// basic.ts — No API key needed. Tests NixExecutor + exec built-in end-to-end.
import { NixExecutor } from "../src/index.ts";

const executor = new NixExecutor({
  gunPath: process.env.GUN_PATH,
});

// Test 1: exec echo
console.log("1. Running echo via exec...");
const r1 = await executor.execute(
  'async () => { const { stdout } = await exec("echo", ["hello from the sandbox"]); return stdout.trim(); }',
  [],
);
console.log("  ", r1.result);

// Test 2: exec with stdin piping
console.log("2. Piping stdin to cat...");
const r2 = await executor.execute(
  'async () => { const { stdout } = await exec("cat", [], { stdin: "construct" }); return stdout; }',
  [],
);
console.log("  ", r2.result);

// Test 3: chaining commands
console.log("3. Chaining exec calls...");
const r3 = await executor.execute(
  `async () => {
    const { stdout: a } = await exec("echo", ["hello"]);
    const { stdout: b } = await exec("echo", ["world"]);
    return (a.trim() + " " + b.trim());
  }`,
  [],
);
console.log("  ", r3.result);

// Test 4: error handling
console.log("4. Handling exec errors...");
const r4 = await executor.execute(
  `async () => {
    try {
      await exec("false", []);
    } catch (e) {
      return "caught error";
    }
    return "no error (exit code checked via .code)";
  }`,
  [],
);
console.log("  ", r4.result);

console.log("\nDone!");
