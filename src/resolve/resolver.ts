// Two-pass name resolver.
// Pass 1: collect top-level declarations into module scope.
// Pass 2: resolve identifiers in bodies, emit diagnostics for unknowns/duplicates/unused.

import type { NodeId, Arena } from "../util/arena";
import type { AstNode } from "../parse/ast";
import type { Diagnostic, Span } from "../diag/types";
import { Scope, type Symbol, type SymbolKind } from "./scope";
import { suggestNames } from "../util/levenshtein";
import { DIAGNOSTIC_REGISTRY } from "../diag/codes";

export type ResolveResult = {
	resolutions: Map<NodeId, NodeId>; // IdentNode → declaration NodeId
	diagnostics: Diagnostic[];
};

export function resolve(root: NodeId, arena: Arena<AstNode>): ResolveResult {
	const resolver = new Resolver(arena);
	resolver.run(root);
	return {
		resolutions: resolver.resolutions,
		diagnostics: resolver.diagnostics,
	};
}

// ---------------------------------------------------------------------------
// Internal resolver class
// ---------------------------------------------------------------------------

class Resolver {
	readonly arena: Arena<AstNode>;
	readonly resolutions = new Map<NodeId, NodeId>();
	readonly diagnostics: Diagnostic[] = [];

	// Track import usage for E0203
	private importUsage = new Map<string, { used: boolean; span: Span; nodeId: NodeId }>();
	// Whether the file has glob imports (skip E0203 entirely in that case)
	private hasGlobImport = false;

	constructor(arena: Arena<AstNode>) {
		this.arena = arena;
	}

	run(root: NodeId): void {
		const fileNode = this.arena.get(root);
		if (fileNode.kind !== "File") return;

		// Create module scope
		const moduleScope = new Scope(null);

		// Pass 1: collect declarations
		for (const declId of fileNode.decls) {
			this.collectDecl(declId, moduleScope);
		}

		// Pass 2: resolve bodies
		for (const declId of fileNode.decls) {
			this.resolveDecl(declId, moduleScope);
		}

		// Emit E0203 for unused imports (skip if glob imports exist)
		if (!this.hasGlobImport) {
			for (const [name, info] of this.importUsage) {
				if (!info.used) {
					this.diagnostics.push({
						code: "E0203",
						severity: "warning",
						message: `unused import \`${name}\``,
						span: info.span,
						suggest: [
							{
								kind: "delete-span",
								rationale: "remove the unused import",
								span: info.span,
							},
						],
						docs: DIAGNOSTIC_REGISTRY.E0203.docs,
					});
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Pass 1: Declaration collection
	// -----------------------------------------------------------------------

	private collectDecl(declId: NodeId, scope: Scope): void {
		const node = this.arena.get(declId);
		switch (node.kind) {
			case "FnDecl":
				this.defineInScope(scope, node.name, "fn", declId, node.span);
				break;

			case "TypeDecl": {
				this.defineInScope(scope, node.name, "type", declId, node.span);
				// Hoist variant constructors from SumType
				const valueNode = this.arena.get(node.value);
				if (valueNode.kind === "SumType") {
					for (const variantId of valueNode.variants) {
						const variant = this.arena.get(variantId);
						if (variant.kind === "Variant") {
							this.defineInScope(scope, variant.name, "variant", variantId, variant.span);
						}
					}
				}
				break;
			}

			case "ExternBlock":
				for (const externDeclId of node.decls) {
					const externDecl = this.arena.get(externDeclId);
					if (externDecl.kind === "ExternFnDecl") {
						this.defineInScope(scope, externDecl.name, "extern-fn", externDeclId, externDecl.span);
					} else if (externDecl.kind === "ExternTypeDecl") {
						this.defineInScope(scope, externDecl.name, "extern-type", externDeclId, externDecl.span);
					}
				}
				break;

			case "Import":
				if (node.names === null) {
					this.hasGlobImport = true;
				} else {
					for (const name of node.names) {
						if (name === "<error>") continue;
						this.defineInScope(scope, name, "import", declId, node.span);
						this.importUsage.set(name, { used: false, span: node.span, nodeId: declId });
					}
				}
				break;

			default:
				// Other node kinds at top level (e.g. ModuleHeader) are not declarations
				break;
		}
	}

	private defineInScope(
		scope: Scope,
		name: string,
		kind: SymbolKind,
		declNode: NodeId,
		span: Span,
	): void {
		if (name === "<error>") return;

		const sym: Symbol = { name, kind, declNode, span };
		const prev = scope.define(sym);
		if (prev !== null) {
			this.diagnostics.push({
				code: "E0202",
				severity: "error",
				message: `duplicate definition of \`${name}\``,
				span,
				related: [{ span: prev.span, message: "previous definition here" }],
				docs: DIAGNOSTIC_REGISTRY.E0202.docs,
			});
		}
	}

	// -----------------------------------------------------------------------
	// Pass 2: Body resolution
	// -----------------------------------------------------------------------

	private resolveDecl(declId: NodeId, moduleScope: Scope): void {
		const node = this.arena.get(declId);
		switch (node.kind) {
			case "FnDecl":
				this.resolveFnDecl(node, moduleScope);
				break;
			case "TypeDecl":
				this.resolveTypeDecl(node, moduleScope);
				break;
			default:
				// ExternBlock, Import, etc. don't have bodies to resolve
				break;
		}
	}

	private resolveFnDecl(
		node: Extract<AstNode, { kind: "FnDecl" }>,
		parentScope: Scope,
	): void {
		const fnScope = new Scope(parentScope);

		// Register type params
		if (node.typeParams !== null) {
			const tpNode = this.arena.get(node.typeParams);
			if (tpNode.kind === "TypeParams") {
				for (const name of tpNode.names) {
					if (name === "<error>") continue;
					fnScope.define({
						name,
						kind: "type-param",
						declNode: node.typeParams,
						span: tpNode.span,
					});
				}
			}
		}

		// Register params
		for (const paramId of node.params) {
			const paramNode = this.arena.get(paramId);
			if (paramNode.kind === "Param") {
				if (paramNode.name !== "<error>") {
					fnScope.define({
						name: paramNode.name,
						kind: "param",
						declNode: paramId,
						span: paramNode.span,
					});
				}
				// Resolve param type
				this.resolveType(paramNode.type, fnScope);
			}
		}

		// Resolve return type
		if (node.returnType !== null) {
			this.resolveType(node.returnType, fnScope);
		}

		// Resolve contract expressions
		for (const contractId of node.contracts) {
			const contract = this.arena.get(contractId);
			if (contract.kind === "ContractPre") {
				this.resolveExpr(contract.expr, fnScope);
			} else if (contract.kind === "ContractPost") {
				this.resolveExpr(contract.expr, fnScope);
			}
			// ContractCost fields are structural (CostValue), skip
		}

		// Resolve body
		if (node.body !== null) {
			this.resolveNode(node.body, fnScope);
		}
	}

	private resolveTypeDecl(
		node: Extract<AstNode, { kind: "TypeDecl" }>,
		parentScope: Scope,
	): void {
		const typeScope = new Scope(parentScope);

		// Register type params
		if (node.typeParams !== null) {
			const tpNode = this.arena.get(node.typeParams);
			if (tpNode.kind === "TypeParams") {
				for (const name of tpNode.names) {
					if (name === "<error>") continue;
					typeScope.define({
						name,
						kind: "type-param",
						declNode: node.typeParams,
						span: tpNode.span,
					});
				}
			}
		}

		// Resolve the type value
		this.resolveType(node.value, typeScope);
	}

	// -----------------------------------------------------------------------
	// Node resolution (dispatches by kind)
	// -----------------------------------------------------------------------

	private resolveNode(nodeId: NodeId, scope: Scope): void {
		const node = this.arena.get(nodeId);
		switch (node.kind) {
			case "Block":
				this.resolveBlock(node, scope);
				break;
			case "BlockExpr":
				this.resolveNode(node.block, scope);
				break;
			case "LetStmt":
				this.resolveLetStmt(node, nodeId, scope);
				break;
			case "ReturnStmt":
				if (node.value !== null) this.resolveExpr(node.value, scope);
				break;
			case "ExprStmt":
				this.resolveExpr(node.expr, scope);
				break;
			default:
				// Treat as expression
				this.resolveExpr(nodeId, scope);
				break;
		}
	}

	private resolveBlock(
		node: Extract<AstNode, { kind: "Block" }>,
		parentScope: Scope,
	): void {
		const blockScope = new Scope(parentScope);
		for (const stmtId of node.stmts) {
			const stmt = this.arena.get(stmtId);
			if (stmt.kind === "LetStmt") {
				this.resolveLetStmt(stmt, stmtId, blockScope);
			} else if (stmt.kind === "ReturnStmt") {
				if (stmt.value !== null) this.resolveExpr(stmt.value, blockScope);
			} else if (stmt.kind === "ExprStmt") {
				this.resolveExpr(stmt.expr, blockScope);
			} else {
				// Expression in tail position
				this.resolveExpr(stmtId, blockScope);
			}
		}
	}

	private resolveLetStmt(
		node: Extract<AstNode, { kind: "LetStmt" }>,
		_nodeId: NodeId,
		scope: Scope,
	): void {
		// Resolve RHS first (before the binding enters scope)
		this.resolveExpr(node.value, scope);

		// Resolve type annotation
		if (node.type !== null) {
			this.resolveType(node.type, scope);
		}

		// Define pattern bindings
		this.definePattern(node.pattern, scope);
	}

	// -----------------------------------------------------------------------
	// Expression resolution
	// -----------------------------------------------------------------------

	private resolveExpr(nodeId: NodeId, scope: Scope): void {
		const node = this.arena.get(nodeId);
		switch (node.kind) {
			case "Ident":
				this.resolveIdent(node, nodeId, scope);
				break;
			case "BinaryExpr":
				this.resolveExpr(node.left, scope);
				this.resolveExpr(node.right, scope);
				break;
			case "UnaryExpr":
				this.resolveExpr(node.operand, scope);
				break;
			case "CallExpr":
				this.resolveExpr(node.callee, scope);
				for (const argId of node.args) {
					this.resolveExpr(argId, scope);
				}
				break;
			case "FieldAccess":
				// Resolve object, but field is structural — not resolved
				this.resolveExpr(node.object, scope);
				break;
			case "IndexExpr":
				this.resolveExpr(node.object, scope);
				this.resolveExpr(node.index, scope);
				break;
			case "TryExpr":
				this.resolveExpr(node.expr, scope);
				break;
			case "TurbofishExpr":
				this.resolveExpr(node.expr, scope);
				this.resolveType(node.typeArg, scope);
				break;
			case "IfExpr":
				this.resolveExpr(node.condition, scope);
				this.resolveNode(node.then, scope);
				if (node.else_ !== null) this.resolveNode(node.else_, scope);
				break;
			case "MatchExpr":
				this.resolveExpr(node.scrutinee, scope);
				for (const armId of node.arms) {
					this.resolveMatchArm(armId, scope);
				}
				break;
			case "TupleExpr":
				for (const elemId of node.elements) {
					this.resolveExpr(elemId, scope);
				}
				break;
			case "RecordExpr":
				// name is structural (constructor name), resolve fields
				if (node.name !== null) {
					// Resolve the constructor name as an ident-like reference
					// RecordExpr.name is a string, not a NodeId, so we can't record resolution
				}
				for (const fieldId of node.fields) {
					const field = this.arena.get(fieldId);
					if (field.kind === "RecordInit") {
						// RecordInit.name is structural; resolve value
						if (field.value !== null) {
							this.resolveExpr(field.value, scope);
						} else {
							// Shorthand { x } — resolve x as an ident
							// The name itself is used as an identifier
							const sym = scope.lookup(field.name);
							if (sym !== null) {
								this.markImportUsed(field.name);
								this.resolutions.set(fieldId, sym.declNode);
							} else if (field.name !== "<error>") {
								this.emitUnknownIdent(field.name, field.span, scope);
							}
						}
					} else {
						this.resolveExpr(fieldId, scope);
					}
				}
				break;
			case "RecordInit":
				// When encountered outside RecordExpr (shouldn't happen normally)
				if (node.value !== null) {
					this.resolveExpr(node.value, scope);
				}
				break;
			case "ListExpr":
				for (const elemId of node.elements) {
					this.resolveExpr(elemId, scope);
				}
				break;
			case "NamedArg":
				// name is structural; resolve value
				this.resolveExpr(node.value, scope);
				break;
			case "BlockExpr":
				this.resolveNode(node.block, scope);
				break;
			case "RangeExpr":
				this.resolveExpr(node.start, scope);
				this.resolveExpr(node.end, scope);
				break;
			case "Block":
				this.resolveBlock(node, scope);
				break;

			// Literals — nothing to resolve
			case "IntLit":
			case "FloatLit":
			case "StringLit":
			case "BoolLit":
			case "VoidLit":
				break;

			// Type/declaration nodes that shouldn't appear in expression position
			// but we handle gracefully
			case "LetStmt":
			case "ReturnStmt":
			case "ExprStmt":
				// Shouldn't be reached via resolveExpr, but handle
				this.resolveNode(nodeId, scope);
				break;

			default:
				// Skip other node kinds in expression position
				break;
		}
	}

	private resolveIdent(
		node: Extract<AstNode, { kind: "Ident" }>,
		nodeId: NodeId,
		scope: Scope,
	): void {
		if (node.name === "<error>") return;

		const sym = scope.lookup(node.name);
		if (sym !== null) {
			this.resolutions.set(nodeId, sym.declNode);
			this.markImportUsed(node.name);
		} else {
			this.emitUnknownIdent(node.name, node.span, scope);
		}
	}

	// -----------------------------------------------------------------------
	// Match arm resolution
	// -----------------------------------------------------------------------

	private resolveMatchArm(armId: NodeId, parentScope: Scope): void {
		const arm = this.arena.get(armId);
		if (arm.kind !== "MatchArm") return;

		const armScope = new Scope(parentScope);

		// Define pattern bindings and resolve ctor references
		this.resolvePattern(arm.pattern, armScope);

		// Resolve guard
		if (arm.guard !== null) {
			this.resolveExpr(arm.guard, armScope);
		}

		// Resolve body
		this.resolveNode(arm.body, armScope);
	}

	// -----------------------------------------------------------------------
	// Pattern handling
	// -----------------------------------------------------------------------

	/** Define bindings introduced by a pattern (for let stmts). */
	private definePattern(patId: NodeId, scope: Scope): void {
		const pat = this.arena.get(patId);
		switch (pat.kind) {
			case "BindingPat":
				if (pat.name !== "<error>") {
					scope.define({
						name: pat.name,
						kind: "let",
						declNode: patId,
						span: pat.span,
					});
				}
				break;
			case "CtorPat":
				// CtorPat.name is a constructor reference — don't define it
				for (const argId of pat.args) {
					this.definePattern(argId, scope);
				}
				break;
			case "TuplePat":
				for (const elemId of pat.elements) {
					this.definePattern(elemId, scope);
				}
				break;
			case "RecordPat":
				for (const fieldId of pat.fields) {
					const field = this.arena.get(fieldId);
					if (field.kind === "RecordPatField") {
						if (field.pattern !== null) {
							this.definePattern(field.pattern, scope);
						} else {
							// Shorthand { x } — x is a binding
							if (field.name !== "<error>") {
								scope.define({
									name: field.name,
									kind: "let",
									declNode: fieldId,
									span: field.span,
								});
							}
						}
					}
				}
				break;
			case "WildcardPat":
			case "LiteralPat":
				break;
			default:
				break;
		}
	}

	/** Resolve constructor references and define bindings in a pattern (for match arms). */
	private resolvePattern(patId: NodeId, scope: Scope): void {
		const pat = this.arena.get(patId);
		switch (pat.kind) {
			case "BindingPat":
				if (pat.name !== "<error>") {
					scope.define({
						name: pat.name,
						kind: "let",
						declNode: patId,
						span: pat.span,
					});
				}
				break;
			case "CtorPat":
				// Resolve constructor name
				if (pat.name !== "<error>") {
					const sym = scope.lookup(pat.name);
					if (sym !== null) {
						this.resolutions.set(patId, sym.declNode);
						this.markImportUsed(pat.name);
					} else {
						this.emitUnknownIdent(pat.name, pat.span, scope);
					}
				}
				// Resolve sub-patterns
				for (const argId of pat.args) {
					this.resolvePattern(argId, scope);
				}
				break;
			case "TuplePat":
				for (const elemId of pat.elements) {
					this.resolvePattern(elemId, scope);
				}
				break;
			case "RecordPat":
				for (const fieldId of pat.fields) {
					const field = this.arena.get(fieldId);
					if (field.kind === "RecordPatField") {
						if (field.pattern !== null) {
							this.resolvePattern(field.pattern, scope);
						} else {
							// Shorthand { x } — x is a binding
							if (field.name !== "<error>") {
								scope.define({
									name: field.name,
									kind: "let",
									declNode: fieldId,
									span: field.span,
								});
							}
						}
					}
				}
				break;
			case "WildcardPat":
			case "LiteralPat":
				break;
			default:
				break;
		}
	}

	// -----------------------------------------------------------------------
	// Type resolution
	// -----------------------------------------------------------------------

	private resolveType(typeId: NodeId, scope: Scope): void {
		const node = this.arena.get(typeId);
		switch (node.kind) {
			case "NominalType":
				// Only resolve single-segment types (multi-segment = cross-module, deferred)
				if (node.segments.length === 1) {
					const name = node.segments[0];
					if (name !== "<error>") {
						const sym = scope.lookup(name);
						if (sym !== null) {
							this.resolutions.set(typeId, sym.declNode);
							this.markImportUsed(name);
						} else {
							this.emitUnknownIdent(name, node.span, scope);
						}
					}
				}
				// Resolve type arguments
				for (const argId of node.typeArgs) {
					this.resolveType(argId, scope);
				}
				break;
			case "RecordType":
				for (const fieldId of node.fields) {
					const field = this.arena.get(fieldId);
					if (field.kind === "Field") {
						this.resolveType(field.type, scope);
					}
				}
				break;
			case "TupleType":
				for (const elemId of node.elements) {
					this.resolveType(elemId, scope);
				}
				break;
			case "FnType":
				for (const paramId of node.params) {
					this.resolveType(paramId, scope);
				}
				this.resolveType(node.returnType, scope);
				break;
			case "RefinedType":
				this.resolveType(node.base, scope);
				this.resolveExpr(node.predicate, scope);
				break;
			case "SumType":
				for (const variantId of node.variants) {
					const variant = this.arena.get(variantId);
					if (variant.kind === "Variant") {
						for (const payloadId of variant.payload) {
							const payload = this.arena.get(payloadId);
							if (payload.kind === "Field") {
								this.resolveType(payload.type, scope);
							} else {
								// Positional payload — it's a type node
								this.resolveType(payloadId, scope);
							}
						}
					}
				}
				break;
			case "VoidType":
				break;
			default:
				break;
		}
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private markImportUsed(name: string): void {
		const info = this.importUsage.get(name);
		if (info !== undefined) {
			info.used = true;
		}
	}

	private emitUnknownIdent(name: string, span: Span, scope: Scope): void {
		const candidates = scope.allVisibleNames();
		const suggestions = suggestNames(name, candidates);

		this.diagnostics.push({
			code: "E0201",
			severity: "error",
			message: `unknown identifier \`${name}\``,
			span,
			suggest: suggestions.map((s) => ({
				kind: "rename" as const,
				rationale: `did you mean \`${s}\`?`,
				span,
				insert: s,
			})),
			docs: DIAGNOSTIC_REGISTRY.E0201.docs,
		});
	}
}
