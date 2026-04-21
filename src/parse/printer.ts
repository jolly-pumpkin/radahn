// Minimal pretty-printer: AST → source text.
// Used for round-trip testing only. Not a formatter.

import type { Arena, NodeId } from "../util/arena";
import { exhaustive, type AstNode, type BinaryOp, type UnaryOp } from "./ast";

export function print(arena: Arena<AstNode>, root: NodeId): string {
	const printer = new Printer(arena);
	return printer.printNode(root);
}

class Printer {
	private arena: Arena<AstNode>;
	private indent = 0;

	constructor(arena: Arena<AstNode>) {
		this.arena = arena;
	}

	printNode(id: NodeId): string {
		const node = this.arena.get(id);
		switch (node.kind) {
			case "File": return this.printFile(node);
			case "ModuleHeader": return this.printModuleHeader(node);
			case "ModulePath": return this.printModulePath(node);
			case "ModuleField": return this.printModuleField(node);
			case "Import": return this.printImport(node);
			case "FnDecl": return this.printFnDecl(node);
			case "TypeDecl": return this.printTypeDecl(node);
			case "SumType": return this.printSumType(node);
			case "Variant": return this.printVariant(node);
			case "ExternBlock": return this.printExternBlock(node);
			case "ExternFnDecl": return this.printExternFnDecl(node);
			case "ExternTypeDecl": return this.printExternTypeDecl(node);
			case "Param": return this.printParam(node);
			case "TypeParams": return `[${node.names.join(", ")}]`;
			case "EffectRow": return this.printEffectRow(node);
			case "EffectName": return node.segments.join(".");
			case "ContractPre": return `${this.ind()}@pre ${this.printNode(node.expr)}`;
			case "ContractPost": return `${this.ind()}@post ${this.printNode(node.expr)}`;
			case "ContractCost": return `${this.ind()}@cost ${node.fields.map(f => this.printNode(f)).join(", ")}`;
			case "CostField": return `${node.name}: ${this.printNode(node.value)}`;
			case "CostValue": return `${node.prefix ? node.prefix + " " : ""}${node.number}${node.unit ? " " + node.unit : ""}`;
			case "NominalType": return this.printNominalType(node);
			case "RecordType": return this.printRecordType(node);
			case "TupleType": return `(${node.elements.map(e => this.printNode(e)).join(", ")})`;
			case "FnType": return this.printFnType(node);
			case "VoidType": return "()";
			case "RefinedType": return `${this.printNode(node.base)} where ${this.printNode(node.predicate)}`;
			case "Field": return `${node.name}: ${this.printNode(node.type)}`;
			case "Block": return this.printBlock(node);
			case "LetStmt": return this.printLetStmt(node);
			case "ReturnStmt": return `${this.ind()}return${node.value ? " " + this.printNode(node.value) : ""}`;
			case "ExprStmt": return `${this.ind()}${this.printNode(node.expr)}`;
			case "WildcardPat": return "_";
			case "LiteralPat": return node.value;
			case "BindingPat": return node.name;
			case "CtorPat": return node.args.length ? `${node.name}(${node.args.map(a => this.printNode(a)).join(", ")})` : node.name;
			case "RecordPat": return `{ ${node.fields.map(f => this.printNode(f)).join(", ")} }`;
			case "RecordPatField": return node.pattern ? `${node.name}: ${this.printNode(node.pattern)}` : node.name;
			case "TuplePat": return `(${node.elements.map(e => this.printNode(e)).join(", ")})`;
			case "IntLit": return node.value;
			case "FloatLit": return node.value;
			case "StringLit": return node.value;
			case "BoolLit": return node.value ? "true" : "false";
			case "VoidLit": return "()";
			case "Ident": return node.name;
			case "BinaryExpr": return this.printBinaryExpr(node);
			case "UnaryExpr": return this.printUnaryExpr(node);
			case "CallExpr": return `${this.printNode(node.callee)}(${node.args.map(a => this.printNode(a)).join(", ")})`;
			case "FieldAccess": return `${this.printNode(node.object)}.${node.field}`;
			case "IndexExpr": return `${this.printNode(node.object)}[${this.printNode(node.index)}]`;
			case "TryExpr": return `${this.printNode(node.expr)}?`;
			case "TurbofishExpr": return `${this.printNode(node.expr)}::<${this.printNode(node.typeArg)}>`;
			case "IfExpr": return this.printIfExpr(node);
			case "MatchExpr": return this.printMatchExpr(node);
			case "MatchArm": return this.printMatchArm(node);
			case "TupleExpr": return `(${node.elements.map(e => this.printNode(e)).join(", ")})`;
			case "RecordExpr": return this.printRecordExpr(node);
			case "RecordInit": return node.value ? `${node.name}: ${this.printNode(node.value)}` : node.name;
			case "ListExpr": return `[${node.elements.map(e => this.printNode(e)).join(", ")}]`;
			case "NamedArg": return `${node.name} = ${this.printNode(node.value)}`;
			case "BlockExpr": {
				const blockNode = this.arena.get(node.block);
				if (blockNode.kind === "Block") return this.printBlock(blockNode);
				return "{}";
			}
			case "RangeExpr": return `${this.printNode(node.start)}..${this.printNode(node.end)}`;
			default: return exhaustive(node);
		}
	}

	private printFile(node: Extract<AstNode, { kind: "File" }>): string {
		let out = this.printNode(node.header) + "\n";
		for (const decl of node.decls) {
			out += "\n" + this.printNode(decl) + "\n";
		}
		return out;
	}

	private printModuleHeader(node: Extract<AstNode, { kind: "ModuleHeader" }>): string {
		let out = `module ${this.printNode(node.path)}\n`;
		for (const field of node.fields) {
			out += `  ${this.printNode(field)}\n`;
		}
		out += "end-module";
		return out;
	}

	private printModulePath(node: Extract<AstNode, { kind: "ModulePath" }>): string {
		let out = node.segments[0];
		for (let i = 0; i < node.separators.length; i++) {
			out += node.separators[i] + node.segments[i + 1];
		}
		return out;
	}

	private printModuleField(node: Extract<AstNode, { kind: "ModuleField" }>): string {
		if (Array.isArray(node.value)) {
			return `${node.name}: [${node.value.join(", ")}]`;
		}
		return `${node.name}: ${node.value}`;
	}

	private printImport(node: Extract<AstNode, { kind: "Import" }>): string {
		let out = `import ${this.printNode(node.path)}`;
		if (node.names) {
			out += ` {${node.names.join(", ")}}`;
		}
		return out;
	}

	private printFnDecl(node: Extract<AstNode, { kind: "FnDecl" }>): string {
		let out = "";
		if (node.visibility) out += "pub ";
		out += `fn ${node.name}`;
		if (node.typeParams) out += this.printNode(node.typeParams);
		out += "(";
		out += node.params.map(p => this.printNode(p)).join(",\n" + this.ind() + "  ");
		out += ")";
		if (node.returnType) out += ` -> ${this.printNode(node.returnType)}`;
		if (node.effectRow) out += ` ${this.printNode(node.effectRow)}`;
		for (const c of node.contracts) {
			out += "\n" + this.printNode(c);
		}
		if (node.body) {
			if (node.contracts.length > 0) {
				out += "\n" + this.printNode(node.body);
			} else {
				out += " " + this.printNode(node.body);
			}
		}
		return out;
	}

	private printTypeDecl(node: Extract<AstNode, { kind: "TypeDecl" }>): string {
		let out = "";
		if (node.visibility) out += "pub ";
		out += `type ${node.name}`;
		if (node.typeParams) out += this.printNode(node.typeParams);
		out += " =";
		const val = this.arena.get(node.value);
		if (val.kind === "SumType") {
			out += "\n" + this.printNode(node.value);
		} else {
			out += " " + this.printNode(node.value);
		}
		return out;
	}

	private printSumType(node: Extract<AstNode, { kind: "SumType" }>): string {
		return node.variants.map(v => `${this.ind()}  | ${this.printNode(v)}`).join("\n");
	}

	private printVariant(node: Extract<AstNode, { kind: "Variant" }>): string {
		if (node.payloadKind === "none") return node.name;
		if (node.payloadKind === "positional") {
			return `${node.name}(${node.payload.map(p => this.printNode(p)).join(", ")})`;
		}
		return `${node.name}(${node.payload.map(p => this.printNode(p)).join(", ")})`;
	}

	private printExternBlock(node: Extract<AstNode, { kind: "ExternBlock" }>): string {
		let out = `extern module ${this.printNode(node.path)} {\n`;
		this.indent++;
		for (const d of node.decls) {
			out += this.ind() + this.printNode(d) + "\n";
		}
		this.indent--;
		out += "}";
		return out;
	}

	private printExternFnDecl(node: Extract<AstNode, { kind: "ExternFnDecl" }>): string {
		let out = `fn ${node.name}(${node.params.map(p => this.printNode(p)).join(", ")})`;
		if (node.returnType) out += ` -> ${this.printNode(node.returnType)}`;
		if (node.effectRow) out += ` ${this.printNode(node.effectRow)}`;
		return out;
	}

	private printExternTypeDecl(node: Extract<AstNode, { kind: "ExternTypeDecl" }>): string {
		let out = `type ${node.name}`;
		if (node.typeParams) out += this.printNode(node.typeParams);
		return out;
	}

	private printParam(node: Extract<AstNode, { kind: "Param" }>): string {
		return `${node.name}: ${this.printNode(node.type)}`;
	}

	private printEffectRow(node: Extract<AstNode, { kind: "EffectRow" }>): string {
		return `! { ${node.effects.map(e => this.printNode(e)).join(", ")} }`;
	}

	private printNominalType(node: Extract<AstNode, { kind: "NominalType" }>): string {
		let out = node.segments.join(".");
		if (node.typeArgs.length) {
			out += `[${node.typeArgs.map(a => this.printNode(a)).join(", ")}]`;
		}
		return out;
	}

	private printRecordType(node: Extract<AstNode, { kind: "RecordType" }>): string {
		if (node.fields.length === 0) return "{}";
		return `{ ${node.fields.map(f => this.printNode(f)).join(", ")} }`;
	}

	private printFnType(node: Extract<AstNode, { kind: "FnType" }>): string {
		let out = `fn(${node.params.map(p => this.printNode(p)).join(", ")}) -> ${this.printNode(node.returnType)}`;
		if (node.effectRow) out += ` ${this.printNode(node.effectRow)}`;
		return out;
	}

	private printBlock(node: Extract<AstNode, { kind: "Block" }>): string {
		if (node.stmts.length === 0) return "{\n" + this.ind() + "}";
		let out = "{\n";
		this.indent++;
		for (const s of node.stmts) {
			out += this.printNode(s) + "\n";
		}
		this.indent--;
		out += this.ind() + "}";
		return out;
	}

	private printLetStmt(node: Extract<AstNode, { kind: "LetStmt" }>): string {
		let out = `${this.ind()}let ${this.printNode(node.pattern)}`;
		if (node.type) out += `: ${this.printNode(node.type)}`;
		out += ` = ${this.printNode(node.value)}`;
		return out;
	}

	private printBinaryExpr(node: Extract<AstNode, { kind: "BinaryExpr" }>): string {
		const left = this.maybeParen(node.left, node.op, "left");
		const right = this.maybeParen(node.right, node.op, "right");
		return `${left} ${node.op} ${right}`;
	}

	private printUnaryExpr(node: Extract<AstNode, { kind: "UnaryExpr" }>): string {
		return `${node.op}${this.printNode(node.operand)}`;
	}

	private printIfExpr(node: Extract<AstNode, { kind: "IfExpr" }>): string {
		let out = `if ${this.printNode(node.condition)} ${this.printNode(node.then)}`;
		if (node.else_) {
			out += ` else ${this.printNode(node.else_)}`;
		}
		return out;
	}

	private printMatchExpr(node: Extract<AstNode, { kind: "MatchExpr" }>): string {
		let out = `match ${this.printNode(node.scrutinee)} {\n`;
		this.indent++;
		for (const arm of node.arms) {
			out += this.printNode(arm) + "\n";
		}
		this.indent--;
		out += this.ind() + "}";
		return out;
	}

	private printMatchArm(node: Extract<AstNode, { kind: "MatchArm" }>): string {
		let out = `${this.ind()}${this.printNode(node.pattern)}`;
		if (node.guard) out += ` if ${this.printNode(node.guard)}`;
		out += ` => ${this.printNode(node.body)}`;
		return out;
	}

	private printRecordExpr(node: Extract<AstNode, { kind: "RecordExpr" }>): string {
		const name = node.name ? node.name + " " : "";
		if (node.fields.length === 0) return `${name}{}`;
		return `${name}{ ${node.fields.map(f => this.printNode(f)).join(", ")} }`;
	}

	// Conservative parenthesization for round-trip safety
	private maybeParen(id: NodeId, parentOp: BinaryOp, side: "left" | "right"): string {
		const node = this.arena.get(id);
		if (node.kind === "BinaryExpr") {
			const childPrec = this.opPrecedence(node.op);
			const parentPrec = this.opPrecedence(parentOp);
			if (childPrec < parentPrec || (childPrec === parentPrec && side === "right")) {
				return `(${this.printNode(id)})`;
			}
		}
		if (node.kind === "UnaryExpr") {
			return `(${this.printNode(id)})`;
		}
		return this.printNode(id);
	}

	private opPrecedence(op: BinaryOp): number {
		switch (op) {
			case "||": return 2;
			case "&&": return 4;
			case "==": case "!=": case "<": case "<=": case ">": case ">=": return 6;
			case "+": case "-": case "++": return 10;
			case "*": case "/": case "%": return 12;
		}
	}

	private ind(): string {
		return "  ".repeat(this.indent);
	}
}
