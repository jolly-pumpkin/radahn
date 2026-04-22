import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { lex } from "../src/lex/index";
import { parse } from "../src/parse/index";
import { resolve } from "../src/resolve/index";
import { typeCheck } from "../src/check/typer";
import { effectCheck } from "../src/check/effects";
import type { Diagnostic } from "../src/diag/types";

function fullCheck(file: string) {
	const source = readFileSync(file, "utf-8");
	const lexResult = lex(source, file);
	const parseResult = parse(lexResult.tokens, file);
	const resolveResult = resolve(parseResult.root, parseResult.arena);
	const typeResult = typeCheck(parseResult.root, parseResult.arena, resolveResult.resolutions);
	const effectResult = effectCheck(
		parseResult.root, parseResult.arena, resolveResult.resolutions, typeResult.typeMap,
	);
	return {
		diagnostics: [
			...lexResult.diagnostics,
			...parseResult.diagnostics,
			...resolveResult.diagnostics,
			...typeResult.diagnostics,
			...effectResult.diagnostics,
		] as Diagnostic[],
	};
}

describe("e2e — type checking", () => {
	test("typecheck-pass.rd has no errors", () => {
		const result = fullCheck("tests/fixtures/typecheck-pass.rd");
		const errs = result.diagnostics.filter(d => d.severity === "error");
		expect(errs).toEqual([]);
	});
});

describe("e2e — effect checking", () => {
	test("effects-pass.rd has no errors", () => {
		const result = fullCheck("tests/fixtures/effects-pass.rd");
		const errs = result.diagnostics.filter(d => d.severity === "error");
		expect(errs).toEqual([]);
	});

	test("effects-fail.rd has E0303", () => {
		const result = fullCheck("tests/fixtures/effects-fail.rd");
		const errs = result.diagnostics.filter(d => d.code === "E0303");
		expect(errs.length).toBeGreaterThan(0);
	});
});

describe("e2e — full pipeline", () => {
	test("all passes produce consistent results", () => {
		const source = [
			"module e2e",
			"end-module",
			"",
			"type Color =",
			"  | Red",
			"  | Green",
			"  | Blue",
			"",
			"fn to_int(c: Color) -> Int {",
			"  match c {",
			"    Red => 0",
			"    Green => 1",
			"    Blue => 2",
			"  }",
			"}",
			"",
			"fn main() -> Int {",
			"  to_int(Red)",
			"}",
		].join("\n");
		const lexResult = lex(source, "test.rd");
		const parseResult = parse(lexResult.tokens, "test.rd");
		const resolveResult = resolve(parseResult.root, parseResult.arena);
		const typeResult = typeCheck(parseResult.root, parseResult.arena, resolveResult.resolutions);
		const effectResult = effectCheck(
			parseResult.root, parseResult.arena, resolveResult.resolutions, typeResult.typeMap,
		);
		const allDiags = [
			...lexResult.diagnostics, ...parseResult.diagnostics,
			...resolveResult.diagnostics, ...typeResult.diagnostics,
			...effectResult.diagnostics,
		];
		expect(allDiags.filter(d => d.severity === "error")).toEqual([]);
	});
});
