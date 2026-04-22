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

	describe("binary operators", () => {
		test("arithmetic on Int", () => {
			const result = check("module t\nend-module\nfn f(a: Int, b: Int) -> Int { a + b }");
			expect(result.diagnostics).toEqual([]);
		});

		test("arithmetic on Float", () => {
			const result = check("module t\nend-module\nfn f(a: Float, b: Float) -> Float { a * b }");
			expect(result.diagnostics).toEqual([]);
		});

		test("arithmetic on mismatched types", () => {
			const errs = errors('module t\nend-module\nfn f(a: Int, b: String) -> Int { a + b }', "E0401");
			expect(errs.length).toBeGreaterThan(0);
		});

		test("comparison returns Bool", () => {
			const result = check("module t\nend-module\nfn f(a: Int, b: Int) -> Bool { a == b }");
			expect(result.diagnostics).toEqual([]);
		});

		test("logical operators require Bool", () => {
			const result = check("module t\nend-module\nfn f(a: Bool, b: Bool) -> Bool { a && b }");
			expect(result.diagnostics).toEqual([]);
		});

		test("logical operator on non-Bool is E0401", () => {
			const errs = errors("module t\nend-module\nfn f(a: Int, b: Int) -> Bool { a && b }", "E0401");
			expect(errs.length).toBeGreaterThan(0);
		});

		test("string concatenation", () => {
			const result = check('module t\nend-module\nfn f(a: String, b: String) -> String { a ++ b }');
			expect(result.diagnostics).toEqual([]);
		});
	});

	describe("if expressions", () => {
		test("if with matching branches", () => {
			const result = check(
				"module t\nend-module\nfn f(x: Bool) -> Int { if x { 1 } else { 2 } }",
			);
			expect(result.diagnostics).toEqual([]);
		});

		test("if condition must be Bool", () => {
			const errs = errors(
				"module t\nend-module\nfn f(x: Int) -> Int { if x { 1 } else { 2 } }",
				"E0401",
			);
			expect(errs.length).toBe(1);
			expect(errs[0].message).toContain("Bool");
		});

		test("if branches must match types", () => {
			const errs = errors(
				'module t\nend-module\nfn f(x: Bool) -> Int { if x { 1 } else { "hi" } }',
				"E0401",
			);
			expect(errs.length).toBeGreaterThan(0);
		});

		test("if without else returns Void", () => {
			const result = check(
				"module t\nend-module\nfn f(x: Bool) -> () { if x { 1 } }",
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
