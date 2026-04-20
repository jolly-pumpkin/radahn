// Name resolution and scope building.
// Re-exports the public API for the resolve pass.

import type { NodeId, Arena } from "../util/arena";
import type { AstNode } from "../parse/ast";
import type { Diagnostic } from "../diag/types";
import { resolve as resolveImpl } from "./resolver";

export type ResolveResult = {
	resolutions: Map<NodeId, NodeId>; // IdentNode → declaration NodeId
	diagnostics: Diagnostic[];
};

export function resolve(root: NodeId, arena: Arena<AstNode>): ResolveResult {
	return resolveImpl(root, arena);
}

export { Scope } from "./scope";
export type { Symbol, SymbolKind } from "./scope";
