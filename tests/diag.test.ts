import { describe, expect, test } from "bun:test";
import {
	DIAGNOSTIC_CODES,
	DIAGNOSTIC_EXAMPLES,
	DIAGNOSTIC_REGISTRY,
	type Diagnostic,
	type Severity,
} from "../src/diag";

const CODE_PATTERN = /^E\d{4}$/;
const ALLOWED_CATEGORIES = new Set([
	"lex",
	"parse",
	"resolve",
	"effects",
	"types",
	"contracts",
	"module",
]);
const ALLOWED_SEVERITIES: Severity[] = ["error", "warning", "info", "help"];
const ALLOWED_SUGGESTION_KINDS = new Set([
	"add-param",
	"add-effect",
	"add-import",
	"narrow-cap",
	"rename",
	"insert-text",
	"replace-span",
	"delete-span",
]);
const INSERT_KINDS = new Set([
	"add-param",
	"add-effect",
	"add-import",
	"narrow-cap",
	"insert-text",
]);
const REPLACE_KINDS = new Set(["rename", "replace-span"]);

function expectValidSpan(span: Diagnostic["span"]) {
	expect(typeof span.file).toBe("string");
	expect(span.file.length).toBeGreaterThan(0);
	expect(span.line).toBeGreaterThanOrEqual(1);
	expect(span.col).toBeGreaterThanOrEqual(1);
	expect(span.len).toBeGreaterThanOrEqual(0);
}

describe("diagnostic registry", () => {
	test("has between 15 and 25 codes", () => {
		expect(DIAGNOSTIC_CODES.length).toBeGreaterThanOrEqual(15);
		expect(DIAGNOSTIC_CODES.length).toBeLessThanOrEqual(25);
	});

	test("every code matches E0NNN format", () => {
		for (const code of DIAGNOSTIC_CODES) {
			expect(code).toMatch(CODE_PATTERN);
		}
	});

	test("codes are unique", () => {
		const set = new Set(DIAGNOSTIC_CODES);
		expect(set.size).toBe(DIAGNOSTIC_CODES.length);
	});

	test("every registry entry has valid category and severity", () => {
		for (const code of DIAGNOSTIC_CODES) {
			const info = DIAGNOSTIC_REGISTRY[code];
			expect(info.code).toBe(code);
			expect(ALLOWED_CATEGORIES.has(info.category)).toBe(true);
			expect(ALLOWED_SEVERITIES).toContain(info.defaultSeverity);
			expect(info.title.length).toBeGreaterThan(0);
			expect(info.summary.length).toBeGreaterThan(0);
			expect(info.docs).toBe(`https://radahn.dev/e/${code.slice(1)}`);
		}
	});
});

describe("diagnostic examples", () => {
	test("every registry code has an example", () => {
		for (const code of DIAGNOSTIC_CODES) {
			expect(DIAGNOSTIC_EXAMPLES[code]).toBeDefined();
		}
	});

	test("every example is keyed by its own code", () => {
		for (const code of DIAGNOSTIC_CODES) {
			expect(DIAGNOSTIC_EXAMPLES[code].code).toBe(code);
		}
	});

	test("example docs URL matches registry docs", () => {
		for (const code of DIAGNOSTIC_CODES) {
			expect(DIAGNOSTIC_EXAMPLES[code].docs).toBe(DIAGNOSTIC_REGISTRY[code].docs);
		}
	});

	test("example severity matches registry default", () => {
		for (const code of DIAGNOSTIC_CODES) {
			expect(DIAGNOSTIC_EXAMPLES[code].severity).toBe(DIAGNOSTIC_REGISTRY[code].defaultSeverity);
		}
	});

	test("examples set covers exactly the registered codes", () => {
		const exampleCodes = Object.keys(DIAGNOSTIC_EXAMPLES).sort();
		const registryCodes = [...DIAGNOSTIC_CODES].sort();
		expect(exampleCodes).toEqual(registryCodes);
	});
});

describe("diagnostic schema shape", () => {
	test("required fields are present and well-formed", () => {
		for (const code of DIAGNOSTIC_CODES) {
			const d = DIAGNOSTIC_EXAMPLES[code];
			expect(typeof d.code).toBe("string");
			expect(ALLOWED_SEVERITIES).toContain(d.severity);
			expect(d.message.length).toBeGreaterThan(0);
			expect(d.docs).toMatch(/^https?:\/\//);
			expectValidSpan(d.span);
		}
	});

	test("suggestion variants enforce their required fields", () => {
		for (const code of DIAGNOSTIC_CODES) {
			const d = DIAGNOSTIC_EXAMPLES[code];
			if (!d.suggest) continue;
			for (const s of d.suggest) {
				expect(ALLOWED_SUGGESTION_KINDS.has(s.kind)).toBe(true);
				expect(s.rationale.length).toBeGreaterThan(0);

				if (s.kind === "delete-span") {
					expect("span" in s).toBe(true);
					expect("insert" in s).toBe(false);
					expectValidSpan(s.span);
				} else if (REPLACE_KINDS.has(s.kind)) {
					expect("span" in s).toBe(true);
					expect("insert" in s).toBe(true);
					if ("span" in s) expectValidSpan(s.span);
					if ("insert" in s) expect(typeof s.insert).toBe("string");
				} else if (INSERT_KINDS.has(s.kind)) {
					expect("at" in s).toBe(true);
					expect("insert" in s).toBe(true);
					if ("at" in s) expectValidSpan(s.at);
					if ("insert" in s) expect(typeof s.insert).toBe("string");
				}
			}
		}
	});

	test("suggestion edit targets always carry a file", () => {
		// Multi-file diagnostics like E0204 point at a different file than the
		// primary span; the test guards against regressing to a fileless `at`.
		for (const code of DIAGNOSTIC_CODES) {
			const d = DIAGNOSTIC_EXAMPLES[code];
			if (!d.suggest) continue;
			for (const s of d.suggest) {
				const target = "at" in s ? s.at : s.span;
				expect(typeof target.file).toBe("string");
				expect(target.file.length).toBeGreaterThan(0);
			}
		}
	});

	test("related info entries have span and message", () => {
		for (const code of DIAGNOSTIC_CODES) {
			const d = DIAGNOSTIC_EXAMPLES[code];
			if (!d.related) continue;
			for (const r of d.related) {
				expect(r.message.length).toBeGreaterThan(0);
				expectValidSpan(r.span);
			}
		}
	});

	test("every example round-trips through JSON", () => {
		for (const code of DIAGNOSTIC_CODES) {
			const d = DIAGNOSTIC_EXAMPLES[code];
			const roundTripped = JSON.parse(JSON.stringify(d)) as Diagnostic;
			expect(roundTripped).toEqual(d);
		}
	});
});
