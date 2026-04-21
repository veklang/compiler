# IR Validation, Debug Dump, and Implementation Order

## Validation

An IR validation pass must run before C emission.

Validation errors are compiler bugs unless they arise from unsupported backend
features, in which case the compiler may report an explicit backend diagnostic.

Required checks:

- every function has at least one block unless extern
- every non-extern block has one terminator
- every terminator target block exists in the same function
- every temp is defined exactly once
- every temp is defined before use in block order, accounting for predecessor
  dominance when needed
- every instruction result type matches the operation
- every `store` value type matches the place type
- every `cond_branch` condition is `bool`
- every `return` matches the function return type
- every direct call target exists
- every call argument matches the target signature
- no generic type parameters appear
- no parser AST nodes appear
- runtime calls are listed in `IrRuntimeRequirements`
- enum payload extraction is dominated by matching tag control flow
- no invalid assignment forms appear
- no string mutation appears
- no tuple mutation appears

For the first implementation, validation may start with structural checks and
grow as features are added. Each newly supported instruction must add validation
coverage.

## Debug Dump Format

The compiler provides a deterministic textual dump for tests.

This is not the canonical representation, but it must be stable enough for
snapshot-style assertions.

Example (single block):

```text
func main() -> void {
bb.0:
  return
}
```

Example with control flow:

```text
func main() -> void {
bb.0:
  %0:i32 = const 1
  %1:i32 = const 2
  %2:i32 = add %0, %1
  %3:bool = eq %2, 3
  cond_branch %3, bb.1, bb.2

bb.1:
  call_runtime __vek_panic_cstr "ok"
  unreachable

bb.2:
  return
}
```

Example with loop:

```text
func count() -> void {
bb.0:
  local.0 = 0
  branch bb.1

bb.1:
  %0:bool = local.0 < 10
  cond_branch %0, bb.2, bb.3

bb.2:
  %1:i32 = local.0 + 1
  local.0 = %1
  branch bb.1

bb.3:
  return
}
```

Dump requirements:

- deterministic declaration order
- deterministic block order
- deterministic temp/local ids
- explicit types on temps
- explicit terminators including targets
- branch targets use block ids (`bb.N`)

## Initial Implementation Slice

The first IR implementation supports:

- `fn main() -> void`
- `return;`
- integer constants
- boolean constants
- string constants only as panic literals
- local declarations
- local loads/stores
- integer arithmetic and comparisons
- `if` / `else` (cond_branch)
- `while` (branch + cond_branch loop)
- `break` and `continue` (branch to exit/condition block)
- direct call to `panic("literal")`

Required files:

```text
compiler/src/ir/types.ts
compiler/src/ir/lower.ts
compiler/src/ir/validate.ts
compiler/src/ir/dump.ts
compiler/src/emit/c.ts
```

## Feature Expansion Order

Recommended order after the initial slice:

1. Primitive function calls and non-void returns. ✅
2. `if` / `while` / `break` / `continue` (branch, cond_branch terminators). ✅
3. Struct declarations, struct literals, field get. ✅
4. Field set for non-heap-backed structs. ✅
5. Enum declarations and unit variants. ✅
6. Enum payload variants and match lowering. ✅
7. Nullable values and null checks. ✅
8. Runtime strings beyond panic literals. ✅
9. Arrays and array indexing. ✅
10. `for` loops (requires array runtime helpers). ✅
11. Copy-on-write detach for array mutation. ✅ for direct array element mutation.
12. Retain/release for strings and arrays. ✅ for direct heap values and owned array elements.
13. Aggregate retain/release helpers. ✅ for structs, tuples, nullable values, and enums containing owned values.
14. Top-level lazy initializers. ✅
15. Function values. ✅ for named functions, non-capturing anonymous functions, inherent methods, type-qualified method references, and direct instance method calls.
16. Specialized generic functions and methods beyond direct primitive cases.

Each step must include:

- IR lowering tests
- IR validation coverage
- C emission tests
- runtime linkage tests when runtime helpers are involved

## Non-Negotiable Invariants

Before a program reaches C emission:

- all names are resolved
- all types are concrete
- all generics are specialized
- all trait calls are statically resolved
- all high-level control flow is lowered to blocks
- all source-level mutability rules are already enforced
- all runtime helper requirements are known
- all emitted heap-backed operations have explicit ownership behavior
- every block ends in a terminator

If an invariant cannot be satisfied for a construct, that construct is not
backend-supported yet. The lowerer must throw a clear "not yet supported"
error rather than silently emitting incorrect IR.
