import { describe, expect, test } from "bun:test";
import { Scope, type Symbol } from "../src/resolve/scope";
import type { NodeId } from "../src/util/arena";
import type { Span } from "../src/diag/types";

const span: Span = { file: "test.rd", line: 1, col: 1, len: 3 };

function sym(name: string, kind: Symbol["kind"] = "let", id = 0 as NodeId): Symbol {
	return { name, kind, declNode: id, span };
}

describe("Scope", () => {
	test("define returns null on success", () => {
		const scope = new Scope(null);
		expect(scope.define(sym("x"))).toBeNull();
	});

	test("define returns previous symbol on duplicate", () => {
		const scope = new Scope(null);
		const first = sym("x", "let", 0 as NodeId);
		const second = sym("x", "fn", 1 as NodeId);
		scope.define(first);
		const result = scope.define(second);
		expect(result).toBe(first);
	});

	test("lookup finds symbol in current scope", () => {
		const scope = new Scope(null);
		const s = sym("foo", "fn");
		scope.define(s);
		expect(scope.lookup("foo")).toBe(s);
	});

	test("lookup returns null when not found", () => {
		const scope = new Scope(null);
		expect(scope.lookup("missing")).toBeNull();
	});

	test("lookup walks parent chain", () => {
		const parent = new Scope(null);
		const child = new Scope(parent);
		const s = sym("outer", "type");
		parent.define(s);
		expect(child.lookup("outer")).toBe(s);
	});

	test("child scope shadows parent", () => {
		const parent = new Scope(null);
		const child = new Scope(parent);
		const parentSym = sym("x", "let", 0 as NodeId);
		const childSym = sym("x", "param", 1 as NodeId);
		parent.define(parentSym);
		child.define(childSym);
		expect(child.lookup("x")).toBe(childSym);
		expect(parent.lookup("x")).toBe(parentSym);
	});

	test("allVisibleNames collects from all scopes", () => {
		const grandparent = new Scope(null);
		const parent = new Scope(grandparent);
		const child = new Scope(parent);
		grandparent.define(sym("a"));
		parent.define(sym("b"));
		child.define(sym("c"));
		const names = child.allVisibleNames();
		expect(names).toContain("a");
		expect(names).toContain("b");
		expect(names).toContain("c");
		expect(names.length).toBe(3);
	});

	test("allVisibleNames deduplicates shadowed names", () => {
		const parent = new Scope(null);
		const child = new Scope(parent);
		parent.define(sym("x", "let", 0 as NodeId));
		child.define(sym("x", "param", 1 as NodeId));
		const names = child.allVisibleNames();
		expect(names.filter((n) => n === "x").length).toBe(1);
	});

	test("all SymbolKind values work", () => {
		const scope = new Scope(null);
		const kinds: Symbol["kind"][] = [
			"fn", "type", "param", "let", "variant",
			"extern-fn", "extern-type", "import", "type-param",
		];
		for (const kind of kinds) {
			expect(scope.define(sym(kind, kind))).toBeNull();
		}
		expect(scope.allVisibleNames().length).toBe(kinds.length);
	});
});
