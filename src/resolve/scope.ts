// Scope — lexical scope chain for name resolution.
// Forms a linked list: module → function → block → match-arm.

import type { NodeId } from "../util/arena";
import type { Span } from "../diag/types";

export type SymbolKind =
	| "fn"
	| "type"
	| "param"
	| "let"
	| "variant"
	| "extern-fn"
	| "extern-type"
	| "import"
	| "type-param";

export type Symbol = {
	name: string;
	kind: SymbolKind;
	declNode: NodeId;
	span: Span;
};

/**
 * Lexical scope with parent-chain lookup. The resolver creates nested Scope
 * instances and defines symbols as declarations are encountered.
 */
export class Scope {
	readonly parent: Scope | null;
	private symbols: Map<string, Symbol> = new Map();

	constructor(parent: Scope | null) {
		this.parent = parent;
	}

	/**
	 * Define a symbol in this scope.
	 * Returns the previously-defined Symbol if the name is already taken
	 * (for duplicate detection), or null on success.
	 */
	define(sym: Symbol): Symbol | null {
		const existing = this.symbols.get(sym.name);
		if (existing !== undefined) {
			return existing;
		}
		this.symbols.set(sym.name, sym);
		return null;
	}

	/**
	 * Look up a name starting in this scope, walking the parent chain.
	 * Returns null if not found in any enclosing scope.
	 */
	lookup(name: string): Symbol | null {
		const local = this.symbols.get(name);
		if (local !== undefined) {
			return local;
		}
		if (this.parent !== null) {
			return this.parent.lookup(name);
		}
		return null;
	}

	/**
	 * Collect all names visible from this scope (local + all ancestors).
	 * Useful for fuzzy-match suggestions on unresolved identifiers.
	 */
	allVisibleNames(): string[] {
		const names = new Set<string>();
		let current: Scope | null = this;
		while (current !== null) {
			for (const name of current.symbols.keys()) {
				names.add(name);
			}
			current = current.parent;
		}
		return [...names];
	}
}
