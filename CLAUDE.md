# Radahn

A programming language designed for coding agents. Compiler written in TypeScript, runs on Bun, transpiles `.rd` source files to TypeScript.

## Project status

Pre-implementation. Design spec and roadmap exist in `docs/`. No compiler code yet — currently at Epic 0.1 (Project Scaffold & CLI).

## Architecture

See `docs/Design.md` (full language spec) and `docs/Roadmap.md` (sequenced epics).

**Target directory layout** (from Design.md §11.2):
```
src/
  cli.ts              # entry, subcommands: check, build, fmt, contract, summary, locate
  lex/lexer.ts        # source -> tokens
  parse/parser.ts     # tokens -> AST
  parse/ast.ts        # AST node types (tagged-union arena)
  resolve/            # name resolution, content-addressed symbols
  types/              # type inference, effect rows
  contracts/          # @pre, @post, @cost checkers
  emit/ts-emitter.ts  # typed AST -> TypeScript via ts-morph
  diag/               # JSON diagnostic protocol
  util/arena.ts       # id-based AST arena
stdlib/               # written in Radahn (.rd files)
examples/             # runnable .rd programs
tests/
bench/                # agent-eval harness
```

**Key internal patterns:**
- AST uses an arena with numeric IDs; annotation passes attach via `Map<NodeId, T>`
- Tagged unions with `satisfies never` for exhaustiveness on AST node kinds
- JSON diagnostics are the primary product surface — design the schema before the checker
- TS emission via `ts-morph` (node factory methods, not string concat)

## Tech stack

- **Runtime:** Bun
- **Language:** TypeScript (strict)
- **Distribution:** `bun build --compile` (single binary)
- **Testing:** Bun test runner
- **File extension:** `.rd` (Radahn source files)

## Commands

```bash
bun install          # install dependencies
bun test             # run tests
bun run build        # compile the radahn CLI binary
```

## Key design decisions

1. **Effects in signatures** — every side effect (`fs`, `net`, `log`, etc.) declared in the function signature via `!` syntax. Pure functions omit it.
2. **Capabilities as values** — no ambient authority. IO requires explicit capability parameters scoped to specific resources (e.g., `FsRead["/data"]`).
3. **Machine-readable diagnostics** — `radahn check --json` emits JSON-Lines with `{code, span, message, suggest[], docs}`. Agent consumption is a first-class use case.
4. **Content-addressed symbols** — public symbols get stable 64-bit content hashes that survive renames.
5. **Bounded complexity** — functions <= 60 LOC, cyclomatic complexity <= 10, nesting <= 4, params <= 7 (compiler-enforced).
6. **No exceptions** — `Result[T, E]` only. `panic` is a distinct effect (`! Panic`).
7. **Total by default** — partial functions require explicit `partial` keyword.

## v0 scope (what to build now)

The v0 proves the effect-row thesis only. It does NOT include:
- Capability types (v1)
- Contract checking beyond parsing (v1)
- Content-addressed module resolution (v2)
- Refinement type checking (v2)
- WASM/native codegen (v2)

v0 minimum slice: lexer + parser + name resolution + effect checker + TS emission + JSON diagnostics + `radahn contract` command.

## Conventions

- Diagnostic codes use the format `E0NNN` (e.g., `E0407`)
- All compiler subcommands support `--json` flag for structured output
- Source files use `.rd` extension
- The compiler binary is called `radahn`
