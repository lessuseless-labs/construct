// cases.ts — eval test case definitions

import type { EvalCheck } from "./checks.ts";
import {
  code_contains,
  code_does_not_contain,
  code_uses_exec,
  result_contains,
  result_is_not_error,
  result_matches,
} from "./checks.ts";

export interface EvalCase {
  id: string;
  prompt: string;
  checks: EvalCheck[];
  tags?: string[];
}

export const cases: EvalCase[] = [
  // --- Binary name correctness ---
  {
    id: "jq-arithmetic",
    prompt: "use jq to calculate 2+3",
    checks: [
      code_contains("jq"),
      code_uses_exec,
      result_contains("5"),
    ],
    tags: ["binary-name", "basic"],
  },
  {
    id: "rg-binary-name",
    prompt: 'use ripgrep to search for the word "hello" in /etc/hosts',
    checks: [
      code_contains('"rg"'),
      code_does_not_contain('"ripgrep"'),
      code_uses_exec,
      result_is_not_error,
    ],
    tags: ["binary-name"],
  },
  {
    id: "coreutils-date",
    prompt: "get the current date and time",
    checks: [
      code_contains("date"),
      code_uses_exec,
      result_is_not_error,
      result_matches(/\d{4}/), // year should appear
    ],
    tags: ["binary-name", "basic"],
  },

  // --- Argument passing ---
  {
    id: "jq-stdin",
    prompt:
      'given the JSON string \'{"name":"construct","version":"0.1.0"}\', use jq to extract the name field',
    checks: [
      code_contains("jq"),
      code_contains("stdin"),
      result_contains("construct"),
    ],
    tags: ["stdin", "args"],
  },
  {
    id: "jq-flags",
    prompt: "use jq to output raw text (not quoted) for the string value from: '{\"msg\":\"hello\"}'",
    checks: [
      code_contains("jq"),
      code_contains("-r"),
      result_contains("hello"),
    ],
    tags: ["args"],
  },

  // --- Tool chaining ---
  {
    id: "chain-echo-jq",
    prompt: 'echo the JSON {"a":1,"b":2} and then use jq to extract the value of "a"',
    checks: [
      code_uses_exec,
      code_contains("jq"),
      result_contains("1"),
    ],
    tags: ["chaining"],
  },
  {
    id: "multi-step",
    prompt: "list the files in /tmp, then count how many there are using wc",
    checks: [
      code_uses_exec,
      result_is_not_error,
    ],
    tags: ["chaining", "multi-step"],
  },

  // --- Error handling ---
  {
    id: "error-handling",
    prompt:
      "try to run a command that doesn't exist called 'nonexistent_tool_xyz', and return a message saying it failed",
    checks: [
      code_uses_exec,
      result_is_not_error, // the code should catch the error, not crash
      result_contains("fail"),
    ],
    tags: ["error-handling"],
  },

  // --- Nushell ---
  {
    id: "nu-arithmetic",
    prompt: "use nushell to calculate 2 + 3",
    checks: [
      code_contains("nu"),
      code_uses_exec,
      result_contains("5"),
    ],
    tags: ["nushell", "basic"],
  },
  {
    id: "nu-json-parse",
    prompt:
      'use nushell to parse the JSON \'{"name":"construct","version":"0.1.0"}\' and return the name field',
    checks: [
      code_contains("nu"),
      code_uses_exec,
      result_contains("construct"),
    ],
    tags: ["nushell", "data"],
  },
  {
    id: "nu-pipeline",
    prompt:
      "use nushell to list files in /tmp, filter to only directories, and count them",
    checks: [
      code_contains("nu"),
      code_uses_exec,
      result_is_not_error,
    ],
    tags: ["nushell", "pipeline"],
  },
  {
    id: "nu-table",
    prompt:
      'use nushell to create a table with columns "name" and "age" containing two rows: Alice/30 and Bob/25, then sort by age',
    checks: [
      code_contains("nu"),
      code_uses_exec,
      result_contains("Bob"),
      result_contains("Alice"),
      result_is_not_error,
    ],
    tags: ["nushell", "structured-data"],
  },
  {
    id: "nu-string-ops",
    prompt:
      "use nushell to split the string 'hello-world-foo-bar' by dashes and return the third element",
    checks: [
      code_contains("nu"),
      code_uses_exec,
      result_contains("foo"),
    ],
    tags: ["nushell", "strings"],
  },
  {
    id: "nu-csv",
    prompt:
      'use nushell to parse this CSV data and return the sum of the values column: "name,value\\nA,10\\nB,20\\nC,30"',
    checks: [
      code_contains("nu"),
      code_uses_exec,
      result_contains("60"),
    ],
    tags: ["nushell", "data"],
  },
];
