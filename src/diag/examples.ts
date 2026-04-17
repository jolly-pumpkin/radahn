// One worked example payload per diagnostic code. These drive both
// the test fixtures and the code-by-code reference in docs/Diagnostics.md.

import { DIAGNOSTIC_REGISTRY } from "./codes";
import type { Diagnostic, DiagnosticCode } from "./types";

const examples: Diagnostic[] = [
	{
		code: "E0001",
		severity: "error",
		message: "unexpected character `#` in source",
		span: { file: "src/refund.rd", line: 12, col: 5, len: 1 },
		docs: DIAGNOSTIC_REGISTRY.E0001.docsUrl,
	},
	{
		code: "E0002",
		severity: "error",
		message: "unterminated string literal",
		span: { file: "src/refund.rd", line: 8, col: 18, len: 14 },
		suggest: [
			{
				kind: "insert-text",
				rationale: "close the string literal",
				at: { line: 8, col: 32 },
				insert: "\"",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0002.docsUrl,
	},
	{
		code: "E0003",
		severity: "error",
		message: "invalid numeric literal `0x_`",
		span: { file: "src/money.rd", line: 3, col: 14, len: 3 },
		docs: DIAGNOSTIC_REGISTRY.E0003.docsUrl,
	},
	{
		code: "E0101",
		severity: "error",
		message: "expected `)` but found `,`",
		span: { file: "src/refund.rd", line: 4, col: 22, len: 1 },
		docs: DIAGNOSTIC_REGISTRY.E0101.docsUrl,
	},
	{
		code: "E0102",
		severity: "error",
		message: "expected closing `}` for block opened at line 3",
		span: { file: "src/refund.rd", line: 9, col: 1, len: 0 },
		related: [
			{
				span: { file: "src/refund.rd", line: 3, col: 18, len: 1 },
				message: "opening `{` was here",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0102.docsUrl,
	},
	{
		code: "E0103",
		severity: "error",
		message: "unexpected end of input while parsing `fn` body",
		span: { file: "src/refund.rd", line: 42, col: 1, len: 0 },
		docs: DIAGNOSTIC_REGISTRY.E0103.docsUrl,
	},
	{
		code: "E0104",
		severity: "error",
		message: "invalid effect row in signature: expected `!` followed by effect list",
		span: { file: "src/refund.rd", line: 1, col: 40, len: 1 },
		suggest: [
			{
				kind: "insert-text",
				rationale: "add an empty effect row for a pure function",
				at: { line: 1, col: 40 },
				insert: " ! {}",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0104.docsUrl,
	},
	{
		code: "E0201",
		severity: "error",
		message: "unknown identifier `chage_id`",
		span: { file: "src/refund.rd", line: 7, col: 12, len: 8 },
		suggest: [
			{
				kind: "rename",
				rationale: "did you mean `charge_id`?",
				span: { file: "src/refund.rd", line: 7, col: 12, len: 8 },
				insert: "charge_id",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0201.docsUrl,
	},
	{
		code: "E0202",
		severity: "error",
		message: "duplicate definition of `refund`",
		span: { file: "src/refund.rd", line: 20, col: 4, len: 6 },
		related: [
			{
				span: { file: "src/refund.rd", line: 5, col: 4, len: 6 },
				message: "previous definition here",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0202.docsUrl,
	},
	{
		code: "E0203",
		severity: "warning",
		message: "unused import `log_info`",
		span: { file: "src/refund.rd", line: 2, col: 10, len: 8 },
		suggest: [
			{
				kind: "delete-span",
				rationale: "remove the unused import",
				span: { file: "src/refund.rd", line: 2, col: 1, len: 22 },
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0203.docsUrl,
	},
	{
		code: "E0204",
		severity: "error",
		message: "`refund_internal` is referenced by `src/api.rd` but not exported from `payments.refunds`",
		span: { file: "src/api.rd", line: 6, col: 18, len: 15 },
		suggest: [
			{
				kind: "insert-text",
				rationale: "add the symbol to the module's `exports` list",
				at: { line: 3, col: 12 },
				insert: ", refund_internal",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0204.docsUrl,
	},
	{
		code: "E0301",
		severity: "error",
		message: "function calls `write_file` which performs effect `Fs<write>`, but the signature declares `{}`",
		span: { file: "src/refund.rd", line: 11, col: 3, len: 10 },
		suggest: [
			{
				kind: "add-effect",
				rationale: "declare the effect in the function signature",
				at: { line: 9, col: 40 },
				insert: "Fs<write>",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0301.docsUrl,
	},
	{
		code: "E0302",
		severity: "warning",
		message: "declared effect `Net<https>` is never performed in this function",
		span: { file: "src/refund.rd", line: 9, col: 44, len: 10 },
		suggest: [
			{
				kind: "delete-span",
				rationale: "remove the unused effect from the declared row",
				span: { file: "src/refund.rd", line: 9, col: 44, len: 10 },
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0302.docsUrl,
	},
	{
		code: "E0303",
		severity: "error",
		message: "callee `write_file` performs `Fs<write>` which is not in caller's effect row",
		span: { file: "src/refund.rd", line: 15, col: 5, len: 10 },
		related: [
			{
				span: { file: "src/refund.rd", line: 9, col: 40, len: 2 },
				message: "caller's effect row declared here",
			},
		],
		suggest: [
			{
				kind: "add-effect",
				rationale: "widen the caller's effect row to include `Fs<write>`",
				at: { line: 9, col: 42 },
				insert: "Fs<write>",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0303.docsUrl,
	},
	{
		code: "E0401",
		severity: "error",
		message: "expected `Int`, found `String`",
		span: { file: "src/refund.rd", line: 14, col: 18, len: 8 },
		docs: DIAGNOSTIC_REGISTRY.E0401.docsUrl,
	},
	{
		code: "E0402",
		severity: "error",
		message: "non-exhaustive match: missing variant `RefundError::AlreadyRefunded`",
		span: { file: "src/refund.rd", line: 18, col: 3, len: 5 },
		suggest: [
			{
				kind: "insert-text",
				rationale: "add a match arm for the missing variant",
				at: { line: 22, col: 3 },
				insert: "| AlreadyRefunded -> ...\n  ",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0402.docsUrl,
	},
	{
		code: "E0403",
		severity: "warning",
		message: "unreachable match arm: earlier pattern already covers this case",
		span: { file: "src/refund.rd", line: 24, col: 3, len: 12 },
		related: [
			{
				span: { file: "src/refund.rd", line: 21, col: 3, len: 1 },
				message: "subsuming wildcard pattern here",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0403.docsUrl,
	},
	{
		code: "E0501",
		severity: "error",
		message: "malformed `@pre` clause: expected predicate expression",
		span: { file: "src/refund.rd", line: 8, col: 8, len: 3 },
		docs: DIAGNOSTIC_REGISTRY.E0501.docsUrl,
	},
	{
		code: "E0601",
		severity: "error",
		message: "missing module header: source files must begin with `module <name>`",
		span: { file: "src/refund.rd", line: 1, col: 1, len: 0 },
		suggest: [
			{
				kind: "insert-text",
				rationale: "declare the module name at the top of the file",
				at: { line: 1, col: 1 },
				insert: "module payments.refunds\nend-module\n\n",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0601.docsUrl,
	},
	{
		code: "E0602",
		severity: "error",
		message: "declared module `payments.refund` does not match path `src/payments/refunds.rd`",
		span: { file: "src/payments/refunds.rd", line: 1, col: 8, len: 15 },
		suggest: [
			{
				kind: "rename",
				rationale: "rename to match the file path",
				span: { file: "src/payments/refunds.rd", line: 1, col: 8, len: 15 },
				insert: "payments.refunds",
			},
		],
		docs: DIAGNOSTIC_REGISTRY.E0602.docsUrl,
	},
];

export const DIAGNOSTIC_EXAMPLES: Record<DiagnosticCode, Diagnostic> = Object.fromEntries(
	examples.map((d) => [d.code, d]),
) as Record<DiagnosticCode, Diagnostic>;
