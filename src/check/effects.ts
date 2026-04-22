// Effect checker — walks function bodies, collects effects from calls,
// and compares against declared effect rows.
// Runs after the typer; skips calls whose type is `error` to avoid phantom effects.

import { DIAGNOSTIC_REGISTRY } from "../diag/codes";
import type { Diagnostic, Span } from "../diag/types";
import type { AstNode } from "../parse/ast";
import type { Arena, NodeId } from "../util/arena";
import {
	type Type,
	type EffectRow,
	type Effect,
	PURE,
	isError,
	printEffectRow,
} from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type EffectCheckResult = {
	effectMap: Map<NodeId, EffectRow>;
	diagnostics: Diagnostic[];
};

export function effectCheck(
	root: NodeId,
	arena: Arena<AstNode>,
	resolutions: Map<NodeId, NodeId>,
	typeMap: Map<NodeId, Type>,
): EffectCheckResult {
	const checker = new EffectChecker(arena, resolutions, typeMap);
	checker.checkFile(root);
	return {
		effectMap: checker.effectMap,
		diagnostics: checker.diagnostics,
	};
}

// ---------------------------------------------------------------------------
// Internal checker
// ---------------------------------------------------------------------------

type CollectedEffect = {
	effect: Effect;
	callSpan: Span;
};

class EffectChecker {
	readonly arena: Arena<AstNode>;
	readonly resolutions: Map<NodeId, NodeId>;
	readonly typeMap: Map<NodeId, Type>;
	readonly effectMap = new Map<NodeId, EffectRow>();
	readonly diagnostics: Diagnostic[] = [];

	constructor(
		arena: Arena<AstNode>,
		resolutions: Map<NodeId, NodeId>,
		typeMap: Map<NodeId, Type>,
	) {
		this.arena = arena;
		this.resolutions = resolutions;
		this.typeMap = typeMap;
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
				// Extern declarations have no bodies — nothing to check
				break;
			default:
				break;
		}
	}

	private checkFnDecl(
		declId: NodeId,
		node: Extract<AstNode, { kind: "FnDecl" }>,
	): void {
		// 1. Get declared effect row
		const declaredRow = this.resolveDeclaredEffectRow(node.effectRow);
		this.effectMap.set(declId, declaredRow);

		// No body → nothing to check
		if (node.body === null) return;

		// 2. Walk body, collecting effects
		const collected = new Map<string, CollectedEffect>();
		this.walkBody(node.body, collected);

		// Build declared effect name set
		const declaredNames = new Set<string>();
		if (declaredRow.kind === "closed" || declaredRow.kind === "open") {
			for (const eff of declaredRow.effects) {
				declaredNames.add(eff.name);
			}
		}

		// 3. Compare computed vs declared
		if (declaredRow.kind === "pure") {
			// Pure function: if any effects found → E0303
			for (const [, { effect, callSpan }] of collected) {
				const effRowStr = `! { ${effect.name} }`;
				const diag: Diagnostic = {
					code: "E0303",
					severity: "error",
					message: `calling an effectful function (\`${effRowStr}\`) from a pure function \`${node.name}\` — add an effect row or wrap in an effectful caller`,
					span: callSpan,
					docs: DIAGNOSTIC_REGISTRY.E0303.docs,
				};
				if (effect.fromExtern) {
					diag.notes = [{ message: `effect \`${effect.name}\` originates from an extern declaration (trusted, not verified)` }];
				}
				this.diagnostics.push(diag);
			}
		} else if (declaredRow.kind === "closed") {
			// Closed row: each computed effect must appear in declared set
			for (const [effName, { effect, callSpan }] of collected) {
				if (!declaredNames.has(effName)) {
					const declStr = declaredNames.size > 0
						? `! { ${[...declaredNames].join(", ")} }`
						: "! {}";
					const diag: Diagnostic = {
						code: "E0301",
						severity: "error",
						message: `function \`${node.name}\` performs effect \`${effName}\` but its signature declares \`${declStr}\` — add \`${effName}\` to the effect row or remove the call`,
						span: callSpan,
						suggest: [{
							kind: "add-effect",
							rationale: `Add \`${effName}\` to the effect row`,
							at: node.span,
							insert: effName,
						}],
						docs: DIAGNOSTIC_REGISTRY.E0301.docs,
					};
					if (effect.fromExtern) {
						diag.notes = [{ message: `effect \`${effName}\` originates from an extern declaration (trusted, not verified)` }];
					}
					this.diagnostics.push(diag);
				}
			}
		}
		// Open rows: skip containment check in v0 (tail absorbs extras)

		// 4. Check unused effects (warning) — only for closed rows
		if (declaredRow.kind === "closed") {
			for (const eff of declaredRow.effects) {
				if (!collected.has(eff.name)) {
					const rowNode = node.effectRow !== null ? this.arena.get(node.effectRow) : null;
					const span = rowNode ? rowNode.span : node.span;
					this.diagnostics.push({
						code: "E0302",
						severity: "warning",
						message: `function \`${node.name}\` declares effect \`${eff.name}\` but never performs it — remove \`${eff.name}\` from the effect row`,
						span,
						docs: DIAGNOSTIC_REGISTRY.E0302.docs,
					});
				}
			}
		}
	}

	// -------------------------------------------------------------------
	// Resolve declared effect row from AST
	// -------------------------------------------------------------------

	private resolveDeclaredEffectRow(rowId: NodeId | null): EffectRow {
		if (rowId === null) return PURE;

		const node = this.arena.get(rowId);
		if (node.kind !== "EffectRow") return PURE;

		const effects: Effect[] = node.effects.map((eid) => {
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
	// Body walking — collect effects from calls
	// -------------------------------------------------------------------

	private walkBody(
		nodeId: NodeId,
		collected: Map<string, CollectedEffect>,
	): void {
		const node = this.arena.get(nodeId);

		switch (node.kind) {
			case "Block":
				for (const stmtId of node.stmts) {
					this.walkBody(stmtId, collected);
				}
				break;

			case "LetStmt":
				this.walkBody(node.value, collected);
				break;

			case "ExprStmt":
				this.walkBody(node.expr, collected);
				break;

			case "ReturnStmt":
				if (node.value !== null) {
					this.walkBody(node.value, collected);
				}
				break;

			case "CallExpr":
				this.walkCallExpr(nodeId, node, collected);
				// Also recurse into args
				for (const argId of node.args) {
					this.walkBody(argId, collected);
				}
				break;

			case "IfExpr":
				this.walkBody(node.condition, collected);
				this.walkBody(node.then, collected);
				if (node.else_ !== null) {
					this.walkBody(node.else_, collected);
				}
				break;

			case "MatchExpr":
				this.walkBody(node.scrutinee, collected);
				for (const armId of node.arms) {
					const arm = this.arena.get(armId);
					if (arm.kind === "MatchArm") {
						if (arm.guard !== null) {
							this.walkBody(arm.guard, collected);
						}
						this.walkBody(arm.body, collected);
					}
				}
				break;

			case "BinaryExpr":
				this.walkBody(node.left, collected);
				this.walkBody(node.right, collected);
				break;

			case "UnaryExpr":
				this.walkBody(node.operand, collected);
				break;

			case "TryExpr":
				this.walkBody(node.expr, collected);
				break;

			case "FieldAccess":
				this.walkBody(node.object, collected);
				break;

			case "BlockExpr":
				this.walkBody(node.block, collected);
				break;

			case "TupleExpr":
				for (const elemId of node.elements) {
					this.walkBody(elemId, collected);
				}
				break;

			case "RecordExpr":
				for (const fieldId of node.fields) {
					const fieldNode = this.arena.get(fieldId);
					if (fieldNode.kind === "RecordInit" && fieldNode.value !== null) {
						this.walkBody(fieldNode.value, collected);
					}
				}
				break;

			case "ListExpr":
				for (const elemId of node.elements) {
					this.walkBody(elemId, collected);
				}
				break;

			case "IndexExpr":
				this.walkBody(node.object, collected);
				this.walkBody(node.index, collected);
				break;

			default:
				// Literals, Ident, patterns, type nodes — nothing to collect
				break;
		}
	}

	private walkCallExpr(
		callId: NodeId,
		node: Extract<AstNode, { kind: "CallExpr" }>,
		collected: Map<string, CollectedEffect>,
	): void {
		// Skip calls where the type checker reported an error
		const callType = this.typeMap.get(callId);
		if (callType !== undefined && isError(callType)) return;

		// Resolve callee to its declaration
		const calleeNode = this.arena.get(node.callee);
		if (calleeNode.kind !== "Ident") return;

		const declId = this.resolutions.get(node.callee);
		if (declId === undefined) return;
		if ((declId as number) === -1) return;

		const declNode = this.arena.get(declId);

		let calleeEffectRow: EffectRow;
		let isExtern = false;

		if (declNode.kind === "FnDecl") {
			calleeEffectRow = this.resolveDeclaredEffectRow(declNode.effectRow);
		} else if (declNode.kind === "ExternFnDecl") {
			calleeEffectRow = this.resolveDeclaredEffectRow(declNode.effectRow);
			isExtern = true;
		} else {
			return;
		}

		// Collect each effect from the callee's effect row
		if (calleeEffectRow.kind === "closed" || calleeEffectRow.kind === "open") {
			for (const eff of calleeEffectRow.effects) {
				const effect: Effect = {
					name: eff.name,
					fromExtern: isExtern,
				};
				if (!collected.has(eff.name)) {
					collected.set(eff.name, { effect, callSpan: node.span });
				}
			}
		}
	}
}
