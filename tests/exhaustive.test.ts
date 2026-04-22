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

function errors(source: string, code: string) {
	return check(source).diagnostics.filter((d) => d.code === code);
}

describe("exhaustiveness — ADT variants", () => {
	const prelude = [
		"module t",
		"end-module",
		"type Shape",
		"  | Circle(Float)",
		"  | Rect(Float, Float)",
		"  | Triangle(Float, Float, Float)",
		"end",
	].join("\n");

	test("all variants covered — no error", () => {
		const src =
			prelude +
			"\nfn area(s: Shape) -> Float {\n  match s {\n    Circle(r) => r\n    Rect(w, h) => w\n    Triangle(a, b, c) => a\n  }\n}";
		expect(errors(src, "E0402")).toEqual([]);
	});

	test("missing variant — E0402", () => {
		const src =
			prelude +
			"\nfn area(s: Shape) -> Float {\n  match s {\n    Circle(r) => r\n    Rect(w, h) => w\n  }\n}";
		const errs = errors(src, "E0402");
		expect(errs.length).toBe(1);
		expect(errs[0].message).toContain("Triangle");
	});

	test("wildcard covers all — no error", () => {
		const src =
			prelude +
			"\nfn area(s: Shape) -> Float {\n  match s {\n    Circle(r) => r\n    _ => 0.0\n  }\n}";
		expect(errors(src, "E0402")).toEqual([]);
	});
});

describe("exhaustiveness — Bool", () => {
	test("true + false covers Bool", () => {
		const src =
			"module t\nend-module\nfn f(b: Bool) -> Int {\n  match b {\n    true => 1\n    false => 0\n  }\n}";
		expect(errors(src, "E0402")).toEqual([]);
	});

	test("missing false — E0402", () => {
		const src =
			"module t\nend-module\nfn f(b: Bool) -> Int {\n  match b {\n    true => 1\n  }\n}";
		expect(errors(src, "E0402").length).toBe(1);
	});
});

describe("exhaustiveness — unreachable arms", () => {
	test("duplicate wildcard — E0403", () => {
		const src =
			"module t\nend-module\nfn f(x: Int) -> Int {\n  match x {\n    _ => 1\n    _ => 2\n  }\n}";
		const errs = errors(src, "E0403");
		expect(errs.length).toBe(1);
	});
});

describe("exhaustiveness — guards", () => {
	test("guarded arm doesn't count as covering", () => {
		const prelude2 =
			"module t\nend-module\ntype Color\n  | Red\n  | Blue\nend\n";
		const src =
			prelude2 +
			"fn f(c: Color) -> Int {\n  match c {\n    Red if true => 1\n    Blue => 2\n  }\n}";
		const errs = errors(src, "E0402");
		expect(errs.length).toBe(1);
	});
});

describe("exhaustiveness — match type checking", () => {
	test("arm body types must match", () => {
		const src =
			'module t\nend-module\nfn f(x: Bool) -> Int {\n  match x {\n    true => 1\n    false => "hi"\n  }\n}';
		const errs = errors(src, "E0401");
		expect(errs.length).toBeGreaterThan(0);
	});

	test("match returns the arm type", () => {
		const result = check(
			"module t\nend-module\nfn f(x: Bool) -> Int {\n  match x {\n    true => 1\n    false => 2\n  }\n}",
		);
		expect(result.diagnostics).toEqual([]);
	});

	test("wildcard on Int type — no missing", () => {
		expect(
			errors(
				"module t\nend-module\nfn f(x: Int) -> Int {\n  match x {\n    _ => 1\n  }\n}",
				"E0402",
			),
		).toEqual([]);
	});
});
