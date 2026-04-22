import { describe, expect, test } from "bun:test";
import { emit } from "../src/emit/index";
import { lex } from "../src/lex/index";
import { parse } from "../src/parse/index";
import { resolve } from "../src/resolve/index";

/** Helper: compile Radahn source to TS string */
function rd2ts(source: string): string {
	const lexResult = lex(source, "test.rd");
	const parseResult = parse(lexResult.tokens, "test.rd");
	const resolveResult = resolve(parseResult.root, parseResult.arena);
	const emitResult = emit(parseResult.root, parseResult.arena, resolveResult.resolutions);
	return emitResult.ts.trim();
}

describe("type mapping", () => {
	test("Int → number", () => {
		const ts = rd2ts("module t\nend-module\nfn f(x: Int) -> Int {\n  x\n}");
		expect(ts).toContain("x: number");
	});

	test("String → string", () => {
		const ts = rd2ts("module t\nend-module\nfn f(x: String) -> String {\n  x\n}");
		expect(ts).toContain("x: string");
	});

	test("Bool → boolean", () => {
		const ts = rd2ts("module t\nend-module\nfn f(x: Bool) -> Bool {\n  x\n}");
		expect(ts).toContain("x: boolean");
	});

	test("Float → number", () => {
		const ts = rd2ts("module t\nend-module\nfn f(x: Float) -> Float {\n  x\n}");
		expect(ts).toContain("x: number");
	});

	test("Void → void", () => {
		const ts = rd2ts("module t\nend-module\nfn f() -> () {\n}");
		expect(ts).toContain("void");
	});
});

describe("function declarations", () => {
	test("simple function with return value", () => {
		const ts = rd2ts("module t\nend-module\nfn add(a: Int, b: Int) -> Int {\n  a + b\n}");
		expect(ts).toContain("function add(a: number, b: number): number");
		expect(ts).toContain("return a + b");
	});

	test("pub function gets export", () => {
		const ts = rd2ts("module t\nend-module\npub fn greet() -> () {\n}");
		expect(ts).toContain("export function greet");
	});

	test("non-pub function has no export", () => {
		const ts = rd2ts("module t\nend-module\nfn helper() -> () {\n}");
		expect(ts).not.toContain("export");
	});

	test("effect annotations erased", () => {
		const ts = rd2ts("module t\nend-module\nfn f() -> () ! { log } {\n}");
		expect(ts).not.toContain("!");
	});

	test("contracts erased", () => {
		const ts = rd2ts("module t\nend-module\nfn f(x: Int) -> Int\n  @pre x > 0\n{\n  x\n}");
		expect(ts).not.toContain("@pre");
		expect(ts).not.toContain("pre");
	});
});

describe("let bindings", () => {
	test("let binding emits const", () => {
		const ts = rd2ts("module t\nend-module\nfn f() -> Int {\n  let x: Int = 5\n  x\n}");
		expect(ts).toContain("const x: number = 5");
	});

	test("let without type annotation", () => {
		const ts = rd2ts("module t\nend-module\nfn f(a: Int) -> Int {\n  let x = a + 1\n  x\n}");
		expect(ts).toContain("const x = a + 1");
	});
});

describe("operators", () => {
	test("++ maps to +", () => {
		const ts = rd2ts("module t\nend-module\nfn f(a: String, b: String) -> String {\n  a ++ b\n}");
		expect(ts).toContain("a + b");
	});

	test("== maps to ===", () => {
		const ts = rd2ts("module t\nend-module\nfn f(a: Int, b: Int) -> Bool {\n  a == b\n}");
		expect(ts).toContain("a === b");
	});

	test("!= maps to !==", () => {
		const ts = rd2ts("module t\nend-module\nfn f(a: Int, b: Int) -> Bool {\n  a != b\n}");
		expect(ts).toContain("a !== b");
	});

	test("numeric literals strip underscores", () => {
		const ts = rd2ts("module t\nend-module\nfn f() -> Int {\n  1_000_000\n}");
		expect(ts).toContain("1000000");
	});
});

describe("if expressions", () => {
	test("if-else as ternary", () => {
		const ts = rd2ts("module t\nend-module\nfn f(x: Int) -> Int {\n  if x > 0 { 1 } else { 0 }\n}");
		expect(ts).toContain("?");
		expect(ts).toContain(":");
	});
});

describe("sum types", () => {
	test("emits variant interfaces with kind", () => {
		const ts = rd2ts("module t\nend-module\ntype Color = | Red | Green | Blue");
		expect(ts).toContain('readonly kind: "Red"');
		expect(ts).toContain('readonly kind: "Green"');
		expect(ts).toContain('readonly kind: "Blue"');
	});

	test("emits union type alias", () => {
		const ts = rd2ts("module t\nend-module\ntype Color = | Red | Green | Blue");
		expect(ts).toContain("type Color = Red | Green | Blue");
	});

	test("emits factory functions", () => {
		const ts = rd2ts("module t\nend-module\ntype Color = | Red | Green | Blue");
		expect(ts).toContain("function Red(): Color");
	});

	test("variant with positional payload", () => {
		const ts = rd2ts("module t\nend-module\npub type Result[T, E] =\n  | Ok(T)\n  | Err(E)");
		expect(ts).toContain("value_0: T");
		expect(ts).toContain('readonly kind: "Ok"');
		expect(ts).toContain('readonly kind: "Err"');
	});

	test("pub type gets export", () => {
		const ts = rd2ts("module t\nend-module\npub type Color = | Red | Green | Blue");
		expect(ts).toContain("export type Color");
		expect(ts).toContain("export interface Red");
		expect(ts).toContain("export function Red");
	});
});

describe("extern blocks", () => {
	test("extern module emits import", () => {
		const ts = rd2ts(
			"module t\nend-module\nextern module node/fs {\n  fn read_file(path: String) -> String ! { fs.read }\n  type Buffer\n}",
		);
		expect(ts).toContain("read_file");
		expect(ts).toContain("Buffer");
		expect(ts).toContain('"node/fs"');
	});

	test("effect annotations erased from extern", () => {
		const ts = rd2ts(
			"module t\nend-module\nextern module node/fs {\n  fn read_file(path: String) -> String ! { fs.read }\n}",
		);
		expect(ts).not.toContain("fs.read");
		expect(ts).not.toContain("!");
	});
});

describe("match expressions", () => {
	test("match emits IIFE with kind checks", () => {
		const ts = rd2ts(
			"module t\nend-module\ntype Color = | Red | Green | Blue\nfn f(c: Color) -> Int {\n  match c {\n    Red() => 1\n    Green() => 2\n    Blue() => 3\n  }\n}",
		);
		expect(ts).toContain("(() =>");
		expect(ts).toContain('.kind === "Red"');
		expect(ts).toContain('.kind === "Green"');
		expect(ts).toContain('.kind === "Blue"');
	});

	test("match with constructor pattern binds fields", () => {
		const ts = rd2ts(
			"module t\nend-module\ntype Box = | Wrap(Int)\nfn f(b: Box) -> Int {\n  match b {\n    Wrap(v) => v\n  }\n}",
		);
		expect(ts).toContain("const v = ");
		expect(ts).toContain("value_0");
	});

	test("match with wildcard", () => {
		const ts = rd2ts(
			"module t\nend-module\nfn f(x: Int) -> Int {\n  match x {\n    _ => 0\n  }\n}",
		);
		expect(ts).toContain("return 0");
	});
});

describe(".d.ts generation", () => {
	test("generates declaration file for exported function", () => {
		const source = "module t\nend-module\npub fn add(a: Int, b: Int) -> Int {\n  a + b\n}";
		const lexResult = lex(source, "test.rd");
		const parseResult = parse(lexResult.tokens, "test.rd");
		const resolveResult = resolve(parseResult.root, parseResult.arena);
		const result = emit(parseResult.root, parseResult.arena, resolveResult.resolutions);
		expect(result.dts).toContain("export declare function add");
		expect(result.dts).toContain("number");
	});

	test("dts includes exported types", () => {
		const source = "module t\nend-module\npub type Color = | Red | Green | Blue";
		const lexResult = lex(source, "test.rd");
		const parseResult = parse(lexResult.tokens, "test.rd");
		const resolveResult = resolve(parseResult.root, parseResult.arena);
		const result = emit(parseResult.root, parseResult.arena, resolveResult.resolutions);
		expect(result.dts).toContain("export type Color");
	});

	test("non-exported items not marked export in dts", () => {
		const source = "module t\nend-module\nfn helper() -> Int {\n  42\n}";
		const lexResult = lex(source, "test.rd");
		const parseResult = parse(lexResult.tokens, "test.rd");
		const resolveResult = resolve(parseResult.root, parseResult.arena);
		const result = emit(parseResult.root, parseResult.arena, resolveResult.resolutions);
		expect(result.dts).not.toContain("export");
		expect(result.dts).toContain("declare function helper");
	});
});

describe("record expressions", () => {
	test("record literal emits object", () => {
		const ts = rd2ts("module t\nend-module\nfn f() -> { x: Int, y: Int } {\n  { x: 1, y: 2 }\n}");
		expect(ts).toContain("x:");
		expect(ts).toContain("y:");
	});
});

describe("misc expressions", () => {
	test("void literal emits undefined", () => {
		const ts = rd2ts("module t\nend-module\nfn f() -> () {\n  ()\n}");
		expect(ts).toContain("undefined");
	});

	test("list literal emits array", () => {
		const ts = rd2ts("module t\nend-module\nfn f() -> List[Int] {\n  [1, 2, 3]\n}");
		expect(ts).toContain("[1, 2, 3]");
	});

	test("field access passes through", () => {
		const ts = rd2ts("module t\nend-module\nfn f(x: { a: Int }) -> Int {\n  x.a\n}");
		expect(ts).toContain("x.a");
	});
});

describe("tsc verification", () => {
	test("valid emitted code produces no diagnostics", () => {
		const source = "module t\nend-module\npub fn add(a: Int, b: Int) -> Int {\n  a + b\n}";
		const lexResult = lex(source, "test.rd");
		const parseResult = parse(lexResult.tokens, "test.rd");
		const resolveResult = resolve(parseResult.root, parseResult.arena);
		const result = emit(parseResult.root, parseResult.arena, resolveResult.resolutions);
		const errors = result.diagnostics.filter((d) => d.severity === "error");
		expect(errors).toHaveLength(0);
	});
});

describe("error handling", () => {
	test("emitter handles empty file gracefully", () => {
		const source = "module t\nend-module";
		const lexResult = lex(source, "test.rd");
		const parseResult = parse(lexResult.tokens, "test.rd");
		const resolveResult = resolve(parseResult.root, parseResult.arena);
		const result = emit(parseResult.root, parseResult.arena, resolveResult.resolutions);
		expect(result.ts).toBeDefined();
		const errors = result.diagnostics.filter((d) => d.severity === "error");
		expect(errors).toHaveLength(0);
	});

	test("TryExpr emits early-return pattern", () => {
		const ts = rd2ts("module t\nend-module\nfn f(x: Int) -> Int {\n  x?\n}");
		expect(ts).toContain("_try_");
		expect(ts).toContain('"Err"');
		expect(ts).toContain("return");
	});

	test("TryExpr in let binding emits temp, check, and .value_0", () => {
		const ts = rd2ts([
			"module t", "end-module",
			"fn might_fail() -> Int { 42 }",
			"fn f() -> Int {",
			"  let x: Int = might_fail()?",
			"  x",
			"}",
		].join("\n"));
		expect(ts).toContain("const _try_0 = might_fail()");
		expect(ts).toContain('if (_try_0.kind === "Err") return _try_0;');
		expect(ts).toContain("const x: number = _try_0.value_0;");
	});

	test("TryExpr standalone emits temp and early return", () => {
		const ts = rd2ts([
			"module t", "end-module",
			"fn do_thing() -> Int { 1 }",
			"fn f() -> Int {",
			"  do_thing()?",
			"  42",
			"}",
		].join("\n"));
		expect(ts).toContain("const _try_0 = do_thing()");
		expect(ts).toContain('if (_try_0.kind === "Err") return _try_0;');
	});

	test("multiple TryExprs get unique temp names", () => {
		const ts = rd2ts([
			"module t", "end-module",
			"fn a() -> Int { 1 }",
			"fn b() -> Int { 2 }",
			"fn f() -> Int {",
			"  let x: Int = a()?",
			"  let y: Int = b()?",
			"  x + y",
			"}",
		].join("\n"));
		expect(ts).toContain("_try_0");
		expect(ts).toContain("_try_1");
	});

	test("deferred RangeExpr emits TODO comment without crashing", () => {
		const ts = rd2ts("module t\nend-module\nfn f() -> Int {\n  1..10\n}");
		expect(ts).toContain("TODO");
	});
});
