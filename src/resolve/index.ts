// Name resolution and scope building.
// Re-exports the public API for the resolve pass.

export { resolve } from "./resolver";
export type { ResolveResult } from "./resolver";
export { Scope } from "./scope";
export type { Symbol, SymbolKind } from "./scope";
