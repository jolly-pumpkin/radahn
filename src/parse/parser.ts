// Parser: token stream → AST (arena-based).
// Recursive descent with Pratt parsing for expressions.
// Panic-mode error recovery.

import type { Diagnostic, Span } from "../diag/types";
import type { DiagnosticCode } from "../diag/codes";
import { DIAGNOSTIC_REGISTRY } from "../diag/codes";
import { Arena, type NodeId } from "../util/arena";
import type { Token, TokenKind } from "../lex/lexer";
import type { AstNode, BinaryOp, UnaryOp } from "./ast";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ParseResult = {
	root: NodeId;
	arena: Arena<AstNode>;
	diagnostics: Diagnostic[];
};

export function parse(tokens: Token[], file: string): ParseResult {
	const parser = new Parser(tokens, file);
	return parser.parseFile();
}

// ---------------------------------------------------------------------------
// Binding powers for Pratt parser
// ---------------------------------------------------------------------------

type BpPair = [left: number, right: number];

function infixBp(kind: TokenKind): BpPair | null {
	switch (kind) {
		case "PipePipe": return [2, 3];
		case "AmpAmp": return [4, 5];
		// Non-associative: equal left and right
		case "EqEq": case "BangEq": case "Lt": case "LtEq": case "Gt": case "GtEq":
			return [6, 6];
		case "DotDot": return [8, 8];
		// Left-associative
		case "Plus": case "Minus": case "PlusPlus": return [10, 11];
		case "Star": case "Slash": case "Percent": return [12, 13];
		default: return null;
	}
}

function prefixBp(_kind: TokenKind): number | null {
	switch (_kind) {
		case "Minus": case "Bang": return 14;
		default: return null;
	}
}

const POSTFIX_BP = 16;

function tokenToBinaryOp(kind: TokenKind): BinaryOp | ".." | null {
	switch (kind) {
		case "Plus": return "+";
		case "Minus": return "-";
		case "Star": return "*";
		case "Slash": return "/";
		case "Percent": return "%";
		case "EqEq": return "==";
		case "BangEq": return "!=";
		case "Lt": return "<";
		case "LtEq": return "<=";
		case "Gt": return ">";
		case "GtEq": return ">=";
		case "AmpAmp": return "&&";
		case "PipePipe": return "||";
		case "PlusPlus": return "++";
		case "DotDot": return "..";
		default: return null;
	}
}

function tokenToUnaryOp(kind: TokenKind): UnaryOp | null {
	switch (kind) {
		case "Minus": return "-";
		case "Bang": return "!";
		default: return null;
	}
}

// Non-associative precedence levels (reject chaining)
function isNonAssociative(kind: TokenKind): boolean {
	switch (kind) {
		case "EqEq": case "BangEq": case "Lt": case "LtEq": case "Gt": case "GtEq":
		case "DotDot":
			return true;
		default:
			return false;
	}
}

const KEYWORD_KINDS: Set<string> = new Set([
	"fn", "let", "if", "else", "match", "module", "end-module",
	"import", "export", "extern", "pub", "effect", "cap",
	"type", "trait", "impl", "where", "pre", "post", "cost",
	"spec", "test", "partial", "linear", "return", "for", "in",
]);

function isKeywordKind(kind: TokenKind): boolean {
	return KEYWORD_KINDS.has(kind);
}

function isTrivia(kind: TokenKind): boolean {
	return kind === "Newline" || kind === "DocComment" || kind === "HintComment";
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
	private tokens: Token[];
	private pos = 0;
	private arena = new Arena<AstNode>();
	private diagnostics: Diagnostic[] = [];
	private file: string;
	private bracketDepth = 0;
	private noStructLiteral = false; // R11: suppress RecordExpr in scrutinee position

	constructor(tokens: Token[], file: string) {
		this.tokens = tokens;
		this.file = file;
	}

	// --- Public entry ---

	parseFile(): ParseResult {
		const start = this.currentSpan();
		const header = this.parseModuleHeader();
		const decls: NodeId[] = [];

		this.skipNewlines();
		while (!this.atEnd()) {
			this.skipNewlines();
			if (this.atEnd()) break;
			const decl = this.parseTopDecl();
			if (decl !== null) decls.push(decl);
			this.skipNewlines();
		}

		const root = this.arena.alloc({
			kind: "File",
			span: this.spanFrom(start),
			header,
			decls,
		});
		return { root, arena: this.arena, diagnostics: this.diagnostics };
	}

	// --- Module header ---

	private parseModuleHeader(): NodeId {
		const start = this.currentSpan();
		this.expect("module");
		const path = this.parseModulePath();
		this.expectNewline();

		const fields: NodeId[] = [];
		while (!this.atEnd() && !this.check("end-module")) {
			this.skipNewlines();
			if (this.check("end-module")) break;
			fields.push(this.parseModuleField());
		}

		this.expect("end-module");
		this.expectNewline();

		return this.arena.alloc({
			kind: "ModuleHeader",
			span: this.spanFrom(start),
			path,
			fields,
		});
	}

	private parseModulePath(): NodeId {
		const start = this.currentSpan();
		const segments: string[] = [];
		const separators: ("." | "/")[] = [];

		segments.push(this.expectIdent());
		while (this.check("Dot") || this.check("Slash")) {
			const sep = this.peek().kind === "Dot" ? "." : "/";
			separators.push(sep);
			this.advance();
			segments.push(this.expectIdent());
		}

		return this.arena.alloc({
			kind: "ModulePath",
			span: this.spanFrom(start),
			segments,
			separators,
		});
	}

	private parseModuleField(): NodeId {
		const start = this.currentSpan();
		const nameToken = this.advance();
		const name = nameToken.value;

		if (!name || !["version", "exports", "effects", "caps", "since", "summary"].includes(name)) {
			this.error("E0101", `expected module field (version, exports, effects, caps, since, summary), got \`${name || nameToken.kind}\``, nameToken.span);
			this.synchronize();
			return this.arena.alloc({ kind: "ModuleField", span: this.spanFrom(start), name: "version", value: "" });
		}

		this.expect("Colon");

		let value: string | string[];
		if (name === "version" || name === "since" || name === "summary") {
			const tok = this.expect("StringLit");
			value = tok.value || "";
		} else {
			// exports, effects, caps — parse [ IdentList ]
			// Effect names can have dots: fs.read, fs.write
			this.expect("LBracket");
			const items: string[] = [];
			while (!this.atEnd() && !this.check("RBracket")) {
				let item = this.expectIdent();
				while (this.eat("Dot")) {
					item += "." + this.expectIdent();
				}
				items.push(item);
				this.eat("Comma");
			}
			this.expect("RBracket");
			value = items;
		}

		this.expectNewline();

		return this.arena.alloc({
			kind: "ModuleField",
			span: this.spanFrom(start),
			name: name as "version" | "exports" | "effects" | "caps" | "since" | "summary",
			value,
		});
	}

	// --- Top-level declarations ---

	private parseTopDecl(): NodeId | null {
		this.skipNewlines();
		const visibility = this.eat("pub");

		if (this.check("fn")) return this.parseFnDecl(visibility);
		if (this.check("type")) return this.parseTypeDecl(visibility);
		if (this.check("extern")) {
			if (visibility) {
				this.error("E0101", "`extern` blocks cannot have visibility modifier", this.currentSpan());
			}
			return this.parseExternBlock();
		}
		if (this.check("import")) {
			if (visibility) {
				this.error("E0101", "`import` cannot have visibility modifier", this.currentSpan());
			}
			return this.parseImport();
		}

		// Reserved keywords
		const tok = this.peek();
		if (["trait", "impl", "effect", "cap", "spec", "test", "for", "linear"].includes(tok.kind)) {
			this.error("E0101", `\`${tok.kind}\` is reserved for a future version`, tok.span);
			this.advance();
			this.synchronize();
			return null;
		}

		// Top-level let binding
		if (this.check("let")) {
			if (visibility) {
				this.error("E0101", "`let` at top level cannot have visibility modifier", this.currentSpan());
			}
			return this.parseLetStmt();
		}

		// Top-level expression statement (e.g., function calls)
		if (visibility) {
			this.error("E0101", `expected declaration (fn, type, import, extern), got \`${tok.kind}\``, tok.span);
			this.synchronize();
			return null;
		}

		// Try parsing as a top-level expression statement
		try {
			const start = this.currentSpan();
			const expr = this.parseExpr();
			this.skipNewlines();
			return this.arena.alloc({
				kind: "ExprStmt",
				span: this.spanFrom(start),
				expr,
			});
		} catch {
			this.error("E0101", `expected declaration (fn, type, import, extern), got \`${tok.kind}\``, tok.span);
			this.synchronize();
			return null;
		}
	}

	private parseImport(): NodeId {
		const start = this.currentSpan();
		this.expect("import");
		const path = this.parseModulePath();

		let names: string[] | null = null;
		if (this.eat("LBrace")) {
			names = [];
			while (!this.atEnd() && !this.check("RBrace")) {
				names.push(this.expectIdent());
				if (!this.eat("Comma")) break;
			}
			this.expect("RBrace");
		}

		this.expectNewline();
		return this.arena.alloc({ kind: "Import", span: this.spanFrom(start), path, names });
	}

	// --- Function declarations ---

	private parseFnDecl(visibility: boolean): NodeId {
		const start = this.currentSpan();
		this.expect("fn");
		const name = this.expectIdent();

		const typeParams = this.check("LBracket") ? this.parseTypeParams() : null;

		this.expect("LParen");
		this.bracketDepth++;
		const params: NodeId[] = [];
		while (!this.atEnd() && !this.check("RParen")) {
			params.push(this.parseParam());
			if (!this.eat("Comma")) break;
		}
		this.bracketDepth--;
		this.expect("RParen");

		const returnType = this.eat("Arrow") ? this.parseType() : null;
		const effectRow = this.check("Bang") ? this.parseEffectRow() : null;

		const contracts: NodeId[] = [];
		this.skipNewlines();
		while (this.check("At")) {
			contracts.push(this.parseContractClause());
			this.skipNewlines();
		}

		this.skipNewlines();
		const body = this.check("LBrace") ? this.parseBlock() : null;
		if (!body) this.expectNewline();

		return this.arena.alloc({
			kind: "FnDecl",
			span: this.spanFrom(start),
			visibility,
			name,
			typeParams,
			params,
			returnType,
			effectRow,
			contracts,
			body,
		});
	}

	private parseParam(): NodeId {
		const start = this.currentSpan();
		this.skipNewlines();
		const name = this.expectIdent();
		this.expect("Colon");
		const type = this.parseType();
		return this.arena.alloc({ kind: "Param", span: this.spanFrom(start), name, type });
	}

	private parseTypeParams(): NodeId {
		const start = this.currentSpan();
		this.expect("LBracket");
		this.bracketDepth++;
		const names: string[] = [];
		while (!this.atEnd() && !this.check("RBracket")) {
			names.push(this.expectIdent());
			if (!this.eat("Comma")) break;
		}
		this.bracketDepth--;
		this.expect("RBracket");
		return this.arena.alloc({ kind: "TypeParams", span: this.spanFrom(start), names });
	}

	private parseEffectRow(): NodeId {
		const start = this.currentSpan();
		this.expect("Bang");
		this.expect("LBrace");
		const effects: NodeId[] = [];
		while (!this.atEnd() && !this.check("RBrace")) {
			effects.push(this.parseEffectName());
			if (!this.eat("Comma")) break;
		}
		this.expect("RBrace");
		return this.arena.alloc({ kind: "EffectRow", span: this.spanFrom(start), effects });
	}

	private parseEffectName(): NodeId {
		const start = this.currentSpan();
		const segments: string[] = [this.expectIdent()];
		while (this.eat("Dot")) {
			segments.push(this.expectIdent());
		}
		return this.arena.alloc({ kind: "EffectName", span: this.spanFrom(start), segments });
	}

	private parseContractClause(): NodeId {
		const start = this.currentSpan();
		this.expect("At");
		this.skipNewlines();

		if (this.check("pre")) {
			this.advance();
			const expr = this.parseExpr();
			this.expectNewline();
			return this.arena.alloc({ kind: "ContractPre", span: this.spanFrom(start), expr });
		}
		if (this.check("post")) {
			this.advance();
			const expr = this.parseExpr();
			this.expectNewline();
			return this.arena.alloc({ kind: "ContractPost", span: this.spanFrom(start), expr });
		}
		if (this.check("cost")) {
			this.advance();
			const fields: NodeId[] = [];
			while (!this.atEnd()) {
				fields.push(this.parseCostField());
				if (!this.eat("Comma")) break;
			}
			this.expectNewline();
			return this.arena.alloc({ kind: "ContractCost", span: this.spanFrom(start), fields });
		}

		this.error("E0501", "expected `pre`, `post`, or `cost` after `@`", this.currentSpan());
		this.synchronize();
		return this.arena.alloc({ kind: "ContractPre", span: this.spanFrom(start), expr: this.allocDummyExpr() });
	}

	private parseCostField(): NodeId {
		const start = this.currentSpan();
		const name = this.expectIdent();
		this.expect("Colon");
		const value = this.parseCostValue();
		return this.arena.alloc({ kind: "CostField", span: this.spanFrom(start), name, value });
	}

	private parseCostValue(): NodeId {
		const start = this.currentSpan();
		let prefix: "<=" | "~" | null = null;
		if (this.check("LtEq")) {
			prefix = "<=";
			this.advance();
		} else if (this.check("Tilde")) {
			prefix = "~";
			this.advance();
		}

		let numValue: string;
		if (this.check("IntLit") || this.check("FloatLit")) {
			numValue = this.advance().value || "0";
		} else {
			this.error("E0101", "expected numeric value in cost field", this.currentSpan());
			numValue = "0";
		}

		let unit: string | null = null;
		if (this.check("Ident")) {
			unit = this.advance().value || null;
		}

		return this.arena.alloc({ kind: "CostValue", span: this.spanFrom(start), prefix, number: numValue, unit });
	}

	// --- Type declarations ---

	private parseTypeDecl(visibility: boolean): NodeId {
		const start = this.currentSpan();
		this.expect("type");
		const name = this.expectIdent();
		const typeParams = this.check("LBracket") ? this.parseTypeParams() : null;
		this.expect("Eq");
		this.skipNewlines();

		let value: NodeId;
		if (this.check("Pipe")) {
			value = this.parseSumType();
		} else {
			value = this.parseType();
		}

		this.expectNewline();
		return this.arena.alloc({ kind: "TypeDecl", span: this.spanFrom(start), visibility, name, typeParams, value });
	}

	private parseSumType(): NodeId {
		const start = this.currentSpan();
		const variants: NodeId[] = [];
		while (this.check("Pipe")) {
			this.advance(); // |
			variants.push(this.parseVariant());
			this.skipNewlines();
		}
		return this.arena.alloc({ kind: "SumType", span: this.spanFrom(start), variants });
	}

	private parseVariant(): NodeId {
		const start = this.currentSpan();
		const name = this.expectIdent();
		let payloadKind: "positional" | "named" | "none" = "none";
		const payload: NodeId[] = [];

		if (this.eat("LParen")) {
			this.bracketDepth++;
			// Determine if named or positional: peek for IDENT followed by ":"
			if (this.check("Ident") && this.peekNth(1)?.kind === "Colon") {
				payloadKind = "named";
				while (!this.atEnd() && !this.check("RParen")) {
					payload.push(this.parseField());
					if (!this.eat("Comma")) break;
				}
			} else {
				payloadKind = "positional";
				while (!this.atEnd() && !this.check("RParen")) {
					payload.push(this.parseType());
					if (!this.eat("Comma")) break;
				}
			}
			this.bracketDepth--;
			this.expect("RParen");
		}

		return this.arena.alloc({ kind: "Variant", span: this.spanFrom(start), name, payloadKind, payload });
	}

	// --- Extern blocks ---

	private parseExternBlock(): NodeId {
		const start = this.currentSpan();
		this.expect("extern");
		this.expect("module");
		const path = this.parseModulePath();
		this.expect("LBrace");
		this.expectNewline();

		const decls: NodeId[] = [];
		while (!this.atEnd() && !this.check("RBrace")) {
			this.skipNewlines();
			if (this.check("RBrace")) break;
			decls.push(this.parseExternDecl());
		}

		this.expect("RBrace");
		this.expectNewline();
		return this.arena.alloc({ kind: "ExternBlock", span: this.spanFrom(start), path, decls });
	}

	private parseExternDecl(): NodeId {
		const start = this.currentSpan();

		if (this.check("fn")) {
			this.advance();
			const name = this.expectIdent();
			this.expect("LParen");
			this.bracketDepth++;
			const params: NodeId[] = [];
			while (!this.atEnd() && !this.check("RParen")) {
				params.push(this.parseParam());
				if (!this.eat("Comma")) break;
			}
			this.bracketDepth--;
			this.expect("RParen");
			const returnType = this.eat("Arrow") ? this.parseType() : null;
			const effectRow = this.check("Bang") ? this.parseEffectRow() : null;
			this.expectNewline();
			return this.arena.alloc({ kind: "ExternFnDecl", span: this.spanFrom(start), name, params, returnType, effectRow });
		}

		if (this.check("type")) {
			this.advance();
			const name = this.expectIdent();
			const typeParams = this.check("LBracket") ? this.parseTypeParams() : null;
			this.expectNewline();
			return this.arena.alloc({ kind: "ExternTypeDecl", span: this.spanFrom(start), name, typeParams });
		}

		this.error("E0101", "expected `fn` or `type` in extern block", this.currentSpan());
		this.synchronize();
		return this.arena.alloc({ kind: "ExternTypeDecl", span: this.spanFrom(start), name: "<error>", typeParams: null });
	}

	// --- Types ---

	private parseType(): NodeId {
		const base = this.parseTypeAtom();

		// Refinement: Type where Expr
		if (this.check("where")) {
			const start = this.arena.get(base).span;
			this.advance();
			const predicate = this.parseExpr();
			return this.arena.alloc({ kind: "RefinedType", span: this.spanFrom(start), base, predicate });
		}

		return base;
	}

	private parseTypeAtom(): NodeId {
		const start = this.currentSpan();

		// Unit type: ()
		if (this.check("LParen")) {
			this.advance();
			this.bracketDepth++;
			if (this.check("RParen")) {
				this.bracketDepth--;
				this.advance();
				return this.arena.alloc({ kind: "VoidType", span: this.spanFrom(start) });
			}
			// Tuple type or parenthesized type
			const first = this.parseType();
			if (this.check("Comma")) {
				// Tuple type
				const elements: NodeId[] = [first];
				while (this.eat("Comma")) {
					if (this.check("RParen")) break;
					elements.push(this.parseType());
				}
				this.bracketDepth--;
				this.expect("RParen");
				return this.arena.alloc({ kind: "TupleType", span: this.spanFrom(start), elements });
			}
			// Parenthesized type
			this.bracketDepth--;
			this.expect("RParen");
			return first;
		}

		// Record type: { fields }
		if (this.check("LBrace")) {
			return this.parseRecordType();
		}

		// Function type: fn(...) -> T
		if (this.check("fn")) {
			return this.parseFnType();
		}

		// Nominal type: Ident (. Ident)* [TypeArgs]?
		return this.parseNominalType();
	}

	private parseNominalType(): NodeId {
		const start = this.currentSpan();
		const segments: string[] = [this.expectIdent()];
		while (this.check("Dot") && !this.atEnd()) {
			this.advance();
			segments.push(this.expectIdent());
		}
		const typeArgs: NodeId[] = [];
		if (this.check("LBracket")) {
			this.advance();
			this.bracketDepth++;
			while (!this.atEnd() && !this.check("RBracket")) {
				typeArgs.push(this.parseType());
				if (!this.eat("Comma")) break;
			}
			this.bracketDepth--;
			this.expect("RBracket");
		}
		return this.arena.alloc({ kind: "NominalType", span: this.spanFrom(start), segments, typeArgs });
	}

	private parseRecordType(): NodeId {
		const start = this.currentSpan();
		this.expect("LBrace");
		const fields: NodeId[] = [];
		while (!this.atEnd() && !this.check("RBrace")) {
			this.skipNewlines();
			if (this.check("RBrace")) break;
			fields.push(this.parseField());
			this.eat("Comma");
			this.skipNewlines();
		}
		this.expect("RBrace");
		return this.arena.alloc({ kind: "RecordType", span: this.spanFrom(start), fields });
	}

	private parseField(): NodeId {
		const start = this.currentSpan();
		const name = this.expectIdent();
		this.expect("Colon");
		const type = this.parseType();
		return this.arena.alloc({ kind: "Field", span: this.spanFrom(start), name, type });
	}

	private parseFnType(): NodeId {
		const start = this.currentSpan();
		this.expect("fn");
		this.expect("LParen");
		this.bracketDepth++;
		const params: NodeId[] = [];
		while (!this.atEnd() && !this.check("RParen")) {
			params.push(this.parseType());
			if (!this.eat("Comma")) break;
		}
		this.bracketDepth--;
		this.expect("RParen");
		this.expect("Arrow");
		const returnType = this.parseType();
		const effectRow = this.check("Bang") ? this.parseEffectRow() : null;
		return this.arena.alloc({ kind: "FnType", span: this.spanFrom(start), params, returnType, effectRow });
	}

	// --- Blocks and statements ---

	private parseBlock(): NodeId {
		const start = this.currentSpan();
		this.expect("LBrace");
		this.expectNewline();

		const stmts: NodeId[] = [];
		while (!this.atEnd() && !this.check("RBrace")) {
			this.skipNewlines();
			if (this.check("RBrace")) break;
			const stmt = this.parseStmt();
			if (stmt !== null) stmts.push(stmt);
		}

		this.expect("RBrace");
		return this.arena.alloc({ kind: "Block", span: this.spanFrom(start), stmts });
	}

	private parseStmt(): NodeId | null {
		this.skipNewlines();
		if (this.check("let")) return this.parseLetStmt();
		if (this.check("return")) return this.parseReturnStmt();
		return this.parseExprStmt();
	}

	private parseLetStmt(): NodeId {
		const start = this.currentSpan();
		this.expect("let");
		const pattern = this.parsePattern();
		const type = this.eat("Colon") ? this.parseType() : null;
		this.expect("Eq");
		const value = this.parseExpr();
		this.expectNewline();
		return this.arena.alloc({ kind: "LetStmt", span: this.spanFrom(start), pattern, type, value });
	}

	private parseReturnStmt(): NodeId {
		const start = this.currentSpan();
		this.expect("return");
		let value: NodeId | null = null;
		if (!this.check("Newline") && !this.check("RBrace") && !this.atEnd()) {
			value = this.parseExpr();
		}
		this.expectNewline();
		return this.arena.alloc({ kind: "ReturnStmt", span: this.spanFrom(start), value });
	}

	private parseExprStmt(): NodeId {
		const start = this.currentSpan();
		const expr = this.parseExpr();
		this.expectNewline();
		return this.arena.alloc({ kind: "ExprStmt", span: this.spanFrom(start), expr });
	}

	// --- Patterns ---

	private parsePattern(): NodeId {
		const start = this.currentSpan();

		// Wildcard
		if (this.check("Ident") && this.peek().value === "_") {
			this.advance();
			return this.arena.alloc({ kind: "WildcardPat", span: this.spanFrom(start) });
		}

		// Record pattern: { ... }
		if (this.check("LBrace")) {
			this.advance();
			const fields: NodeId[] = [];
			while (!this.atEnd() && !this.check("RBrace")) {
				const fStart = this.currentSpan();
				const name = this.expectIdent();
				let pattern: NodeId | null = null;
				if (this.eat("Colon")) {
					pattern = this.parsePattern();
				}
				fields.push(this.arena.alloc({ kind: "RecordPatField", span: this.spanFrom(fStart), name, pattern }));
				if (!this.eat("Comma")) break;
			}
			this.expect("RBrace");
			return this.arena.alloc({ kind: "RecordPat", span: this.spanFrom(start), fields });
		}

		// Tuple pattern: ( pat, pat, ... )
		if (this.check("LParen")) {
			this.advance();
			this.bracketDepth++;
			const elements: NodeId[] = [];
			elements.push(this.parsePattern());
			if (this.eat("Comma")) {
				elements.push(this.parsePattern());
				while (this.eat("Comma")) {
					if (this.check("RParen")) break;
					elements.push(this.parsePattern());
				}
			}
			this.bracketDepth--;
			this.expect("RParen");
			if (elements.length >= 2) {
				return this.arena.alloc({ kind: "TuplePat", span: this.spanFrom(start), elements });
			}
			// Single element in parens — just return the inner pattern
			return elements[0];
		}

		// Literal patterns
		if (this.check("IntLit")) {
			const tok = this.advance();
			return this.arena.alloc({ kind: "LiteralPat", span: this.spanFrom(start), value: tok.value || "0", litKind: "int" });
		}
		if (this.check("FloatLit")) {
			const tok = this.advance();
			return this.arena.alloc({ kind: "LiteralPat", span: this.spanFrom(start), value: tok.value || "0.0", litKind: "float" });
		}
		if (this.check("StringLit")) {
			const tok = this.advance();
			return this.arena.alloc({ kind: "LiteralPat", span: this.spanFrom(start), value: tok.value || '""', litKind: "string" });
		}
		if (this.check("BoolTrue") || this.check("BoolFalse")) {
			const tok = this.advance();
			return this.arena.alloc({ kind: "LiteralPat", span: this.spanFrom(start), value: tok.kind === "BoolTrue" ? "true" : "false", litKind: "bool" });
		}

		// Constructor or binding pattern
		if (this.check("Ident")) {
			const name = this.advance().value!;
			// Constructor pattern: IDENT ( patterns... )
			if (this.check("LParen")) {
				this.advance();
				this.bracketDepth++;
				const args: NodeId[] = [];
				while (!this.atEnd() && !this.check("RParen")) {
					args.push(this.parsePattern());
					if (!this.eat("Comma")) break;
				}
				this.bracketDepth--;
				this.expect("RParen");
				return this.arena.alloc({ kind: "CtorPat", span: this.spanFrom(start), name, args });
			}
			// Binding pattern
			return this.arena.alloc({ kind: "BindingPat", span: this.spanFrom(start), name });
		}

		this.error("E0101", "expected pattern", this.currentSpan());
		this.advance();
		return this.arena.alloc({ kind: "WildcardPat", span: this.spanFrom(start) });
	}

	// --- Expressions (Pratt parser) ---

	private parseExpr(): NodeId {
		// Check for if/match first (they're at expression level)
		if (this.check("if")) return this.parseIfExpr();
		if (this.check("match")) return this.parseMatchExpr();
		return this.parseExprBp(0);
	}

	private parseExprBp(minBp: number): NodeId {
		let lhs: NodeId;

		// Prefix operators
		const prefBp = prefixBp(this.peek().kind);
		if (prefBp !== null) {
			const start = this.currentSpan();
			const opTok = this.advance();
			const op = tokenToUnaryOp(opTok.kind)!;
			const operand = this.parseExprBp(prefBp);
			lhs = this.arena.alloc({ kind: "UnaryExpr", span: this.spanFrom(start), op, operand });
		} else {
			lhs = this.parsePrimaryExpr();
		}

		// Postfix and infix loop
		while (true) {
			// Postfix operators (highest precedence)
			if (POSTFIX_BP >= minBp) {
				const postfix = this.tryParsePostfix(lhs);
				if (postfix !== null) {
					lhs = postfix;
					continue;
				}
			}

			// Infix operators
			const bp = infixBp(this.peek().kind);
			if (bp === null) break;
			const [leftBp, rightBp] = bp;
			if (leftBp < minBp) break;

			const start = this.arena.get(lhs).span;
			const opTok = this.advance();
			const op = tokenToBinaryOp(opTok.kind)!;

			// Non-associative check: after parsing RHS, reject if same precedence follows
			const rhs = this.parseExprBp(rightBp + (isNonAssociative(opTok.kind) ? 1 : 0));

			// Check for chaining of non-associative operators
			if (isNonAssociative(opTok.kind)) {
				const nextBp = infixBp(this.peek().kind);
				if (nextBp !== null && nextBp[0] === leftBp) {
					this.error("E0101", `chained \`${this.peek().kind}\` is not allowed; use \`&&\` to combine comparisons`, this.peek().span);
				}
			}

			if (op === "..") {
				lhs = this.arena.alloc({ kind: "RangeExpr", span: this.spanFrom(start), start: lhs, end: rhs });
			} else {
				lhs = this.arena.alloc({ kind: "BinaryExpr", span: this.spanFrom(start), op, left: lhs, right: rhs });
			}
		}

		return lhs;
	}

	private tryParsePostfix(lhs: NodeId): NodeId | null {
		const start = this.arena.get(lhs).span;

		// Call: (args)
		if (this.check("LParen")) {
			const args = this.parseCallArgs();
			return this.arena.alloc({ kind: "CallExpr", span: this.spanFrom(start), callee: lhs, args });
		}

		// Field access: .ident (keywords allowed as field names, e.g. http.post)
		if (this.check("Dot")) {
			this.advance();
			const field = this.expectIdentOrKeyword();
			return this.arena.alloc({ kind: "FieldAccess", span: this.spanFrom(start), object: lhs, field });
		}

		// Index: [expr]
		if (this.check("LBracket")) {
			this.advance();
			this.bracketDepth++;
			const index = this.parseExpr();
			this.bracketDepth--;
			this.expect("RBracket");
			return this.arena.alloc({ kind: "IndexExpr", span: this.spanFrom(start), object: lhs, index });
		}

		// Try: ?
		if (this.check("Question")) {
			this.advance();
			return this.arena.alloc({ kind: "TryExpr", span: this.spanFrom(start), expr: lhs });
		}

		// Turbofish: ::<Type>
		if (this.check("ColonColon") && this.peekNth(1)?.kind === "Lt") {
			this.advance(); // ::
			this.advance(); // <
			const typeArg = this.parseType();
			this.expect("Gt");
			return this.arena.alloc({ kind: "TurbofishExpr", span: this.spanFrom(start), expr: lhs, typeArg });
		}

		// Named RecordExpr: IDENT { ... } (only if lhs is an Ident and not in scrutinee position)
		if (!this.noStructLiteral && this.check("LBrace")) {
			const lhsNode = this.arena.get(lhs);
			if (lhsNode.kind === "Ident") {
				// Peek ahead: { IDENT : or { }
				const next = this.peekNth(1);
				if (next && (next.kind === "RBrace" || (next.kind === "Ident" && this.peekNth(2)?.kind === "Colon"))) {
					return this.parseRecordExprBody(lhsNode.name, start);
				}
				// Also check for shorthand: { IDENT , or { IDENT }
				if (next && next.kind === "Ident") {
					const afterIdent = this.peekNth(2);
					if (afterIdent && (afterIdent.kind === "Comma" || afterIdent.kind === "RBrace")) {
						return this.parseRecordExprBody(lhsNode.name, start);
					}
				}
			}
		}

		return null;
	}

	private parseCallArgs(): NodeId[] {
		this.expect("LParen");
		this.bracketDepth++;
		const args: NodeId[] = [];
		while (!this.atEnd() && !this.check("RParen")) {
			args.push(this.parseArg());
			if (!this.eat("Comma")) break;
		}
		this.bracketDepth--;
		this.expect("RParen");
		return args;
	}

	private parseArg(): NodeId {
		const start = this.currentSpan();
		// Named arg: IDENT = Expr
		if (this.check("Ident") && this.peekNth(1)?.kind === "Eq") {
			const name = this.advance().value!;
			this.advance(); // =
			const value = this.parseExpr();
			return this.arena.alloc({ kind: "NamedArg", span: this.spanFrom(start), name, value });
		}
		return this.parseExpr();
	}

	private parsePrimaryExpr(): NodeId {
		const start = this.currentSpan();

		// Literals
		if (this.check("IntLit")) {
			const tok = this.advance();
			return this.arena.alloc({ kind: "IntLit", span: this.spanFrom(start), value: tok.value || "0" });
		}
		if (this.check("FloatLit")) {
			const tok = this.advance();
			return this.arena.alloc({ kind: "FloatLit", span: this.spanFrom(start), value: tok.value || "0.0" });
		}
		if (this.check("StringLit")) {
			const tok = this.advance();
			return this.arena.alloc({ kind: "StringLit", span: this.spanFrom(start), value: tok.value || '""' });
		}
		if (this.check("BoolTrue")) {
			this.advance();
			return this.arena.alloc({ kind: "BoolLit", span: this.spanFrom(start), value: true });
		}
		if (this.check("BoolFalse")) {
			this.advance();
			return this.arena.alloc({ kind: "BoolLit", span: this.spanFrom(start), value: false });
		}

		// Parenthesized expr / tuple / unit
		if (this.check("LParen")) {
			this.advance();
			this.bracketDepth++;
			if (this.check("RParen")) {
				this.bracketDepth--;
				this.advance();
				return this.arena.alloc({ kind: "VoidLit", span: this.spanFrom(start) });
			}
			const first = this.parseExpr();
			if (this.check("Comma")) {
				// Tuple
				const elements: NodeId[] = [first];
				while (this.eat("Comma")) {
					if (this.check("RParen")) break;
					elements.push(this.parseExpr());
				}
				this.bracketDepth--;
				this.expect("RParen");
				return this.arena.alloc({ kind: "TupleExpr", span: this.spanFrom(start), elements });
			}
			this.bracketDepth--;
			this.expect("RParen");
			return first; // parenthesized expression
		}

		// List: [expr, ...]
		if (this.check("LBracket")) {
			this.advance();
			this.bracketDepth++;
			const elements: NodeId[] = [];
			while (!this.atEnd() && !this.check("RBracket")) {
				elements.push(this.parseExpr());
				if (!this.eat("Comma")) break;
			}
			this.bracketDepth--;
			this.expect("RBracket");
			return this.arena.alloc({ kind: "ListExpr", span: this.spanFrom(start), elements });
		}

		// Block as expression: { NEWLINE ... }
		if (this.check("LBrace")) {
			// R11: check if it's a block (NEWLINE after {) or anonymous record
			const next = this.peekNth(1);
			if (next && next.kind === "Newline") {
				const block = this.parseBlock();
				return this.arena.alloc({ kind: "BlockExpr", span: this.spanFrom(start), block });
			}
			// Anonymous record expression: { field: expr, ... }
			return this.parseRecordExprBody(null, start);
		}

		// Identifier
		if (this.check("Ident")) {
			const tok = this.advance();
			return this.arena.alloc({ kind: "Ident", span: this.spanFrom(start), name: tok.value! });
		}

		// If/Match can also appear as primary expressions via the Pratt loop
		if (this.check("if")) return this.parseIfExpr();
		if (this.check("match")) return this.parseMatchExpr();

		this.error("E0101", `expected expression, got \`${this.peek().kind}\``, this.currentSpan());
		this.advance();
		return this.allocDummyExpr();
	}

	private parseRecordExprBody(name: string | null, start: Span): NodeId {
		this.expect("LBrace");
		const fields: NodeId[] = [];
		while (!this.atEnd() && !this.check("RBrace")) {
			const fStart = this.currentSpan();
			const fieldName = this.expectIdent();
			let value: NodeId | null = null;
			if (this.eat("Colon")) {
				value = this.parseExpr();
			}
			fields.push(this.arena.alloc({ kind: "RecordInit", span: this.spanFrom(fStart), name: fieldName, value }));
			if (!this.eat("Comma")) break;
		}
		this.expect("RBrace");
		return this.arena.alloc({ kind: "RecordExpr", span: this.spanFrom(start), name, fields });
	}

	// --- If / Match ---

	private parseIfExpr(): NodeId {
		const start = this.currentSpan();
		this.expect("if");

		// R11: no struct literals in condition
		const prevNoStruct = this.noStructLiteral;
		this.noStructLiteral = true;
		const condition = this.parseExpr();
		this.noStructLiteral = prevNoStruct;

		const then = this.parseBlock();
		let else_: NodeId | null = null;
		this.skipNewlines();
		if (this.eat("else")) {
			if (this.check("if")) {
				else_ = this.parseIfExpr();
			} else {
				else_ = this.parseBlock();
			}
		}
		return this.arena.alloc({ kind: "IfExpr", span: this.spanFrom(start), condition, then, else_ });
	}

	private parseMatchExpr(): NodeId {
		const start = this.currentSpan();
		this.expect("match");

		// R11: no struct literals in scrutinee
		const prevNoStruct = this.noStructLiteral;
		this.noStructLiteral = true;
		const scrutinee = this.parseExpr();
		this.noStructLiteral = prevNoStruct;

		this.expect("LBrace");
		this.expectNewline();

		const arms: NodeId[] = [];
		while (!this.atEnd() && !this.check("RBrace")) {
			this.skipNewlines();
			if (this.check("RBrace")) break;
			arms.push(this.parseMatchArm());
		}

		this.expect("RBrace");
		return this.arena.alloc({ kind: "MatchExpr", span: this.spanFrom(start), scrutinee, arms });
	}

	private parseMatchArm(): NodeId {
		const start = this.currentSpan();
		const pattern = this.parsePattern();
		let guard: NodeId | null = null;
		if (this.check("if")) {
			this.advance();
			guard = this.parseExpr();
		}
		this.expect("FatArrow");

		let body: NodeId;
		if (this.check("LBrace") && this.peekNth(1)?.kind === "Newline") {
			body = this.parseBlock();
		} else {
			body = this.parseExpr();
		}
		this.expectNewline();
		return this.arena.alloc({ kind: "MatchArm", span: this.spanFrom(start), pattern, guard, body });
	}

	// --- Token helpers ---

	private peek(): Token {
		this.skipInsignificantNewlines();
		return this.tokens[this.pos] || { kind: "Eof" as const, span: { file: this.file, line: 0, col: 0, len: 0 } };
	}

	private peekNth(n: number): Token | null {
		let p = this.pos;
		// Skip leading insignificant trivia first (same as peek())
		if (this.bracketDepth > 0) {
			while (p < this.tokens.length && isTrivia(this.tokens[p].kind)) p++;
		}
		let skipped = 0;
		while (p < this.tokens.length && skipped < n) {
			p++;
			if (this.bracketDepth > 0) {
				while (p < this.tokens.length && isTrivia(this.tokens[p].kind)) p++;
			}
			skipped++;
		}
		return this.tokens[p] || null;
	}

	private advance(): Token {
		this.skipInsignificantNewlines();
		const tok = this.tokens[this.pos];
		if (tok && tok.kind !== "Eof") this.pos++;
		return tok || { kind: "Eof" as const, span: { file: this.file, line: 0, col: 0, len: 0 } };
	}

	private check(kind: TokenKind): boolean {
		return this.peek().kind === kind;
	}

	private eat(kind: TokenKind): boolean {
		if (this.check(kind)) {
			this.advance();
			return true;
		}
		return false;
	}

	private expect(kind: TokenKind): Token {
		const tok = this.peek();
		if (tok.kind === kind) {
			return this.advance();
		}
		if (kind === "Newline" && tok.kind === "Eof") {
			// EOF counts as newline for statement terminators
			return tok;
		}
		const code: DiagnosticCode = kind === "RParen" || kind === "RBracket" || kind === "RBrace" ? "E0102" : "E0101";
		this.error(code, `expected \`${kind}\`, got \`${tok.kind}\``, tok.span);
		return tok;
	}

	private expectIdent(): string {
		const tok = this.peek();
		if (tok.kind === "Ident") {
			this.advance();
			return tok.value!;
		}
		this.error("E0101", `expected identifier, got \`${tok.kind}\``, tok.span);
		return "<error>";
	}

	/** Accept an identifier OR a keyword (for field access positions like `http.post`). */
	private expectIdentOrKeyword(): string {
		const tok = this.peek();
		if (tok.kind === "Ident") {
			this.advance();
			return tok.value!;
		}
		// Accept keywords as field names
		if (isKeywordKind(tok.kind)) {
			this.advance();
			return tok.kind; // keyword kind is its string value
		}
		this.error("E0101", `expected identifier, got \`${tok.kind}\``, tok.span);
		return "<error>";
	}

	private expectNewline(): void {
		if (this.bracketDepth > 0) return; // Newlines are insignificant inside brackets
		const tok = this.tokens[this.pos];
		if (!tok || tok.kind === "Eof" || tok.kind === "RBrace") return;
		if (isTrivia(tok.kind)) {
			this.pos++;
			return;
		}
		// Check if previous token was trivia (already consumed by skipNewlines)
		if (this.pos > 0 && isTrivia(this.tokens[this.pos - 1]?.kind)) return;
		this.error("E0101", `expected newline, got \`${tok.kind}\``, tok.span);
	}

	private skipNewlines(): void {
		while (this.pos < this.tokens.length && isTrivia(this.tokens[this.pos].kind)) {
			this.pos++;
		}
	}

	private skipInsignificantNewlines(): void {
		if (this.bracketDepth > 0) {
			while (this.pos < this.tokens.length && isTrivia(this.tokens[this.pos].kind)) {
				this.pos++;
			}
		}
	}

	private atEnd(): boolean {
		return this.peek().kind === "Eof";
	}

	// --- Error handling ---

	private error(code: DiagnosticCode, message: string, span: Span): void {
		this.diagnostics.push({
			code,
			severity: DIAGNOSTIC_REGISTRY[code].defaultSeverity,
			message,
			span,
			docs: DIAGNOSTIC_REGISTRY[code].docs,
		});
	}

	private synchronize(): void {
		while (!this.atEnd()) {
			const tok = this.tokens[this.pos];
			if (!tok) return;
			if (tok.kind === "Newline" || tok.kind === "RBrace") {
				this.pos++;
				return;
			}
			if (tok.kind === "fn" || tok.kind === "type" || tok.kind === "extern" || tok.kind === "pub" || tok.kind === "import") {
				return; // Don't consume — let the caller handle
			}
			this.pos++;
		}
	}

	// --- Span helpers ---

	private currentSpan(): Span {
		const tok = this.tokens[this.pos];
		if (tok) return tok.span;
		return { file: this.file, line: 1, col: 1, len: 0 };
	}

	private spanFrom(start: Span): Span {
		const end = this.tokens[this.pos - 1]?.span || start;
		// For single-line spans, compute precise length; for multi-line, use start token length
		if (end.line === start.line) {
			const len = (end.col + end.len) - start.col;
			return { file: this.file, line: start.line, col: start.col, len: Math.max(len, 1) };
		}
		// Multi-line: len covers only the first line portion (col to EOL is unknowable without source)
		// Use a sentinel len of the start token for multi-line constructs
		return { file: this.file, line: start.line, col: start.col, len: start.len || 1 };
	}

	private allocDummyExpr(): NodeId {
		return this.arena.alloc({ kind: "Ident", span: this.currentSpan(), name: "<error>" });
	}
}
