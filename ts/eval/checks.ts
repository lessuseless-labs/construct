// checks.ts — predicate factories for eval assertions

export interface EvalContext {
  code: string;
  result: unknown;
  error?: string;
  logs?: string[];
  text: string;
}

export interface EvalCheck {
  name: string;
  fn: (ctx: EvalContext) => boolean;
}

export function code_contains(needle: string): EvalCheck {
  return {
    name: `code_contains("${needle}")`,
    fn: (ctx) => ctx.code.includes(needle),
  };
}

export function code_does_not_contain(needle: string): EvalCheck {
  return {
    name: `code_does_not_contain("${needle}")`,
    fn: (ctx) => !ctx.code.includes(needle),
  };
}

export function result_contains(needle: string): EvalCheck {
  return {
    name: `result_contains("${needle}")`,
    fn: (ctx) => {
      const s = typeof ctx.result === "object" ? JSON.stringify(ctx.result) : String(ctx.result ?? "");
      return s.includes(needle);
    },
  };
}

export function result_matches(pattern: RegExp): EvalCheck {
  return {
    name: `result_matches(${pattern})`,
    fn: (ctx) => pattern.test(String(ctx.result ?? "")),
  };
}

export function result_equals(expected: unknown): EvalCheck {
  return {
    name: `result_equals(${JSON.stringify(expected)})`,
    fn: (ctx) => {
      const actual = typeof ctx.result === "string" ? ctx.result.trim() : ctx.result;
      return actual === expected;
    },
  };
}

export const result_is_not_error: EvalCheck = {
  name: "result_is_not_error",
  fn: (ctx) => !ctx.error,
};

export const code_uses_exec: EvalCheck = {
  name: "code_uses_exec",
  fn: (ctx) => ctx.code.includes("exec(") || ctx.code.includes("exec ("),
};
