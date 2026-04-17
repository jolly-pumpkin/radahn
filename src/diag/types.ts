// Diagnostic schema — the JSON shape every compiler pass emits.
// See docs/Design.md §4.10 and docs/Diagnostics.md for the reference.

import type { DiagnosticCode } from "./codes";

export type { DiagnosticCode };

export type Severity = "error" | "warning" | "info" | "help";

export type Span = {
	file: string;
	line: number;
	col: number;
	len: number;
};

export type SuggestionKind =
	| "add-param"
	| "add-effect"
	| "add-import"
	| "narrow-cap"
	| "rename"
	| "insert-text"
	| "replace-span"
	| "delete-span";

// Discriminated union: each kind binds the fields it actually requires.
//   - delete-span:  removes `span`; no insert text
//   - rename / replace-span:  replaces `span` with `insert`
//   - all insert-style kinds:  inserts `insert` at point `at` (use len: 0)
export type Suggestion =
	| {
			kind: "delete-span";
			rationale: string;
			span: Span;
	  }
	| {
			kind: "rename" | "replace-span";
			rationale: string;
			span: Span;
			insert: string;
	  }
	| {
			kind: "add-param" | "add-effect" | "add-import" | "narrow-cap" | "insert-text";
			rationale: string;
			at: Span;
			insert: string;
	  };

export type RelatedInfo = {
	span: Span;
	message: string;
};

export type Note = {
	message: string;
	span?: Span;
};

export type Diagnostic = {
	code: DiagnosticCode;
	severity: Severity;
	message: string;
	span: Span;
	related?: RelatedInfo[];
	suggest?: Suggestion[];
	notes?: Note[];
	docs: string;
};

export type DiagnosticCategory =
	| "lex"
	| "parse"
	| "resolve"
	| "effects"
	| "types"
	| "contracts"
	| "module";
