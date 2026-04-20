import { describe, expect, test } from "bun:test";
import { levenshtein, suggestNames } from "../src/util/levenshtein";

describe("levenshtein", () => {
	test("identical strings have distance 0", () => {
		expect(levenshtein("foo", "foo")).toBe(0);
	});

	test("empty vs non-empty returns length", () => {
		expect(levenshtein("", "abc")).toBe(3);
		expect(levenshtein("abc", "")).toBe(3);
	});

	test("both empty returns 0", () => {
		expect(levenshtein("", "")).toBe(0);
	});

	test("single insertion", () => {
		expect(levenshtein("cat", "cats")).toBe(1);
	});

	test("single deletion", () => {
		expect(levenshtein("cats", "cat")).toBe(1);
	});

	test("single substitution", () => {
		expect(levenshtein("cat", "car")).toBe(1);
	});

	test("classic kitten/sitting example", () => {
		expect(levenshtein("kitten", "sitting")).toBe(3);
	});

	test("completely different strings", () => {
		expect(levenshtein("abc", "xyz")).toBe(3);
	});

	test("is symmetric", () => {
		expect(levenshtein("abc", "axc")).toBe(levenshtein("axc", "abc"));
	});
});

describe("suggestNames", () => {
	const candidates = ["count", "counter", "amount", "total", "conut"];

	test("returns close matches sorted by distance", () => {
		const result = suggestNames("cont", candidates);
		// "conut" distance 2, "count" distance 2
		expect(result).toContain("conut");
		expect(result).toContain("count");
	});

	test("excludes exact matches (distance 0)", () => {
		const result = suggestNames("count", candidates);
		expect(result).not.toContain("count");
	});

	test("excludes candidates beyond maxDistance", () => {
		const result = suggestNames("xyz", candidates, 1);
		expect(result).toHaveLength(0);
	});

	test("returns at most 3 results", () => {
		const many = ["aa", "ab", "ac", "ad", "ae"];
		const result = suggestNames("a", many, 2);
		expect(result.length).toBeLessThanOrEqual(3);
	});

	test("respects custom maxDistance", () => {
		const result = suggestNames("count", candidates, 1);
		// No candidate is at distance exactly 1 from "count"
		expect(result).toEqual([]);
		// With maxDistance 2, "conut" and "counter" appear
		const result2 = suggestNames("count", candidates, 2);
		expect(result2).toContain("conut");
		expect(result2).toContain("counter");
	});

	test("returns empty array when no candidates", () => {
		expect(suggestNames("foo", [])).toEqual([]);
	});

	test("sorts by distance then alphabetically", () => {
		const names = ["bar", "baz", "baa"];
		const result = suggestNames("ba", names, 2);
		// All at distance 1; alphabetical: baa, bar, baz
		expect(result).toEqual(["baa", "bar", "baz"]);
	});
});
