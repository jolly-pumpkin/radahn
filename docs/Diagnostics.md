# Radahn diagnostics reference

Every Radahn compiler pass emits diagnostics in a single stable JSON shape. This
document is the human reference for that shape and the v0 code catalogue. The
canonical machine definition lives in [`src/diag/types.ts`](../src/diag/types.ts);
the registry is in [`src/diag/codes.ts`](../src/diag/codes.ts); one example
payload per code is in [`src/diag/examples.ts`](../src/diag/examples.ts).

## The JSON-Lines protocol

`radahn check --json` writes one `Diagnostic` per line to stdout. Agents read
the stream, apply the first entry in `suggest[]` as a patch, and re-run the
check. A typical fix loop is *one diagnostic → one edit → re-check*; the
protocol is optimised for agent consumption and a token budget under ~500 per
fix (see Design §4.10).

## Schema

```ts
type Diagnostic = {
  code: `E${string}`;              // stable code, e.g. "E0201"
  severity: "error" | "warning" | "info" | "help";
  message: string;                 // single-line summary
  span: Span;                      // primary source location
  related?: RelatedInfo[];         // additional labelled spans
  suggest?: Suggestion[];          // ordered, first = most actionable
  notes?: Note[];                  // supplementary explanation
  docs: string;                    // URL to this reference
};

type Span = { file: string; line: number; col: number; len: number };
type Position = { line: number; col: number };

type Suggestion = {
  kind:
    | "add-param" | "add-effect" | "add-import" | "narrow-cap"
    | "rename" | "insert-text" | "replace-span" | "delete-span";
  rationale: string;
  at?: Position;                   // insertion point (for insert-style kinds)
  span?: Span;                     // target span (for replace/delete kinds)
  insert?: string;                 // text to insert or replace with
};

type RelatedInfo = { span: Span; message: string };
type Note = { message: string; span?: Span };
```

`line` and `col` are 1-indexed. `len` is the span length in bytes (0 for a
point). Fields marked optional are omitted from the JSON when absent — they are
never emitted as `null`.

## Code catalogue

Codes are partitioned by category. Each section is the title, default severity,
a one-paragraph description, a `.rd` snippet that triggers it, the JSON the
checker will emit, and how to fix it.

---

### E0001 — Unexpected character &nbsp;·&nbsp; *error* &nbsp;·&nbsp; lex

The lexer encountered a character that is not part of any Radahn token.

```rd
let total = 10 # 2
```

```json
{"code":"E0001","severity":"error","message":"unexpected character `#` in source","span":{"file":"src/refund.rd","line":12,"col":5,"len":1},"docs":"https://radahn.dev/e/0001"}
```

**Fix:** remove the stray character, or quote it if it was meant to be part of a string literal.

---

### E0002 — Unterminated string literal &nbsp;·&nbsp; *error* &nbsp;·&nbsp; lex

A string literal is missing its closing quote before end of line or file.

```rd
let greeting = "hello world
```

```json
{"code":"E0002","severity":"error","message":"unterminated string literal","span":{"file":"src/refund.rd","line":8,"col":18,"len":14},"suggest":[{"kind":"insert-text","rationale":"close the string literal","at":{"line":8,"col":32},"insert":"\""}],"docs":"https://radahn.dev/e/0002"}
```

**Fix:** add a closing `"` at the end of the literal.

---

### E0003 — Invalid numeric literal &nbsp;·&nbsp; *error* &nbsp;·&nbsp; lex

A numeric literal has malformed digits, prefix, or exponent.

```rd
let mask = 0x_
```

```json
{"code":"E0003","severity":"error","message":"invalid numeric literal `0x_`","span":{"file":"src/money.rd","line":3,"col":14,"len":3},"docs":"https://radahn.dev/e/0003"}
```

**Fix:** supply at least one hex digit after `0x`, or remove the prefix.

---

### E0101 — Unexpected token &nbsp;·&nbsp; *error* &nbsp;·&nbsp; parse

The parser expected a different token kind at this position.

```rd
fn refund(charge_id,, amount) -> Result[Unit, RefundError]
```

```json
{"code":"E0101","severity":"error","message":"expected `)` but found `,`","span":{"file":"src/refund.rd","line":4,"col":22,"len":1},"docs":"https://radahn.dev/e/0101"}
```

**Fix:** remove the extraneous token or supply the expected one.

---

### E0102 — Expected closing delimiter &nbsp;·&nbsp; *error* &nbsp;·&nbsp; parse

A bracket, brace, or parenthesis was opened but never closed.

```rd
fn refund(charge_id) -> Unit {
  log("starting refund")
```

```json
{"code":"E0102","severity":"error","message":"expected closing `}` for block opened at line 3","span":{"file":"src/refund.rd","line":9,"col":1,"len":0},"related":[{"span":{"file":"src/refund.rd","line":3,"col":18,"len":1},"message":"opening `{` was here"}],"docs":"https://radahn.dev/e/0102"}
```

**Fix:** add the missing closing delimiter; the `related` span points at the
unmatched opener.

---

### E0103 — Unexpected end of input &nbsp;·&nbsp; *error* &nbsp;·&nbsp; parse

The source ended while a declaration or expression was still being parsed.

```rd
fn refund(charge_id) -> Unit {
  let amount =
```

```json
{"code":"E0103","severity":"error","message":"unexpected end of input while parsing `fn` body","span":{"file":"src/refund.rd","line":42,"col":1,"len":0},"docs":"https://radahn.dev/e/0103"}
```

**Fix:** complete the in-progress declaration or expression.

---

### E0104 — Invalid function signature &nbsp;·&nbsp; *error* &nbsp;·&nbsp; parse

A `fn` signature has a malformed parameter list or effect row.

```rd
fn refund(charge_id: ChargeId) -> Unit !
```

```json
{"code":"E0104","severity":"error","message":"invalid effect row in signature: expected `!` followed by effect list","span":{"file":"src/refund.rd","line":1,"col":40,"len":1},"suggest":[{"kind":"insert-text","rationale":"add an empty effect row for a pure function","at":{"line":1,"col":40},"insert":" ! {}"}],"docs":"https://radahn.dev/e/0104"}
```

**Fix:** provide the effect row (`! { Fs<write> }`) or omit the `!` for a pure function.

---

### E0201 — Unknown identifier &nbsp;·&nbsp; *error* &nbsp;·&nbsp; resolve

A name was referenced but no matching declaration exists in scope.

```rd
fn refund(charge_id: ChargeId) -> Unit {
  validate(chage_id)
}
```

```json
{"code":"E0201","severity":"error","message":"unknown identifier `chage_id`","span":{"file":"src/refund.rd","line":7,"col":12,"len":8},"suggest":[{"kind":"rename","rationale":"did you mean `charge_id`?","span":{"file":"src/refund.rd","line":7,"col":12,"len":8},"insert":"charge_id"}],"docs":"https://radahn.dev/e/0201"}
```

**Fix:** rename to an in-scope identifier, or add an import/declaration.

---

### E0202 — Duplicate definition &nbsp;·&nbsp; *error* &nbsp;·&nbsp; resolve

Two declarations share the same name in the same scope.

```rd
fn refund(a) { ... }
fn refund(a, b) { ... }
```

```json
{"code":"E0202","severity":"error","message":"duplicate definition of `refund`","span":{"file":"src/refund.rd","line":20,"col":4,"len":6},"related":[{"span":{"file":"src/refund.rd","line":5,"col":4,"len":6},"message":"previous definition here"}],"docs":"https://radahn.dev/e/0202"}
```

**Fix:** rename one of the definitions, or merge them.

---

### E0203 — Unused import &nbsp;·&nbsp; *warning* &nbsp;·&nbsp; resolve

An imported symbol is never referenced in this module.

```rd
import log.log_info
```

```json
{"code":"E0203","severity":"warning","message":"unused import `log_info`","span":{"file":"src/refund.rd","line":2,"col":10,"len":8},"suggest":[{"kind":"delete-span","rationale":"remove the unused import","span":{"file":"src/refund.rd","line":2,"col":1,"len":22}}],"docs":"https://radahn.dev/e/0203"}
```

**Fix:** delete the import, or start using the symbol.

---

### E0204 — Private symbol not exported &nbsp;·&nbsp; *error* &nbsp;·&nbsp; resolve

A symbol is referenced across modules but is not listed in the exports.

```rd
// src/api.rd
import payments.refunds.refund_internal
```

```json
{"code":"E0204","severity":"error","message":"`refund_internal` is referenced by `src/api.rd` but not exported from `payments.refunds`","span":{"file":"src/api.rd","line":6,"col":18,"len":15},"suggest":[{"kind":"insert-text","rationale":"add the symbol to the module's `exports` list","at":{"line":3,"col":12},"insert":", refund_internal"}],"docs":"https://radahn.dev/e/0204"}
```

**Fix:** add the symbol to the producing module's `exports` list, or use a
different public symbol.

---

### E0301 — Effect not declared in signature &nbsp;·&nbsp; *error* &nbsp;·&nbsp; effects

A function body uses an effect that is absent from its declared effect row.
This is the headline v0 diagnostic — the effect-row thesis in action.

```rd
fn refund(charge_id: ChargeId) -> Unit ! {} {
  write_file("/log", charge_id)
}
```

```json
{"code":"E0301","severity":"error","message":"function calls `write_file` which performs effect `Fs<write>`, but the signature declares `{}`","span":{"file":"src/refund.rd","line":11,"col":3,"len":10},"suggest":[{"kind":"add-effect","rationale":"declare the effect in the function signature","at":{"line":9,"col":40},"insert":"Fs<write>"}],"docs":"https://radahn.dev/e/0301"}
```

**Fix:** add the effect to the signature, or stop using it in the body.

---

### E0302 — Declared effect unused in body &nbsp;·&nbsp; *warning* &nbsp;·&nbsp; effects

A function declares an effect that its body never actually performs. Declared
effects are a contract with callers, so unused declarations over-constrain.

```rd
fn refund(charge_id) -> Unit ! { Fs<write>, Net<https> } {
  write_file("/log", charge_id)
}
```

```json
{"code":"E0302","severity":"warning","message":"declared effect `Net<https>` is never performed in this function","span":{"file":"src/refund.rd","line":9,"col":44,"len":10},"suggest":[{"kind":"delete-span","rationale":"remove the unused effect from the declared row","span":{"file":"src/refund.rd","line":9,"col":44,"len":10}}],"docs":"https://radahn.dev/e/0302"}
```

**Fix:** drop the unused effect from the row.

---

### E0303 — Effect row mismatch at call site &nbsp;·&nbsp; *error* &nbsp;·&nbsp; effects

A callee's effects are not a subset of the caller's declared effects.

```rd
fn caller() -> Unit ! {} {
  write_file("/log", "hi")
}
```

```json
{"code":"E0303","severity":"error","message":"callee `write_file` performs `Fs<write>` which is not in caller's effect row","span":{"file":"src/refund.rd","line":15,"col":5,"len":10},"related":[{"span":{"file":"src/refund.rd","line":9,"col":40,"len":2},"message":"caller's effect row declared here"}],"suggest":[{"kind":"add-effect","rationale":"widen the caller's effect row to include `Fs<write>`","at":{"line":9,"col":42},"insert":"Fs<write>"}],"docs":"https://radahn.dev/e/0303"}
```

**Fix:** widen the caller's effect row, or avoid the effectful call.

---

### E0401 — Type mismatch &nbsp;·&nbsp; *error* &nbsp;·&nbsp; types

An expression's inferred type does not match the expected type at this position.

```rd
fn amount() -> Int { "twelve" }
```

```json
{"code":"E0401","severity":"error","message":"expected `Int`, found `String`","span":{"file":"src/refund.rd","line":14,"col":18,"len":8},"docs":"https://radahn.dev/e/0401"}
```

**Fix:** convert the value explicitly, or change the declared type.

---

### E0402 — Non-exhaustive match &nbsp;·&nbsp; *error* &nbsp;·&nbsp; types

A `match` expression does not cover every variant of the scrutinee's type.

```rd
match err {
| NotFound -> ...
| InvalidAmount -> ...
}
```

```json
{"code":"E0402","severity":"error","message":"non-exhaustive match: missing variant `RefundError::AlreadyRefunded`","span":{"file":"src/refund.rd","line":18,"col":3,"len":5},"suggest":[{"kind":"insert-text","rationale":"add a match arm for the missing variant","at":{"line":22,"col":3},"insert":"| AlreadyRefunded -> ...\n  "}],"docs":"https://radahn.dev/e/0402"}
```

**Fix:** add arms for the missing variants or a `_` wildcard.

---

### E0403 — Unreachable match arm &nbsp;·&nbsp; *warning* &nbsp;·&nbsp; types

A match arm can never be reached because an earlier arm subsumes it.

```rd
match err {
| _ -> log("unknown")
| NotFound -> log("not found")   // unreachable
}
```

```json
{"code":"E0403","severity":"warning","message":"unreachable match arm: earlier pattern already covers this case","span":{"file":"src/refund.rd","line":24,"col":3,"len":12},"related":[{"span":{"file":"src/refund.rd","line":21,"col":3,"len":1},"message":"subsuming wildcard pattern here"}],"docs":"https://radahn.dev/e/0403"}
```

**Fix:** remove the unreachable arm or reorder the patterns.

---

### E0501 — Malformed contract clause &nbsp;·&nbsp; *error* &nbsp;·&nbsp; contracts

A `@pre`, `@post`, or `@cost` clause is syntactically invalid. v0 only parses
contracts; deeper checking arrives in v1.

```rd
@pre  //  missing predicate
fn refund(...) { ... }
```

```json
{"code":"E0501","severity":"error","message":"malformed `@pre` clause: expected predicate expression","span":{"file":"src/refund.rd","line":8,"col":8,"len":3},"docs":"https://radahn.dev/e/0501"}
```

**Fix:** provide a predicate expression after the contract keyword.

---

### E0601 — Missing module header &nbsp;·&nbsp; *error* &nbsp;·&nbsp; module

A source file is missing its `module` / `end-module` header.

```rd
fn refund() { ... }   // no module declaration above
```

```json
{"code":"E0601","severity":"error","message":"missing module header: source files must begin with `module <name>`","span":{"file":"src/refund.rd","line":1,"col":1,"len":0},"suggest":[{"kind":"insert-text","rationale":"declare the module name at the top of the file","at":{"line":1,"col":1},"insert":"module payments.refunds\nend-module\n\n"}],"docs":"https://radahn.dev/e/0601"}
```

**Fix:** add a `module <name> ... end-module` header at the top of the file.

---

### E0602 — Module name does not match path &nbsp;·&nbsp; *error* &nbsp;·&nbsp; module

The declared module name does not agree with the source file's on-disk path.

```rd
// src/payments/refunds.rd
module payments.refund
end-module
```

```json
{"code":"E0602","severity":"error","message":"declared module `payments.refund` does not match path `src/payments/refunds.rd`","span":{"file":"src/payments/refunds.rd","line":1,"col":8,"len":15},"suggest":[{"kind":"rename","rationale":"rename to match the file path","span":{"file":"src/payments/refunds.rd","line":1,"col":8,"len":15},"insert":"payments.refunds"}],"docs":"https://radahn.dev/e/0602"}
```

**Fix:** rename the module header to match the path, or move the file.

---

## Adding a new code

1. Reserve a code in the appropriate range (see [`src/diag/codes.ts`](../src/diag/codes.ts)) and add a `DiagnosticInfo` entry.
2. Add one example `Diagnostic` to [`src/diag/examples.ts`](../src/diag/examples.ts).
3. Add a section to this file with the same shape as above.
4. `bun test tests/diag.test.ts` will fail until every code has a matching example, so there is no way to forget a step.
