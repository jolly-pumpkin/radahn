import { describe, expect, test } from "bun:test";
import { lex } from "../src/lex/index";
import { parse } from "../src/parse/index";
import { resolve } from "../src/resolve/index";
import { typeCheck, type TypeCheckResult } from "../src/check/typer";

function check(source: string): TypeCheckResult {
	const lexResult = lex(source, "test.rd");
	const parseResult = parse(lexResult.tokens, "test.rd");
	const resolveResult = resolve(parseResult.root, parseResult.arena);
	return typeCheck(parseResult.root, parseResult.arena, resolveResult.resolutions);
}

function errors(source: string, code?: string) {
	const result = check(source);
	if (code) return result.diagnostics.filter((d) => d.code === code);
	return result.diagnostics.filter((d) => d.severity === "error");
}

describe("typer scaffold", () => {
	describe("literal return types — no errors", () => {
		test("Int literal matches Int return type", () => {
			const errs = errors(`module app
end-module

fn f() -> Int {
  42
}
`);
			expect(errs).toEqual([]);
		});

		test("Float literal matches Float return type", () => {
			const errs = errors(`module app
end-module

fn f() -> Float {
  3.14
}
`);
			expect(errs).toEqual([]);
		});

		test("String literal matches String return type", () => {
			const errs = errors(`module app
end-module

fn f() -> String {
  "hello"
}
`);
			expect(errs).toEqual([]);
		});

		test("Bool literal matches Bool return type", () => {
			const errs = errors(`module app
end-module

fn f() -> Bool {
  true
}
`);
			expect(errs).toEqual([]);
		});
	});

	describe("return type mismatches — E0401", () => {
		test("body is Bool but declared Int", () => {
			const errs = errors(
				`module app
end-module

fn f() -> Int {
  true
}
`,
				"E0401",
			);
			expect(errs.length).toBe(1);
			expect(errs[0].message).toContain("Bool");
			expect(errs[0].message).toContain("Int");
		});
	});

	describe("parameter types", () => {
		test("parameter type flows to return", () => {
			const errs = errors(`module app
end-module

fn f(x: Int) -> Int {
  x
}
`);
			expect(errs).toEqual([]);
		});

		test("wrong param type in return — E0401", () => {
			const errs = errors(
				`module app
end-module

fn f(x: String) -> Int {
  x
}
`,
				"E0401",
			);
			expect(errs.length).toBe(1);
		});
	});

	describe("let statements", () => {
		test("let with matching annotation — no error", () => {
			const errs = errors(`module app
end-module

fn f() -> Int {
  let x: Int = 42
  x
}
`);
			expect(errs).toEqual([]);
		});

		test("let with mismatched annotation — E0401", () => {
			const errs = errors(
				`module app
end-module

fn f() -> String {
  let x: String = 42
  x
}
`,
				"E0401",
			);
			// One error: let annotation String vs value Int
			expect(errs.length).toBe(1);
		});
	});

	describe("multiple functions", () => {
		test("each function checked independently", () => {
			const errs = errors(`module app
end-module

fn a() -> Int {
  1
}

fn b() -> Bool {
  true
}
`);
			expect(errs).toEqual([]);
		});
	});

	describe("function calls", () => {
		test("correct call to declared function", () => {
			const result = check(
				"module t\nend-module\nfn add(a: Int, b: Int) -> Int { a }\nfn main() -> Int { add(1, 2) }",
			);
			expect(result.diagnostics).toEqual([]);
		});

		test("wrong argument type is E0401", () => {
			const errs = errors(
				'module t\nend-module\nfn add(a: Int, b: Int) -> Int { a }\nfn main() -> Int { add(1, "hi") }',
				"E0401",
			);
			expect(errs.length).toBe(1);
			expect(errs[0].message).toContain("argument");
		});

		test("wrong argument count is E0401", () => {
			const errs = errors(
				"module t\nend-module\nfn add(a: Int, b: Int) -> Int { a }\nfn main() -> Int { add(1) }",
				"E0401",
			);
			expect(errs.length).toBe(1);
		});

		test("call return type flows to usage", () => {
			const errs = errors(
				'module t\nend-module\nfn get_name() -> String { "hi" }\nfn main() -> Int { get_name() }',
				"E0401",
			);
			expect(errs.length).toBe(1); // String != Int return
		});

		test("chained calls", () => {
			const result = check(
				"module t\nend-module\nfn inc(x: Int) -> Int { x }\nfn main() -> Int { inc(inc(1)) }",
			);
			expect(result.diagnostics).toEqual([]);
		});
	});

	describe("typeMap population", () => {
		test("literals have types in typeMap", () => {
			const result = check(`module app
end-module

fn f() -> Int {
  42
}
`);
			// There should be at least some entries in the typeMap
			expect(result.typeMap.size).toBeGreaterThan(0);
		});
	});
});
