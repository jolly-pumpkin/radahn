import { describe, test, expect } from "bun:test";
import { lex } from "../src/lex/index";
import { parse } from "../src/parse/index";
import { resolve } from "../src/resolve/index";
import { emit } from "../src/emit/index";
import {
	HELLO, RESULT, REFINEMENT, LET_AND_BINOP, EXTERN_FS, CONTRACTS
} from "./fixtures/conformance";

function compileFixture(source: string): { ts: string; dts: string; errors: number } {
	const lexResult = lex(source, "fixture.rd");
	const parseResult = parse(lexResult.tokens, "fixture.rd");
	const resolveResult = resolve(parseResult.root, parseResult.arena);
	const emitResult = emit(parseResult.root, parseResult.arena, resolveResult.resolutions);
	const errors = emitResult.diagnostics.filter(d => d.severity === "error").length;
	return { ts: emitResult.ts, dts: emitResult.dts, errors };
}

describe("conformance emission", () => {
	test("HELLO fixture emits valid TS", () => {
		const { ts, errors } = compileFixture(HELLO);
		expect(errors).toBe(0);
		expect(ts).toContain("function main");
	});

	test("RESULT fixture emits discriminated unions", () => {
		const { ts, errors } = compileFixture(RESULT);
		expect(errors).toBe(0);
		expect(ts).toContain('readonly kind: "Ok"');
		expect(ts).toContain('readonly kind: "Err"');
		expect(ts).toContain("type Result");
	});

	test("REFINEMENT fixture erases refinement predicates", () => {
		const { ts, errors } = compileFixture(REFINEMENT);
		expect(errors).toBe(0);
		expect(ts).not.toContain("where");
	});

	test("LET_AND_BINOP fixture preserves operator mapping", () => {
		const { ts, errors } = compileFixture(LET_AND_BINOP);
		expect(errors).toBe(0);
		expect(ts).toContain("===");
		expect(ts).toContain("!==");
	});

	test("EXTERN_FS fixture emits imports", () => {
		const { ts, errors } = compileFixture(EXTERN_FS);
		expect(errors).toBe(0);
		expect(ts).toContain("import");
	});

	test("CONTRACTS fixture erases @pre, @post, @cost", () => {
		const { ts, errors } = compileFixture(CONTRACTS);
		expect(errors).toBe(0);
		expect(ts).not.toContain("@pre");
		expect(ts).not.toContain("@post");
		expect(ts).not.toContain("@cost");
	});
});
