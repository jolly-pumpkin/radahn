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
			expect(info.docsUrl).toBe(`https://radahn.dev/e/${code.slice(1)}`);
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

	test("example docs URL matches registry docsUrl", () => {
		for (const code of DIAGNOSTIC_CODES) {
			expect(DIAGNOSTIC_EXAMPLES[code].docs).toBe(DIAGNOSTIC_REGISTRY[code].docsUrl);
		}
	});

	test("no example uses a code outside the registry", () => {
		for (const code of Object.keys(DIAGNOSTIC_EXAMPLES)) {
			expect(DIAGNOSTIC_REGISTRY[code as Diagnostic["code"]]).toBeDefined();
		}
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

			expect(typeof d.span.file).toBe("string");
			expect(d.span.file.length).toBeGreaterThan(0);
			expect(d.span.line).toBeGreaterThanOrEqual(1);
			expect(d.span.col).toBeGreaterThanOrEqual(1);
			expect(d.span.len).toBeGreaterThanOrEqual(0);
		}
	});

	test("suggestions have valid kinds and an edit target", () => {
		for (const code of DIAGNOSTIC_CODES) {
			const d = DIAGNOSTIC_EXAMPLES[code];
			if (!d.suggest) continue;
			for (const s of d.suggest) {
				expect(ALLOWED_SUGGESTION_KINDS.has(s.kind)).toBe(true);
				expect(s.rationale.length).toBeGreaterThan(0);
				const hasTarget = s.at !== undefined || s.span !== undefined;
				expect(hasTarget).toBe(true);
			}
		}
	});

	test("related info entries have span and message", () => {
		for (const code of DIAGNOSTIC_CODES) {
			const d = DIAGNOSTIC_EXAMPLES[code];
			if (!d.related) continue;
			for (const r of d.related) {
				expect(r.message.length).toBeGreaterThan(0);
				expect(r.span.line).toBeGreaterThanOrEqual(1);
				expect(r.span.col).toBeGreaterThanOrEqual(1);
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
