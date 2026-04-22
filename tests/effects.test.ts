import { describe, expect, test } from "bun:test";
import { lex } from "../src/lex/index";
import { parse } from "../src/parse/index";
import { resolve } from "../src/resolve/index";
import { typeCheck } from "../src/check/typer";
import { effectCheck, type EffectCheckResult } from "../src/check/effects";

function check(source: string): EffectCheckResult {
	const lexResult = lex(source, "test.rd");
	const parseResult = parse(lexResult.tokens, "test.rd");
	const resolveResult = resolve(parseResult.root, parseResult.arena);
	const typeResult = typeCheck(parseResult.root, parseResult.arena, resolveResult.resolutions);
	return effectCheck(parseResult.root, parseResult.arena, resolveResult.resolutions, typeResult.typeMap);
}

function errors(source: string, code: string) {
	return check(source).diagnostics.filter((d) => d.code === code);
}

describe("effect checker", () => {
	describe("valid programs — no diagnostics", () => {
		test("declared effects match usage — no error", () => {
			const src = `module app
end-module

extern "io" {
  fn print(msg: String) -> Void ! { log }
}

fn greet(name: String) -> Void ! { log } {
  print(name)
}
`;
			const result = check(src);
			const errs = result.diagnostics.filter((d) => d.severity === "error");
			expect(errs).toEqual([]);
		});

		test("pure function calling pure — no error", () => {
			const src = `module app
end-module

fn add(a: Int, b: Int) -> Int {
  a + b
}

fn double(x: Int) -> Int {
  add(x, x)
}
`;
			const result = check(src);
			const errs = result.diagnostics.filter((d) => d.severity === "error");
			expect(errs).toEqual([]);
		});

		test("no effect row and no effectful calls — clean", () => {
			const src = `module app
end-module

fn identity(x: Int) -> Int {
  x
}
`;
			const result = check(src);
			expect(result.diagnostics).toEqual([]);
		});

		test("superset of effects is fine", () => {
			const src = `module app
end-module

extern "io" {
  fn print(msg: String) -> Void ! { log }
  fn read_file(path: String) -> String ! { fs }
}

fn do_both(path: String) -> Void ! { log, fs } {
  let data = read_file(path)
  print(data)
}
`;
			const result = check(src);
			const errs = result.diagnostics.filter((d) => d.severity === "error");
			expect(errs).toEqual([]);
		});
	});

	describe("E0301 — undeclared effect", () => {
		test("function uses effect not in its row", () => {
			const src = `module app
end-module

extern "io" {
  fn print(msg: String) -> Void ! { log }
  fn read_file(path: String) -> String ! { fs }
}

fn greet(name: String) -> Void ! { log } {
  let data = read_file(name)
  print(data)
}
`;
			const errs = errors(src, "E0301");
			expect(errs.length).toBe(1);
			expect(errs[0].message).toContain("fs");
			expect(errs[0].message).toContain("greet");
			expect(errs[0].suggest).toBeDefined();
			expect(errs[0].suggest![0].kind).toBe("add-effect");
		});

		test("multiple effects, one missing — only the missing one errors", () => {
			const src = `module app
end-module

extern "io" {
  fn print(msg: String) -> Void ! { log }
  fn send(url: String) -> Void ! { net }
}

fn do_stuff(x: String) -> Void ! { log } {
  print(x)
  send(x)
}
`;
			const errs = errors(src, "E0301");
			expect(errs.length).toBe(1);
			expect(errs[0].message).toContain("net");
			// Only one E0301 — for net, not for log (which is declared)
		});
	});

	describe("E0302 — unused effect (warning)", () => {
		test("declared but unused effect", () => {
			const src = `module app
end-module

extern "io" {
  fn print(msg: String) -> Void ! { log }
}

fn greet(name: String) -> Void ! { log, fs } {
  print(name)
}
`;
			const warnings = errors(src, "E0302");
			expect(warnings.length).toBe(1);
			expect(warnings[0].severity).toBe("warning");
			expect(warnings[0].message).toContain("fs");
			expect(warnings[0].message).toContain("greet");
		});
	});

	describe("E0303 — pure function calling effectful", () => {
		test("pure function calling effectful — E0303", () => {
			const src = `module app
end-module

extern "io" {
  fn print(msg: String) -> Void ! { log }
}

fn greet(name: String) -> Void {
  print(name)
}
`;
			const errs = errors(src, "E0303");
			expect(errs.length).toBe(1);
			expect(errs[0].message).toContain("log");
			expect(errs[0].message).toContain("pure");
		});
	});

	describe("effect map", () => {
		test("effectMap is populated for each FnDecl", () => {
			const src = `module app
end-module

extern "io" {
  fn print(msg: String) -> Void ! { log }
}

fn pure_fn() -> Int {
  42
}

fn effectful_fn() -> Void ! { log } {
  print("hello")
}
`;
			const result = check(src);
			// Should have entries for both FnDecl nodes
			expect(result.effectMap.size).toBeGreaterThanOrEqual(2);

			// Find the effectMap entries
			let hasPure = false;
			let hasClosed = false;
			for (const [, row] of result.effectMap) {
				if (row.kind === "pure") hasPure = true;
				if (row.kind === "closed") hasClosed = true;
			}
			expect(hasPure).toBe(true);
			expect(hasClosed).toBe(true);
		});
	});

	describe("skips ill-typed calls", () => {
		test("error-typed call does not produce phantom effects", () => {
			const src = `module app
end-module

fn f() -> Void {
  unknown_fn()
}
`;
			// The call to unknown_fn will produce a resolver error and error type,
			// but the effect checker should not report E0303 for it
			const errs = errors(src, "E0303");
			expect(errs).toEqual([]);
		});
	});
});
