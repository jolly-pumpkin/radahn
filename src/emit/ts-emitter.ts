// TypeScript emitter: typed AST → TypeScript via ts-morph
// Implementation: Epic 0.6

import { Project, type SourceFile } from "ts-morph";
import type { DiagnosticCode, Diagnostic } from "../diag/types";
import type { AstNode } from "../parse/ast";
import type { Arena, NodeId } from "../util/arena";

export type EmitResult = {
	ts: string;
	dts: string;
	diagnostics: Diagnostic[];
};

export function emit(
	root: NodeId,
	arena: Arena<AstNode>,
	resolutions: Map<NodeId, NodeId>,
): EmitResult {
	const emitter = new Emitter(arena, resolutions);
	return emitter.run(root);
}

class Emitter {
	private arena: Arena<AstNode>;
	private resolutions: Map<NodeId, NodeId>;
	private project: Project;
	private sf!: SourceFile;
	private diagnostics: Diagnostic[] = [];
	private matchCounter = 0;
	private tryCounter = 0;
	private pendingStatements: string[] = [];

	constructor(arena: Arena<AstNode>, resolutions: Map<NodeId, NodeId>) {
		this.arena = arena;
		this.resolutions = resolutions;
		this.project = new Project({
			compilerOptions: {
				strict: true,
				declaration: true,
				target: 99, // ESNext
				module: 99, // ESNext
			},
			useInMemoryFileSystem: true,
		});
	}

	run(root: NodeId): EmitResult {
		const file = this.arena.get(root);
		if (file.kind !== "File") throw new Error("Expected File node at root");
		this.sf = this.project.createSourceFile("output.ts", "");
		this.emitFile(file);

		const ts = this.sf.getFullText();

		// Run tsc verification via ts-morph diagnostics
		// Skip TS2304 (cannot find name) and TS2307 (cannot find module) since
		// Radahn emits single files without their full dependency graph.
		// 2304: cannot find name (external types not in scope)
		// 2307: cannot find module (external modules not resolvable)
		// 2591: cannot find name 'console' (no @types/node in memory FS)
		const SKIP_TS_CODES = new Set([2304, 2307, 2591]);
		const tsDiags = this.project.getPreEmitDiagnostics();
		for (const d of tsDiags) {
			if (SKIP_TS_CODES.has(d.getCode())) continue;
			const messageText = d.getMessageText();
			const message = typeof messageText === "string" ? messageText : messageText.getMessageText();
			this.diagnostics.push({
				code: "E0601" as DiagnosticCode,
				severity: "error",
				message: `TS${d.getCode()}: ${message}`,
				span: { file: "output.ts", line: 0, col: 0, len: 0 },
				docs: "https://radahn.dev/e/E0601",
			});
		}

		// Generate .d.ts via ts-morph
		const emitOutput = this.project.emitToMemory({ emitOnlyDtsFiles: true });
		const dtsFile = emitOutput.getFiles().find((f) => f.filePath.endsWith(".d.ts"));
		const dts = dtsFile?.text ?? "";

		return { ts, dts, diagnostics: this.diagnostics };
	}

	private emitFile(file: Extract<AstNode, { kind: "File" }>): void {
		for (const declId of file.decls) {
			this.emitDecl(declId);
		}
	}

	private emitDecl(id: NodeId): void {
		const node = this.arena.get(id);
		switch (node.kind) {
			case "FnDecl":
				this.emitFnDecl(node);
				break;
			case "TypeDecl":
				this.emitTypeDecl(node);
				break;
			case "ExternBlock":
				this.emitExternBlock(node);
				break;
			case "Import":
				break; // erased
			case "ExprStmt": {
				const val = this.emitExpr(node.expr);
				const pending = this.flushPending();
				for (const s of pending) this.sf.addStatements(s);
				this.sf.addStatements(`${val};`);
				break;
			}
			case "LetStmt": {
				this.sf.addStatements(this.emitLetStmt(node));
				break;
			}
			default:
				break;
		}
	}

	// --- Type emission ---

	private emitType(id: NodeId): string {
		const node = this.arena.get(id);
		switch (node.kind) {
			case "NominalType": {
				const name = node.segments.join(".");
				const mapped = this.mapTypeName(name);
				if (node.typeArgs.length === 0) return mapped;
				const args = node.typeArgs.map((a) => this.emitType(a)).join(", ");
				return `${mapped}<${args}>`;
			}
			case "VoidType":
				return "void";
			case "TupleType": {
				const elems = node.elements.map((e) => this.emitType(e)).join(", ");
				return `[${elems}]`;
			}
			case "RecordType": {
				const fields = node.fields.map((f) => {
					const field = this.arena.get(f);
					if (field.kind !== "Field") throw new Error("Expected Field");
					return `${field.name}: ${this.emitType(field.type)}`;
				});
				return `{ ${fields.join("; ")} }`;
			}
			case "FnType": {
				const params = node.params.map((p, i) => `arg${i}: ${this.emitType(p)}`).join(", ");
				const ret = this.emitType(node.returnType);
				return `(${params}) => ${ret}`;
			}
			case "RefinedType":
				return this.emitType(node.base);
			default:
				return "unknown";
		}
	}

	private mapTypeName(name: string): string {
		switch (name) {
			case "Int":
				return "number";
			case "Float":
				return "number";
			case "String":
				return "string";
			case "Bool":
				return "boolean";
			case "List":
				return "Array";
			default:
				return name;
		}
	}

	// --- Function emission ---

	private emitFnDecl(node: Extract<AstNode, { kind: "FnDecl" }>): void {
		const returnType = node.returnType ? this.emitType(node.returnType) : "void";
		const typeParamNames = this.getTypeParamNames(node.typeParams);

		const fn = this.sf.addFunction({
			name: node.name,
			isExported: node.visibility,
			returnType,
			typeParameters: typeParamNames.length > 0 ? typeParamNames : undefined,
			parameters: node.params.map((p) => {
				const param = this.arena.get(p);
				if (param.kind !== "Param") throw new Error("Expected Param");
				return { name: param.name, type: this.emitType(param.type) };
			}),
		});

		if (node.body) {
			fn.setBodyText(this.emitBlockBody(node.body));
		}
	}

	// --- Block/statement emission ---

	private emitBlockBody(id: NodeId): string {
		const node = this.arena.get(id);
		if (node.kind !== "Block") throw new Error("Expected Block");
		const lines: string[] = [];
		for (let i = 0; i < node.stmts.length; i++) {
			const isLast = i === node.stmts.length - 1;
			const stmt = this.arena.get(node.stmts[i]);
			if (isLast && stmt.kind === "ExprStmt") {
				const val = this.emitExpr(stmt.expr);
				const pending = this.flushPending();
				lines.push(...pending);
				lines.push(`return ${val};`);
			} else {
				lines.push(this.emitStmt(node.stmts[i]));
			}
		}
		return lines.join("\n");
	}

	private emitStmt(id: NodeId): string {
		const node = this.arena.get(id);
		switch (node.kind) {
			case "LetStmt":
				return this.emitLetStmt(node);
			case "ReturnStmt": {
				if (!node.value) return "return;";
				const val = this.emitExpr(node.value);
				const pending = this.flushPending();
				return [...pending, `return ${val};`].join("\n");
			}
			case "ExprStmt": {
				const val = this.emitExpr(node.expr);
				const pending = this.flushPending();
				return [...pending, `${val};`].join("\n");
			}
			default:
				return `/* unsupported stmt: ${node.kind} */`;
		}
	}

	private flushPending(): string[] {
		const stmts = this.pendingStatements.splice(0);
		return stmts;
	}

	private emitLetStmt(node: Extract<AstNode, { kind: "LetStmt" }>): string {
		const pattern = this.arena.get(node.pattern);
		const name = pattern.kind === "BindingPat" ? pattern.name : "_";
		const typeAnnotation = node.type ? `: ${this.emitType(node.type)}` : "";
		const value = this.emitExpr(node.value);
		const pending = this.flushPending();
		const letLine = `const ${name}${typeAnnotation} = ${value};`;
		return [...pending, letLine].join("\n");
	}

	// --- Expression emission ---

	private emitExpr(id: NodeId): string {
		const node = this.arena.get(id);
		switch (node.kind) {
			case "IntLit":
				return node.value.replace(/_/g, "");
			case "FloatLit":
				return node.value;
			case "StringLit":
				return node.value;
			case "BoolLit":
				return String(node.value);
			case "VoidLit":
				return "undefined";
			case "Ident":
				return node.name;
			case "BinaryExpr":
				return this.emitBinaryExpr(node);
			case "UnaryExpr":
				return `${node.op}${this.emitExpr(node.operand)}`;
			case "CallExpr": {
				const callee = this.emitExpr(node.callee);
				const args = node.args.map((a) => this.emitExpr(a)).join(", ");
				return `${callee}(${args})`;
			}
			case "FieldAccess":
				return `${this.emitExpr(node.object)}.${node.field}`;
			case "IndexExpr":
				return `${this.emitExpr(node.object)}[${this.emitExpr(node.index)}]`;
			case "IfExpr":
				return this.emitIfExpr(node);
			case "MatchExpr":
				return this.emitMatchExpr(node);
			case "TupleExpr": {
				const elems = node.elements.map((e) => this.emitExpr(e)).join(", ");
				return `[${elems}]`;
			}
			case "RecordExpr":
				return this.emitRecordExpr(node);
			case "ListExpr": {
				const elems = node.elements.map((e) => this.emitExpr(e)).join(", ");
				return `[${elems}]`;
			}
			case "BlockExpr":
				return this.emitBlockExprAsIIFE(node);
			case "NamedArg":
				return this.emitExpr(node.value);
			case "TryExpr": {
				const tryVar = `_try_${this.tryCounter++}`;
				const inner = this.emitExpr(node.expr);
				this.pendingStatements.push(`const ${tryVar} = ${inner};`);
				this.pendingStatements.push(`if (${tryVar}.kind === "Err") return ${tryVar};`);
				return `${tryVar}.value_0`;
			}
			case "TurbofishExpr":
				return this.emitExpr(node.expr);
			case "RangeExpr":
				return "/* TODO: RangeExpr */";
			default:
				return `/* unsupported expr: ${(node as AstNode).kind} */`;
		}
	}

	private emitBinaryExpr(node: Extract<AstNode, { kind: "BinaryExpr" }>): string {
		const left = this.emitExpr(node.left);
		const right = this.emitExpr(node.right);
		const op = this.mapBinaryOp(node.op);
		return `${left} ${op} ${right}`;
	}

	private mapBinaryOp(op: string): string {
		switch (op) {
			case "++":
				return "+";
			case "==":
				return "===";
			case "!=":
				return "!==";
			default:
				return op;
		}
	}

	private emitIfExpr(node: Extract<AstNode, { kind: "IfExpr" }>): string {
		const cond = this.emitExpr(node.condition);
		if (node.else_) {
			const thenExpr = this.emitBranchExpr(node.then);
			const elseExpr = this.emitBranchExpr(node.else_);
			return `(${cond} ? ${thenExpr} : ${elseExpr})`;
		}
		const thenBody = this.emitBranchBody(node.then);
		return `if (${cond}) {\n${thenBody}\n}`;
	}

	private emitBranchExpr(id: NodeId): string {
		const node = this.arena.get(id);
		if (node.kind === "Block" && node.stmts.length === 1) {
			const stmt = this.arena.get(node.stmts[0]);
			if (stmt.kind === "ExprStmt") return this.emitExpr(stmt.expr);
		}
		if (node.kind === "Block") {
			const body = this.emitBlockBody(id);
			return `(() => {\n${body}\n})()`;
		}
		return this.emitExpr(id);
	}

	private emitBranchBody(id: NodeId): string {
		const node = this.arena.get(id);
		if (node.kind === "Block") {
			return node.stmts.map((s) => this.emitStmt(s)).join("\n");
		}
		return `${this.emitExpr(id)};`;
	}

	private emitMatchExpr(node: Extract<AstNode, { kind: "MatchExpr" }>): string {
		const scrutinee = this.emitExpr(node.scrutinee);
		const tmpVar = `_match${this.matchCounter++}`;
		const arms = node.arms.map((armId) => {
			const arm = this.arena.get(armId);
			if (arm.kind !== "MatchArm") throw new Error("Expected MatchArm");
			return this.emitMatchArm(arm, tmpVar);
		});
		return `(() => {\nconst ${tmpVar} = ${scrutinee};\n${arms.join("\n")}\nthrow new Error("non-exhaustive match");\n})()`;
	}

	private emitMatchArm(arm: Extract<AstNode, { kind: "MatchArm" }>, scrutinee: string): string {
		const pattern = this.arena.get(arm.pattern);
		const body = this.emitExpr(arm.body);
		const guard = arm.guard ? ` && ${this.emitExpr(arm.guard)}` : "";

		switch (pattern.kind) {
			case "CtorPat": {
				const bindings = pattern.args
					.map((argId, i) => {
						const arg = this.arena.get(argId);
						if (arg.kind === "BindingPat") return `const ${arg.name} = ${scrutinee}.value_${i};`;
						return "";
					})
					.filter(Boolean)
					.join(" ");
				return `if (${scrutinee}.kind === "${pattern.name}"${guard}) { ${bindings} return ${body}; }`;
			}
			case "LiteralPat":
				return `if (${scrutinee} === ${pattern.value}${guard}) { return ${body}; }`;
			case "WildcardPat":
				return `{ return ${body}; }`;
			case "BindingPat":
				return `{ const ${pattern.name} = ${scrutinee}; return ${body}; }`;
			case "TuplePat": {
				const bindings = pattern.elements
					.map((elemId, i) => {
						const elem = this.arena.get(elemId);
						if (elem.kind === "BindingPat") return `const ${elem.name} = ${scrutinee}[${i}];`;
						return "";
					})
					.filter(Boolean)
					.join(" ");
				return `{ ${bindings} return ${body}; }`;
			}
			default:
				return `/* unsupported pattern: ${pattern.kind} */ { return ${body}; }`;
		}
	}

	private emitRecordExpr(node: Extract<AstNode, { kind: "RecordExpr" }>): string {
		const fields = node.fields.map((fId) => {
			const field = this.arena.get(fId);
			if (field.kind === "RecordInit") {
				if (field.value) return `${field.name}: ${this.emitExpr(field.value)}`;
				return field.name;
			}
			return "/* unknown field kind */";
		});
		return `{ ${fields.join(", ")} }`;
	}

	private emitBlockExprAsIIFE(node: Extract<AstNode, { kind: "BlockExpr" }>): string {
		const body = this.emitBlockBody(node.block);
		return `(() => {\n${body}\n})()`;
	}

	// --- Type declaration emission ---

	private getTypeParamNames(id: NodeId | null): string[] {
		if (!id) return [];
		const node = this.arena.get(id);
		if (node.kind !== "TypeParams") return [];
		return node.names;
	}

	private emitTypeDecl(node: Extract<AstNode, { kind: "TypeDecl" }>): void {
		const valueNode = this.arena.get(node.value);
		if (valueNode.kind === "SumType") {
			this.emitSumType(node, valueNode);
		} else {
			// Non-sum type (e.g. refinement type) — emit simple alias
			const baseType = this.emitType(node.value);
			const exportKw = node.visibility ? "export " : "";
			const typeParamNames = this.getTypeParamNames(node.typeParams);
			const typeParamSuffix = typeParamNames.length > 0 ? `<${typeParamNames.join(", ")}>` : "";
			this.sf.addStatements(`${exportKw}type ${node.name}${typeParamSuffix} = ${baseType};`);
		}
	}

	private emitSumType(
		decl: Extract<AstNode, { kind: "TypeDecl" }>,
		sum: Extract<AstNode, { kind: "SumType" }>,
	): void {
		const typeParamNames = this.getTypeParamNames(decl.typeParams);
		const typeParamSuffix = typeParamNames.length > 0 ? `<${typeParamNames.join(", ")}>` : "";
		const exportKw = decl.visibility ? "export " : "";

		const variantNames: string[] = [];

		for (const variantId of sum.variants) {
			const variant = this.arena.get(variantId);
			if (variant.kind !== "Variant") continue;
			variantNames.push(variant.name);

			// Emit interface
			const fields: string[] = [`readonly kind: "${variant.name}"`];
			if (variant.payloadKind === "positional") {
				for (let i = 0; i < variant.payload.length; i++) {
					fields.push(`value_${i}: ${this.emitType(variant.payload[i])}`);
				}
			} else if (variant.payloadKind === "named") {
				for (const fieldId of variant.payload) {
					const field = this.arena.get(fieldId);
					if (field.kind === "Field") {
						fields.push(`${field.name}: ${this.emitType(field.type)}`);
					}
				}
			}

			this.sf.addStatements(
				`${exportKw}interface ${variant.name}${typeParamSuffix} { ${fields.join("; ")}; }`,
			);
		}

		// Emit union type alias
		const unionMembers = variantNames.map((n) => `${n}${typeParamSuffix}`).join(" | ");
		this.sf.addStatements(`${exportKw}type ${decl.name}${typeParamSuffix} = ${unionMembers};`);

		// Emit factory functions
		for (const variantId of sum.variants) {
			const variant = this.arena.get(variantId);
			if (variant.kind !== "Variant") continue;

			const params: string[] = [];
			const objFields: string[] = [`kind: "${variant.name}" as const`];

			if (variant.payloadKind === "positional") {
				for (let i = 0; i < variant.payload.length; i++) {
					params.push(`value_${i}: ${this.emitType(variant.payload[i])}`);
					objFields.push(`value_${i}`);
				}
			} else if (variant.payloadKind === "named") {
				for (const fieldId of variant.payload) {
					const field = this.arena.get(fieldId);
					if (field.kind === "Field") {
						params.push(`${field.name}: ${this.emitType(field.type)}`);
						objFields.push(field.name);
					}
				}
			}

			const paramStr = params.join(", ");
			const returnType = `${decl.name}${typeParamSuffix}`;
			const body = `{ ${objFields.join(", ")} }`;
			this.sf.addStatements(
				`${exportKw}function ${variant.name}${typeParamSuffix}(${paramStr}): ${returnType} { return ${body}; }`,
			);
		}
	}

	// --- Extern block emission ---

	private emitExternBlock(node: Extract<AstNode, { kind: "ExternBlock" }>): void {
		const pathNode = this.arena.get(node.path);
		if (pathNode.kind !== "ModulePath") throw new Error("Expected ModulePath");

		// Build module path string from segments and separators
		let modulePath = pathNode.segments[0];
		for (let i = 0; i < pathNode.separators.length; i++) {
			modulePath += pathNode.separators[i] + pathNode.segments[i + 1];
		}

		// Collect imported names from extern declarations
		const names: string[] = [];
		for (const declId of node.decls) {
			const decl = this.arena.get(declId);
			if (decl.kind === "ExternFnDecl") {
				names.push(decl.name);
			} else if (decl.kind === "ExternTypeDecl") {
				names.push(decl.name);
			}
		}

		if (names.length > 0) {
			this.sf.addStatements(`import { ${names.join(", ")} } from "${modulePath}";`);
		}
	}
}
