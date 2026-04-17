# Radahn Roadmap

**Scope:** Epic-level feature map. Each epic is a shippable milestone that unlocks the next.
**Source of truth:** [Design.md](./agent-lang-design.md) — this roadmap is the *sequencing* layer over that spec.

---

## Phase 0 — Foundations (v0 POC)

The smallest slice that proves the thesis: *effect rows in signatures reduce agent iteration count and token cost on repo-level edits*.

### Epic 0.1 — Project Scaffold & CLI

Stand up the TypeScript-on-Bun project structure, CI, and the `radahn` CLI entry point with subcommand routing. No compiler logic yet — just the skeleton everything else plugs into. Runs in parallel with 0.2 and 0.3; none of the three block each other.

- Bun project, tsconfig, linting, test runner
- Directory layout: `src/{cli,lexer,parser,ast,resolve,check,emit,diagnostics}`
- CLI binary via `bun build --compile` with subcommand dispatch (`check`, `build`, `fmt`, `contract`, `summary`, `locate`)
- CI (GitHub Actions): run tests + format check on PR
- Smoke test: `radahn --help` exits zero with help text

### Epic 0.2 — Diagnostic Schema

The JSON shape that every compiler pass emits. This is the product surface for AI agents — it's the thing they consume instead of parsed stderr text, so it's pinned before any checker is written. Runs in parallel with 0.1 and 0.3.

- TypeScript type definition for `Diagnostic` (code, severity, message, span, related, suggest[], notes)
- Registry of ~15–25 v0 diagnostic codes (E001 unknown identifier, E002 effect not declared, E003 non-exhaustive match, ...) with example JSON payloads for each
- Documentation: markdown reference listing every code with a short description and example
- `diagnostics.ts` module exports the types; all later epics import from here

### Epic 0.3 — EBNF Grammar

Formal specification of Radahn's v0 syntax. Design §4 describes the language informally; this epic writes the production rules. Pinned before the parser is written so grammar ambiguities get resolved at spec time, not at parser-coding time. Runs in parallel with 0.1 and 0.2.

- EBNF production rules covering the v0 subset: module headers, imports, `fn` signatures with effect rows, ADTs, structural records, refinement syntax (parsed only), `let`, `match`, literals, binary ops, calls, `?` operator, `extern module` blocks
- Explicit disambiguation rules for any non-LR(1) cases (with a stated resolution strategy if needed)
- Example programs (5–10 snippets) annotated with their parse trees, to serve as conformance cases for the parser
- Deliverable: `grammar.ebnf` + `grammar-examples.md`

### Epic 0.4 — Lexer & Parser

Source text → token stream → AST, implementing the grammar from Epic 0.3. Covers the full v0 subset.

- Lexer (tokeniser)
- AST node types (tagged-union arena with numeric IDs)
- Parser producing the arena-based AST
- Round-trip test: parse → pretty-print → re-parse === identity
- Conformance: all grammar examples from 0.3 parse successfully

### Epic 0.5 — Name Resolution & Diagnostics

Resolve every symbol to a declaration or emit a structured error. This is the first epic that produces *agent-facing value* — hallucinated imports and undefined variables become compile errors with fix suggestions.

- Scope building (module-level, function-level, block-level)
- Undefined-variable and undefined-import errors with `suggest[]` fields
- Duplicate-definition errors
- `radahn check --json` wired end-to-end (first real diagnostic output using the schema from 0.2)

### Epic 0.6 — TypeScript Emission

Typed AST → runnable TypeScript. Effect annotations and contracts are erased; structural types map 1:1. Output verified by `tsc --noEmit`. Ships *before* effect checking so there's an executable feedback loop from the start — you can run Radahn programs and see runtime behavior while building the checker in 0.7.

- TS code emitter (via `ts-morph` or direct AST construction)
- `.d.ts` generation for every module
- `radahn build` subcommand: `.rd` → `.ts` + `.d.ts`
- End-to-end test: Radahn source → TS → Bun executes → correct output

### Epic 0.7 — Type Checking & Effect Checking

The core thesis feature, built on top of a working emitter so every checker rule can be validated against runnable programs. Includes annotation-required type checking (all function signatures must have explicit types; bidirectional inference within function bodies is deferred to Epic 1.1). The effect checker walks the call graph and verifies that a function's body only calls functions whose effect rows are subsets of its declared row.

- Annotation-required type checker: verify call-site argument types against declared parameter types, verify return types, resolve ADT constructors and field access. No inference across function boundaries — signatures are the source of truth. (Bidirectional local inference deferred to 1.1.)
- Effect-row representation and subtyping (row polymorphism, Koka-style)
- Effect checker: walk call graph, verify effect containment
- Diagnostics: "function `f` performs effect `net` but its signature declares `! { log }` — add `net` to the effect row or remove the call"
- Pure functions (no `!` clause) verified to call only pure functions
- Type error diagnostics with structured suggestions (wrong argument type, missing field, non-exhaustive match)

### Epic 0.8 — TypeScript Interop (`extern`)

The adoption bridge. `extern module` declarations let Radahn code import real TS/JS libraries with hand-annotated types and effects. Without this, the benchmark is toy-scale.

- `extern module` syntax parsed and resolved
- Type mapping: Radahn types ↔ TS types at the `extern` boundary
- Effect annotations on extern declarations (trusted, not verified)
- Smoke test: Radahn program imports `node:fs` and `fetch` via extern shims

### Epic 0.9 — Agent-Facing Tools

The retrieval layer that makes Radahn cheaper to work with than reading source files.

- `radahn contract <symbol>` — structured JSON: signature, effects, pre/post (stubs in v0), cost (stub)
- `radahn summary <module>` — module header + one-line export summaries, ~90 tokens
- `radahn locate <symbol>` — file and line for a symbol (path-based in v0, hash in v1)

### Epic 0.10 — Formatter

One canonical syntax. `radahn fmt` is the only accepted layout. Ships *before* the stdlib so that all stdlib code is written in canonical format from day one — no noisy reformatting commit later.

- Canonical formatter over the AST (sorted imports, consistent bracing, one-decl-per-line)
- `radahn fmt` subcommand (in-place and stdout modes)
- `radahn fmt --check` for CI gating

### Epic 0.11 — Standard Library & Language Guide

Bootstrap corpus so agents (and humans) can write idiomatic Radahn without having seen training data. All stdlib code is formatted via `radahn fmt` (Epic 0.10) before merge.

- `stdlib/`: `result.rd`, `option.rd`, `list.rd`, `string.rd` — pure foundations
- `stdlib/`: `net.rd`, `fs.rd`, `log.rd` — effectful modules. APIs take opaque capability-token parameters that are just marker types in v0 and become real linear capability types in 1.2. Shape is forward-compatible; enforcement arrives in v1.
- Language guide: grammar cheatsheet, effect-row syntax, capability passing patterns, 3–4 worked examples
- `examples/`: 5–10 runnable programs covering the v0 feature set

### Epic 0.12 — Benchmark Harness & First Results

The experiment that validates or falsifies the v0 thesis. **Epic 0.8 (extern/TS interop) is a hard prerequisite** — without it the task corpus is limited to what Radahn's tiny stdlib can express and the benchmark measures toy problems, not real-world agent ergonomics.

- Benchmark harness: agent loop (Claude Sonnet + tool use) × language (Python, TS, Radahn) × task
- **Pilot round:** 10–20 tasks (trivial, refactor, bug-fix, feature-add, cross-module). Compute bootstrap confidence intervals. If signal direction is consistent, proceed to expansion.
- **Expansion round:** scale to 30+ tasks for statistical validity before declaring the v0→v1 gate. Hallucinated-symbol count is naturally low-frequency; 10 tasks gives very wide confidence intervals.
- Metrics: iterations per fix, tokens per fix, hallucinated-symbol count, pass rate
- Analysis and write-up of v0 results

---

## Phase 1 — Capabilities & Contracts (v1)

Unlocked by: positive signal from v0 benchmark (fewer iterations / tokens in Radahn vs. TS).

Phase 1 adds the two remaining pillars of the design thesis: *capability-scoped authority* and *machine-readable contracts*. Together with effect rows (v0), these three form the complete "signature tells the truth" story.

### Epic 1.1 — Type Inference Expansion

v0 ships an annotation-required type checker (Epic 0.7) — all function signatures need explicit types and the checker verifies call sites against them. This epic expands that into bidirectional inference so ~95% of local bindings need no annotation; explicit types remain required at module boundaries.

- Bidirectional type inference within function bodies (let-binding inference, closure argument inference)
- Generics: type parameters on functions and types, constraint syntax, inference at call sites
- Structural subtyping for records (width subtyping where safe)
- Improved type error diagnostics: expected vs. actual with diff-style display

### Epic 1.2 — Capability Types

Linear capability values that scope authority. `FsRead["/data"]` is distinct from `FsRead["*"]`. Capabilities are passed explicitly; the compiler refuses to widen.

- `cap` keyword and capability type syntax
- Linear capability tracking (consumed or re-borrowed, not duplicated)
- Scope narrowing: `FsRead[path]` checked against declared prefixes
- `requires:` clause in function signatures
- Capability-missing diagnostics with "add parameter" suggestions

### Epic 1.3 — Contract Checking (`@pre`, `@post`, `@cost`)

Contracts become enforced, not just parsed. Static checks where possible; runtime assertions as fallback.

- `@pre` / `@post` as compile-time checks for statically-decidable conditions
- Runtime assertion insertion for data-dependent contracts
- `@cost` as advisory metadata emitted in `radahn contract` output
- `spec` blocks: property-based test generation with shrinking

### Epic 1.4 — Bounded Complexity Enforcement

Compiler-enforced structural limits from the design doc. Placed here because these limits shape the language's character at the stdlib level — deferring means the stdlib ships without them and later enforcement becomes a breaking change. If v1 slips, this is the most deferrable of the v1 epics (it's implementable as a lint pass), but shipping v1 without it means the stdlib gets grandfathered in.

- Function size cap (default 60 LOC), cyclomatic complexity cap (≤10), nesting depth cap (≤4), parameter count cap (≤7)
- `@waiver(reason: "...")` escape hatch, tracked in contract output
- `partial` keyword and `! Diverge` effect for non-terminating functions
- Loop termination measures and bounded recursion declarations

### Epic 1.5 — Package Manager (Hermetic, Content-Addressed)

Dependency management that agents can reason about deterministically.

- `radahn.toml` manifest with declared capability ceilings per dependency
- `radahn.lock` — content-addressed lockfile, no version solving at build time
- Hermetic builds: no network during compile
- Capability-scoped imports: importing a package forces you to pass the caps it declares
- No transitive authority enforcement

### Epic 1.6 — Ecosystem Tooling (begins in v1, continues through v2)

Starts during v1 in parallel with the package manager. The `@types/*`-equivalent effect annotations for popular npm packages are what make `extern` declarations trustworthy — this directly addresses v0's honest-cost caveat about trust holes at the extern boundary.

- Community-maintained effect annotation packages for popular npm libraries (Express, Zod, node:fs, node:http, etc.)
- LSP server (language server protocol) for IDE integration
- `radahn migrate <file.ts>` — assisted TS → Radahn conversion tool (basic version)

### Epic 1.7 — Expanded Benchmark (v1)

Re-run the v0 benchmark with the full v1 feature set. Add tasks that specifically exercise capabilities and contracts.

- Expanded task corpus (50+ tasks) including capability-threading and contract-violation scenarios
- Comparison against Rust (not just Python/TS)
- Measure: does capability scoping reduce "agent wrote code that exceeded authority" failures?
- Measure: do contracts reduce iteration count for bug-fix tasks?
- Bootstrap confidence intervals required for gate criteria (mirroring v0→v1 rigor)

---

## Phase 2 — Verification & Maturity (v2)

Unlocked by: v1 benchmark shows capability + contract features compound the v0 gains.

Phase 2 pushes toward production-grade correctness tooling and alternative compilation targets.

### Epic 2.1 — Content-Addressed Modules

Deferred from v1. The engineering lift is large (name/hash registry, rewriter, impact analysis) and the benchmark payoff is weak until the ecosystem scales — content-addressed resolution helps most when there are many packages and many rename-across-boundary operations, which is a Phase 2 problem, not a v1 problem.

- Content hashing of public symbol ASTs (stable across whitespace/formatting)
- `name@hash` resolution in imports
- `radahn locate <hash>` resolves by hash
- Auto-rewriter: rename propagation across callers when name changes but hash doesn't
- `radahn impact <diff>` — given an edit, report which symbol hashes change and their dependents

### Epic 2.2 — Refinement Types

Predicates on primitive types, checked at compile time where possible, runtime otherwise.

- `Int where x > 0`, `String where len(x) <= 256` syntax (already parsed in v0; now checked)
- SMT integration (Z3) for static refinement verification
- `@heavy-smt` opt-in flag for expensive proofs
- Refinement propagation through `match` arms and `if` guards

### Epic 2.3 — WASM Compilation (Component Model)

Real capability enforcement at the runtime level, not just compile-time.

- WASM component model output target
- Capability enforcement via WASM component boundaries (not just type checking)
- `radahn build --target wasm` subcommand

### Epic 2.4 — Native Compilation

Performance-critical path for production use.

- LLVM or Cranelift backend
- `radahn build --target native` subcommand
- Benchmark: runtime performance vs. Bun-executed TS output

### Epic 2.5 — Self-Hosting

The Radahn compiler written in Radahn, transpiled to TS for bootstrapping. **Depends on Epic 2.2 (refinement types) completed, not in-progress** — the compiler's internal AST uses refinement types for node IDs and bounded indices. Self-hosting before refinement types are solid means rewriting the compiler a second time.

- Rewrite compiler passes in Radahn (lexer, parser, checker, emitter)
- Bootstrap chain: Radahn source → (existing TS compiler) → TS → Bun → compiles new Radahn source
- Dogfooding: the compiler itself validates bounded complexity, effect rows, and capability discipline

### Epic 2.6 — Ecosystem Tooling (continued from 1.6)

Expands on the foundation laid in Epic 1.6 with deeper automation.

- Automatic effect inference for TS code behind `extern` boundaries (replaces hand-written annotations)
- `radahn migrate <file.ts>` — full assisted migration with effect inference (builds on basic version from 1.6)
- Effect annotation coverage dashboard for npm ecosystem

---

## Dependency Graph

Legend: `├→` items may run in parallel under the parent; `└→` strictly sequential.

```
0.1 Scaffold ─┐
0.2 Schema ───┼→ (all three complete before 0.4)
0.3 Grammar ──┘
                └→ 0.4 Lexer/Parser
                    └→ 0.5 Name Resolution
                        └→ 0.6 TS Emission (runnable baseline first)
                            └→ 0.7 Type & Effect Checking
                                ├→ 0.8 TS Interop (extern) ←── load-bearing for benchmark realism
                                ├→ 0.9 Agent Tools
                                └→ 0.10 Formatter
                                    └→ 0.11 Stdlib & Guide (all code formatted from day one)

0.7 + 0.8 (required) + 0.9 + 0.11 → 0.12 Benchmark
                                      ├→ pilot (10–20 tasks)
                                      └→ expansion (30+ tasks, required for gate)

0.12 (positive signal) →
    1.1 Type Inference Expansion
     ├→ 1.2 Capability Types
     │   └→ 1.5 Package Manager
     ├→ 1.3 Contract Checking
     └→ 1.4 Bounded Complexity
    1.6 Ecosystem Tooling (begins parallel with 1.5, continues through v2)
    All v1 epics → 1.7 Expanded Benchmark

1.7 (positive signal) →
    2.1 Content-Addressed Modules (deferred from v1 — ROI scales with ecosystem)
    2.2 Refinement Types
    2.3 WASM (parallel with 2.2)
    2.4 Native (after 2.3)
    2.5 Self-Hosting (after 2.2 completed — needs refinement types)
    2.6 Ecosystem Tooling continued (ongoing from 1.6)
```

Note: epic ordering is topological, not temporal. No timeboxes are committed at the roadmap level; Design §11.6 sketches a ~6-weekend solo part-time estimate for v0 as a sanity check, not a deadline.

---

## Decision Gates

| Gate | Criteria | If no-go |
|---|---|---|
| **v0 → v1** | On 30+ benchmark tasks, **≥2 of 3** metrics improve (iterations, tokens, hallucinated symbols) vs. TS, **or** any single metric improves by ≥20%. Bootstrap confidence intervals must exclude zero for the claimed improvements. | Revisit effect-row design; consider pivoting to a TS plugin/linter instead of a new language |
| **v1 → v2** | On 50+ task corpus: capability + contract features compound v0 gains with ≥10pp resolution improvement over equivalent Rust tasks. Bootstrap confidence intervals must exclude zero (same statistical rigor as v0→v1 gate). | Ship v1 as the product; defer verification/native to community demand |
| **v2 → stable** | Self-hosted compiler passes its own bounded-complexity checks; 50+ real-world packages with effect annotations | Continue iterating on v2 features |

---

## Out of Scope (all phases)

Explicit non-goals so later planning rounds don't reintroduce them by drift:

- Macros or metaprogramming beyond what the grammar directly expresses
- Effect handlers as first-class values (effects are declarative annotations, not dispatchable)
- Module-system features beyond content-addressed resolution (no nominal module hierarchies, no module parameters)
- Language interop beyond TypeScript/JavaScript (no Python, Java, Go, C FFI in any phase)
- GUI or framework-specific tooling (editor plugins beyond LSP, build-system integrations beyond `radahn build`)
- Runtime reflection or dynamic code loading