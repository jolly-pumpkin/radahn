// Maranget-style exhaustiveness and usefulness checker for match expressions.
// This module works on a simplified pattern representation (CheckPattern) and
// knows nothing about the AST or arena — conversion happens in the typer.

import type { Type } from "./types";

// ---------------------------------------------------------------------------
// CheckPattern — simplified pattern representation
// ---------------------------------------------------------------------------

export type CheckPattern =
	| { kind: "ctor"; name: string; args: CheckPattern[] }
	| { kind: "literal"; value: string | number | boolean }
	| { kind: "wildcard" };

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ExhaustivenessResult = {
	missing: string[]; // human-readable missing patterns
	unreachable: number[]; // indices of unreachable arms
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function checkExhaustiveness(
	scrutineeType: Type,
	arms: { pattern: CheckPattern; hasGuard: boolean }[],
	variantInfo: Map<string, number>, // variant name -> arity
): ExhaustivenessResult {
	const unreachable: number[] = [];

	// Build the pattern matrix incrementally to detect unreachable arms.
	// Only non-guarded arms contribute to the matrix.
	const matrix: CheckPattern[][] = [];
	const constructors = variantInfo;

	for (let i = 0; i < arms.length; i++) {
		const arm = arms[i];
		const vector = [arm.pattern];

		if (!arm.hasGuard) {
			// Check usefulness before adding to matrix
			if (!isUseful(matrix, vector, constructors)) {
				unreachable.push(i);
			}
			matrix.push(vector);
		}
		// Guarded arms are NOT added to the matrix (they don't guarantee coverage)
	}

	// After processing all arms, check if the matrix is exhaustive.
	// A wildcard vector is useful iff the match is non-exhaustive.
	const missing: string[] = [];

	if (constructors.size > 0) {
		// ADT or Bool: check each constructor
		collectMissing(matrix, constructors, missing);
	} else {
		// Infinite type (Int, Float, String): need a wildcard
		if (isUseful(matrix, [{ kind: "wildcard" }], constructors)) {
			missing.push("_");
		}
	}

	return { missing, unreachable };
}

// ---------------------------------------------------------------------------
// Core algorithm: usefulness check
// ---------------------------------------------------------------------------

/**
 * Is the pattern vector `q` useful with respect to the pattern matrix `P`?
 * A pattern is useful if there exists a value matched by `q` but not by any row in `P`.
 */
function isUseful(
	matrix: CheckPattern[][],
	vector: CheckPattern[],
	constructors: Map<string, number>,
): boolean {
	// Base case: empty vector
	if (vector.length === 0) {
		// Useful iff matrix has no rows (no prior pattern matched the empty value)
		return matrix.length === 0;
	}

	const firstPat = vector[0];
	const rest = vector.slice(1);

	switch (firstPat.kind) {
		case "ctor": {
			// Specialize the matrix for this constructor
			const specialized = specializeMatrix(matrix, firstPat.name, firstPat.args.length);
			const newVector = [...firstPat.args, ...rest];
			return isUseful(specialized, newVector, constructors);
		}

		case "literal": {
			// Treat literal as a nullary constructor for usefulness
			const name = String(firstPat.value);
			const specialized = specializeMatrix(matrix, name, 0);
			return isUseful(specialized, rest, constructors);
		}

		case "wildcard": {
			if (constructors.size > 0) {
				// Check if the matrix already covers all constructors
				const headCtors = collectHeadConstructors(matrix);
				const allCovered = [...constructors.keys()].every((c) => headCtors.has(c));

				if (allCovered) {
					// Must check each constructor separately
					for (const [ctorName, arity] of constructors) {
						const specialized = specializeMatrix(matrix, ctorName, arity);
						const wildcards = Array.from({ length: arity }, (): CheckPattern => ({ kind: "wildcard" }));
						const newVector = [...wildcards, ...rest];
						if (isUseful(specialized, newVector, constructors)) {
							return true;
						}
					}
					return false;
				}
				// Not all constructors covered — check default matrix
				const defaults = defaultMatrix(matrix);
				return isUseful(defaults, rest, constructors);
			}
			// No known constructors (infinite type): check default matrix
			const defaults = defaultMatrix(matrix);
			return isUseful(defaults, rest, constructors);
		}
	}
}

// ---------------------------------------------------------------------------
// Matrix operations
// ---------------------------------------------------------------------------

/**
 * Specialize the matrix for constructor `ctorName` with `arity` arguments.
 * For each row:
 * - If the head is the same ctor, replace it with its args
 * - If the head is a wildcard, expand to `arity` wildcards
 * - Otherwise, drop the row
 */
function specializeMatrix(
	matrix: CheckPattern[][],
	ctorName: string,
	arity: number,
): CheckPattern[][] {
	const result: CheckPattern[][] = [];

	for (const row of matrix) {
		if (row.length === 0) continue;
		const head = row[0];
		const tail = row.slice(1);

		switch (head.kind) {
			case "ctor":
				if (head.name === ctorName) {
					result.push([...head.args, ...tail]);
				}
				break;
			case "literal":
				if (String(head.value) === ctorName) {
					result.push(tail);
				}
				break;
			case "wildcard": {
				const wildcards = Array.from({ length: arity }, (): CheckPattern => ({ kind: "wildcard" }));
				result.push([...wildcards, ...tail]);
				break;
			}
		}
	}

	return result;
}

/**
 * Default matrix: keep rows whose head is a wildcard, removing the first column.
 */
function defaultMatrix(matrix: CheckPattern[][]): CheckPattern[][] {
	const result: CheckPattern[][] = [];

	for (const row of matrix) {
		if (row.length === 0) continue;
		if (row[0].kind === "wildcard") {
			result.push(row.slice(1));
		}
	}

	return result;
}

/**
 * Collect the set of constructor names that appear as heads in the matrix.
 */
function collectHeadConstructors(matrix: CheckPattern[][]): Set<string> {
	const ctors = new Set<string>();
	for (const row of matrix) {
		if (row.length === 0) continue;
		const head = row[0];
		if (head.kind === "ctor") {
			ctors.add(head.name);
		} else if (head.kind === "literal") {
			ctors.add(String(head.value));
		}
	}
	return ctors;
}

// ---------------------------------------------------------------------------
// Missing pattern collection
// ---------------------------------------------------------------------------

/**
 * Collect human-readable descriptions of missing patterns for ADT/Bool types.
 */
function collectMissing(
	matrix: CheckPattern[][],
	constructors: Map<string, number>,
	missing: string[],
): void {
	for (const [ctorName, arity] of constructors) {
		const specialized = specializeMatrix(matrix, ctorName, arity);
		if (arity === 0) {
			// Nullary constructor: check if useful
			if (isUseful(specialized, [], constructors)) {
				missing.push(ctorName);
			}
		} else {
			// Constructor with arguments: check if a wildcard-filled vector is useful
			const wildcards = Array.from({ length: arity }, (): CheckPattern => ({ kind: "wildcard" }));
			if (isUseful(specialized, wildcards, constructors)) {
				const args = Array.from({ length: arity }, () => "_").join(", ");
				missing.push(`${ctorName}(${args})`);
			}
		}
	}
}
