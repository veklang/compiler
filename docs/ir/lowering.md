# IR Lowering Rules

This document defines how checked AST constructs lower to IR. See
[control-flow.md](./control-flow.md) for block structure diagrams for each
construct.

## Functions

Each reachable concrete function lowers to one `IrFunction`.

Rules:

- Generic functions lower only for used specializations.
- Extern functions lower to declarations without blocks.
- Anonymous functions lower to generated top-level functions because v1
  anonymous functions are non-capturing.
- Methods lower to functions. Instance methods receive `self` as the first
  ordinary parameter.
- The user-level `main` function lowers to the program entry function.
- When a function or method omits `-> T`, the lowerer uses the return type
  inferred and recorded by the checker. `main` must have no parameters and must
  return either `void` or `i32` after inference.

## Variables

Local declarations lower to:

- local slot declaration in `IrFunction.locals`
- initializer expression instructions
- `assign` into the local slot

`const` and readonly restrictions are checker-only. IR does not need separate
readonly places except where runtime ownership depends on parameter passing.

Variable names declared inside block-scoped bodies (if, while, for, match arms)
are not visible after the body exits. The lowerer tracks local names per scope
and restores the outer scope when the inner block completes.

## Assignment

Assignments lower to stores or aggregate set instructions.

Examples:

```text
x = value
  -> assign local.x, value

user.name = value
  -> set_field user, "name", value

arr[i] = value
  -> detach arr
  -> array_set arr, i, value
```

Invalid assignment targets must never reach IR.

Compound assignments lower as a read of the assignable place, a binary
operation, and a write back to the same place. The assignable place is evaluated
once.

## If

See [control-flow.md § If](./control-flow.md#if) for block diagrams.

Source-level nullable narrowing inside `if` conditions (e.g. `if x != null`)
must be lowered to `is_null` + `cond_branch`. The narrowed value inside the
then-block uses `unwrap_nullable` rather than the original nullable operand.

`else if` chains are lowered by recursion: the inner if statement starts in the
outer `else_block`.

## While

See [control-flow.md § While](./control-flow.md#while) for block diagrams.

Rules:

- `break` lowers to an unconditional `branch` to the loop's `exit_block`.
- `continue` lowers to an unconditional `branch` to the loop's `condition_block`.
- The lowerer tracks the innermost enclosing loop's exit and continue targets.
  Nested loops each have their own targets.
- Ownership cleanup for locals introduced inside the loop body is emitted before
  the `break` or `continue` branch.
- A terminated body path (via return, break, panic/unreachable) does not emit
  the trailing `branch condition_block`.

## For

See [control-flow.md § For](./control-flow.md#for-array) and
[control-flow.md § For (custom Iterable)](./control-flow.md#for-custom-iterable)
for block diagrams.

For array iteration:

- The array expression is evaluated once before the loop.
- `array_len` is called once and stored in a temp.
- An index local is introduced by the lowerer and is not user-accessible.
- `array_get` retrieves each element; the element local has the iterator
  variable's name.
- `break` and `continue` follow the same rules as for while loops. `continue`
  branches to `condition_block`, which re-evaluates the index comparison.

For custom `Iterable<T>` iteration:

- The iterable expression is evaluated once before the loop.
- The result is stored in a hidden mutable iterator local.
- The lowerer calls the emitted concrete `next(mut self) -> T?` method at the
  top of each iteration.
- The nullable result is checked with `is_null`; null exits the loop.
- The non-null payload is unwrapped and assigned to the user iterator local.
- `break` and `continue` follow the same rules as for while loops. `continue`
  branches to the block that calls `next` again.

## Match Statements

See [control-flow.md § Match Statement](./control-flow.md#match-statement) for
block diagrams.

General rules:

- The scrutinee is evaluated exactly once.
- Arms are evaluated in source order when the lowerer uses `cond_branch` chains.
  With `switch`, the C compiler and runtime control order.
- Wildcard and identifier-binding arms act as the default case.
- Payload names declared in arm patterns are block-scoped to that arm body.

Enum match:

- `get_tag` extracts the discriminator.
- A `switch` terminator dispatches to arm blocks.
- Payload fields are extracted with `get_enum_payload` inside arm blocks.

Nullable match:

- `is_null` checks null first.
- The non-null arm uses `unwrap_nullable`.

Literal match:

- Sequential `binary eq` + `cond_branch` chains.
- Boolean match on a single `bool` scrutinee is equivalent to `if`.

## Match Expressions

Match expressions follow the same block structure as match statements but each
arm stores its result into a compiler-generated local before branching to the
join block. See [control-flow.md § Match Expressions](./control-flow.md#match-expressions).

## Short-Circuit Operators

`&&` and `||` must preserve short-circuit evaluation. See
[control-flow.md § Short-Circuit Operators](./control-flow.md#short-circuit-operators).

## Nullable Narrowing

The checker proves narrowing. IR represents it operationally.

Source:

```vek
if value != null {
  use(value)
}
```

IR:

```text
entry:
  %is_null = is_null value
  cond_branch %is_null, else_block, then_block

then_block:
  %inner = unwrap_nullable value
  call use(%inner)
  branch join_block

else_block:
  branch join_block

join_block:
  ...
```

The lowerer must use the narrowed value in the narrowed block rather than
requiring the C emitter to understand narrowing.

## Equality

Built-in equality lowers to `binary eq` or runtime helper calls.

User-defined equality through `Equal<T>` lowers to a static call to the resolved
`equals` method.

`!=` lowers to equality followed by boolean negation unless a better direct
operation exists for the type.

## Casts

Only checked valid casts reach IR.

Numeric casts lower to `cast`.

Invalid casts are checker diagnostics and must not reach emittable IR.

## Panic

`panic("literal")` lowers to:

```text
call panic("literal")
unreachable
```

`panic(value)` where `value: string` lowers to:

```text
call panic(value)
unreachable
```

The C emitter maps these reserved panic calls to the appropriate runtime helper
and treats them as non-returning.

## Struct Literals

Struct literals lower to `construct_struct` with fields sorted by IR field
index.

Field shorthand has already been resolved by the parser/checker and does not
exist in IR.

## Enum Variants

Enum variant construction lowers to `construct_enum`.

Unit variants are `construct_enum` with an empty payload list.

Bare variant identifiers in expression position must have been resolved before
IR lowering.

## Function Values

Named functions lower to function operands with concrete `IrFunctionValueType`
signatures.

Anonymous functions lower to generated `IrFunction` declarations and then to
function operands when used as values. Generated anonymous functions use stable
internal link names such as `__vek_anon_0`.

Calling through a function value lowers to an ordinary `call` instruction whose
callee is a local/temp/global/function operand of function type.

Inherent methods lower to ordinary static `IrFunction` declarations with
owner-qualified link names such as `User_show`.

Type-qualified method references lower to function operands after the method is
resolved to a concrete static function. Instance method references include the
receiver as the first parameter, so `User.show` has a function type shaped like
`fn(User) -> Ret`.

Direct instance method calls lower to static calls with the receiver as the first
argument.

Captured closures are not supported in v1 and must never reach IR.

## Generics

IR is post-monomorphization.

Rules:

- No `TypeParam` types may appear.
- No generic function declarations may appear unless represented only as source
  metadata.
- Each used type argument set gets a concrete `IrFunction`.
- Each used generic struct instantiation gets a concrete type declaration as
  needed.
- Non-generic methods on used generic struct owners lower once per concrete
  owner layout.
- Generic methods on used generic struct owners combine the owner type
  substitutions and method type substitutions in a single concrete function.
- Mangled names must be deterministic.

## Traits

Traits do not exist as runtime values in IR.

Rules:

- Trait bounds are checker constraints only.
- Trait method calls lower to concrete static calls.
- `satisfies` blocks contribute concrete methods.
- Trait objects and dynamic dispatch are not supported.

## Top-Level Initializers

Rules:

- Cycles are rejected before IR lowering.
- Lazy top-level initializer execution lowers to an initializer function plus
  guard state.
- Any read of a lazily initialized global must be preceded by
  `ensure_global_initialized`.
- Eager compile-time constants may be emitted as static C initializers when they
  require no runtime work.
