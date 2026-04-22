import { describe, expect, test } from "bun:test";
import { lex } from "../src/lex/lexer";
import type { AstNode } from "../src/parse/ast";
import { type ParseResult, parse } from "../src/parse/parser";
import type { NodeId } from "../src/util/arena";

function p(source: string): ParseResult {
	const { tokens } = lex(source, "test.rd");
	return parse(tokens, "test.rd");
}

function getNode(result: ParseResult, id: NodeId): AstNode {
	return result.arena.get(id);
}

function rootNode(result: ParseResult): AstNode {
	return getNode(result, result.root);
}

describe("parser", () => {
	describe("module header", () => {
		test("minimal module", () => {
			const result = p("module hello\n  exports: [main]\nend-module\n\nfn main() {\n}\n");
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			expect(file.kind).toBe("File");
			if (file.kind !== "File") return;
			const header = getNode(result, file.header);
			expect(header.kind).toBe("ModuleHeader");
		});

		test("module with path separators", () => {
			const result = p("module payments/refund\nend-module\n");
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const header = getNode(result, file.header);
			if (header.kind !== "ModuleHeader") return;
			const path = getNode(result, header.path);
			if (path.kind !== "ModulePath") return;
			expect(path.segments).toEqual(["payments", "refund"]);
			expect(path.separators).toEqual(["/"]);
		});

		test("module with dot separator", () => {
			const result = p("module std.result\nend-module\n");
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const header = getNode(result, file.header);
			if (header.kind !== "ModuleHeader") return;
			const path = getNode(result, header.path);
			if (path.kind !== "ModulePath") return;
			expect(path.segments).toEqual(["std", "result"]);
			expect(path.separators).toEqual(["."]);
		});

		test("module with fields", () => {
			const src = `module hello
  version: "1.0.0"
  exports: [main, helper]
  effects: [log, fs.read]
end-module
`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const header = getNode(result, file.header);
			if (header.kind !== "ModuleHeader") return;
			expect(header.fields.length).toBe(3);
		});
	});

	describe("function declarations", () => {
		test("empty function", () => {
			const result = p("module t\nend-module\n\nfn main() {\n}\n");
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			expect(file.decls.length).toBe(1);
			const fn = getNode(result, file.decls[0]);
			expect(fn.kind).toBe("FnDecl");
			if (fn.kind !== "FnDecl") return;
			expect(fn.name).toBe("main");
			expect(fn.visibility).toBe(false);
			expect(fn.params).toEqual([]);
		});

		test("function with params and return type", () => {
			const src = `module t\nend-module\n\nfn add(a: Int, b: Int) -> Int {\n  a\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			expect(fn.params.length).toBe(2);
			expect(fn.returnType).not.toBeNull();
		});

		test("pub visibility", () => {
			const src = `module t\nend-module\n\npub fn foo() {\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			expect(fn.visibility).toBe(true);
		});

		test("function with type params", () => {
			const src = `module t\nend-module\n\nfn map[T, U](x: T) -> U {\n  x\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			expect(fn.typeParams).not.toBeNull();
			const tp = getNode(result, fn.typeParams!);
			if (tp.kind !== "TypeParams") return;
			expect(tp.names).toEqual(["T", "U"]);
		});

		test("function with effect row", () => {
			const src = `module t\nend-module\n\nfn read() -> String ! { fs.read } {\n  x\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			expect(fn.effectRow).not.toBeNull();
			const er = getNode(result, fn.effectRow!);
			if (er.kind !== "EffectRow") return;
			expect(er.effects.length).toBe(1);
			expect(er.tail).toBeNull();
			const eff = getNode(result, er.effects[0]);
			if (eff.kind !== "EffectName") return;
			expect(eff.segments).toEqual(["fs", "read"]);
		});

		test("closed effect row has null tail", () => {
			const src = `module t\nend-module\n\nfn f() -> Int ! { log, net } {\n  1\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			expect(fn.effectRow).not.toBeNull();
			const er = getNode(result, fn.effectRow!);
			if (er.kind !== "EffectRow") return;
			expect(er.effects.length).toBe(2);
			expect(er.tail).toBeNull();
		});

		test("open effect row with tail variable", () => {
			const src = `module t\nend-module\n\nfn f() -> Int ! { log | e } {\n  1\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			expect(fn.effectRow).not.toBeNull();
			const er = getNode(result, fn.effectRow!);
			if (er.kind !== "EffectRow") return;
			expect(er.effects.length).toBe(1);
			expect(er.tail).not.toBeNull();
			const tail = getNode(result, er.tail!);
			expect(tail.kind).toBe("Ident");
			if (tail.kind !== "Ident") return;
			expect(tail.name).toBe("e");
		});

		test("fully open effect row", () => {
			const src = `module t\nend-module\n\nfn f() -> Int ! { | e } {\n  1\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			expect(fn.effectRow).not.toBeNull();
			const er = getNode(result, fn.effectRow!);
			if (er.kind !== "EffectRow") return;
			expect(er.effects.length).toBe(0);
			expect(er.tail).not.toBeNull();
			const tail = getNode(result, er.tail!);
			expect(tail.kind).toBe("Ident");
			if (tail.kind !== "Ident") return;
			expect(tail.name).toBe("e");
		});

		test("function with contracts", () => {
			const src = `module t\nend-module\n\nfn withdraw(amount: Int) -> Int\n  @pre amount > 0\n  @post result > 0\n  @cost tokens: 80\n{\n  amount\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			expect(fn.contracts.length).toBe(3);
			expect(getNode(result, fn.contracts[0]).kind).toBe("ContractPre");
			expect(getNode(result, fn.contracts[1]).kind).toBe("ContractPost");
			expect(getNode(result, fn.contracts[2]).kind).toBe("ContractCost");
		});
	});

	describe("type declarations", () => {
		test("simple alias", () => {
			const src = `module t\nend-module\n\ntype Id = String\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const td = getNode(result, file.decls[0]);
			expect(td.kind).toBe("TypeDecl");
			if (td.kind !== "TypeDecl") return;
			expect(td.name).toBe("Id");
			const val = getNode(result, td.value);
			expect(val.kind).toBe("NominalType");
		});

		test("sum type with leading |", () => {
			const src = `module t\nend-module\n\ntype Color =\n  | Red\n  | Green\n  | Blue\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const td = getNode(result, file.decls[0]);
			if (td.kind !== "TypeDecl") return;
			const sum = getNode(result, td.value);
			expect(sum.kind).toBe("SumType");
			if (sum.kind !== "SumType") return;
			expect(sum.variants.length).toBe(3);
		});

		test("ADT with payloads", () => {
			const src = `module t\nend-module\n\ntype Result[T, E] =\n  | Ok(T)\n  | Err(E)\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const td = getNode(result, file.decls[0]);
			if (td.kind !== "TypeDecl") return;
			expect(td.typeParams).not.toBeNull();
			const sum = getNode(result, td.value);
			if (sum.kind !== "SumType") return;
			const ok = getNode(result, sum.variants[0]);
			if (ok.kind !== "Variant") return;
			expect(ok.name).toBe("Ok");
			expect(ok.payloadKind).toBe("positional");
			expect(ok.payload.length).toBe(1);
		});

		test("refinement type (parsed, not checked)", () => {
			const src = `module t\nend-module\n\ntype Pos = Int where x > 0\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const td = getNode(result, file.decls[0]);
			if (td.kind !== "TypeDecl") return;
			const val = getNode(result, td.value);
			expect(val.kind).toBe("RefinedType");
		});
	});

	describe("expressions", () => {
		// Helper to parse a single expression from a minimal module
		function parseExpr(exprSrc: string): { result: ParseResult; expr: AstNode } {
			const src = `module t\nend-module\n\nfn f() {\n  ${exprSrc}\n}\n`;
			const result = p(src);
			const file = rootNode(result);
			if (file.kind !== "File") throw new Error("not a file");
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") throw new Error("not a fn");
			const block = getNode(result, fn.body!);
			if (block.kind !== "Block") throw new Error("not a block");
			const stmt = getNode(result, block.stmts[0]);
			if (stmt.kind !== "ExprStmt") throw new Error("not an expr stmt");
			return { result, expr: getNode(result, stmt.expr) };
		}

		test("precedence: a + b * c", () => {
			const { result, expr } = parseExpr("a + b * c");
			expect(expr.kind).toBe("BinaryExpr");
			if (expr.kind !== "BinaryExpr") return;
			expect(expr.op).toBe("+");
			const right = getNode(result, expr.right);
			expect(right.kind).toBe("BinaryExpr");
			if (right.kind !== "BinaryExpr") return;
			expect(right.op).toBe("*");
		});

		test("left associativity: a + b + c", () => {
			const { result, expr } = parseExpr("a + b + c");
			expect(expr.kind).toBe("BinaryExpr");
			if (expr.kind !== "BinaryExpr") return;
			expect(expr.op).toBe("+");
			const left = getNode(result, expr.left);
			expect(left.kind).toBe("BinaryExpr");
			if (left.kind !== "BinaryExpr") return;
			expect(left.op).toBe("+");
		});

		test("unary: -a + b", () => {
			const { result, expr } = parseExpr("-a + b");
			expect(expr.kind).toBe("BinaryExpr");
			if (expr.kind !== "BinaryExpr") return;
			expect(expr.op).toBe("+");
			const left = getNode(result, expr.left);
			expect(left.kind).toBe("UnaryExpr");
			if (left.kind !== "UnaryExpr") return;
			expect(left.op).toBe("-");
		});

		test("logical: a && b || c", () => {
			const { result, expr } = parseExpr("a && b || c");
			expect(expr.kind).toBe("BinaryExpr");
			if (expr.kind !== "BinaryExpr") return;
			expect(expr.op).toBe("||");
			const left = getNode(result, expr.left);
			expect(left.kind).toBe("BinaryExpr");
			if (left.kind !== "BinaryExpr") return;
			expect(left.op).toBe("&&");
		});

		test("postfix: foo.bar(x)", () => {
			const { result, expr } = parseExpr("foo.bar(x)");
			expect(expr.kind).toBe("CallExpr");
			if (expr.kind !== "CallExpr") return;
			const callee = getNode(result, expr.callee);
			expect(callee.kind).toBe("FieldAccess");
		});

		test("postfix: foo()?", () => {
			const { result, expr } = parseExpr("foo()");
			expect(expr.kind).toBe("CallExpr");
		});

		test("try operator: x?", () => {
			const { expr } = parseExpr("x?");
			expect(expr.kind).toBe("TryExpr");
		});

		test("named call args: f(x = 1, y = 2)", () => {
			const { result, expr } = parseExpr("f(x = 1, y = 2)");
			expect(expr.kind).toBe("CallExpr");
			if (expr.kind !== "CallExpr") return;
			expect(expr.args.length).toBe(2);
			const arg0 = getNode(result, expr.args[0]);
			expect(arg0.kind).toBe("NamedArg");
			if (arg0.kind !== "NamedArg") return;
			expect(arg0.name).toBe("x");
		});

		test("if expression", () => {
			const src = `module t\nend-module\n\nfn f() {\n  if x {\n    a\n  } else {\n    b\n  }\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
		});

		test("match expression", () => {
			const src = `module t\nend-module\n\nfn f() {\n  match x {\n    Ok(v) => v\n    Err(e) => e\n  }\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			const block = getNode(result, fn.body!);
			if (block.kind !== "Block") return;
			const stmt = getNode(result, block.stmts[0]);
			if (stmt.kind !== "ExprStmt") return;
			const match = getNode(result, stmt.expr);
			expect(match.kind).toBe("MatchExpr");
			if (match.kind !== "MatchExpr") return;
			expect(match.arms.length).toBe(2);
		});

		test("non-associative comparisons produce error on chaining", () => {
			const src = `module t\nend-module\n\nfn f() {\n  a < b < c\n}\n`;
			const result = p(src);
			expect(result.diagnostics.length).toBeGreaterThan(0);
			expect(result.diagnostics[0].message).toContain("chained");
		});
	});

	describe("patterns", () => {
		test("wildcard pattern", () => {
			const src = `module t\nend-module\n\nfn f() {\n  let _ = x\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			const block = getNode(result, fn.body!);
			if (block.kind !== "Block") return;
			const stmt = getNode(result, block.stmts[0]);
			if (stmt.kind !== "LetStmt") return;
			const pat = getNode(result, stmt.pattern);
			expect(pat.kind).toBe("WildcardPat");
		});

		test("constructor pattern: Ok(v)", () => {
			const src = `module t\nend-module\n\nfn f() {\n  match x {\n    Ok(v) => v\n  }\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
		});

		test("literal pattern in match", () => {
			const src = `module t\nend-module\n\nfn f() {\n  match x {\n    200 => a\n    404 => b\n  }\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
		});
	});

	describe("blocks and statements", () => {
		test("let statement with type annotation", () => {
			const src = `module t\nend-module\n\nfn f() {\n  let x: Int = 42\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			const block = getNode(result, fn.body!);
			if (block.kind !== "Block") return;
			const stmt = getNode(result, block.stmts[0]);
			expect(stmt.kind).toBe("LetStmt");
			if (stmt.kind !== "LetStmt") return;
			expect(stmt.type).not.toBeNull();
		});

		test("return statement", () => {
			const src = `module t\nend-module\n\nfn f() -> Int {\n  return 42\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
		});

		test("newlines insignificant inside parens", () => {
			const src = `module t\nend-module\n\nfn f(\n  a: Int,\n  b: Int,\n) {\n  x\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const fn = getNode(result, file.decls[0]);
			if (fn.kind !== "FnDecl") return;
			expect(fn.params.length).toBe(2);
		});
	});

	describe("extern blocks", () => {
		test("extern module with fn and type", () => {
			const src = `module t\nend-module\n\nextern module node/fs {\n  fn read_file(path: String) -> Result[Buffer, Error] ! { fs.read }\n  type Buffer\n}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const ext = getNode(result, file.decls[0]);
			expect(ext.kind).toBe("ExternBlock");
			if (ext.kind !== "ExternBlock") return;
			expect(ext.decls.length).toBe(2);
			expect(getNode(result, ext.decls[0]).kind).toBe("ExternFnDecl");
			expect(getNode(result, ext.decls[1]).kind).toBe("ExternTypeDecl");
		});
	});

	describe("imports", () => {
		test("simple import", () => {
			const src = `module t\nend-module\n\nimport std/result\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const imp = getNode(result, file.decls[0]);
			expect(imp.kind).toBe("Import");
			if (imp.kind !== "Import") return;
			expect(imp.names).toBeNull();
		});

		test("import with names", () => {
			const src = `module t\nend-module\n\nimport std/result {Ok, Err}\n`;
			const result = p(src);
			expect(result.diagnostics).toEqual([]);
			const file = rootNode(result);
			if (file.kind !== "File") return;
			const imp = getNode(result, file.decls[0]);
			if (imp.kind !== "Import") return;
			expect(imp.names).toEqual(["Ok", "Err"]);
		});
	});

	describe("error recovery", () => {
		test("missing closing paren produces diagnostic", () => {
			const src = `module t\nend-module\n\nfn f( {\n}\n`;
			const result = p(src);
			expect(result.diagnostics.length).toBeGreaterThan(0);
		});

		test("unexpected token produces diagnostic", () => {
			const src = `module t\nend-module\n\n+ + +\n`;
			const result = p(src);
			expect(result.diagnostics.length).toBeGreaterThan(0);
		});

		test("multiple errors in one file", () => {
			const src = `module t\nend-module\n\nfn a( {\n}\n\nfn b( {\n}\n`;
			const result = p(src);
			expect(result.diagnostics.length).toBeGreaterThan(1);
		});
	});
});
