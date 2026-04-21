import { describe, test, expect } from "bun:test";
import { lex } from "../src/lex/index";
import { parse } from "../src/parse/index";
import { resolve } from "../src/resolve/index";
import { emit } from "../src/emit/index";

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
		const ts = rd2ts(`module t\nend-module\nfn f(x: Int) -> Int {\n  x\n}`);
		expect(ts).toContain("x: number");
	});

	test("String → string", () => {
		const ts = rd2ts(`module t\nend-module\nfn f(x: String) -> String {\n  x\n}`);
		expect(ts).toContain("x: string");
	});

	test("Bool → boolean", () => {
		const ts = rd2ts(`module t\nend-module\nfn f(x: Bool) -> Bool {\n  x\n}`);
		expect(ts).toContain("x: boolean");
	});

	test("Float → number", () => {
		const ts = rd2ts(`module t\nend-module\nfn f(x: Float) -> Float {\n  x\n}`);
		expect(ts).toContain("x: number");
	});

	test("Void → void", () => {
		const ts = rd2ts(`module t\nend-module\nfn f() -> () {\n}`);
		expect(ts).toContain("void");
	});
});
