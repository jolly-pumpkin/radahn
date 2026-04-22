// AST node types — tagged-union arena with numeric IDs.
// Every node carries a `kind` discriminant and a `span`.
// Children are NodeId references into the arena, never inline.

import type { Span } from "../diag/types";
import type { NodeId } from "../util/arena";

// ---------------------------------------------------------------------------
// Node kinds — plain string literals (no const enum; Bun doesn't support it)
// ---------------------------------------------------------------------------

export type NodeKind = AstNode["kind"];

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export type BinaryOp =
	| "+"
	| "-"
	| "*"
	| "/"
	| "%"
	| "=="
	| "!="
	| "<"
	| "<="
	| ">"
	| ">="
	| "&&"
	| "||"
	| "++";

export type UnaryOp = "-" | "!";

// ---------------------------------------------------------------------------
// File-level nodes
// ---------------------------------------------------------------------------

export type FileNode = {
	kind: "File";
	span: Span;
	header: NodeId;
	decls: NodeId[];
};

export type ModuleHeaderNode = {
	kind: "ModuleHeader";
	span: Span;
	path: NodeId;
	fields: NodeId[];
};

export type ModulePathNode = {
	kind: "ModulePath";
	span: Span;
	segments: string[];
	separators: ("." | "/")[];
};

export type ModuleFieldNode = {
	kind: "ModuleField";
	span: Span;
	name: "version" | "exports" | "effects" | "caps" | "since" | "summary";
	value: string | string[];
};

export type ImportNode = {
	kind: "Import";
	span: Span;
	path: NodeId;
	names: string[] | null;
};

// ---------------------------------------------------------------------------
// Declaration nodes
// ---------------------------------------------------------------------------

export type FnDeclNode = {
	kind: "FnDecl";
	span: Span;
	visibility: boolean;
	name: string;
	typeParams: NodeId | null;
	params: NodeId[];
	returnType: NodeId | null;
	effectRow: NodeId | null;
	contracts: NodeId[];
	body: NodeId | null;
};

export type TypeDeclNode = {
	kind: "TypeDecl";
	span: Span;
	visibility: boolean;
	name: string;
	typeParams: NodeId | null;
	value: NodeId; // SumType or a Type node
};

export type SumTypeNode = {
	kind: "SumType";
	span: Span;
	variants: NodeId[];
};

export type VariantNode = {
	kind: "Variant";
	span: Span;
	name: string;
	payloadKind: "positional" | "named" | "none";
	payload: NodeId[]; // Type[] for positional, Field[] for named
};

export type ExternBlockNode = {
	kind: "ExternBlock";
	span: Span;
	path: NodeId;
	decls: NodeId[];
};

export type ExternFnDeclNode = {
	kind: "ExternFnDecl";
	span: Span;
	name: string;
	params: NodeId[];
	returnType: NodeId | null;
	effectRow: NodeId | null;
};

export type ExternTypeDeclNode = {
	kind: "ExternTypeDecl";
	span: Span;
	name: string;
	typeParams: NodeId | null;
};

export type ParamNode = {
	kind: "Param";
	span: Span;
	name: string;
	type: NodeId;
};

export type TypeParamsNode = {
	kind: "TypeParams";
	span: Span;
	names: string[];
};

export type EffectRowNode = {
	kind: "EffectRow";
	span: Span;
	effects: NodeId[];
	tail: NodeId | null; // Ident node for row variable, e.g. `e` in `! { log | e }`
};

export type EffectNameNode = {
	kind: "EffectName";
	span: Span;
	segments: string[];
};

export type ContractPreNode = {
	kind: "ContractPre";
	span: Span;
	expr: NodeId;
};

export type ContractPostNode = {
	kind: "ContractPost";
	span: Span;
	expr: NodeId;
};

export type ContractCostNode = {
	kind: "ContractCost";
	span: Span;
	fields: NodeId[];
};

export type CostFieldNode = {
	kind: "CostField";
	span: Span;
	name: string;
	value: NodeId;
};

export type CostValueNode = {
	kind: "CostValue";
	span: Span;
	prefix: "<=" | "~" | null;
	number: string;
	unit: string | null;
};

// ---------------------------------------------------------------------------
// Type nodes
// ---------------------------------------------------------------------------

export type NominalTypeNode = {
	kind: "NominalType";
	span: Span;
	segments: string[];
	typeArgs: NodeId[];
};

export type RecordTypeNode = {
	kind: "RecordType";
	span: Span;
	fields: NodeId[];
};

export type TupleTypeNode = {
	kind: "TupleType";
	span: Span;
	elements: NodeId[];
};

export type FnTypeNode = {
	kind: "FnType";
	span: Span;
	params: NodeId[];
	returnType: NodeId;
	effectRow: NodeId | null;
};

export type VoidTypeNode = {
	kind: "VoidType";
	span: Span;
};

export type RefinedTypeNode = {
	kind: "RefinedType";
	span: Span;
	base: NodeId;
	predicate: NodeId;
};

export type FieldNode = {
	kind: "Field";
	span: Span;
	name: string;
	type: NodeId;
};

// ---------------------------------------------------------------------------
// Statement nodes
// ---------------------------------------------------------------------------

export type BlockNode = {
	kind: "Block";
	span: Span;
	stmts: NodeId[];
};

export type LetStmtNode = {
	kind: "LetStmt";
	span: Span;
	pattern: NodeId;
	type: NodeId | null;
	value: NodeId;
};

export type ReturnStmtNode = {
	kind: "ReturnStmt";
	span: Span;
	value: NodeId | null;
};

export type ExprStmtNode = {
	kind: "ExprStmt";
	span: Span;
	expr: NodeId;
};

// ---------------------------------------------------------------------------
// Pattern nodes
// ---------------------------------------------------------------------------

export type WildcardPatNode = {
	kind: "WildcardPat";
	span: Span;
};

export type LiteralPatNode = {
	kind: "LiteralPat";
	span: Span;
	value: string;
	litKind: "int" | "float" | "string" | "bool";
};

export type BindingPatNode = {
	kind: "BindingPat";
	span: Span;
	name: string;
};

export type CtorPatNode = {
	kind: "CtorPat";
	span: Span;
	name: string;
	args: NodeId[];
};

export type RecordPatNode = {
	kind: "RecordPat";
	span: Span;
	fields: NodeId[];
};

export type RecordPatFieldNode = {
	kind: "RecordPatField";
	span: Span;
	name: string;
	pattern: NodeId | null; // null = shorthand { x }
};

export type TuplePatNode = {
	kind: "TuplePat";
	span: Span;
	elements: NodeId[];
};

// ---------------------------------------------------------------------------
// Expression nodes
// ---------------------------------------------------------------------------

export type IntLitNode = {
	kind: "IntLit";
	span: Span;
	value: string; // raw text, e.g. "0xFF_00"
};

export type FloatLitNode = {
	kind: "FloatLit";
	span: Span;
	value: string;
};

export type StringLitNode = {
	kind: "StringLit";
	span: Span;
	value: string; // raw text including quotes
};

export type BoolLitNode = {
	kind: "BoolLit";
	span: Span;
	value: boolean;
};

export type VoidLitNode = {
	kind: "VoidLit";
	span: Span;
};

export type IdentNode = {
	kind: "Ident";
	span: Span;
	name: string;
};

export type BinaryExprNode = {
	kind: "BinaryExpr";
	span: Span;
	op: BinaryOp;
	left: NodeId;
	right: NodeId;
};

export type UnaryExprNode = {
	kind: "UnaryExpr";
	span: Span;
	op: UnaryOp;
	operand: NodeId;
};

export type CallExprNode = {
	kind: "CallExpr";
	span: Span;
	callee: NodeId;
	args: NodeId[];
};

export type FieldAccessNode = {
	kind: "FieldAccess";
	span: Span;
	object: NodeId;
	field: string;
};

export type IndexExprNode = {
	kind: "IndexExpr";
	span: Span;
	object: NodeId;
	index: NodeId;
};

export type TryExprNode = {
	kind: "TryExpr";
	span: Span;
	expr: NodeId;
};

export type TurbofishExprNode = {
	kind: "TurbofishExpr";
	span: Span;
	expr: NodeId;
	typeArg: NodeId;
};

export type IfExprNode = {
	kind: "IfExpr";
	span: Span;
	condition: NodeId;
	then: NodeId;
	else_: NodeId | null;
};

export type MatchExprNode = {
	kind: "MatchExpr";
	span: Span;
	scrutinee: NodeId;
	arms: NodeId[];
};

export type MatchArmNode = {
	kind: "MatchArm";
	span: Span;
	pattern: NodeId;
	guard: NodeId | null;
	body: NodeId;
};

export type TupleExprNode = {
	kind: "TupleExpr";
	span: Span;
	elements: NodeId[];
};

export type RecordExprNode = {
	kind: "RecordExpr";
	span: Span;
	name: string | null; // leading IDENT or null for anonymous
	fields: NodeId[];
};

export type RecordInitNode = {
	kind: "RecordInit";
	span: Span;
	name: string;
	value: NodeId | null; // null = shorthand { x }
};

export type ListExprNode = {
	kind: "ListExpr";
	span: Span;
	elements: NodeId[];
};

export type NamedArgNode = {
	kind: "NamedArg";
	span: Span;
	name: string;
	value: NodeId;
};

export type BlockExprNode = {
	kind: "BlockExpr";
	span: Span;
	block: NodeId;
};

export type RangeExprNode = {
	kind: "RangeExpr";
	span: Span;
	start: NodeId;
	end: NodeId;
};

// ---------------------------------------------------------------------------
// Union of all AST nodes
// ---------------------------------------------------------------------------

export type AstNode =
	// File-level
	| FileNode
	| ModuleHeaderNode
	| ModulePathNode
	| ModuleFieldNode
	| ImportNode
	// Declarations
	| FnDeclNode
	| TypeDeclNode
	| SumTypeNode
	| VariantNode
	| ExternBlockNode
	| ExternFnDeclNode
	| ExternTypeDeclNode
	| ParamNode
	| TypeParamsNode
	| EffectRowNode
	| EffectNameNode
	| ContractPreNode
	| ContractPostNode
	| ContractCostNode
	| CostFieldNode
	| CostValueNode
	// Types
	| NominalTypeNode
	| RecordTypeNode
	| TupleTypeNode
	| FnTypeNode
	| VoidTypeNode
	| RefinedTypeNode
	| FieldNode
	// Statements
	| BlockNode
	| LetStmtNode
	| ReturnStmtNode
	| ExprStmtNode
	// Patterns
	| WildcardPatNode
	| LiteralPatNode
	| BindingPatNode
	| CtorPatNode
	| RecordPatNode
	| RecordPatFieldNode
	| TuplePatNode
	// Expressions
	| IntLitNode
	| FloatLitNode
	| StringLitNode
	| BoolLitNode
	| VoidLitNode
	| IdentNode
	| BinaryExprNode
	| UnaryExprNode
	| CallExprNode
	| FieldAccessNode
	| IndexExprNode
	| TryExprNode
	| TurbofishExprNode
	| IfExprNode
	| MatchExprNode
	| MatchArmNode
	| TupleExprNode
	| RecordExprNode
	| RecordInitNode
	| ListExprNode
	| NamedArgNode
	| BlockExprNode
	| RangeExprNode;

// ---------------------------------------------------------------------------
// Exhaustiveness helper
// ---------------------------------------------------------------------------

/** Place in default arm of switch on AstNode["kind"] — TS errors if any case is missed. */
export function exhaustive(x: never): never {
	throw new Error(`Unhandled node kind: ${(x as AstNode).kind}`);
}
