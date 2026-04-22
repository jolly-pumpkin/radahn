export type {
	Type, Effect, EffectRow, EffectVar,
} from "./types";
export {
	INT, FLOAT, STRING, BOOL, VOID, ERROR_TYPE, PURE, BUILTIN_DECL_NODE,
	isError, typesEqual, printType, printEffectRow,
	freshTypeVar, freshEffectVar, resetVarCounter,
	substituteType, unify,
} from "./types";
export { typeCheck } from "./typer";
export type { TypeCheckResult } from "./typer";
export { checkExhaustiveness } from "./exhaustive";
export type { CheckPattern, ExhaustivenessResult } from "./exhaustive";
export { effectCheck } from "./effects";
export type { EffectCheckResult } from "./effects";
