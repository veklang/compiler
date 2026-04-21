# IR Ownership Lowering

Ownership lowering is the pass that inserts `retain`, `release`, and CoW
`detach`.

Direct heap retain/release lowering is implemented for `string` and `Array<T>`.
Recursive retain/release lowering is implemented for structs, tuples, nullable
values, and enums whose fields/payloads contain owned values. CoW detach
lowering is implemented for direct array element mutation.

## Ownership Categories

Types fall into ownership categories:

- `trivial`: no retain/release needed
- `heap_ref`: retain/release needed
- `aggregate`: retain/release needed if any field/element needs it
- `opaque`: determined by runtime declaration

Trivial:

- `void`
- `bool`
- integer types
- float types
- enum tags without heap payload by representation

Heap refs:

- `string`
- `Array<T>`

Aggregates:

- tuples
- structs
- enums with payloads
- nullable heap-backed values

## Calling Convention

The IR calling convention defines ownership transfer as follows:

- parameters are borrowed for the duration of the call
- return values are owned by the caller when heap-backed
- storing a heap-backed value into a longer-lived place retains it
- overwriting a heap-backed place releases the previous value

Changing this convention requires updating this specification and the IR
validator. The C emitter must treat this convention as fixed input behavior, not
as something to infer or reinterpret.

## Locals

For heap-backed locals:

- initialization stores an owned or retained value
- reassignment releases the previous value
- function exit releases live owned locals

The current implementation tracks owned locals and temps for direct heap values
and aggregate values containing owned fields/payloads. Parameters are treated as
borrowed values. A borrowed owned value is retained before it is stored into an
owning local/global or returned as an owned result.

## Branches

Ownership lowering must handle all exits from a block:

- normal branches
- returns
- panic/unreachable
- loop break/continue

For `break` and `continue`, any heap-backed locals introduced since the loop
body's entry must be released before branching to the exit or condition block.
The current lowerer emits these releases directly before the branch.

For `return`, all live heap-backed locals in scope must be released before the
return instruction is emitted.

The pass may insert cleanup blocks if needed.

## Instructions

- `retain` increments the runtime reference count for heap-backed values.
- `release` decrements it and may free.
- `detach` returns a uniquely owned value suitable for mutation. The current
  lowerer emits it before direct `Array<T>` element mutation.
- Non-heap-backed values must not receive retain/release/detach.
- Ownership lowering is responsible for inserting these instructions.
- The C emitter must not infer missing ownership operations.

## Aggregate Ownership

Composite types containing heap-backed fields are retained and released
recursively. The current C emitter inlines recursive operations at each
retain/release instruction. A future emitter may generate helper functions if
the inline output becomes too repetitive.

`Array<T>` remains a direct heap object at the IR boundary. When `T` owns
storage, the C emitter generates element retain/release callbacks and passes
them to the runtime array constructor. Runtime `release`, `set`, and `detach`
use those callbacks to manage element lifetimes.
