# IR Instructions

Every instruction has a stable operation kind and optional source span.

```ts
type IrInstruction =
  | IrLoad
  | IrStore
  | IrMove
  | IrConstInstruction
  | IrUnary
  | IrBinary
  | IrCast
  | IrCall
  | IrConstructStruct
  | IrGetField
  | IrSetField
  | IrConstructTuple
  | IrGetTupleField
  | IrConstructEnum
  | IrEnumTag
  | IrEnumPayload
  | IrMakeNullable
  | IrMakeNull
  | IrIsNull
  | IrUnwrapNullable
  | IrArrayNew
  | IrArrayLen
  | IrArrayGet
  | IrArraySet
  | IrStringLen
  | IrStringGet
  | IrStringConcat
  | IrRetain
  | IrRelease
  | IrDetach
  | IrEnsureGlobalInitialized;
```

If an instruction has `result`, the result temp is defined exactly once.

## Local and Memory Instructions

```ts
interface IrLoad {
  kind: "load";
  result: IrTempValue;
  place: IrPlace;
}

interface IrStore {
  kind: "store";
  place: IrPlace;
  value: IrValue;
}

interface IrMove {
  kind: "move";
  result: IrTempValue;
  value: IrValue;
}
```

Rules:

- `load` reads from a place.
- `store` writes to a place.
- `move` creates a typed temp alias/value and is mainly useful after ownership
  lowering.

The lowerer may omit `load` for immutable temps when a value can be used
directly.

## Constants

```ts
interface IrConstInstruction {
  kind: "const";
  result: IrTempValue;
  value: IrConst;
}
```

String constants in IR are source strings. The C emitter chooses whether to emit
them as C string literals, static runtime strings, or calls to runtime
constructors.

## Unary, Binary, and Cast

```ts
type IrUnaryOp = "neg" | "not";

interface IrUnary {
  kind: "unary";
  result: IrTempValue;
  op: IrUnaryOp;
  value: IrValue;
}
```

```ts
type IrBinaryOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "mod"
  | "shl"
  | "shr"
  | "bit_and"
  | "bit_or"
  | "bit_xor"
  | "logical_and"
  | "logical_or"
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge";

interface IrBinary {
  kind: "binary";
  result: IrTempValue;
  op: IrBinaryOp;
  left: IrValue;
  right: IrValue;
}
```

```ts
interface IrCast {
  kind: "cast";
  result: IrTempValue;
  value: IrValue;
  target: IrType;
}
```

Rules:

- `logical_and` and `logical_or` may appear only after short-circuiting has
  already been lowered, or when both operands are known already evaluated (no
  side effects on the right operand).
- Source-level `&&` and `||` must normally lower to blocks with `cond_branch` to
  preserve short-circuit evaluation. See [control-flow.md](./control-flow.md).
- User-defined equality must lower to a static call to the resolved `equals`
  method, not to `binary eq`.
- `binary eq` and `binary ne` are for built-in equality only.

## Calls

```ts
interface IrCall {
  kind: "call";
  result?: IrTempValue;
  target: IrCallTarget;
  args: IrValue[];
}

type IrCallTarget =
  | { kind: "direct"; function: IrFunctionId }
  | { kind: "value"; value: IrValue }
  | { kind: "runtime"; name: IrRuntimeFunction };
```

Runtime function names:

```ts
type IrRuntimeFunction =
  | "__vek_panic"
  | "__vek_panic_cstr"
  | "__vek_string_new"
  | "__vek_string_retain"
  | "__vek_string_release"
  | "__vek_string_eq"
  | "__vek_string_cmp"
  | "__vek_array_new"
  | "__vek_array_retain"
  | "__vek_array_release"
  | "__vek_array_len"
  | "__vek_array_get"
  | "__vek_array_set"
  | "__vek_array_detach";
```

Rules:

- Direct calls must target concrete IR functions.
- Method calls lower to direct calls with receiver as an ordinary argument.
- Static methods lower to direct calls without receiver injection.
- Type-qualified method references lower to `IrFunctionValue`.
- Trait calls on type parameters must be statically resolved by specialization
  before IR emission.
- Runtime calls must be declared in `IrRuntimeRequirements`.

## Structs

```ts
interface IrConstructStruct {
  kind: "construct_struct";
  result: IrTempValue;
  type: IrStructType;
  fields: IrStructFieldValue[];
}

interface IrStructFieldValue {
  index: number;
  name: string;
  value: IrValue;
}

interface IrGetField {
  kind: "get_field";
  result: IrTempValue;
  object: IrValue;
  field: string;
  index: number;
}

interface IrSetField {
  kind: "set_field";
  object: IrPlace;
  field: string;
  index: number;
  value: IrValue;
}
```

Rules:

- Field names are retained for debugging.
- Field indexes are authoritative for emission.
- `set_field` may require a prior `detach` if the object is heap-backed or
  contains heap-backed storage by representation.

## Tuples

```ts
interface IrConstructTuple {
  kind: "construct_tuple";
  result: IrTempValue;
  type: IrTupleType;
  elements: IrValue[];
}

interface IrGetTupleField {
  kind: "get_tuple_field";
  result: IrTempValue;
  object: IrValue;
  index: number;
}
```

Tuple mutation is not valid IR.

## Enums

```ts
interface IrConstructEnum {
  kind: "construct_enum";
  result: IrTempValue;
  type: IrEnumType;
  variant: string;
  tag: number;
  payload: IrValue[];
}

interface IrEnumTag {
  kind: "enum_tag";
  result: IrTempValue;
  value: IrValue;
}

interface IrEnumPayload {
  kind: "enum_payload";
  result: IrTempValue;
  value: IrValue;
  variant: string;
  tag: number;
  index: number;
}
```

Rules:

- Payload extraction is valid only on a control-flow path where the tag is known
  to match.
- The lowerer must ensure payload extraction dominance.
- The C emitter may assert this invariant in debug builds but must not implement
  source-level pattern checking.

## Nullable Values

```ts
interface IrMakeNullable {
  kind: "make_nullable";
  result: IrTempValue;
  value: IrValue;
  type: IrNullableType;
}

interface IrMakeNull {
  kind: "make_null";
  result: IrTempValue;
  type: IrNullableType;
}

interface IrIsNull {
  kind: "is_null";
  result: IrTempValue;
  value: IrValue;
}

interface IrUnwrapNullable {
  kind: "unwrap_nullable";
  result: IrTempValue;
  value: IrValue;
}
```

Rules:

- `unwrap_nullable` may appear only on a path where null has been ruled out, or
  as the implementation of user-visible `unwrap` where a panic path has been
  inserted.
- Source-level narrowing is not represented as a type environment in IR.
  Instead, the lowerer emits branch-local values or unwrap operations in the
  block where the value is known non-null.

## Arrays and Strings

```ts
interface IrArrayNew {
  kind: "array_new";
  result: IrTempValue;
  elementType: IrType;
  elements: IrValue[];
}

interface IrArrayLen {
  kind: "array_len";
  result: IrTempValue;
  array: IrValue;
}

interface IrArrayGet {
  kind: "array_get";
  result: IrTempValue;
  array: IrValue;
  index: IrValue;
}

interface IrArraySet {
  kind: "array_set";
  array: IrPlace;
  index: IrValue;
  value: IrValue;
}

interface IrStringLen {
  kind: "string_len";
  result: IrTempValue;
  string: IrValue;
}

interface IrStringGet {
  kind: "string_get";
  result: IrTempValue;
  string: IrValue;
  index: IrValue;
}

interface IrStringConcat {
  kind: "string_concat";
  result: IrTempValue;
  left: IrValue;
  right: IrValue;
}
```

Rules:

- Bounds checks are required for `array_get`, `array_set`, and `string_get`.
- Bounds checks may be emitted as runtime helper calls or explicit IR branches
  to panic.
- `array_set` must be preceded by detach when the array may be shared.
- Strings are immutable; there is no `string_set`.

## Ownership and Runtime Lifetime

```ts
interface IrRetain {
  kind: "retain";
  value: IrValue;
}

interface IrRelease {
  kind: "release";
  value: IrValue;
}

interface IrDetach {
  kind: "detach";
  result: IrTempValue;
  value: IrValue;
}
```

See [ownership.md](./ownership.md) for full rules.

## Top-Level Initializers

```ts
interface IrEnsureGlobalInitialized {
  kind: "ensure_global_initialized";
  globalId: IrGlobalId;
}
```

Any read of a lazily initialized global must be preceded by this instruction.
See [program.md](./program.md) for global initializer structure.
