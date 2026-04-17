// Diagnostic schema — the JSON shape every compiler pass emits.
// See docs/Design.md §4.10 and docs/Diagnostics.md for the reference.

export type Severity = "error" | "warning" | "info" | "help";

export type DiagnosticCode = `E${string}`;

export type Span = {
	file: string;
	line: number;
	col: number;
	len: number;
};

export type Position = {
	line: number;
	col: number;
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

export type Suggestion = {
	kind: SuggestionKind;
	rationale: string;
	at?: Position;
	span?: Span;
	insert?: string;
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
