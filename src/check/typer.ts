// Type checker scaffold — walks the resolved AST and produces a type map.
// v0 scope: literals, identifiers, let bindings, return type checking.
// Unhandled expression kinds return ERROR_TYPE (no cascading).

import { DIAGNOSTIC_REGISTRY } from "../diag/codes";
import type { Diagnostic, Span } from "../diag/types";
import type { AstNode } from "../parse/ast";
import type { Arena, NodeId } from "../util/arena";
import {
	type Type,
	type EffectRow,
	INT,
	FLOAT,
	STRING,
	BOOL,
	VOID,
	ERROR_TYPE,
	PURE,
	isError,
	typesEqual,
	printType,
} from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type TypeCheckResult = {
	typeMap: Map<NodeId, Type>;
	diagnostics: Diagnostic[];
};

export function typeCheck(
	root: NodeId,
	arena: Arena<AstNode>,
	resolutions: Map<NodeId, NodeId>,
): TypeCheckResult {
	const typer = new Typer(arena, resolutions);
	typer.checkFile(root);
	return {
		typeMap: typer.typeMap,
		diagnostics: typer.diagnostics,
	};
}

// ---------------------------------------------------------------------------
// Internal typer class
// ---------------------------------------------------------------------------

class Typer {
	readonly arena: Arena<AstNode>;
	readonly resolutions: Map<NodeId, NodeId>;
	readonly typeMap = new Map<NodeId, Type>();
	readonly diagnostics: Diagnostic[] = [];

	/** Type of the current function's declared return, used for ReturnStmt checking. */
	private currentReturnType: Type | null = null;

	constructor(arena: Arena<AstNode>, resolutions: Map<NodeId, NodeId>) {
		this.arena = arena;
		this.resolutions = resolutions;
	}

	// -------------------------------------------------------------------
	// File-level entry
	// -------------------------------------------------------------------

	checkFile(root: NodeId): void {
		const node = this.arena.get(root);
		if (node.kind !== "File") return;

		for (const declId of node.decls) {
			this.checkDecl(declId);
		}
	}

	// -------------------------------------------------------------------
	// Declaration checking
	// -------------------------------------------------------------------

	private checkDecl(declId: NodeId): void {
		const node = this.arena.get(declId);
		switch (node.kind) {
			case "FnDecl":
				this.checkFnDecl(declId, node);
				break;
			case "ExternBlock":
				// Extern declarations have no bodies to check
				break;
			default:
				// TypeDecl, Import, ModuleHeader, etc. — nothing to type-check in v0
				break;
		}
	}

	private checkFnDecl(declId: NodeId, node: Extract<AstNode, { kind: "FnDecl" }>): void {
		// Build local environment: param name → Type
		const env = new Map<string, Type>();

		for (const paramId of node.params) {
			const param = this.arena.get(paramId);
			if (param.kind === "Param") {
				const paramType = this.resolveTypeNode(param.type);
				this.typeMap.set(paramId, paramType);
				if (param.name !== "<error>") {
					env.set(param.name, paramType);
				}
			}
		}

		// Resolve declared return type
		const declaredReturn = node.returnType !== null ? this.resolveTypeNode(node.returnType) : VOID;

		// Store the fn type itself
		const paramTypes = node.params.map((pid) => this.typeMap.get(pid) ?? ERROR_TYPE);
		const effectRow = node.effectRow !== null ? this.resolveEffectRow(node.effectRow) : PURE;
		const fnType: Type = {
			kind: "fn",
			params: paramTypes,
			returnType: declaredReturn,
			effectRow,
		};
		this.typeMap.set(declId, fnType);

		// Check body
		if (node.body !== null) {
			const prevReturn = this.currentReturnType;
			this.currentReturnType = declaredReturn;

			const bodyType = this.checkNode(node.body, env);

			// Compare body type against declared return
			if (!isError(bodyType) && !isError(declaredReturn) && !typesEqual(bodyType, declaredReturn)) {
				const bodyNode = this.arena.get(node.body);
				this.emitTypeMismatch(declaredReturn, bodyType, bodyNode.span);
			}

			this.currentReturnType = prevReturn;
		}
	}

	// -------------------------------------------------------------------
	// Node checking (statements + expressions)
	// -------------------------------------------------------------------

	private checkNode(nodeId: NodeId, env: Map<string, Type>): Type {
		const node = this.arena.get(nodeId);
		let ty: Type;

		switch (node.kind) {
			case "Block":
				ty = this.checkBlock(node, env);
				break;
			case "LetStmt":
				ty = this.checkLetStmt(node, env);
				break;
			case "ReturnStmt":
				ty = this.checkReturnStmt(node, env);
				break;
			case "ExprStmt":
				ty = this.checkExpr(node.expr, env);
				break;
			default:
				// Treat as expression
				ty = this.checkExpr(nodeId, env);
				break;
		}

		this.typeMap.set(nodeId, ty);
		return ty;
	}

	private checkBlock(node: Extract<AstNode, { kind: "Block" }>, parentEnv: Map<string, Type>): Type {
		// Block gets its own env (let bindings are scoped)
		const blockEnv = new Map(parentEnv);

		if (node.stmts.length === 0) return VOID;

		let lastType: Type = VOID;
		for (const stmtId of node.stmts) {
			lastType = this.checkNode(stmtId, blockEnv);
		}

		return lastType;
	}

	private checkLetStmt(node: Extract<AstNode, { kind: "LetStmt" }>, env: Map<string, Type>): Type {
		const valueType = this.checkExpr(node.value, env);

		// Check annotation if present
		if (node.type !== null) {
			const annotationType = this.resolveTypeNode(node.type);
			if (
				!isError(valueType) &&
				!isError(annotationType) &&
				!typesEqual(valueType, annotationType)
			) {
				const valueNode = this.arena.get(node.value);
				this.emitTypeMismatch(annotationType, valueType, valueNode.span);
			}
			// Bind using the annotation type
			this.bindPattern(node.pattern, annotationType, env);
		} else {
			// Bind using the inferred type
			this.bindPattern(node.pattern, valueType, env);
		}

		return VOID;
	}

	private checkReturnStmt(
		node: Extract<AstNode, { kind: "ReturnStmt" }>,
		env: Map<string, Type>,
	): Type {
		const valueType = node.value !== null ? this.checkExpr(node.value, env) : VOID;

		if (this.currentReturnType !== null) {
			if (
				!isError(valueType) &&
				!isError(this.currentReturnType) &&
				!typesEqual(valueType, this.currentReturnType)
			) {
				const span =
					node.value !== null ? this.arena.get(node.value).span : node.span;
				this.emitTypeMismatch(this.currentReturnType, valueType, span);
			}
		}

		return valueType;
	}

	// -------------------------------------------------------------------
	// Expression checking
	// -------------------------------------------------------------------

	private checkExpr(nodeId: NodeId, env: Map<string, Type>): Type {
		const node = this.arena.get(nodeId);
		let ty: Type;

		switch (node.kind) {
			case "IntLit":
				ty = INT;
				break;
			case "FloatLit":
				ty = FLOAT;
				break;
			case "StringLit":
				ty = STRING;
				break;
			case "BoolLit":
				ty = BOOL;
				break;
			case "VoidLit":
				ty = VOID;
				break;
			case "Ident":
				ty = this.checkIdent(nodeId, node, env);
				break;
			case "CallExpr":
				ty = this.checkCall(nodeId, node, env);
				break;
			case "Block":
				ty = this.checkBlock(node, env);
				break;
			case "BlockExpr":
				ty = this.checkNode(node.block, env);
				break;
			default:
				// Unhandled expression kinds — return ERROR_TYPE (no cascading)
				ty = ERROR_TYPE;
				break;
		}

		this.typeMap.set(nodeId, ty);
		return ty;
	}

	private checkIdent(
		nodeId: NodeId,
		node: Extract<AstNode, { kind: "Ident" }>,
		env: Map<string, Type>,
	): Type {
		// Check local environment first (params, let bindings)
		const localType = env.get(node.name);
		if (localType !== undefined) return localType;

		// Fall back to resolution map — look up declaration and get its type
		const declId = this.resolutions.get(nodeId);
		if (declId !== undefined) {
			return this.typeOfDecl(declId);
		}

		// Unresolved — already reported by resolver, propagate error
		return ERROR_TYPE;
	}

	private checkCall(
		_nodeId: NodeId,
		node: Extract<AstNode, { kind: "CallExpr" }>,
		env: Map<string, Type>,
	): Type {
		const calleeType = this.checkExpr(node.callee, env);

		// If callee is error, propagate without cascading
		if (isError(calleeType)) return ERROR_TYPE;

		// Callee must be a function type
		if (calleeType.kind !== "fn") {
			this.diagnostics.push({
				code: "E0401",
				severity: "error",
				message: `type mismatch: expected a function, found \`${printType(calleeType)}\``,
				span: node.span,
				docs: DIAGNOSTIC_REGISTRY.E0401.docs,
			});
			return ERROR_TYPE;
		}

		// Check argument count
		if (node.args.length !== calleeType.params.length) {
			this.diagnostics.push({
				code: "E0401",
				severity: "error",
				message: `argument count mismatch: expected ${calleeType.params.length} argument(s), found ${node.args.length}`,
				span: node.span,
				docs: DIAGNOSTIC_REGISTRY.E0401.docs,
			});
			return ERROR_TYPE;
		}

		// Check each argument type
		for (let i = 0; i < node.args.length; i++) {
			const argType = this.checkExpr(node.args[i], env);
			const paramType = calleeType.params[i];
			if (!isError(argType) && !isError(paramType) && !typesEqual(argType, paramType)) {
				const argNode = this.arena.get(node.args[i]);
				this.diagnostics.push({
					code: "E0401",
					severity: "error",
					message: `argument type mismatch: expected \`${printType(paramType)}\`, found \`${printType(argType)}\``,
					span: argNode.span,
					docs: DIAGNOSTIC_REGISTRY.E0401.docs,
				});
			}
		}

		return calleeType.returnType;
	}

	// -------------------------------------------------------------------
	// Type of a declaration
	// -------------------------------------------------------------------

	private typeOfDecl(declId: NodeId): Type {
		// Check if we already computed it
		const cached = this.typeMap.get(declId);
		if (cached !== undefined) return cached;

		// Sentinel for built-in types (-1 as NodeId)
		if ((declId as number) === -1) return ERROR_TYPE;

		const node = this.arena.get(declId);
		switch (node.kind) {
			case "FnDecl": {
				const paramTypes = node.params.map((pid) => {
					const p = this.arena.get(pid);
					if (p.kind === "Param") return this.resolveTypeNode(p.type);
					return ERROR_TYPE;
				});
				const retType = node.returnType !== null ? this.resolveTypeNode(node.returnType) : VOID;
				const eff = node.effectRow !== null ? this.resolveEffectRow(node.effectRow) : PURE;
				const fnType: Type = { kind: "fn", params: paramTypes, returnType: retType, effectRow: eff };
				this.typeMap.set(declId, fnType);
				return fnType;
			}
			case "ExternFnDecl": {
				const paramTypes = node.params.map((pid) => {
					const p = this.arena.get(pid);
					if (p.kind === "Param") return this.resolveTypeNode(p.type);
					return ERROR_TYPE;
				});
				const retType = node.returnType !== null ? this.resolveTypeNode(node.returnType) : VOID;
				const eff = node.effectRow !== null ? this.resolveEffectRow(node.effectRow) : PURE;
				const fnType: Type = { kind: "fn", params: paramTypes, returnType: retType, effectRow: eff };
				this.typeMap.set(declId, fnType);
				return fnType;
			}
			case "Param": {
				const paramType = this.resolveTypeNode(node.type);
				this.typeMap.set(declId, paramType);
				return paramType;
			}
			default:
				return ERROR_TYPE;
		}
	}

	// -------------------------------------------------------------------
	// AST type node → runtime Type
	// -------------------------------------------------------------------

	resolveTypeNode(typeId: NodeId): Type {
		const node = this.arena.get(typeId);
		switch (node.kind) {
			case "NominalType": {
				const name = node.segments.join(".");
				// Primitive type shortcuts
				switch (name) {
					case "Int":
						return INT;
					case "Float":
						return FLOAT;
					case "String":
						return STRING;
					case "Bool":
						return BOOL;
				}
				// Non-primitive nominal type
				const typeArgs = node.typeArgs.map((a) => this.resolveTypeNode(a));
				// Try to find the declaration via resolutions
				const declNode = this.resolutions.get(typeId) ?? (-1 as NodeId);
				return { kind: "nominal", name, declNode, typeArgs };
			}
			case "RecordType": {
				const fields = new Map<string, Type>();
				for (const fieldId of node.fields) {
					const field = this.arena.get(fieldId);
					if (field.kind === "Field") {
						fields.set(field.name, this.resolveTypeNode(field.type));
					}
				}
				return { kind: "record", fields };
			}
			case "TupleType": {
				const elements = node.elements.map((e) => this.resolveTypeNode(e));
				return { kind: "tuple", elements };
			}
			case "FnType": {
				const params = node.params.map((p) => this.resolveTypeNode(p));
				const returnType = this.resolveTypeNode(node.returnType);
				const effectRow = node.effectRow !== null ? this.resolveEffectRow(node.effectRow) : PURE;
				return { kind: "fn", params, returnType, effectRow };
			}
			case "VoidType":
				return VOID;
			case "RefinedType":
				// v0: just use the base type
				return this.resolveTypeNode(node.base);
			default:
				return ERROR_TYPE;
		}
	}

	// -------------------------------------------------------------------
	// AST effect row node → runtime EffectRow
	// -------------------------------------------------------------------

	resolveEffectRow(rowId: NodeId): EffectRow {
		const node = this.arena.get(rowId);
		if (node.kind !== "EffectRow") return PURE;

		const effects = node.effects.map((eid) => {
			const e = this.arena.get(eid);
			if (e.kind === "EffectName") {
				return { name: e.segments.join("."), fromExtern: false };
			}
			return { name: "<unknown>", fromExtern: false };
		});

		if (effects.length === 0 && node.tail === null) return PURE;

		if (node.tail !== null) {
			const tailNode = this.arena.get(node.tail);
			const tailName = tailNode.kind === "Ident" ? tailNode.name : "<unknown>";
			return {
				kind: "open",
				effects,
				tail: { name: tailName, id: 0 },
			};
		}

		return { kind: "closed", effects };
	}

	// -------------------------------------------------------------------
	// Pattern binding
	// -------------------------------------------------------------------

	private bindPattern(patId: NodeId, type: Type, env: Map<string, Type>): void {
		const pat = this.arena.get(patId);
		switch (pat.kind) {
			case "BindingPat":
				if (pat.name !== "<error>") {
					env.set(pat.name, type);
				}
				break;
			case "WildcardPat":
				// Nothing to bind
				break;
			default:
				break;
		}
	}

	// -------------------------------------------------------------------
	// Diagnostics
	// -------------------------------------------------------------------

	private emitTypeMismatch(expected: Type, actual: Type, span: Span): void {
		this.diagnostics.push({
			code: "E0401",
			severity: "error",
			message: `type mismatch: expected \`${printType(expected)}\`, found \`${printType(actual)}\``,
			span,
			docs: DIAGNOSTIC_REGISTRY.E0401.docs,
		});
	}
}
