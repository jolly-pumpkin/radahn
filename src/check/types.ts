import type { NodeId } from "../util/arena";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Type =
	| { kind: "int" }
	| { kind: "float" }
	| { kind: "string" }
	| { kind: "bool" }
	| { kind: "void" }
	| { kind: "nominal"; name: string; declNode: NodeId; typeArgs: Type[] }
	| { kind: "record"; fields: Map<string, Type> }
	| { kind: "tuple"; elements: Type[] }
	| { kind: "fn"; params: Type[]; returnType: Type; effectRow: EffectRow }
	| { kind: "type-var"; name: string; id: number }
	| { kind: "error" };

// Singleton constants for primitives
export const INT: Type = { kind: "int" };
export const FLOAT: Type = { kind: "float" };
export const STRING: Type = { kind: "string" };
export const BOOL: Type = { kind: "bool" };
export const VOID: Type = { kind: "void" };
export const ERROR_TYPE: Type = { kind: "error" };

// Sentinel NodeId for compiler built-in types (matches resolver's -1)
export const BUILTIN_DECL_NODE = -1 as NodeId;

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export type Effect = {
	name: string;
	fromExtern: boolean;
};

export type EffectRow =
	| { kind: "closed"; effects: Effect[] }
	| { kind: "open"; effects: Effect[]; tail: EffectVar }
	| { kind: "pure" };

export type EffectVar = {
	name: string;
	id: number;
};

export const PURE: EffectRow = { kind: "pure" };

// ---------------------------------------------------------------------------
// Type variable generation
// ---------------------------------------------------------------------------

let nextVarId = 0;
export function freshTypeVar(name: string): Type {
	return { kind: "type-var", name, id: nextVarId++ };
}

export function freshEffectVar(name: string): EffectVar {
	return { name, id: nextVarId++ };
}

export function resetVarCounter(): void {
	nextVarId = 0;
}

// ---------------------------------------------------------------------------
// Type utilities
// ---------------------------------------------------------------------------

export function isError(t: Type): boolean {
	return t.kind === "error";
}

export function printType(t: Type): string {
	switch (t.kind) {
		case "int": return "Int";
		case "float": return "Float";
		case "string": return "String";
		case "bool": return "Bool";
		case "void": return "Void";
		case "error": return "<error>";
		case "type-var": return t.name;
		case "nominal": {
			if (t.typeArgs.length === 0) return t.name;
			return `${t.name}[${t.typeArgs.map(printType).join(", ")}]`;
		}
		case "record": {
			const fields = [...t.fields.entries()]
				.map(([k, v]) => `${k}: ${printType(v)}`)
				.join(", ");
			return `{ ${fields} }`;
		}
		case "tuple":
			return `(${t.elements.map(printType).join(", ")})`;
		case "fn": {
			const params = t.params.map(printType).join(", ");
			const ret = printType(t.returnType);
			const eff = printEffectRow(t.effectRow);
			return `(${params}) -> ${ret}${eff}`;
		}
	}
}

export function printEffectRow(row: EffectRow): string {
	switch (row.kind) {
		case "pure": return "";
		case "closed":
			return ` ! { ${row.effects.map(e => e.name).join(", ")} }`;
		case "open": {
			const concrete = row.effects.map(e => e.name).join(", ");
			if (concrete) return ` ! { ${concrete} | ${row.tail.name} }`;
			return ` ! { | ${row.tail.name} }`;
		}
	}
}

export function typesEqual(a: Type, b: Type): boolean {
	if (a.kind === "error" || b.kind === "error") return true;
	if (a.kind !== b.kind) return false;
	switch (a.kind) {
		case "int": case "float": case "string": case "bool": case "void":
			return true;
		case "type-var":
			return a.id === (b as typeof a).id;
		case "nominal": {
			const bn = b as typeof a;
			if (a.name !== bn.name) return false;
			if (a.typeArgs.length !== bn.typeArgs.length) return false;
			return a.typeArgs.every((arg, i) => typesEqual(arg, bn.typeArgs[i]));
		}
		case "record": {
			const br = b as typeof a;
			if (a.fields.size !== br.fields.size) return false;
			for (const [k, v] of a.fields) {
				const bv = br.fields.get(k);
				if (!bv || !typesEqual(v, bv)) return false;
			}
			return true;
		}
		case "tuple": {
			const bt = b as typeof a;
			if (a.elements.length !== bt.elements.length) return false;
			return a.elements.every((el, i) => typesEqual(el, bt.elements[i]));
		}
		case "fn": {
			const bf = b as typeof a;
			if (a.params.length !== bf.params.length) return false;
			if (!typesEqual(a.returnType, bf.returnType)) return false;
			return a.params.every((p, i) => typesEqual(p, bf.params[i]));
		}
	}
	return false;
}

// Substitution and unification for generics

export function substituteType(t: Type, subst: Map<number, Type>): Type {
	switch (t.kind) {
		case "type-var": {
			const resolved = subst.get(t.id);
			return resolved ? substituteType(resolved, subst) : t;
		}
		case "nominal":
			return {
				kind: "nominal",
				name: t.name,
				declNode: t.declNode,
				typeArgs: t.typeArgs.map(a => substituteType(a, subst)),
			};
		case "record": {
			const fields = new Map<string, Type>();
			for (const [k, v] of t.fields) {
				fields.set(k, substituteType(v, subst));
			}
			return { kind: "record", fields };
		}
		case "tuple":
			return { kind: "tuple", elements: t.elements.map(e => substituteType(e, subst)) };
		case "fn":
			return {
				kind: "fn",
				params: t.params.map(p => substituteType(p, subst)),
				returnType: substituteType(t.returnType, subst),
				effectRow: t.effectRow,
			};
		default:
			return t;
	}
}

export function unify(a: Type, b: Type, subst: Map<number, Type>): boolean {
	if (a.kind === "error" || b.kind === "error") return true;
	if (a.kind === "type-var") {
		const resolved = subst.get(a.id);
		if (resolved) return unify(resolved, b, subst);
		subst.set(a.id, b);
		return true;
	}
	if (b.kind === "type-var") {
		const resolved = subst.get(b.id);
		if (resolved) return unify(a, resolved, subst);
		subst.set(b.id, a);
		return true;
	}
	if (a.kind !== b.kind) return false;
	switch (a.kind) {
		case "int": case "float": case "string": case "bool": case "void":
			return true;
		case "nominal": {
			const bn = b as typeof a;
			if (a.name !== bn.name) return false;
			if (a.typeArgs.length !== bn.typeArgs.length) return false;
			return a.typeArgs.every((arg, i) => unify(arg, bn.typeArgs[i], subst));
		}
		case "record": {
			const br = b as typeof a;
			if (a.fields.size !== br.fields.size) return false;
			for (const [k, v] of a.fields) {
				const bv = br.fields.get(k);
				if (!bv || !unify(v, bv, subst)) return false;
			}
			return true;
		}
		case "tuple": {
			const bt = b as typeof a;
			if (a.elements.length !== bt.elements.length) return false;
			return a.elements.every((el, i) => unify(el, bt.elements[i], subst));
		}
		case "fn": {
			const bf = b as typeof a;
			if (a.params.length !== bf.params.length) return false;
			if (!unify(a.returnType, bf.returnType, subst)) return false;
			return a.params.every((p, i) => unify(p, bf.params[i], subst));
		}
	}
	return false;
}
