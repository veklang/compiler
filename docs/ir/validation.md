# IR Validation, Debug Dump, and Invariants

## Validation

The compiler runs IR validation before C emission. Validation failures are
compiler bugs unless they are raised as explicit unsupported-backend diagnostics.

The current validator covers structural integrity:

- every defined function has at least one block
- every non-extern block has a terminator
- every terminator target block exists in the same function
- every function referenced by `entry`, calls, or initializer functions exists
- every struct declaration id is unique
- every global declaration id is unique
- every global reference exists
- every struct construction references an existing struct declaration
- every local/temp operand refers to an in-scope local or previously defined
  temp
- every temp is defined before use in block order
- every temp is defined only once within a function
- all referenced runtime requirements are present on the program

Validation should continue to grow with feature support. Checks that are still
worth adding include:

- instruction result type checks
- assignment and return type compatibility
- call argument compatibility
- dominance-aware temp validation across complex control flow
- enum payload extraction only on matching-tag paths
- rejection of `unknown` and `error` types in emittable IR

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
  call panic("ok")
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

## Implemented Feature Coverage

The IR and C backend currently cover:

1. Primitive function calls and non-void returns.
2. Inferred function and method return types from checker-recorded types.
3. `main` validation after inference: no params, return `void` or `i32`.
4. `if` / `while` / `break` / `continue`.
5. Struct declarations, literals, field reads, and local field writes.
6. Enum declarations, unit variants, payload variants, and match lowering.
7. Nullable values and null checks.
8. Runtime strings.
9. Arrays, indexing, mutation, and array-backed `for` loops.
10. Copy-on-write detach for direct array element mutation.
11. Retain/release for direct heap values and owned array elements.
12. Aggregate retain/release helpers for structs, tuples, nullable values, and
    enums containing owned values.
13. Top-level lazy initializers.
14. Function values for named functions, non-capturing anonymous functions,
    inherent methods, type-qualified method references, and direct instance
    method calls.
15. Generic free function specializations, generic method specializations on
    concrete owner types, used generic struct layout specializations, and
    both non-generic and method-generic methods on used generic struct owner
    specializations.

Associated types, higher-kinded generics, and generic enum layout
specialization remain outside the current backend slice.

## Non-Negotiable Invariants

Before a program reaches C emission:

- all names are resolved
- all types are concrete
- all generics required by emitted code are specialized
- all trait calls are statically resolved
- all high-level control flow is lowered to blocks
- all source-level mutability rules are already enforced
- all runtime helper requirements are known
- all emitted heap-backed operations have explicit ownership behavior
- every block ends in a terminator

If an invariant cannot be satisfied for a construct, that construct is not
backend-supported yet. The lowerer must throw a clear unsupported-feature error
rather than silently emitting incorrect IR.
