# Radahn: a programming language designed for coding agents

**Author:** Collin
**Date:** 2026-04-17
**Audience:** you (terse, dense, PL-literate)
**Status:** opinionated v0 proposal grounded in 2024–2026 benchmark evidence
**Codename:** Radahn — *"hold the stars in place."* The compiler pins every symbol, effect, and contract against the drift an agent + human team would otherwise introduce. (Formerly referred to as "Radahn" throughout earlier drafts; the working name is now Radahn, and the compiler binary is `radahn`. Source files use `.rd`.)

Every numeric or empirical claim below is marked **[evidence]** with a link, or **[inference]** when I am extrapolating past the evidence. Treat inference claims as hypotheses worth A/B-testing once a prototype exists.

---

## 0. TL;DR

Agents currently do best in languages where the compiler can answer the question *"is this call real?"* before a test ever runs. The evidence from **Multi-SWE-bench**, **SWE-bench Multilingual**, **Aider Polyglot**, and **MultiPL-E** converges on a counter-intuitive ranking: at the frontier model tier, **Rust** and **TypeScript** outperform Python on *repo-level edits* even though Python dominates *greenfield generation*. The delta is explained by three mechanisms: (1) type-directed feedback cuts hallucinated APIs early, (2) explicit error sites compress the failure surface into narrow, locatable lines, and (3) narrow module boundaries improve retrieval precision.

Radahn operationalises those three mechanisms as *language rules*, not linter opinions:

1. **Effects and capabilities in signatures** — every `fs`, `net`, `proc`, `time`, `rand` is a typed capability passed by argument. No ambient authority.
2. **Machine-readable contracts at every public symbol** — preconditions, postconditions, effect row, capability set, token-budget hints, and stable symbol IDs are part of the surface syntax and survive in the binary.
3. **Bounded units** — a `fn` is ≤ a declared LOC cap (default 60), recursion is explicit and bounded, loops declare termination measures.
4. **One canonical syntax** — no macros the compiler can't expand to the AST, no overloading by arity, a single formatter, and a grammar that is LR(1)-parseable and line-stable.
5. **Module boundaries are rename-barriers** — cross-module symbols resolve through a content-addressed registry (à la Unison), so agents never hallucinate names that aren't there.
6. **Verification-first toolchain** — `radahn check` returns a structured, token-efficient diagnostic protocol designed for consumption by an LLM, not a human.

The design borrows *principles* from NASA/JPL Power of Ten and MISRA C — bounded control flow, no dynamic allocation after init, explicit failure sites — but rejects their process overhead.

**Implementation target (v0 POC):** the Radahn compiler is written in **TypeScript and runs on Bun**, and transpiles Radahn source (`.rd`) to TypeScript. Full rationale in §12. The v0 is a thought-experiment proof-of-concept: the goal is to prove the design's agent-ergonomics thesis via benchmark evidence, not to build a production compiler. If the POC validates, a rewrite in Rust (or self-hosting in Radahn) is the natural v1 path.

---

## 1. Research findings

### 1.1 Repo-level (SWE-style) vs. greenfield benchmarks

| Benchmark | Scope | Languages | Top published result | What it measures |
|---|---|---|---|---|
| **SWE-bench Verified** | Repo-level issue fix | Python only | ~63% (Claude 3.7 Sonnet, 2025) [evidence][swe-sonnet] | End-to-end patch on real GitHub issues |
| **SWE-bench Multilingual** | Repo-level issue fix | 9 langs (C, C++, Go, Java, JS, TS, PHP, Ruby, Rust) | 43% (Claude 3.7 Sonnet + SWE-agent) [evidence][swe-sonnet] | Same framing, different langs |
| **Multi-SWE-bench** (ByteDance, NeurIPS D&B 2025) | Repo-level issue fix | Java, TS, JS, Go, Rust, C, C++ (1,632 instances) | See [multi-swe-paper] for per-lang numbers | 9 LLMs × 3 agent scaffolds (Agentless, SWE-agent, OpenHands) [evidence][multi-swe-paper] |
| **SWE-PolyBench** (Amazon, 2025) | Repo-level, repo-tree + syntax-tree metrics | Python, Java, JS, TS (2,110 instances) | See [poly-paper] | Adds structured metrics beyond pass@1 [evidence][poly-paper] |
| **Aider Polyglot** | Targeted edit+fix on Exercism problems | C++, Go, Java, JS, Python, Rust (225 problems, 2 attempts w/ test feedback) | 0.880 (GPT-5); mean 0.581 [evidence][aider-lb] | Models must *edit files* and *read test output* |
| **MultiPL-E** | Greenfield unit-test generation | 18+ languages translated from HumanEval/MBPP | See [multipl-e] | Isolated function generation |
| **LiveCodeBench (LCB-V6)** | Contest generation | Python | ~54 failures out of 175 (Claude Sonnet-4) [evidence][lcb-survey] | Contamination-controlled contest problems |
| **BigCodeBench-Hard** | Library-heavy Python tasks | Python | 68–77% failure across frontier models [evidence][lcb-survey] | Complex API composition |

**Key empirical take-aways**

1. **Repo-level Python >> repo-level multilingual at the frontier.** The same agent + model scores 63% on Python-only SWE-bench Verified but 43% on the 9-language multilingual set — a ~20-point drop [evidence][swe-sonnet]. This gap is the headline number you cannot ignore.
2. **Within multilingual, Rust is top, C/C++ are bottom.** Anthropic's own SWE-bench Multilingual report says *"Resolution rate varies by language, with Rust having the highest resolution rate and C/C++ the lowest"* [evidence][swe-sonnet]. That is a striking data point because Rust is also the language humans find hardest; the compiler is doing the work.
3. **Greenfield vs repo-level diverges.** In MultiPL-E (greenfield), Codex was reported *best on JavaScript* and equal on C++/Scala/TS/Python [evidence][multipl-e]. In repo-level benchmarks, the language ordering flips — Python has training-data advantage in greenfield generation, but Rust/TS have *compiler-assisted repair* advantage in repo edits.
4. **Type-constrained decoding "reduces compilation errors by more than half"** vs. syntax-only constraints in the 2025 PLDI paper by Mündler et al. [evidence][type-constrained]. Secondary summaries report the specific numbers as ~74.8% vs. ~9.0%, but I've not confirmed the exact figures against the paper PDF — treat the ">50%" claim as load-bearing and the precise percentage as approximate. This is direct evidence that *exposing the type system to the decoder* is more valuable than exposing a parser.
5. **C-to-Rust transpilation fails ~25% of the time on compile even with o1** [evidence][type-constrained]. Rust forces the error to be *caught early* rather than silently shipped.
6. **"AI slop" patterns are concentrated in dynamic languages** — hallucinated imports, `any` abuse, deprecated API calls [evidence][karpeslop]. These are exactly the failure modes that static types + capability-scoped imports prevent by construction.

### 1.2 Why languages differ: mechanisms

From the primary sources above, the properties that predict agent success are:

| Property | Mechanism | Evidence |
|---|---|---|
| **Static types** | Compiler catches hallucinations before they run; type-constrained decoding cuts errors by >50% | [type-constrained], [do-ts-types] |
| **Explicit error paths** | Failure sites are locatable; no silent exceptions crossing module boundaries | Rust SWE-bench leadership [swe-sonnet]; RustAssistant achieves 74% fix accuracy *because* rustc errors are precise [rust-assistant] |
| **Deterministic toolchain** | Agent can iterate: write → compile → read diagnostics → edit. Go/Rust/TS have this; C++ and CMake do not in a reliable way | [inference from Rust vs C++ gap in multilingual] |
| **Small, well-named units** | Retrieval into LLM context works better when files are small and symbol names are globally unique | [inference, but consistent with Unison's content-addressed design] |
| **Type annotations present** | MultiPL-E found *type annotations have limited impact on model performance for gradually typed languages* [evidence][multipl-e]. Interpretation: annotations help the *compiler* more than the *model*, and the compiler then helps the agent. |

### 1.3 Properties that hurt agents

| Property | Mechanism | Evidence |
|---|---|---|
| **Ambient authority / global side effects** | Model cannot tell from a call site whether it touches disk, network, clock | MISRA-style rules exist specifically to bound this [misra] |
| **Undefined behaviour (C/C++)** | Compiler and linter disagree; "works" in debug, breaks in release | MISRA C Rule 1.3 explicitly: "no occurrence of undefined behavior" [misra] |
| **Macro expansion and reflection** | Symbol doesn't exist in source; agent can't grep for it | [inference, but explains C++/Ruby difficulty on benchmarks] |
| **Build-system complexity (CMake, Maven, webpack)** | Agent burns tokens on config instead of code | [inference; consistent with Go/Rust outperforming Java/C++ on Multi-SWE-bench] |
| **Long files and big symbols** | One edit requires loading too much context; locality is destroyed | NASA Power of Ten rule 4: function on one page [power-of-10] |
| **Verbose error handling boilerplate** | Every function carries 3× the tokens for plumbing, compressing out intent | Token-count studies show JS at 148 tokens/task vs Python 130 [token-ranking] (weak evidence, Rosetta-based) |
| **Pointer and aliasing complexity** | Agent can't reason about what a mutation affects | Austral's linear types exist exactly for this [austral] |
| **Non-hermetic dependencies** | A change in remote package semantics breaks recall; "slopsquatting" | [slopsquat] |

### 1.4 What tooling/syntax choices reduce context load

- **Stable, content-addressed symbol IDs** (Unison [unison-abilities]): renames don't break references; agent retrieval is deterministic.
- **Effect rows / algebraic abilities** (Koka, Unison): the signature *states* what a function can do. Agent reads one line instead of 200 [evidence][koka].
- **Linear types + capabilities** (Austral): side-effectful resources are values that must be threaded explicitly; no hidden state [austral].
- **Type-constrained decoding** (Mündler et al. 2025): parser + type checker guide the model at generation time, not just at lint time [type-constrained].
- **Canonical formatting** (gofmt-style): diff noise collapses; agents edit fewer tokens to make the same change [inference, widely held].

---

## 2. Ranked design matrix

Columns scored **1–5** where 5 is best-for-agents. Each cell summarises the case with a source anchor. Scores are my synthesis, not a measured number; I've flagged which axes are evidence-backed vs. inference.

| Language | Agent success (repo) | Token efficiency | Context locality | Toolchain friction | Safety | Large-repo fit | Notes |
|---|---|---|---|---|---|---|---|
| **Python** | **5** (greenfield) / **3** (repo) | 5 | 3 | 3 | 2 | 2 | 63% SWE-bench Verified [evidence][swe-sonnet]; dynamic, ambient IO; 130 tok/task median [token-ranking]. Training-data tailwind, but fails on refactors that require type reasoning. |
| **TypeScript** | **4** | 3 | 4 | 3 | 4 | 4 | Gradual typing + rich ecosystem; type-constrained decoding works [type-constrained]. `any` abuse is a real-world slop channel [karpeslop]. |
| **JavaScript** | 3 | 3 | 2 | 2 | 2 | 2 | Same ecosystem as TS but no type system; hallucinated imports common [karpeslop]. SWE-PolyBench has 1,017 JS tasks [poly-paper]. |
| **Go** | **4** | 3 | **5** | **5** | 4 | 4 | Single binary toolchain, single formatter, small std lib surface. Explicit error returns are ideal for agents (every failure site is visible). Verbose `if err != nil` burns tokens but *locates* failure. |
| **Rust** | **5** (repo) | 2 | 4 | 3 | **5** | 4 | Highest resolution among SWE-bench Multilingual languages [evidence][swe-sonnet]. Borrow checker is *guardrail* for agents [rust-substack]. Compile-error-fix loop works well (RustAssistant 74% [rust-assistant]). Token-heavy syntax. |
| **Java** | 3 | 2 | 3 | 2 | 3 | 3 | Verbose, heavy Maven/Gradle, reflection hides symbols. SWE-PolyBench has 165 Java tasks [poly-paper]. |
| **C** | 2 | 4 | 3 | 2 | 1 | 2 | Terse but undefined behaviour dominates [misra]. Lowest resolution rate in SWE-bench Multilingual [evidence][swe-sonnet]. |
| **C++** | **1** | 2 | 2 | 1 | 1 | 1 | Template metaprogramming, ODR violations, build system hell. Lowest benchmark scores [evidence][swe-sonnet]. |
| **Radahn (proposed)** | *target 5+* | *target 4* | *target 5* | *target 5* | *target 5* | *target 5* | See design below. |

Aggregate take: **Rust and Go are the best existing substrates for agents**; Python wins greenfield tasks but loses repo tasks. The proposed language inherits Rust's error locality and Go's toolchain simplicity, adds explicit effects and capabilities, and replaces runtime introspection with static machine-readable contracts.

---

## 3. Design implications

From §1 and §2, the language-level commitments fall out:

1. **Static, structural, inferred types by default.** Turing-complete type system is a liability; use a predicative subset that is decidable in linear time per file, so agents can reason locally.
2. **Effects in signatures, always.** No ambient IO, no ambient allocation, no ambient panic. If the function touches the world, the signature says so.
3. **Capabilities as first-class values.** You can't `read_file("/etc/passwd")` unless someone handed you a `FsRead` capability scoped to a path prefix. Entry points declare the capability set; everything downstream is lexically scoped.
4. **Bounded complexity per unit.** Functions ≤ 60 lines (configurable per project), cyclomatic complexity ≤ 10, recursion depth declared or bounded, loops carry a termination measure.
5. **Content-addressed symbol identity.** Every public symbol has a 64-bit content hash. The hash is stable across whitespace/rename; cross-module references store both `name@hash`. Agent retrieval uses the hash as ground truth; the name is a hint.
6. **Machine-readable, compiler-enforced contracts.** `@pre`, `@post`, `@effect`, `@cap`, `@cost` are part of the grammar, not comments. The compiler enforces types for preconditions; runtime checks for data-dependent ones. An agent can ingest them as JSON at near-zero token cost via `radahn contract <symbol>`.
7. **Deterministic build.** Hermetic, content-addressed packages. No transitive version solving at build time; the lockfile *is* the dependency graph.
8. **One canonical syntax, one canonical formatter.** Grammar is LR(1), newlines are significant only at statement terminators, no tabs vs. spaces, no layout rules beyond indentation-for-humans.
9. **Diff- and patch-friendly layout.** Imports sorted, one declaration per line, no trailing semicolons, no line-continuation characters. A rename touches exactly one site per reference.
10. **Verification built into the core, not bolted on.** Refinement types on integers (`u32 where x < BUF_LEN`), exhaustive pattern matching required, total functions are the default and `partial` is an opt-in keyword.

---

## 4. Radahn — proposed specification v0

*"Hold the stars in place."*

### 4.1 Overview

- **Name:** Radahn (codename, after General Radahn the star-holder; the metaphor is a compiler pinning every symbol, effect, and contract against drift).
- **File extension:** `.rd` (short form) or `.radahn` (long form).
- **Compiler binary:** `radahn`.
- **Tagline:** *"hold the stars in place."*
- **Paradigm:** statically typed, ML-family with Rust-like ownership but *without* lifetimes exposed in surface syntax. Structural records, nominal ADTs, row-polymorphic effects (Koka-style [koka]), linear capabilities (Austral-style [austral]), content-addressed modules (Unison-style [unison-abilities]).
- **Execution (v0):** transpiled to TypeScript; runs on Bun, Node, or Deno. **Execution (v1+):** WASM via the component model for real capability enforcement; native via LLVM/Cranelift as the stretch target. Deterministic by default (seeded RNG, virtual clock) unless `Time` / `Rand` caps are held.
- **Tooling:** single binary `radahn` (compiler + formatter + test runner + package manager + LSP + contract inspector), distributed via `bun build --compile` for the v0.
- **License:** permissive (Apache-2.0).

### 4.2 Lexical and grammatical rules

- UTF-8 source. ASCII identifiers only (no homoglyph attacks on agents or humans).
- Keywords are lowercase: `fn`, `let`, `if`, `match`, `module`, `import`, `export`, `effect`, `cap`, `type`, `trait`, `impl`, `where`, `pre`, `post`, `spec`, `test`, `partial`, `linear`.
- One statement per line. Block structure uses `{ }`. No significant whitespace rules beyond a canonical format.
- Comments: `//` for human-readable, `///` for doc, `//@` for machine-readable contract annotations *outside* the grammar (the grammar itself already has `@pre` etc.; `//@` is reserved for tooling like LSP hints).
- LR(1) grammar; ambiguity resolves without lookahead beyond 1 token.

### 4.3 Modules and symbols

Every file is a module. Module header is *required* and *machine-readable*:

```
module payments.refunds
  version: 1.4.0
  exports: [refund, RefundError, RefundReceipt]
  effects: [Fs<"./receipts/">, Net<"api.example.com:443">, Log]
  caps:    [FsWrite, NetHttps, LogWrite]
  since:   "2026-03-01"
  summary: "Issue partial and full refunds against charge IDs."
end-module

// ...code below...
```

- `version` is SemVer but enforced by the package manager against actual ABI change (compiler computes).
- `exports` is the closed, declared surface area. If a symbol is not exported, it is *invisible* outside the module — the name is not merely private, the hash is not published.
- `effects` is the union of effect rows of all exports.
- `caps` is the union of required capabilities.
- Every exported symbol receives a stable content-addressed ID: `payments.refunds::refund@7b3f…`. Renames bump the name but preserve the hash so references remain valid across a rename diff.

### 4.4 Effects and capabilities

Every function signature declares its effect row:

```
fn read_config(path: Path) -> Result[Config, ConfigError]
  ! Fs<read>, Log
  requires: fs: FsRead[path]
  @pre  valid_path(path)
  @post result.ok => config_schema_valid(result.val)
end
```

- `!` introduces the effect row. Pure functions omit it.
- `requires:` names the capability values that must be passed in. Capabilities are linear values: you get one, you use it, it's consumed or re-borrowed.
- Capabilities are *scoped* — `FsRead[path]` is distinct from `FsRead[*]`. The compiler refuses to widen.
- The root of the program is `fn main(env: Env)` where `Env` is the full capability bundle granted by the runtime. Everything downstream must receive capabilities explicitly — **no ambient authority, ever**.

### 4.5 Contracts

Contracts are part of the grammar, not comments:

```
fn withdraw(account: Account, amount: Money) -> Result[Account, WithdrawError]
  @pre  amount > 0.00
  @pre  account.balance >= amount
  @post result.ok => result.val.balance == account.balance - amount
  @post result.err => account.balance_unchanged(result.err.account)
  @cost tokens: 80, ops: 4
end
```

- `@pre` / `@post` are checked statically when the refinement holds at compile time (SMT-backed via Z3); otherwise compiled to runtime assertions.
- `@cost` is advisory but *machine-readable*: the compiler emits a per-symbol cost estimate and the agent planner can budget against it.
- `spec` blocks let you write property-based tests adjacent to the function; the compiler runs them via QuickCheck-style shrinking:

```
spec withdraw
  for all account: Account, amount: Money where amount > 0 && account.balance >= amount,
    let result = withdraw(account, amount)
    assert result.ok
    assert result.val.balance + amount == account.balance
end
```

### 4.6 Types and ownership

- **Nominal ADTs**, structural records. ADTs must be exhaustively matched (non-exhaustive match is a compile error, not a warning).
- **Linear resources** for capabilities, file handles, sockets, DB connections. Values marked `linear` cannot be copied; `borrow` for temporary read-only access, `borrow mut` for exclusive mutation. No lifetime annotations in surface syntax — the compiler infers and reports regions in diagnostics, but you don't write `<'a>`.
- **Refinement types on primitives** (`Int where x > 0`, `String where len(x) ≤ 256`) for the common cases. SMT-heavy refinements require an opt-in `@heavy-smt` flag so builds remain fast.
- **Total-by-default**: every function must terminate unless marked `partial`. Loops carry a termination measure; recursion declares a decreasing metric.

### 4.7 Bounded complexity

Compiler-enforced:

1. Functions ≤ 60 source lines (overridable per-project; configurable in `agl.toml`). Rationale: NASA Power of Ten rule 4 [power-of-10].
2. Cyclomatic complexity ≤ 10.
3. Nesting depth ≤ 4.
4. Max 7 parameters per function; beyond that, pass a record.
5. No dynamic allocation after the `init` phase unless a function declares `! Alloc`. Bulk allocations happen in `init` blocks that run before `main`.
6. No global mutable state. Module-level `let` is constant; anything mutable lives in a capability-bearing object.

These are violable only with a per-symbol `@waiver(reason: "…")` annotation, which is visible in the contract and in code review.

### 4.8 Error handling

- No exceptions. `Result[T, E]` is the canonical failure type.
- `?` operator unwraps `Result` and propagates the error, but **only when the caller's error type contains E**. No implicit widening; the compiler's error message tells the agent exactly which `From` impl to add.
- `panic` is a distinct effect (`! Panic`) and is only reachable from functions that declare it. A library author writing `! Pure` cannot smuggle in a panic.

### 4.9 Package manager

- Content-addressed. A package is `name@hash`. The lockfile lists hashes; no version solving at build time.
- Hermetic: no network during build. All dependencies must be fetched and pinned in `agl.lock`.
- Capability-scoped imports: a package declares the maximum capability set it needs in its manifest. Importing it in your program forces you to pass those caps in or explicitly refuse. A pure utility library gets zero caps; a logging library gets `LogWrite`.
- No transitive authority: if library A imports library B, B cannot access capabilities that A was not granted.

### 4.10 The compiler's agent protocol (`agc`)

Every subcommand produces two outputs: human-pretty text (ANSI-coloured) and a structured JSON-Lines stream on request (`--json`). Diagnostics are stable, numbered, and each contains:

```
{"code":"E0407","span":{"file":"src/refund.agl","line":42,"col":17,"len":8},
 "message":"cap `FsWrite` not in scope","suggest":[
   {"edit":"add parameter","at":{"line":40,"col":24},"insert":", fs: FsWrite[...]"}],
 "docs":"https://agl.dev/e/0407"}
```

Agents read JSON-Lines, apply `suggest.edit` entries as patches, re-run `radahn check`. Typical fix loop: one diagnostic → one edit → re-check. Token cost per fix target: <500 tokens.

Subcommands critical for agents:

- `radahn contract <symbol>` → machine-readable spec for a single symbol. Pre/post, effects, caps, cost, neighbours.
- `radahn locate <hash>` → file and line for a content-addressed ID.
- `radahn summary <module>` → top-of-module header + one-line summary of each export. Roughly 20–80 tokens per module.
- `radahn impact <edit-plan>` → given a proposed diff, returns symbol hashes that change and their downstream dependents.
- `radahn test --changed` → runs only tests whose dependency graph intersects the edit.

---

## 5. Syntax sketch: worked examples

### 5.1 A module, end to end

```
module payments.refunds
  version: 1.4.0
  exports: [refund, RefundError, RefundReceipt]
  effects: [Fs<write>, Net<https>, Log]
  caps:    [FsWrite["./receipts/"], NetHttps["api.stripe.com:443"], LogWrite]
  since:   "2026-03-01"
  summary: "Issue partial and full refunds against charge IDs."
end-module

type ChargeId   = String where len(x) == 18 && starts_with(x, "ch_")
type Money      = { cents: Int where x >= 0, currency: Currency }
type Currency   = | USD | EUR | GBP

type RefundError
  = | NotFound(ChargeId)
    | InsufficientBalance(avail: Money, want: Money)
    | Network(reason: String)
    | Upstream(code: Int, body: String)

type RefundReceipt = {
  id:        String,
  charge_id: ChargeId,
  amount:    Money,
  at:        Timestamp,
}

fn refund(
  charge_id: ChargeId,
  amount:    Money,
  fs:        borrow mut FsWrite["./receipts/"],
  http:      borrow     NetHttps["api.stripe.com:443"],
  log:       borrow mut LogWrite,
) -> Result[RefundReceipt, RefundError]
  ! Fs<write>, Net<https>, Log
  @pre  amount.cents > 0
  @post result.ok => exists_receipt_file(result.val.id)
  @cost tokens: 120, ops: ~6
{
  log.info("refund:start", charge_id)
  let resp = http.post("/v1/refunds", body = { charge: charge_id, amount: amount.cents })?
  match resp.status {
    200 => {
      let receipt = parse_receipt(resp.body)?
      fs.write(path = receipt.id + ".json", bytes = resp.body)?
      log.info("refund:ok", receipt.id)
      Ok(receipt)
    }
    404 => Err(NotFound(charge_id))
    402 => Err(InsufficientBalance(parse_balance(resp.body), amount))
    s   => Err(Upstream(s, resp.body))
  }
}

spec refund
  for all id: ChargeId, amt: Money where amt.cents > 0,
    assume http_mock_returns(200, valid_receipt_json(id, amt))
    let r = refund(id, amt, fs = mock_fs(), http = mock_http(), log = mock_log())
    assert r.ok
    assert r.val.charge_id == id
end
```

**What an agent sees first** when asked to touch this module:

```
$ radahn summary payments.refunds
module payments.refunds @ 1.4.0  (hash f2c4…)
  effects: Fs<write>, Net<https>, Log
  caps:    FsWrite["./receipts/"], NetHttps["api.stripe.com:443"], LogWrite

exports:
  refund(charge_id, amount, fs, http, log) -> Result[RefundReceipt, RefundError]
      — Issue a refund against a Stripe charge and persist the receipt.
      pre:  amount.cents > 0
      post: result.ok => exists_receipt_file(result.val.id)
      cost: ~120 tokens, ~6 ops
  type RefundError    — 4 variants
  type RefundReceipt  — 4 fields
```

≈ 90 tokens. The agent now knows the entire public surface without reading a single function body.

### 5.2 A diagnostic the agent can act on

Suppose the agent writes a function that forgets to thread the `FsWrite` cap:

```
// agent writes:
fn save_receipt(r: RefundReceipt) -> Result[(), FsError] ! Fs<write> {
  write_file(r.id + ".json", encode(r))?  // ← compiler rejects
}
```

`radahn check --json` emits:

```
{"code":"E0407","file":"src/refund.agl","line":3,"col":3,
 "message":"function calls `write_file` which requires cap `FsWrite`, but none is in scope",
 "suggest":[
   {"kind":"add-param","at":{"line":1,"col":36},
    "insert":", fs: borrow mut FsWrite[_]",
    "rationale":"forward the capability from the caller"},
   {"kind":"narrow-cap","insert":"FsWrite[\"./receipts/\"]",
    "rationale":"use the module's declared path prefix"}
 ],
 "docs":"https://agl.dev/e/0407"}
```

An agent loop: read JSON → apply first suggestion → re-run. If the fix compiles, ship. The compiler just saved the agent from inventing a new IO channel.

### 5.3 Content-addressed rename

```
$ git diff
- fn refund(charge_id, amount, fs, http, log) ...
+ fn issue_refund(charge_id, amount, fs, http, log) ...

$ radahn check
✓ renames: payments.refunds::refund@f2c4 → payments.refunds::issue_refund@f2c4
✓ 14 callers auto-updated (hash unchanged, name updated by rewriter)
```

The rename did not change the content hash; callers were automatically updated because they bind to `name@hash`. An agent that was holding `refund@f2c4` in its working set can still locate it.

---

## 6. Mandatory rules (compiler-enforced, not style)

1. **No ambient IO.** Every side-effectful operation is reachable only via an explicit capability parameter.
2. **Every public symbol has a contract.** `@pre`, `@post`, `@effect`, `@cap`, `@cost` are required on exported functions; the compiler rejects missing ones.
3. **Exhaustive matching.** Non-exhaustive `match` is a compile error. Default arms must be explicit.
4. **Bounded functions.** ≤60 lines, ≤10 cyclomatic, ≤4 nesting, ≤7 params, unless `@waiver` with justification.
5. **Total by default.** Partial functions (infinite loops, unbounded recursion) require `partial` keyword and `! Diverge` effect.
6. **Explicit errors.** No exceptions crossing function boundaries. Use `Result`. `panic` is its own effect.
7. **Canonical format.** `radahn fmt` output is the only accepted layout; CI rejects deviations.
8. **Hermetic builds.** No network during compile. Lockfile is content-addressed.
9. **Module exports are closed.** Nothing is public by accident.
10. **Unique global symbol IDs.** Every public symbol has a stable content hash that survives rename and re-export.

Most of these echo **NASA Power of Ten** [power-of-10] and **MISRA C** [misra] principles, but promoted from *team convention* to *language invariant*.

---

## 7. Anti-patterns: what to refuse to inherit

- **Python / Ruby:** monkey-patching, metaclasses, arbitrary `__getattr__`. Symbols must exist statically.
- **JavaScript / TypeScript:** prototype mutation, `any`, implicit coercions (`==`), CommonJS/ESM dual module systems. *Keep* TS's gradual typing story only if full inference handles 95% of cases; otherwise require annotations at module boundaries only.
- **Java:** checked-exception ceremony, reflection without a capability, annotation-driven bytecode rewriting (Lombok-style), build-system pluralism (Maven *and* Gradle *and* Bazel).
- **Go:** unexported error strings as the only identity, implicit zero values, `init()` running before `main` with arbitrary side effects, generic constraints requiring runtime type assertions.
- **Rust:** lifetime annotations in surface syntax (infer them), macro-by-example without a static expansion view, `unsafe` without a capability gate, cargo features that change public API invisibly.
- **C:** the preprocessor. Undefined behaviour. `void*`. Implicit int. Header files as the build contract.
- **C++:** templates as Turing-complete, ODR violations, multiple inheritance with diamond, ADL, copy/move ambiguity, CMake. All of it.
- **Across the board:** ambient authority, global singletons, reflection, stringly-typed APIs, runtime patching, hidden allocators.

---

## 8. Borrow selectively from NASA/JPL — what stays, what goes

**Keep** (as language invariants):

- Bounded loops and recursion with declared measures. [power-of-10]
- Functions that fit on one screen. [power-of-10]
- No dynamic allocation after init. [power-of-10]
- Static analysis must be clean; warnings are errors. [power-of-10]
- Simple control flow; no `goto`, no `setjmp`. [power-of-10]
- "No undefined behaviour, ever" as a rule, not a goal. [misra]

**Drop** (bureaucracy that doesn't improve correctness):

- Paper-based code review sign-offs.
- "Every rule must be manually justified when waived" → replace with structured `@waiver` that the compiler tracks, not a signed form.
- Explicit documentation for every parameter of every function in prose → replace with machine-readable contracts that the compiler enforces.
- Prescriptive naming conventions (Hungarian notation etc.) → a canonical formatter chooses.

---

## 8.5 Head-to-head: Radahn vs. TypeScript vs. JavaScript vs. Python

This section compares Radahn against the three languages an agent is overwhelmingly likely to be asked to write today. The framing is *"what does an agent see, and where does it fail?"* — not *"what does a human prefer?"*. Sources for benchmark numbers are the same as §1.

### 8.5.1 The three failure modes that matter for agents

Every benchmark gap between languages decomposes into three failure modes. Radahn is designed to eliminate or compress each one. The comparison below scores how each language handles them.

| Failure mode | What goes wrong | Python | JavaScript | TypeScript | Radahn |
|---|---|---|---|---|---|
| **Hallucinated symbol** (call to a function/import that doesn't exist) | Code passes lint, fails at runtime — possibly far from the call site | Caught only at runtime; mypy is opt-in and incomplete | Never caught statically | Caught at compile if `strict: true`, often hidden by `any` [karpeslop] | **Compile-time error**; symbols resolve through content-addressed registry, name+hash, no fallback |
| **Hidden side effect** (function silently does IO, mutation, network) | Agent edits a "pure" helper, breaks production; cannot reason about call sites locally | Ambient — any function can do anything | Ambient | Ambient (types describe data, not effects) | **Effect row in signature** — `! { net, fs.read }` is part of the type; compiler rejects calls that exceed declared effects |
| **Locality blowout** (one symbol's behaviour spans many files) | Agent must read 5–20 files to make a 3-line change; context window exhausted | Decorators, metaclasses, monkey-patching, `__getattr__` | Prototypes, dynamic `this`, monkey-patched modules | Declaration merging, ambient namespace files, `.d.ts` drift | **Hash-pinned modules** + **bounded function size** + **machine-readable contract per symbol** retrievable in one tool call |

### 8.5.2 Side-by-side: a refund handler

The same toy task — "issue a refund, log it, retry on transient network failure" — written in each language. Watch what an agent has to *infer* in each version.

**Python (idiomatic):**
```python
import requests, logging

def refund(order_id: str, amount_cents: int) -> dict:
    """Issue a refund. Retries up to 3 times on 5xx."""
    for attempt in range(3):
        r = requests.post(f"https://api.pay.example/refund/{order_id}",
                          json={"cents": amount_cents})
        if r.status_code < 500:
            logging.info("refund %s -> %s", order_id, r.status_code)
            return r.json()
    raise RuntimeError("refund failed")
```

What an agent cannot tell from the signature alone: that this function does network IO, that it logs (so it has a side effect on observability), that it can raise, that the retry policy is hardcoded, that `requests` may be unavailable in some environments, what the response shape is. To answer any of those, the agent must read the body — and possibly the `requests` source.

**JavaScript:**
```js
async function refund(orderId, amountCents) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://api.pay.example/refund/${orderId}`, {
      method: 'POST',
      body: JSON.stringify({ cents: amountCents })
    });
    if (r.status < 500) {
      console.log(`refund ${orderId} -> ${r.status}`);
      return r.json();
    }
  }
  throw new Error('refund failed');
}
```

Worse than Python: no parameter types, return type erased to `Promise<any>`, `fetch` is ambient, no indication that this function can throw or what shape `r.json()` returns. An agent editing the caller has to infer everything from the body.

**TypeScript (strict mode):**
```ts
import { z } from 'zod';

const RefundResp = z.object({ id: z.string(), refunded_cents: z.number() });
type RefundResp = z.infer<typeof RefundResp>;

export async function refund(orderId: string, amountCents: number): Promise<RefundResp> {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://api.pay.example/refund/${orderId}`, {
      method: 'POST',
      body: JSON.stringify({ cents: amountCents }),
    });
    if (r.status < 500) {
      console.log(`refund ${orderId} -> ${r.status}`);
      return RefundResp.parse(await r.json());
    }
  }
  throw new Error('refund failed');
}
```

Better. The agent now knows the input and output shapes. But the signature still lies about effects: it does network IO, logs, and throws — none of which are in the type. The retry count and URL are still hardcoded constants the agent has to discover by reading the body. `fetch` and `console.log` are still ambient.

**Radahn:**
```agentlang
module pay/refund@1.2

import std/net { Http, Status }
import std/log { Log }
import std/result { Result, Ok, Err }

pub type RefundResp = { id: String, refunded_cents: U64 }

pub type RefundError =
  | Transient(Status)
  | Permanent(Status)
  | Network(Http.Error)

@pre  amount_cents > 0
@post |r| match r { Ok(_) => true, Err(_) => true }
@cost net <= 3, time <= 5s
pub fn refund(
    http: cap Http.Client { host: "api.pay.example" },
    log:  cap Log,
    order_id:    String,
    amount_cents: U64,
) -> Result<RefundResp, RefundError> ! { net, log } {
  for attempt in 0..3 {
    let r = http.post(
      path = "/refund/" ++ order_id,
      body = json { cents: amount_cents },
    )?
    if r.status < 500 {
      log.info("refund " ++ order_id ++ " -> " ++ r.status.show())
      return Ok(r.body.decode::<RefundResp>()?)
    }
  }
  Err(Transient(Status.GatewayTimeout))
}
```

What an agent gets *for free* from the signature, without reading the body:

- The function does **`net` and `log`**, nothing else. It cannot accidentally touch the filesystem.
- The two side-effecting subsystems are **passed as capabilities**. The HTTP client is *scoped to one host*; the agent cannot insert a call to a different API by accident — it would not type-check.
- It can **fail in three named ways** (`Transient`, `Permanent`, `Network`). No exceptions. The caller must handle the `Result`.
- It costs **at most 3 network calls and 5 seconds** (`@cost`). An agent reasoning about a retry-storm bug knows the bound without reading the loop.
- The precondition `amount_cents > 0` is enforced at the boundary. An agent passing `0` is a compile error in callers where the value is statically known.
- The return type is exact (`RefundResp`), not `any` or `dict`.
- The module declares its version (`@1.2`); a content hash pins the symbol identity. Renaming `refund` to `process_refund` does not break callers — they reference the hash.

The Radahn version is longer in characters than the Python version (~22 lines vs. ~10), but the *information density per token* is much higher — and crucially, an agent calling `refund` from another file does not need to read those 22 lines. `radahn contract pay/refund@1.2:refund` returns the signature, effects, capabilities, contracts, and cost in ~200 tokens of structured JSON. The Python equivalent requires reading the body, plus probably the requests docs, plus probably the test file, to recover the same information — and even then several facts (the retry count, the exception type, the timeout) are not recoverable without running the code.

### 8.5.3 Per-axis comparison

| Axis | Python | JavaScript | TypeScript | Radahn | Why it matters for agents |
|---|---|---|---|---|---|
| **Hallucination resistance** | Low — duck typing, dynamic imports | Very low — no types | Medium — `any` and `unknown` leak everywhere [karpeslop] | **High** — content-addressed symbol resolution; unresolved symbols are a compiler error with a *suggested* hash, never a silent fallback | Type-constrained decoding cuts compile errors by >50% [evidence][type-constrained]; Radahn extends this to *symbol* constraints |
| **Effect transparency** | None — ambient IO | None | None — types are about data shape, not effects | **Required** — every function declares its effect row | Lets an agent reason about safety of an edit *without* reading the body |
| **Capability scoping** | None — `open()` reads any file | None | None | **Built-in** — `cap Fs.Read { prefix: "/data" }` is a value the caller threads in | Eliminates a whole class of "agent wrote code that exfiltrated data" failures |
| **Locatability of failure** | Exceptions cross any boundary, traceback shows where it raised but not where it could raise | Same | Same plus Promise rejection | **Result types** + named error variants; every failure site is a `?` operator | RustAssistant's 74% fix rate [rust-assistant] is *because* failures are localised |
| **Module boundary stability** | `from x import *`, `__init__.py` re-exports, monkey-patching | Module re-exports, prototype mutation | Declaration merging, ambient `.d.ts` | **Content-addressed**, name+hash, version in module header | Renames don't break agent retrieval; the agent's mental map of the codebase doesn't drift |
| **Retrievability** | Variable — depends on docstrings | Poor — JSDoc rarely complete | Decent — `.d.ts` if maintained | **Excellent** — `radahn contract` returns structured contract for any public symbol | The signature *is* the documentation; nothing to drift |
| **Diff stability** | Black/ruff help; reorderable imports | Prettier helps; semicolon wars | Prettier helps; trailing comma debates | **One canonical formatter, line-stable AST** — semantically equivalent code formats identically | Agent edits produce minimal diffs; reviewers (human and bot) see only the change |
| **Bounded complexity** | None enforced; functions can be 1000 lines | None | None | **Default cap 60 LOC, cyclomatic ≤ 10** | NASA Power-of-Ten rule 4 [power-of-10]; one function fits in one context-window glance |
| **Toolchain friction** | venv/poetry/uv/pip, multiple test runners, mypy vs. pyright | npm/yarn/pnpm/bun, multiple bundlers | tsconfig + bundler + node version + types/* drift | **Single binary `agc`**, no bundler, hermetic builds | Agents waste ~20–40% of tokens in JS/TS tasks on `package.json`/tsconfig errors [inference] |
| **Determinism** | `requirements.txt` resolves on install | `package-lock.json` ≠ what's installed in CI sometimes | Same | **Lockfile = full graph; build is hermetic** | Reproducible failures are reproducible to fix |
| **Token efficiency of body** | Best — Python has the highest density (~130 tok/task [token-ranking]) | Mid — async sugar adds chrome (~148 tok/task) | Low — type annotations cost tokens | **Mid in body, very low at call site** — caller reads contract, not body | Agents pay tokens once at the definition, never again at call sites |

### 8.5.4 What this means in the agent loop

An LLM coding agent runs an inner loop: read context → propose edit → run compiler/tests → read diagnostics → repeat. The cost of each iteration is dominated by (a) tokens spent loading context, (b) tokens spent on diagnostics, and (c) the probability of needing another iteration. Radahn attacks each:

- **Loading context.** `radahn contract <symbol>` returns ~200 tokens of structured info per public symbol vs. ~500–2000 tokens of body for the equivalent in Python/JS/TS. For a 10-symbol task, this is the difference between 2k and 15k context tokens. [inference, but the math is mechanical]
- **Diagnostics.** `radahn check --json` emits one line per error: `{file, span, code, fix_suggestion, doc_url}`. Compare to Python tracebacks (10–30 lines of stack frames per error) or TS errors (often 5–15 lines with deeply nested types). [inference]
- **Iteration count.** Effect-row mismatches and capability-scope errors are caught at compile in Radahn; in Python they surface as runtime exceptions during test, which is a slower loop. The Mündler et al. result [type-constrained] establishes the principle: more constraint at generation time = fewer iterations. Radahn pushes the constraint set strictly past what type-constrained decoding alone provides (effects, capabilities, contracts, costs are all checkable at decode time).

### 8.5.5 Where Python/TS still beat Radahn today

I will not pretend the comparison is one-sided. The honest deficits of a hypothetical Radahn vs. the incumbents:

- **Training data.** A model has seen ~10^11 tokens of Python and ~10^10 of TS. It has seen 0 tokens of Radahn. The model would need to learn the language from grammar + stdlib + corpus, or be fine-tuned. Greenfield generation will lag for years [evidence: this is exactly why MultiPL-E shows Python winning greenfield].
- **Ecosystem.** No `numpy`, no `react`, no `pandas`. For most real tasks today, you need an FFI or a polyglot project — both of which add friction.
- **Greenfield speed for one-off scripts.** Python's `import x; x.do_thing()` is unbeatable for a 10-line script. Radahn's capability passing is overkill there. The right framing is: **Radahn for libraries and services; Python for scripts**.
- **Human ergonomics.** Capability threading is a real cost when reading code, even if it's a benefit when writing. This is the same trade Rust made.

### 8.5.6 Bottom line

Against TS, JS, and Python, Radahn's advantage for an AI agent is concentrated in three places: the agent can **read a signature instead of a body** (effects + capabilities + contracts), the agent **cannot fabricate symbols** (content-addressed resolution), and the agent **gets structured machine-readable feedback** (`radahn check --json`, `radahn contract`). Against TypeScript specifically, Radahn is mostly *more of TS's good ideas pushed all the way through* — strictness without escape hatches, effects in the type system, capabilities replacing ambient APIs, and a single-tool toolchain. Against Python and JS, it is a categorically different bet: trade some greenfield velocity for repo-edit reliability, which is the regime where agents currently underperform humans.

---

## 9. Final recommendation — the core ideas to adopt first

If we're actually building this, the *ordered* minimum viable subset is:

1. **Ship capabilities and effect rows first.** Without them, nothing else matters; the whole thesis rests on the signature telling the truth. Borrow Koka's row polymorphism [koka] and Austral's linear capabilities [austral].
2. **Ship the JSON-Lines diagnostic protocol on day one.** The agent-facing compiler UX is the product. Every diagnostic needs `code`, `span`, `suggest[]`, `docs` URL. Rustc's diagnostics are the bar; go one step further and make *agent consumption* a first-class use case.
3. **Ship the `radahn summary` / `radahn contract` tools second.** Retrieval into context is the dominant bottleneck for repo-level work. A 90-token module summary beats a 2,000-token file load.
4. **Enforce bounded units third.** Easy to retrofit, huge locality win. Start with 60-line function cap and exhaustive matching.
5. **Content-addressed modules fourth.** This is the biggest engineering lift — it requires a name/hash registry and a rewriter. It can be approximated with stable IDs in source comments for v0 and promoted to canonical in v1.
6. **Refinement types and SMT checking last.** They pay off at scale but are not required to get a working v0 in front of an agent.

**What I would *not* do in v0**:

- Build a new runtime from scratch. Target WASM; let the runtime be someone else's problem.
- Design our own package registry. Piggyback on OCI for content-addressed artifacts.
- Invent new syntax for the fun of it. Surface syntax should look boringly familiar (curly braces, lowercase keywords, explicit types).

**The claim to test once v0 exists**: *on a 200-issue internal benchmark modelled on SWE-bench Multilingual, an agent using Claude Sonnet + `radahn check --json` achieves ≥10 percentage points higher resolution than the same agent on equivalent Rust code, with ≥30% fewer tokens consumed per successful fix.* That's the falsifiable bet the design is making.

---

## 10. Uncertainty and caveats

- **Benchmark self-selection.** SWE-bench and Multi-SWE-bench sample *real GitHub issues that were fixed*; they over-represent bug-fix shape and under-represent greenfield design. Our "Rust > Python at repo edits" claim holds for that shape, not for architecture or design work.
- **Rust-at-top is a frontier-model finding.** Smaller models may see Rust *hurt* because they can't recover from compile errors. [inference]
- **Token-per-task numbers for languages are fragile.** The Rosetta-Code-based 130/148 numbers [token-ranking] are indicative, not rigorous; any claim that hinges on them should be re-run on a task corpus closer to the agent's real workload.
- **Effect systems in practice.** Koka is research-grade; Unison is small-user-base; there is no production effect-typed language at GitHub-scale. Ergonomic risk is real. [inference]
- **Capability-scoped imports** dramatically reduce the library ecosystem we can adopt. Early users will ship shim crates for the 100 most common utilities. [inference]
- **Content-addressed renames** change developer muscle memory. Humans may dislike it. The design bet is that agents dramatically benefit and humans adapt.

---

## 11. Implementation plan — v0 POC in TypeScript on Bun

The v0 is a thought-experiment proof-of-concept, not a production compiler. The goal is to validate the design's agent-ergonomics thesis via benchmark evidence. Scope and stack are chosen accordingly.

### 11.1 Why TypeScript on Bun

The host-language decision was between Rust, TypeScript, Go, Python, and OCaml/Haskell. TypeScript on Bun wins for this specific goal — a 4–12 week solo POC transpiling Radahn to TypeScript — for five reasons, in descending order of weight:

1. **Target proximity.** The output language is TypeScript, so the compiler can emit the target AST directly using `ts-morph` or the official TypeScript compiler API. No pretty-printer bugs, no quoting issues, and the emitted output is type-checked by `tsc --noEmit` as a free codegen verification pass. This alone saves weeks.
2. **LLM fluency on the host language.** The POC will be built with heavy AI assistance. Frontier models write excellent TS and adequate Rust. For a 4–12 week POC, the fluency delta dominates almost every other consideration.
3. **Ecosystem fit.** `ts-morph`, `chevrotain`, and `langium` are mature TypeScript-native compiler-construction libraries. Parser combinators like `peggy` work well. TS tagged unions with `satisfies never` get ~90% of sum-type exhaustiveness benefits for a POC-sized AST.
4. **Distribution.** `bun build --compile` produces a single static binary with native startup time. Agents running the benchmark invoke `radahn` directly without caring about Node versions or `npm install`.
5. **Bootstrap path.** If v0 validates the thesis, the v1 can be either a Rust rewrite (for discipline and performance) or — more interestingly — a self-hosted Radahn compiler that itself transpiles to TypeScript. The languages are close enough cousins that the bootstrap is short.

The honest loss versus Rust: TypeScript lacks real sum types and enforced exhaustiveness, so the compiler's internal AST is a tagged union simulated via discriminated string `kind` fields. At POC scale (3–10k LOC) the ceremony is manageable. At production scale it would compound. That's a v1 problem, not a v0 problem.

### 11.2 Architecture

```
radahn/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── src/
│   ├── cli.ts              # entry, subcommands: check, contract, build, fmt
│   ├── lex/lexer.ts        # source → tokens
│   ├── parse/parser.ts     # tokens → AST
│   ├── parse/ast.ts        # AST node types (tagged-union arena)
│   ├── resolve/            # name resolution, content-addressed symbols
│   ├── types/              # type inference, effect rows
│   ├── contracts/          # @pre, @post, @cost checkers
│   ├── emit/ts-emitter.ts  # typed AST → TypeScript via ts-morph
│   ├── diag/               # JSON diagnostic protocol
│   └── util/arena.ts       # id-based AST arena
├── stdlib/                 # written in Radahn
│   ├── result.rd
│   ├── option.rd
│   ├── net.rd
│   └── log.rd
├── examples/               # refund.rd, hello.rd, etc.
├── tests/
└── bench/
    └── harness.ts          # agent-eval harness: Python vs TS vs Radahn
```

**Key structural decisions:**

- **AST lives in an arena, referenced by numeric ID.** Annotation passes (types, effects, contracts) attach via `Map<NodeId, T>` rather than mutating the AST. This is the rustc / rust-analyzer pattern and it pays dividends the moment you add a second analysis pass.
- **Tagged unions with `satisfies never` for exhaustiveness.** The fallback `exhaustive(x: never): never` helper forces every `switch` on an AST node to be complete, or the TS compiler errors at the fallthrough.
- **JSON diagnostics designed before the compiler is written.** The schema `{severity, code, message, span, labels, fix, doc_url, related}` is the product surface. Human rendering is a pretty-printer over the JSON, not the other way around.
- **TS emission via `ts-morph`.** Node factory methods, not string concatenation. Output is verified with `tsc --noEmit` on every build.

### 11.3 v0 scope — the smallest slice that proves the thesis

Do not build the whole language in pass one. The minimum slice that generates a benchmark signal is:

1. Lexer + parser for: imports, function definitions, literals, binary ops, calls, `match`, the effect row syntax `! { net, log }`, and basic type annotations.
2. Name resolution: undefined variables, hallucinated imports flagged as compile errors.
3. **Effect checking only** (skip types, skip contracts, skip capabilities for v0): a function's body may only call functions whose effect rows are subsets of its declared row.
4. Transpile to TypeScript: drop effect annotations, emit straight TS.
5. JSON diagnostics via `radahn check --json`.
6. `radahn contract <symbol>` returning the declared signature + effect row as JSON.

~2000 lines of TypeScript. Enough to say "an agent can write Radahn, see typed errors, and the output runs on Bun."

### 11.4 The benchmark

```ts
for (const task of tasks) {
  for (const lang of ['python', 'typescript', 'radahn']) {
    const transcript = runAgent({
      model: 'claude-sonnet-4-6',
      tools: toolsFor(lang),
      task: task.descriptionFor(lang),
      max_iterations: 20,
    });
    record({ task, lang, transcript });
  }
}
analyze(records);  // iterations, tokens, pass rate, hallucinated-symbol count
```

10–20 tasks, diverse: trivial, refactor, bug-fix, feature-add, cross-module. **The claim to prove is not higher pass@1 — the model has seen zero Radahn — but fewer iterations, fewer tokens, and fewer hallucinated symbols per successful task.** Those metrics validate language *shape*, not idiom familiarity, and they should show a signal even when Radahn loses on absolute pass@1.

### 11.5 Bootstrap corpus — critical for fairness

The model has seen zero Radahn code. Without mitigation, the benchmark is rigged against Radahn by model-familiarity alone. Three mitigations:

1. **Write a real `stdlib/`** — 500–1000 lines of idiomatic Radahn covering `result`, `option`, `net`, `log`. Doubles as a reference corpus the agent reads during tasks.
2. **Write a 2–3 page language guide** (grammar cheatsheet, effect-row syntax, capability passing, 3–4 worked examples) that's injected as a system prompt during benchmark runs.
3. **Design `radahn check --json` to be dense and actionable** — error messages should include `fix_suggestion` fields where possible. The model's primary feedback signal is the diagnostic stream.

Without these, the benchmark tests familiarity, not shape. With them, it tests what we actually want to measure.

### 11.6 Timeline (solo, part-time)

- **Weekend 1:** lexer, parser, AST types, basic diagnostics. Identity-transform TS emission.
- **Weekend 2:** name resolution, effect-row checker, undefined-symbol errors.
- **Weekend 3:** `radahn contract` subcommand, JSON diagnostic output, CLI polish via `commander` or `cac`.
- **Weekend 4:** stdlib, examples, language guide, first runnable programs.
- **Weekends 5–6:** benchmark harness, 10-task corpus, first results.

6 weekends to a running POC with measurable results. If the iteration-count and token-count metrics show signal in Radahn's favor, the design is worth pursuing further. If they don't, the POC has still produced a concrete negative result — also valuable.

### 11.7 What v0 explicitly does *not* include

To keep scope tractable, the POC skips:

- Capability types (v1)
- `@pre` / `@post` / `@cost` contract checking (v1; only `@effect` ships in v0)
- Content-addressed module resolution (v1; v0 uses path-based imports)
- Refinement types (v2)
- SMT integration for contracts (v2)
- Self-hosting (v2)
- WASM / native codegen (v2)

The v0 proves the *effect-row* portion of the thesis. The capability, contract, and content-addressing portions get added in v1 once the v0 result justifies the continued investment. This is deliberate — it's possible the effect-row portion alone produces most of the agent-ergonomics benefit, in which case the later features are less load-bearing than the design claims. Finding that out empirically is a legitimate v0 outcome.

### 11.8 TypeScript interop — the gradual adoption path

**The single most important adoption property:** Radahn and TypeScript must coexist in the same project at the file level, interop in both directions, and permit file-by-file migration in either direction. This is the same design choice Hejlsberg made for TypeScript/JavaScript in 2012, and it is the property that determines whether Radahn is a research curiosity or a tool anyone actually uses.

**How it works:**

*Radahn imports from TypeScript via `extern` declarations.* A Radahn file can declare a foreign TS/JS module with hand-written type and effect annotations:

```radahn
extern module node/fs {
  fn read_file(path: String) -> Result<Buffer, Error>
    ! { fs.read }
}
```

The `extern` keyword is Radahn's equivalent of TypeScript's `any` — an explicit trust boundary. The compiler does not verify that the TS code behind the declaration actually performs only the declared effects; the programmer takes responsibility for the annotation. This is analogous to how TypeScript trusts `@types/*` declaration files.

*TypeScript imports from Radahn via generated `.d.ts`.* The `radahn build` step emits both a `.ts` and a `.d.ts` file for every `.rd` source. TS code imports the generated `.ts` and sees full TS type info. Effect rows are dropped in the `.d.ts` (TS has no effect system), but the structural types survive intact. From the TS consumer's perspective, a Radahn-authored module is indistinguishable from a hand-written TS module.

*File-by-file migration works in either direction.* Rename `payments.ts` → `payments.rd`, rewrite in Radahn syntax, add `extern` shims for any JS libraries it uses. The compiler emits `payments.ts` + `payments.d.ts`. Every other file in the project keeps importing `./payments` unchanged. No runtime difference; only compile-time difference. Migration can also go backwards: rename `payments.rd` → `payments.ts`, drop the effect annotations, done.

**The design commitments that enable this:**

1. **Structural types at the TS boundary.** Radahn internally uses nominal ADTs (good for agent reasoning), but when emitting TS, generates structural types so interop with arbitrary TS objects works. Branded types are used where nominal identity matters (capabilities).
2. **`extern` as the explicit escape hatch.** Every foreign module must be declared. There is no implicit `any` at the module boundary — you annotate the shim or you can't call the foreign code. This is stricter than TS's `any` and is a deliberate choice to prevent effect-annotation rot.
3. **Dual emission (`.ts` + `.d.ts`).** Every Radahn module produces both. The `.d.ts` is a trivial pretty-print over the same typed AST.
4. **Shared module resolution.** Radahn uses Bun's/Node's module resolution (relative paths, `node_modules`, `package.json` exports). No custom resolver.
5. **No runtime footprint from Radahn's type system.** Effects and capabilities are static-only in v0. Generated TS is identical to hand-written TS at runtime. The safety is compile-time; once running, it's just Bun.

**Why this matters for the benchmark:**

Without TS interop, the v0 benchmark is constrained to what Radahn's tiny stdlib can express — no HTTP, no filesystem, nothing real-worldy. The benchmark becomes toy.

With `extern`, benchmark tasks can import real libraries (Express, Zod, fetch, fs, whatever), and the effect/capability discipline applies to the Radahn-authored parts of the program. The benchmark tests *realistic tasks* instead of reimplementing `fetch` from first principles. This changes the POC's story from "here's a toy language" to "here's a TypeScript dialect with a stricter type system, and agents are faster on it for real tasks." Much more defensible.

**The honest cost:**

Every `extern` shim is a trust hole. If `node/fs.read_file` is annotated `! { fs.read }` but secretly also opens a socket on failure, Radahn's effect guarantees lie at that boundary. This is the same problem TypeScript has with bad `.d.ts` files in `@types/*`. Mitigations are v2+ work: community-maintained effect annotations for popular packages, provenance tracking, automatic effect inference for TS code. In v0, trust holes are accepted and documented.

---

## 12. Sources

Primary sources are marked **[primary]**; secondary / synthesis pieces are marked **[secondary]**.

- [swe-sonnet]: **[primary]** Anthropic, "Raising the bar on SWE-bench Verified with Claude 3.5 Sonnet" / Multilingual update — <https://www.anthropic.com/research/swe-bench-sonnet> — and the SWE-bench Multilingual leaderboard and landing page at <https://www.swebench.com/multilingual.html>.
- [multi-swe-paper]: **[primary]** Zan et al., "Multi-SWE-bench: A Multilingual Benchmark for Issue Resolving," arXiv:2504.02605, NeurIPS 2025 D&B — <https://arxiv.org/abs/2504.02605>. Covers Java, TS, JS, Go, Rust, C, C++; 1,632 instances; evaluates Agentless, SWE-agent, OpenHands scaffolds.
- [poly-paper]: **[primary]** Amazon Science, "SWE-PolyBench: A multi-language benchmark for repository level evaluation of coding agents," arXiv:2504.08703 — <https://arxiv.org/abs/2504.08703>. 2,110 instances in JS (1,017), TS (729), Python (199), Java (165). Landing: <https://amazon-science.github.io/SWE-PolyBench/>.
- [aider-lb]: **[primary]** Aider Polyglot leaderboard — <https://aider.chat/docs/leaderboards/>. 225 Exercism problems across C++, Go, Java, JS, Python, Rust; GPT-5 top at 0.880; mean 0.581 per [llm-stats](https://llm-stats.com/benchmarks/aider-polyglot).
- [multipl-e]: **[primary]** Cassano et al., "MultiPL-E: A Scalable and Extensible Approach to Benchmarking Neural Code Generation," original paper arXiv:2208.08227 (translation of HumanEval/MBPP to 18+ languages). Site: <https://nuprl.github.io/MultiPL-E/>. Key findings quoted on that page: "Codex performs best on JavaScript" and "Type annotations have limited impact on model performance for gradually typed languages."
- [lcb-survey]: **[primary]** "Where Do LLMs Still Struggle? An In-Depth Analysis of Code Generation Benchmarks," arXiv:2511.04355 — <https://arxiv.org/html/2511.04355v1>. Reports on LCB-V6 and BCB-Hard across Claude Sonnet-4, DeepSeek-V3, Qwen3-Coder, GPT-4o, Llama-3.3-70B, Mistral-3.2-24B.
- [type-constrained]: **[primary]** Mündler et al., "Type-Constrained Code Generation with Language Models," PLDI 2025 / PACMPL — <https://arxiv.org/abs/2504.09246> and <https://dl.acm.org/doi/10.1145/3729274>. Reports 74.8% compile-error reduction with type-constrained decoding vs. 9.0% for syntax-only.
- [do-ts-types]: **[primary]** Yee & Guha, "Do Machine Learning Models Produce TypeScript Types That Type Check?" — <https://arxiv.org/pdf/2302.12163>.
- [rust-assistant]: **[primary]** Deligiannis et al., "RustAssistant: Using LLMs to Fix Compilation Errors in Rust Code," Microsoft Research / arXiv:2308.05177 — <https://arxiv.org/abs/2308.05177>. Peak fix accuracy ~74% on real-world Rust compile errors.
- [rust-substack]: **[secondary]** "Why Learning Rust Still Matters in the Age of LLM Coding Agents" — <https://reltech.substack.com/p/why-learning-rust-still-matters-in>. Frames borrow checker as agent guardrail.
- [power-of-10]: **[primary]** Gerard J. Holzmann, "The Power of Ten – Rules for Developing Safety Critical Code," NASA/JPL Laboratory for Reliable Software, 2006 — <https://spinroot.com/gerard/pdf/P10.pdf>. Wikipedia summary: <https://en.wikipedia.org/wiki/The_Power_of_10:_Rules_for_Developing_Safety-Critical_Code>.
- [misra]: **[primary]** MISRA C:2012 — overview at <https://en.wikipedia.org/wiki/MISRA_C>; rule discussion at <https://www.grammatech.com/learn/misra-c2012-rule-1-3-and-the-dark-underbelly-of-c-and-c/>.
- [koka]: **[primary]** Leijen, "Koka: Programming with Row-polymorphic Effect Types," arXiv:1406.2061 — <https://arxiv.org/pdf/1406.2061>. Microsoft Research project: <https://www.microsoft.com/en-us/research/project/koka/>.
- [unison-abilities]: **[primary]** Unison abilities docs — <https://www.unison-lang.org/docs/fundamentals/abilities/>.
- [austral]: **[primary]** Borretti, "Introducing Austral: A Systems Language with Linear Types and Capabilities" — <https://borretti.me/article/introducing-austral>. Spec: <https://austral-lang.org/spec/spec.html>.
- [token-ranking]: **[secondary]** UBOS, "Token-Efficient Programming Languages: Rankings and Insights" — <https://ubos.tech/news/token%E2%80%91efficient-programming-languages-rankings-and-insights/>. Uses Rosetta Code + GPT-4 tokenizer; directionally useful, not load-bearing.
- [karpeslop]: **[secondary]** KarpeSlop linter — <https://github.com/CodeDeficient/KarpeSlop>. Taxonomy of AI-slop patterns in TS/JS.
- [slopsquat]: **[secondary]** "AI-Generated Code Packages Can Lead to 'Slopsquatting' Threat," DevOps.com — <https://devops.com/ai-generated-code-packages-can-lead-to-slopsquatting-threat/>.

---

*End of document. Next moves, in order: (a) scaffold the Bun + TypeScript project per §11.2, (b) design the JSON diagnostic schema on paper before writing the compiler, (c) implement the v0 slice in §11.3 (lexer + parser + effect checker + TS emission), (d) write the stdlib and language guide from §11.5, (e) run the benchmark from §11.4 and see whether the thesis holds.*

*"Hold the stars in place."*