# Radahn v0 — grammar conformance examples

Companion to [`grammar.ebnf`](./grammar.ebnf). Each section gives a
`.rd` snippet and the parse-tree outline it produces. Together these are
the conformance suite against which Epic 0.4's parser is scored: every
snippet must parse successfully and produce the outlined structure.

Outlines use indented production names from `grammar.ebnf`. Terminal
tokens appear in `monospace`. Omitted fields (e.g. an absent
`EffectRow`) are not shown.

---

## 1. `hello.rd` — minimal module

```
module hello
  exports: [main]
end-module

fn main() {
}
```

Parse tree:

```
File
├── ModuleHeader
│   ├── "module"
│   ├── ModulePath    = hello
│   ├── ModuleField   (exports) = [main]
│   └── "end-module"
└── TopDecl = FnDecl
    ├── "fn"
    ├── IDENT         = main
    ├── ParamList     = (empty)
    └── Block         = (empty)
```

Tests: `ModuleHeader` required and terminated by `end-module`, empty
`ParamList`, empty `Block`, no effect row (function is pure).

---

## 2. `refund.rd` — effect row, named call args, `?`, `match`

Reduced from Design §5.1. Pinned effect-row syntax is `! { … }`; generic
arguments use `[ … ]`.

```
module payments/refund
  version: "1.4.0"
  exports: [refund, RefundError]
  effects: [net, fs.write, log]
end-module

type RefundError =
  | NotFound(ChargeId)
  | Upstream(Int, String)

pub fn refund(
  http: Http,
  log:  Log,
  charge_id: ChargeId,
) -> Result[RefundReceipt, RefundError] ! { net, log } {
  let resp = http.post(path = "/v1/refunds", body = charge_id)?
  match resp.status {
    200 => Ok(parse_receipt(resp.body)?)
    404 => Err(NotFound(charge_id))
    s   => Err(Upstream(s, resp.body))
  }
}
```

Parse tree (abbreviated to the shape-bearing nodes):

```
File
├── ModuleHeader (module payments/refund, 3 fields)
└── TopDecl = FnDecl
    ├── Visibility    = pub
    ├── IDENT         = refund
    ├── ParamList     (3 Params: http, log, charge_id)
    ├── "->" Type     = NominalType Result[RefundReceipt, RefundError]
    ├── EffectRow     = ! { net, log }
    └── Block
        ├── Stmt = LetStmt
        │   ├── BindingPat = resp
        │   └── Expr = PostfixExpr
        │       ├── PrimaryExpr = http
        │       ├── PostfixOp   = . post
        │       ├── PostfixOp   = CallArgs( path = "/v1/refunds", body = charge_id )
        │       └── PostfixOp   = ?
        └── Stmt = ExprStmt
            └── MatchExpr (scrutinee: resp.status, 3 MatchArms)
```

Tests: effect row placement after return type; named call arguments
(`path = …`, `body = …`); postfix `?` after a call; `match` with literal
arms and a catch-all binding arm (`s => …`); the ADT declared above the
fn, with leading `|` on every arm.

---

## 3. `result.rd` — ADT with type parameters

```
module std/result
  exports: [Result, map]
end-module

pub type Result[T, E] =
  | Ok(T)
  | Err(E)

pub fn map[T, U, E](r: Result[T, E], f: fn(T) -> U) -> Result[U, E] {
  match r {
    Ok(v)  => Ok(f(v))
    Err(e) => Err(e)
  }
}
```

Parse tree (abbreviated):

```
File
├── ModuleHeader
├── TopDecl = TypeDecl
│   ├── IDENT      = Result
│   ├── TypeParams = [T, E]
│   └── TypeExpr   = SumType (Ok(T), Err(E))
└── TopDecl = FnDecl
    ├── IDENT      = map
    ├── TypeParams = [T, U, E]
    ├── ParamList  (r: Result[T, E], f: FnType)
    ├── "->" Type  = Result[U, E]
    └── Block { MatchExpr (Ok(v) => …, Err(e) => …) }
```

Tests: `TypeParams` on both `TypeDecl` and `FnDecl`; a parameter whose
`Type` is itself an `FnType`; `CtorPat` with a `BindingPat` payload;
leading `|` on the first variant.

---

## 4. `refinement.rd` — refinement syntax (parsed, not checked)

```
module ids
  exports: [ChargeId, NonEmpty]
end-module

pub type ChargeId = String where len(x) == 18
pub type NonEmpty[T] = List[T] where len(x) > 0
```

Parse tree:

```
File
├── ModuleHeader
├── TopDecl = TypeDecl
│   ├── IDENT    = ChargeId
│   └── TypeExpr = Type
│       ├── TypeAtom = NominalType String
│       └── "where" Expr = CmpExpr
│           ├── CallExpr len(x)
│           ├── "=="
│           └── INT_LIT 18
└── TopDecl = TypeDecl
    ├── IDENT    = NonEmpty
    ├── TypeParams = [T]
    └── TypeExpr = Type
        ├── TypeAtom = NominalType List[T]
        └── "where" Expr = CmpExpr (len(x) > 0)
```

Tests: `Type ::= TypeAtom ("where" Expr)?` parses; the refinement
predicate is a full `Expr` (not a restricted form); no semantic check
runs — `x` is not resolved in v0.

---

## 5. `let-and-binop.rd` — expression precedence ladder

```
module math
  exports: [mixup]
end-module

fn mixup(a: Int, b: Int, c: Int) -> Bool {
  let x = a + b * c
  let y = a * b + c
  let z = -a + b
  x == y && z >= 0 || b != 0
}
```

Parse tree (focus on the last expression — the precedence test):

```
Block
├── LetStmt x = AddExpr(a, "+", MulExpr(b, "*", c))
├── LetStmt y = AddExpr(MulExpr(a, "*", b), "+", c)
├── LetStmt z = AddExpr(UnaryExpr("-", a), "+", b)
└── ExprStmt
    └── OrExpr
        ├── AndExpr
        │   ├── CmpExpr(x, "==", y)
        │   └── CmpExpr(z, ">=", 0)
        └── CmpExpr(b, "!=", 0)
```

Tests: `*` binds tighter than `+`; `-` at start of expression is unary;
`&&` binds tighter than `||`; comparisons bind looser than arithmetic
and tighter than `&&` / `||`; trailing expression of a `Block` is a
valid `ExprStmt` (implicit return).

---

## 6. `extern-fs.rd` — extern block with effects

```
module app/io
  exports: [read_config]
end-module

extern module node/fs {
  fn read_file(path: String) -> Result[Buffer, Error] ! { fs.read }
  type Buffer
}

fn read_config(path: String) -> Result[Buffer, Error] ! { fs.read } {
  read_file(path)
}
```

Parse tree (abbreviated):

```
File
├── ModuleHeader
├── TopDecl = ExternBlock
│   ├── ModulePath = node/fs
│   ├── ExternDecl fn read_file(path: String) -> Result[Buffer, Error] ! { fs.read }
│   └── ExternDecl type Buffer                            (opaque)
└── TopDecl = FnDecl
    ├── IDENT      = read_config
    ├── ParamList  (path: String)
    ├── "->" Type  = Result[Buffer, Error]
    ├── EffectRow  = ! { fs.read }
    └── Block { ExprStmt CallExpr read_file(path) }
```

Tests: `extern module` is its own top-level form distinct from
`ModuleHeader`; dotted `EffectName` (`fs.read`) lexes as a single
EffectRow entry; an `ExternDecl` without a body ends at NEWLINE;
opaque `type Buffer` (no `=` RHS) is a legal `ExternDecl`.

---

## 7. `contracts.rd` — contract clauses between signature and body

```
module accounts
  exports: [withdraw]
end-module

pub fn withdraw(account: Account, amount: Money) -> Result[Account, WithdrawError]
  @pre amount.cents > 0
  @pre account.balance >= amount
  @post result.ok
  @cost tokens: 80, ops: <= 4
{
  Ok(account)
}
```

Parse tree:

```
File
├── ModuleHeader
└── TopDecl = FnDecl
    ├── Visibility = pub
    ├── IDENT      = withdraw
    ├── ParamList  (account, amount)
    ├── "->" Type  = Result[Account, WithdrawError]
    ├── ContractClause @pre  (amount.cents > 0)
    ├── ContractClause @pre  (account.balance >= amount)
    ├── ContractClause @post (result.ok)
    ├── ContractClause @cost (tokens: 80, ops: <= 4)
    └── Block { ExprStmt Ok(account) }
```

Tests: any number of `ContractClause`s may appear between the return
type and the body; each clause is terminated by NEWLINE; `@cost` takes
a comma-separated `CostField` list with `<=` and `~` magnitude prefixes;
the clauses are parsed but not type-checked (`result.ok` refers to a
binding only defined by Epic 1.3's contract checker).

---

## Coverage check against Epic 0.3 bullet

Every v0 surface construct the Roadmap names for this epic is exercised:

| Construct                         | Example(s)                      |
|-----------------------------------|---------------------------------|
| Module headers                    | all (1–7)                       |
| Imports                           | (not shown; same as module path; see `Import` in grammar) |
| `fn` signatures with effect rows  | 2, 6, 7                         |
| ADTs                              | 2, 3                            |
| Structural records                | 2 (`{ path = …, body = … }`), 7 |
| Refinement syntax (parsed only)   | 4                               |
| `let`                             | 2, 5                            |
| `match`                           | 2, 3                            |
| Literals                          | 2, 5, 7                         |
| Binary ops                        | 2, 5, 7                         |
| Calls                             | 2, 3, 6                         |
| `?` operator                      | 2                               |
| `extern module` blocks            | 6                               |

When Epic 0.4's parser tests are written, each snippet here becomes a
round-trip fixture: `parse(snippet) → AST → pretty-print → parse` must
be an identity function modulo whitespace.
