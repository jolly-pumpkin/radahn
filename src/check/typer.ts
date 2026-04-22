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
	BUILTIN_DECL_NODE,
	PURE,
	isError,
	typesEqual,
	printType,
	freshTypeVar,
	substituteType,
	unify,
} from "./types";
import {
	type CheckPattern,
	checkExhaustiveness,
} from "./exhaustive";

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

		// If generic, create a type var map for resolving param/return types
		let typeVarMap: Map<string, Type> | null = null;
		if (node.typeParams !== null) {
			const tpNode = this.arena.get(node.typeParams);
			if (tpNode.kind === "TypeParams") {
				typeVarMap = new Map<string, Type>();
				for (const name of tpNode.names) {
					typeVarMap.set(name, freshTypeVar(name));
				}
			}
		}

		const resolveType = (typeId: NodeId): Type =>
			typeVarMap !== null
				? this.resolveTypeNodeWithVars(typeId, typeVarMap)
				: this.resolveTypeNode(typeId);

		for (const paramId of node.params) {
			const param = this.arena.get(paramId);
			if (param.kind === "Param") {
				const paramType = resolveType(param.type);
				this.typeMap.set(paramId, paramType);
				if (param.name !== "<error>") {
					env.set(param.name, paramType);
				}
			}
		}

		// Resolve declared return type
		const declaredReturn = node.returnType !== null ? resolveType(node.returnType) : VOID;

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
			if (!isError(bodyType) && !isError(declaredReturn)) {
				if (typeVarMap !== null) {
					// For generic functions, use unification instead of strict equality
					const subst = new Map<number, Type>();
					if (!unify(declaredReturn, bodyType, subst)) {
						const bodyNode = this.arena.get(node.body);
						this.emitTypeMismatch(declaredReturn, bodyType, bodyNode.span);
					}
				} else if (!typesEqual(bodyType, declaredReturn)) {
					const bodyNode = this.arena.get(node.body);
					this.emitTypeMismatch(declaredReturn, bodyType, bodyNode.span);
				}
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
			case "BinaryExpr":
				ty = this.checkBinaryExpr(nodeId, node, env);
				break;
			case "UnaryExpr":
				ty = this.checkUnaryExpr(node, env);
				break;
			case "IfExpr":
				ty = this.checkIf(nodeId, node, env);
				break;
			case "MatchExpr":
				ty = this.checkMatch(nodeId, node, env);
				break;
			case "FieldAccess":
				ty = this.checkFieldAccess(node, env);
				break;
			case "RecordExpr":
				ty = this.checkRecordExpr(node, env);
				break;
			case "TupleExpr":
				ty = this.checkTupleExpr(node, env);
				break;
			case "ListExpr":
				ty = this.checkListExpr(node, env);
				break;
			case "TryExpr":
				ty = this.checkTryExpr(node, env);
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
		// Check if callee is a generic function before evaluating normally
		const calleeNode = this.arena.get(node.callee);
		if (calleeNode.kind === "Ident") {
			const declId = this.resolutions.get(node.callee);
			if (declId !== undefined && (declId as number) !== -1) {
				const declNode = this.arena.get(declId);
				if (declNode.kind === "FnDecl" && declNode.typeParams !== null) {
					return this.checkGenericCall(node, declNode, env);
				}
			}
		}

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

	private checkGenericCall(
		node: Extract<AstNode, { kind: "CallExpr" }>,
		fnDecl: Extract<AstNode, { kind: "FnDecl" }>,
		env: Map<string, Type>,
	): Type {
		// Get type parameter names
		const typeParamsNode = this.arena.get(fnDecl.typeParams!);
		if (typeParamsNode.kind !== "TypeParams") return ERROR_TYPE;

		// Create fresh type variables for each type parameter
		const typeVarMap = new Map<string, Type>();
		for (const name of typeParamsNode.names) {
			typeVarMap.set(name, freshTypeVar(name));
		}

		// Resolve param types with type variables substituted
		const paramTypes: Type[] = [];
		for (const paramId of fnDecl.params) {
			const param = this.arena.get(paramId);
			if (param.kind === "Param") {
				paramTypes.push(this.resolveTypeNodeWithVars(param.type, typeVarMap));
			} else {
				paramTypes.push(ERROR_TYPE);
			}
		}

		// Resolve return type with type variables substituted
		const returnType = fnDecl.returnType !== null
			? this.resolveTypeNodeWithVars(fnDecl.returnType, typeVarMap)
			: VOID;

		// Check argument count
		if (node.args.length !== paramTypes.length) {
			this.diagnostics.push({
				code: "E0401",
				severity: "error",
				message: `argument count mismatch: expected ${paramTypes.length} argument(s), found ${node.args.length}`,
				span: node.span,
				docs: DIAGNOSTIC_REGISTRY.E0401.docs,
			});
			return ERROR_TYPE;
		}

		// Unify each argument type with the parameter type
		const subst = new Map<number, Type>();
		for (let i = 0; i < node.args.length; i++) {
			const argType = this.checkExpr(node.args[i], env);
			if (isError(argType) || isError(paramTypes[i])) continue;
			if (!unify(paramTypes[i], argType, subst)) {
				const argNode = this.arena.get(node.args[i]);
				const resolvedParam = substituteType(paramTypes[i], subst);
				this.diagnostics.push({
					code: "E0401",
					severity: "error",
					message: `argument type mismatch: expected \`${printType(resolvedParam)}\`, found \`${printType(argType)}\``,
					span: argNode.span,
					docs: DIAGNOSTIC_REGISTRY.E0401.docs,
				});
			}
		}

		return substituteType(returnType, subst);
	}

	private resolveTypeNodeWithVars(typeId: NodeId, typeVarMap: Map<string, Type>): Type {
		const node = this.arena.get(typeId);
		switch (node.kind) {
			case "NominalType": {
				// If it's a single-segment name matching a type param, return the type variable
				if (node.segments.length === 1 && node.typeArgs.length === 0) {
					const tv = typeVarMap.get(node.segments[0]);
					if (tv !== undefined) return tv;
				}
				const name = node.segments.join(".");
				// Primitive type shortcuts
				switch (name) {
					case "Int": return INT;
					case "Float": return FLOAT;
					case "String": return STRING;
					case "Bool": return BOOL;
				}
				// Non-primitive nominal type — resolve type args with vars too
				const typeArgs = node.typeArgs.map((a) => this.resolveTypeNodeWithVars(a, typeVarMap));
				const declNode = this.resolutions.get(typeId) ?? (-1 as NodeId);
				return { kind: "nominal", name, declNode, typeArgs };
			}
			case "RecordType": {
				const fields = new Map<string, Type>();
				for (const fieldId of node.fields) {
					const field = this.arena.get(fieldId);
					if (field.kind === "Field") {
						fields.set(field.name, this.resolveTypeNodeWithVars(field.type, typeVarMap));
					}
				}
				return { kind: "record", fields };
			}
			case "TupleType": {
				const elements = node.elements.map((e) => this.resolveTypeNodeWithVars(e, typeVarMap));
				return { kind: "tuple", elements };
			}
			case "FnType": {
				const params = node.params.map((p) => this.resolveTypeNodeWithVars(p, typeVarMap));
				const returnType = this.resolveTypeNodeWithVars(node.returnType, typeVarMap);
				const effectRow = node.effectRow !== null ? this.resolveEffectRow(node.effectRow) : PURE;
				return { kind: "fn", params, returnType, effectRow };
			}
			case "VoidType":
				return VOID;
			case "RefinedType":
				return this.resolveTypeNodeWithVars(node.base, typeVarMap);
			default:
				return ERROR_TYPE;
		}
	}

	// -------------------------------------------------------------------
	// Binary expressions
	// -------------------------------------------------------------------

	private checkBinaryExpr(
		_nodeId: NodeId,
		node: Extract<AstNode, { kind: "BinaryExpr" }>,
		env: Map<string, Type>,
	): Type {
		const leftType = this.checkExpr(node.left, env);
		const rightType = this.checkExpr(node.right, env);

		// Don't cascade errors
		if (isError(leftType) || isError(rightType)) return ERROR_TYPE;

		const op = node.op;

		// Arithmetic: +, -, *, /, % — both must be same numeric type
		if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
			const isNumeric = (t: Type) => t.kind === "int" || t.kind === "float";
			if (!isNumeric(leftType)) {
				this.emitTypeMismatch(INT, leftType, this.arena.get(node.left).span);
				return ERROR_TYPE;
			}
			if (!typesEqual(leftType, rightType)) {
				this.emitTypeMismatch(leftType, rightType, this.arena.get(node.right).span);
				return ERROR_TYPE;
			}
			return leftType;
		}

		// String concatenation: ++
		if (op === "++") {
			if (leftType.kind !== "string") {
				this.emitTypeMismatch(STRING, leftType, this.arena.get(node.left).span);
				return ERROR_TYPE;
			}
			if (rightType.kind !== "string") {
				this.emitTypeMismatch(STRING, rightType, this.arena.get(node.right).span);
				return ERROR_TYPE;
			}
			return STRING;
		}

		// Comparison: ==, !=, <, <=, >, >= — both must be same type, returns Bool
		if (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") {
			if (!typesEqual(leftType, rightType)) {
				this.emitTypeMismatch(leftType, rightType, this.arena.get(node.right).span);
				return ERROR_TYPE;
			}
			return BOOL;
		}

		// Logical: &&, || — both must be Bool
		if (op === "&&" || op === "||") {
			if (leftType.kind !== "bool") {
				this.emitTypeMismatch(BOOL, leftType, this.arena.get(node.left).span);
				return ERROR_TYPE;
			}
			if (rightType.kind !== "bool") {
				this.emitTypeMismatch(BOOL, rightType, this.arena.get(node.right).span);
				return ERROR_TYPE;
			}
			return BOOL;
		}

		return ERROR_TYPE;
	}

	// -------------------------------------------------------------------
	// Unary expressions
	// -------------------------------------------------------------------

	private checkUnaryExpr(
		node: Extract<AstNode, { kind: "UnaryExpr" }>,
		env: Map<string, Type>,
	): Type {
		const operandType = this.checkExpr(node.operand, env);
		if (isError(operandType)) return ERROR_TYPE;

		if (node.op === "-") {
			if (operandType.kind !== "int" && operandType.kind !== "float") {
				this.emitTypeMismatch(INT, operandType, this.arena.get(node.operand).span);
				return ERROR_TYPE;
			}
			return operandType;
		}

		if (node.op === "!") {
			if (operandType.kind !== "bool") {
				this.emitTypeMismatch(BOOL, operandType, this.arena.get(node.operand).span);
				return ERROR_TYPE;
			}
			return BOOL;
		}

		return ERROR_TYPE;
	}

	// -------------------------------------------------------------------
	// If expressions
	// -------------------------------------------------------------------

	private checkIf(
		_nodeId: NodeId,
		node: Extract<AstNode, { kind: "IfExpr" }>,
		env: Map<string, Type>,
	): Type {
		const condType = this.checkExpr(node.condition, env);

		if (!isError(condType) && condType.kind !== "bool") {
			this.emitTypeMismatch(BOOL, condType, this.arena.get(node.condition).span);
		}

		const thenType = this.checkNode(node.then, env);

		if (node.else_ === null) {
			return VOID;
		}

		const elseType = this.checkNode(node.else_, env);

		if (!isError(thenType) && !isError(elseType) && !typesEqual(thenType, elseType)) {
			this.emitTypeMismatch(thenType, elseType, this.arena.get(node.else_).span);
			return ERROR_TYPE;
		}

		return isError(thenType) ? elseType : thenType;
	}

	// -------------------------------------------------------------------
	// Match expressions
	// -------------------------------------------------------------------

	private checkMatch(
		_nodeId: NodeId,
		node: Extract<AstNode, { kind: "MatchExpr" }>,
		env: Map<string, Type>,
	): Type {
		const scrutineeType = this.checkExpr(node.scrutinee, env);
		if (isError(scrutineeType)) return ERROR_TYPE;

		// Build variant info from the scrutinee type
		const variantInfo = this.getVariantInfo(scrutineeType);

		// Process each arm
		const armPatterns: { pattern: CheckPattern; hasGuard: boolean }[] = [];
		const bodyTypes: Type[] = [];

		for (const armId of node.arms) {
			const arm = this.arena.get(armId);
			if (arm.kind !== "MatchArm") continue;

			// Convert AST pattern to CheckPattern
			const checkPat = this.astPatternToCheckPattern(arm.pattern, scrutineeType);

			// Create a new env scope for this arm's pattern bindings
			const armEnv = new Map(env);
			this.bindMatchPattern(arm.pattern, scrutineeType, armEnv);

			// Check guard expression (must be Bool)
			const hasGuard = arm.guard !== null;
			if (arm.guard !== null) {
				const guardType = this.checkExpr(arm.guard, armEnv);
				if (!isError(guardType) && guardType.kind !== "bool") {
					this.emitTypeMismatch(BOOL, guardType, this.arena.get(arm.guard).span);
				}
			}

			// Check body
			const bodyType = this.checkNode(arm.body, armEnv);
			bodyTypes.push(bodyType);

			armPatterns.push({ pattern: checkPat, hasGuard });
		}

		// Run exhaustiveness check
		const result = checkExhaustiveness(scrutineeType, armPatterns, variantInfo);

		// Emit E0402 for missing patterns
		if (result.missing.length > 0) {
			const missingStr = result.missing.join(", ");
			this.diagnostics.push({
				code: "E0402",
				severity: "error",
				message: `non-exhaustive match: missing pattern(s) ${missingStr}`,
				span: node.span,
				docs: DIAGNOSTIC_REGISTRY.E0402.docs,
			});
		}

		// Emit E0403 for unreachable arms
		for (const idx of result.unreachable) {
			const armId = node.arms[idx];
			const armNode = this.arena.get(armId);
			this.diagnostics.push({
				code: "E0403",
				severity: "warning",
				message: "unreachable match arm",
				span: armNode.span,
				docs: DIAGNOSTIC_REGISTRY.E0403.docs,
			});
		}

		// Verify all arm body types match
		if (bodyTypes.length === 0) return VOID;

		let resultType = bodyTypes[0];
		for (let i = 1; i < bodyTypes.length; i++) {
			if (isError(bodyTypes[i])) continue;
			if (isError(resultType)) {
				resultType = bodyTypes[i];
				continue;
			}
			if (!typesEqual(resultType, bodyTypes[i])) {
				const armId = node.arms[i];
				const armNode = this.arena.get(armId);
				if (armNode.kind === "MatchArm") {
					this.emitTypeMismatch(resultType, bodyTypes[i], this.arena.get(armNode.body).span);
				}
			}
		}

		return isError(resultType) && bodyTypes.length > 1
			? bodyTypes.find((t) => !isError(t)) ?? ERROR_TYPE
			: resultType;
	}

	/**
	 * Get variant info for the scrutinee type.
	 * For ADTs (nominal types backed by SumType), returns variant name -> arity.
	 * For Bool, returns hardcoded true/false variants.
	 * For infinite types (Int, Float, String), returns empty map.
	 */
	private getVariantInfo(scrutineeType: Type): Map<string, number> {
		const info = new Map<string, number>();

		if (scrutineeType.kind === "bool") {
			info.set("true", 0);
			info.set("false", 0);
			return info;
		}

		if (scrutineeType.kind === "nominal") {
			const declId = scrutineeType.declNode;
			if ((declId as number) === -1) return info;

			const declNode = this.arena.get(declId);
			if (declNode.kind !== "TypeDecl") return info;

			const valueNode = this.arena.get(declNode.value);
			if (valueNode.kind !== "SumType") return info;

			for (const variantId of valueNode.variants) {
				const variant = this.arena.get(variantId);
				if (variant.kind === "Variant") {
					info.set(variant.name, variant.payload.length);
				}
			}
			return info;
		}

		// Int, Float, String — infinite types, return empty map
		return info;
	}

	/**
	 * Convert an AST pattern node into a CheckPattern for the exhaustiveness checker.
	 */
	private astPatternToCheckPattern(patId: NodeId, scrutineeType: Type): CheckPattern {
		const pat = this.arena.get(patId);
		switch (pat.kind) {
			case "WildcardPat":
				return { kind: "wildcard" };

			case "BindingPat": {
				// Check if this binding name matches a known variant of the scrutinee type.
				// The parser produces BindingPat for nullary constructors like `Red`.
				const variantInfo = this.getVariantInfo(scrutineeType);
				if (variantInfo.has(pat.name)) {
					return { kind: "ctor", name: pat.name, args: [] };
				}
				// Otherwise it's a true binding, equivalent to wildcard for coverage
				return { kind: "wildcard" };
			}

			case "CtorPat": {
				const args = pat.args.map((argId) =>
					this.astPatternToCheckPattern(argId, scrutineeType),
				);
				return { kind: "ctor", name: pat.name, args };
			}

			case "LiteralPat": {
				if (pat.litKind === "bool") {
					// Bool literals become constructors for exhaustiveness
					return { kind: "ctor", name: pat.value, args: [] };
				}
				// Non-bool literals
				return { kind: "literal", value: pat.value };
			}

			case "TuplePat": {
				const elements = pat.elements.map((elemId) =>
					this.astPatternToCheckPattern(elemId, scrutineeType),
				);
				// Treat tuple as a single constructor with args
				return { kind: "ctor", name: "()", args: elements };
			}

			case "RecordPat": {
				// Treat record pattern as wildcard for now (v0 simplification)
				return { kind: "wildcard" };
			}

			default:
				return { kind: "wildcard" };
		}
	}

	/**
	 * Bind pattern variables into the environment for type checking the arm body.
	 * This extends the typer's existing bindPattern to handle match-specific patterns.
	 */
	private bindMatchPattern(patId: NodeId, scrutineeType: Type, env: Map<string, Type>): void {
		const pat = this.arena.get(patId);
		switch (pat.kind) {
			case "BindingPat": {
				if (pat.name === "<error>") break;
				// If the name matches a known variant, don't bind it as a variable
				const variantInfo = this.getVariantInfo(scrutineeType);
				if (variantInfo.has(pat.name)) break;
				env.set(pat.name, scrutineeType);
				break;
			}

			case "WildcardPat":
				break;

			case "CtorPat": {
				// Look up variant payload types from the scrutinee's type declaration
				const payloadTypes = this.getCtorPayloadTypes(pat.name, scrutineeType);
				for (let i = 0; i < pat.args.length; i++) {
					const argType = i < payloadTypes.length ? payloadTypes[i] : ERROR_TYPE;
					this.bindMatchPattern(pat.args[i], argType, env);
				}
				break;
			}

			case "LiteralPat":
				break;

			case "TuplePat":
				if (scrutineeType.kind === "tuple") {
					for (let i = 0; i < pat.elements.length; i++) {
						const elemType =
							i < scrutineeType.elements.length ? scrutineeType.elements[i] : ERROR_TYPE;
						this.bindMatchPattern(pat.elements[i], elemType, env);
					}
				}
				break;

			case "RecordPat":
				// v0: not binding record pattern fields yet
				break;

			default:
				break;
		}
	}

	/**
	 * Get the payload types for a constructor variant within a sum type.
	 */
	private getCtorPayloadTypes(ctorName: string, scrutineeType: Type): Type[] {
		if (scrutineeType.kind !== "nominal") return [];
		const declId = scrutineeType.declNode;
		if ((declId as number) === -1) return [];

		const declNode = this.arena.get(declId);
		if (declNode.kind !== "TypeDecl") return [];

		const valueNode = this.arena.get(declNode.value);
		if (valueNode.kind !== "SumType") return [];

		for (const variantId of valueNode.variants) {
			const variant = this.arena.get(variantId);
			if (variant.kind === "Variant" && variant.name === ctorName) {
				return variant.payload.map((payloadId) => this.resolveTypeNode(payloadId));
			}
		}
		return [];
	}

	// -------------------------------------------------------------------
	// Field access
	// -------------------------------------------------------------------

	private checkFieldAccess(
		node: Extract<AstNode, { kind: "FieldAccess" }>,
		env: Map<string, Type>,
	): Type {
		const objectType = this.checkExpr(node.object, env);
		if (isError(objectType)) return ERROR_TYPE;

		if (objectType.kind === "record") {
			const fieldType = objectType.fields.get(node.field);
			if (fieldType !== undefined) return fieldType;

			this.diagnostics.push({
				code: "E0401",
				severity: "error",
				message: `no field \`${node.field}\` on type \`${printType(objectType)}\``,
				span: node.span,
				docs: DIAGNOSTIC_REGISTRY.E0401.docs,
			});
			return ERROR_TYPE;
		}

		this.diagnostics.push({
			code: "E0401",
			severity: "error",
			message: `type \`${printType(objectType)}\` has no fields`,
			span: node.span,
			docs: DIAGNOSTIC_REGISTRY.E0401.docs,
		});
		return ERROR_TYPE;
	}

	// -------------------------------------------------------------------
	// Record expressions
	// -------------------------------------------------------------------

	private checkRecordExpr(
		node: Extract<AstNode, { kind: "RecordExpr" }>,
		env: Map<string, Type>,
	): Type {
		const fields = new Map<string, Type>();
		for (const fieldId of node.fields) {
			const fieldNode = this.arena.get(fieldId);
			if (fieldNode.kind === "RecordInit") {
				const valueType = fieldNode.value !== null
					? this.checkExpr(fieldNode.value, env)
					: env.get(fieldNode.name) ?? ERROR_TYPE;
				fields.set(fieldNode.name, valueType);
			}
		}
		return { kind: "record", fields };
	}

	// -------------------------------------------------------------------
	// Tuple expressions
	// -------------------------------------------------------------------

	private checkTupleExpr(
		node: Extract<AstNode, { kind: "TupleExpr" }>,
		env: Map<string, Type>,
	): Type {
		const elements = node.elements.map((elemId) => this.checkExpr(elemId, env));
		return { kind: "tuple", elements };
	}

	// -------------------------------------------------------------------
	// List expressions
	// -------------------------------------------------------------------

	private checkListExpr(
		node: Extract<AstNode, { kind: "ListExpr" }>,
		env: Map<string, Type>,
	): Type {
		if (node.elements.length === 0) {
			// Empty list — element type unknown, use ERROR_TYPE (compatible with anything)
			return { kind: "nominal", name: "List", declNode: BUILTIN_DECL_NODE, typeArgs: [ERROR_TYPE] };
		}

		const firstType = this.checkExpr(node.elements[0], env);
		for (let i = 1; i < node.elements.length; i++) {
			const elemType = this.checkExpr(node.elements[i], env);
			if (!isError(firstType) && !isError(elemType) && !typesEqual(firstType, elemType)) {
				this.emitTypeMismatch(firstType, elemType, this.arena.get(node.elements[i]).span);
			}
		}

		return { kind: "nominal", name: "List", declNode: BUILTIN_DECL_NODE, typeArgs: [firstType] };
	}

	// -------------------------------------------------------------------
	// Try expression (? operator)
	// -------------------------------------------------------------------

	private checkTryExpr(
		node: Extract<AstNode, { kind: "TryExpr" }>,
		env: Map<string, Type>,
	): Type {
		const innerType = this.checkExpr(node.expr, env);
		if (isError(innerType)) return ERROR_TYPE;

		// Must be Result[T, E]
		if (innerType.kind !== "nominal" || innerType.name !== "Result" || innerType.typeArgs.length !== 2) {
			this.diagnostics.push({
				code: "E0401",
				severity: "error",
				message: `\`?\` operator requires \`Result[T, E]\`, got \`${printType(innerType)}\``,
				span: node.span,
				docs: DIAGNOSTIC_REGISTRY.E0401.docs,
			});
			return ERROR_TYPE;
		}

		const [okType, errType] = innerType.typeArgs;

		// Enclosing function must return Result[_, E] with same E
		if (this.currentReturnType) {
			const ret = this.currentReturnType;
			if (ret.kind !== "nominal" || ret.name !== "Result" || ret.typeArgs.length !== 2) {
				this.diagnostics.push({
					code: "E0401",
					severity: "error",
					message: `\`?\` requires enclosing function to return \`Result\`, but it returns \`${printType(ret)}\``,
					span: node.span,
					docs: DIAGNOSTIC_REGISTRY.E0401.docs,
				});
				return ERROR_TYPE;
			}
			if (!typesEqual(errType, ret.typeArgs[1])) {
				this.diagnostics.push({
					code: "E0401",
					severity: "error",
					message: `\`?\` error type mismatch: inner is \`${printType(errType)}\` but function returns \`Result[_, ${printType(ret.typeArgs[1])}]\``,
					span: node.span,
					docs: DIAGNOSTIC_REGISTRY.E0401.docs,
				});
			}
		}

		return okType;
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
