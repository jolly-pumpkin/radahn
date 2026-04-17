// Registry of v0 diagnostic codes. Every checker imports from here rather
// than hard-coding strings, so the set of codes is auditable in one place.
//
// `DiagnosticCode` is the literal union of every registered code — emitting
// an unregistered code is a compile error, and registry/example lookups are
// statically total (no `undefined` returns).

import type { DiagnosticCategory, Severity } from "./types";

const docs = (n: string): string => `https://radahn.dev/e/${n}`;

const ENTRIES = [
	{
		code: "E0001",
		title: "Unexpected character",
		category: "lex",
		defaultSeverity: "error",
		summary: "The lexer encountered a character that is not part of any Radahn token.",
		docs: docs("0001"),
	},
	{
		code: "E0002",
		title: "Unterminated string literal",
		category: "lex",
		defaultSeverity: "error",
		summary: "A string literal is missing its closing quote before end of line or file.",
		docs: docs("0002"),
	},
	{
		code: "E0003",
		title: "Invalid numeric literal",
		category: "lex",
		defaultSeverity: "error",
		summary: "A numeric literal has malformed digits, prefix, or exponent.",
		docs: docs("0003"),
	},
	{
		code: "E0101",
		title: "Unexpected token",
		category: "parse",
		defaultSeverity: "error",
		summary: "The parser expected a different token kind at this position.",
		docs: docs("0101"),
	},
	{
		code: "E0102",
		title: "Expected closing delimiter",
		category: "parse",
		defaultSeverity: "error",
		summary: "A bracket, brace, or parenthesis was opened but never closed.",
		docs: docs("0102"),
	},
	{
		code: "E0103",
		title: "Unexpected end of input",
		category: "parse",
		defaultSeverity: "error",
		summary: "The source ended while a declaration or expression was still being parsed.",
		docs: docs("0103"),
	},
	{
		code: "E0104",
		title: "Invalid function signature",
		category: "parse",
		defaultSeverity: "error",
		summary: "A `fn` signature has a malformed parameter list or effect row.",
		docs: docs("0104"),
	},
	{
		code: "E0201",
		title: "Unknown identifier",
		category: "resolve",
		defaultSeverity: "error",
		summary: "A name was referenced but no matching declaration exists in scope.",
		docs: docs("0201"),
	},
	{
		code: "E0202",
		title: "Duplicate definition",
		category: "resolve",
		defaultSeverity: "error",
		summary: "Two declarations share the same name in the same scope.",
		docs: docs("0202"),
	},
	{
		code: "E0203",
		title: "Unused import",
		category: "resolve",
		defaultSeverity: "warning",
		summary: "An imported symbol is never referenced in this module.",
		docs: docs("0203"),
	},
	{
		code: "E0204",
		title: "Private symbol not exported",
		category: "resolve",
		defaultSeverity: "error",
		summary: "A symbol is referenced across modules but is not listed in the exports.",
		docs: docs("0204"),
	},
	{
		code: "E0301",
		title: "Effect not declared in signature",
		category: "effects",
		defaultSeverity: "error",
		summary: "A function body uses an effect that is absent from its declared effect row.",
		docs: docs("0301"),
	},
	{
		code: "E0302",
		title: "Declared effect unused in body",
		category: "effects",
		defaultSeverity: "warning",
		summary: "A function declares an effect that its body never actually performs.",
		docs: docs("0302"),
	},
	{
		code: "E0303",
		title: "Effect row mismatch at call site",
		category: "effects",
		defaultSeverity: "error",
		summary: "A callee's effects are not a subset of the caller's declared effects.",
		docs: docs("0303"),
	},
	{
		code: "E0401",
		title: "Type mismatch",
		category: "types",
		defaultSeverity: "error",
		summary: "An expression's inferred type does not match the expected type at this position.",
		docs: docs("0401"),
	},
	{
		code: "E0402",
		title: "Non-exhaustive match",
		category: "types",
		defaultSeverity: "error",
		summary: "A `match` expression does not cover every variant of the scrutinee's type.",
		docs: docs("0402"),
	},
	{
		code: "E0403",
		title: "Unreachable match arm",
		category: "types",
		defaultSeverity: "warning",
		summary: "A match arm can never be reached because an earlier arm subsumes it.",
		docs: docs("0403"),
	},
	{
		code: "E0501",
		title: "Malformed contract clause",
		category: "contracts",
		defaultSeverity: "error",
		summary: "A `@pre`, `@post`, or `@cost` clause is syntactically invalid.",
		docs: docs("0501"),
	},
	{
		code: "E0601",
		title: "Missing module header",
		category: "module",
		defaultSeverity: "error",
		summary: "A source file is missing its `module` / `end-module` header.",
		docs: docs("0601"),
	},
	{
		code: "E0602",
		title: "Module name does not match path",
		category: "module",
		defaultSeverity: "error",
		summary: "The declared module name does not agree with the source file's on-disk path.",
		docs: docs("0602"),
	},
] as const satisfies readonly {
	code: `E${string}`;
	title: string;
	category: DiagnosticCategory;
	defaultSeverity: Severity;
	summary: string;
	docs: string;
}[];

export type DiagnosticCode = (typeof ENTRIES)[number]["code"];

export type DiagnosticInfo = {
	code: DiagnosticCode;
	title: string;
	category: DiagnosticCategory;
	defaultSeverity: Severity;
	summary: string;
	docs: string;
};

export const DIAGNOSTIC_REGISTRY: { readonly [K in DiagnosticCode]: DiagnosticInfo } =
	Object.fromEntries(ENTRIES.map((info) => [info.code, info])) as {
		[K in DiagnosticCode]: DiagnosticInfo;
	};

export const DIAGNOSTIC_CODES: readonly DiagnosticCode[] = ENTRIES.map((info) => info.code);
