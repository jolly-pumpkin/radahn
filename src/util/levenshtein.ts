// Levenshtein edit distance and "did you mean?" suggestion helper.
// Used by name resolution to power E0201 diagnostics.

/**
 * Compute the Levenshtein edit distance between two strings.
 * Uses single-row optimization for O(min(m, n)) space.
 */
export function levenshtein(a: string, b: string): number {
	// Ensure `a` is the shorter string so the row array is minimal.
	if (a.length > b.length) {
		[a, b] = [b, a];
	}

	const m = a.length;
	const n = b.length;

	// Early exits.
	if (m === 0) return n;
	if (n === 0) return m;

	// Single row of size m+1.
	const row = new Uint32Array(m + 1);
	for (let i = 0; i <= m; i++) row[i] = i;

	for (let j = 1; j <= n; j++) {
		let prev = row[0];
		row[0] = j;

		for (let i = 1; i <= m; i++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const temp = row[i];
			row[i] = Math.min(
				row[i] + 1,       // deletion
				row[i - 1] + 1,   // insertion
				prev + cost,       // substitution
			);
			prev = temp;
		}
	}

	return row[m];
}

/**
 * Return up to 3 candidates sorted by edit distance from `target`,
 * filtered to distance <= `maxDistance` (default 2) and excluding exact matches.
 */
export function suggestNames(
	target: string,
	candidates: string[],
	maxDistance: number = 2,
): string[] {
	return candidates
		.map((name) => ({ name, dist: levenshtein(target, name) }))
		.filter((c) => c.dist > 0 && c.dist <= maxDistance)
		.sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name))
		.slice(0, 3)
		.map((c) => c.name);
}
