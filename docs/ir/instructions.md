# IR Instructions

Every instruction has a stable `kind` and an optional source span. If an
instruction defines a temp `target`, that temp is defined exactly once.

```ts
type IrInstruction =
  | IrAssignInstruction
  | IrRetainInstruction
  | IrReleaseInstruction
  | IrDetachInstruction
  | IrBinaryInstruction
  | IrUnaryInstruction
  | IrCallInstruction
  | IrCastInstruction
  | IrMakeNullInstruction
  | IrMakeNullableInstruction
  | IrIsNullInstruction
  | IrUnwrapNullableInstruction
  | IrConstructTupleInstruction
  | IrGetTupleFieldInstruction
  | IrConstructStructInstruction
  | IrGetFieldInstruction
  | IrSetFieldInstruction
  | IrConstructEnumInstruction
  | IrGetTagInstruction
  | IrGetEnumPayloadInstruction
  | IrArrayNewInstruction
  | IrArrayLenInstruction
  | IrArrayGetInstruction
  | IrArraySetInstruction
  | IrEnsureGlobalInitializedInstruction
  | IrStoreGlobalInstruction
  | IrStringLenInstruction
  | IrStringAtInstruction
  | IrStringConcatInstruction
  | IrStringEqInstruction;
```

## Local and Ownership Instructions

```ts
interface IrAssignInstruction {
  kind: "assign";
  target: IrLocalId;
  value: IrOperand;
}

interface IrRetainInstruction {
  kind: "retain";
  value: IrOperand;
}

interface IrReleaseInstruction {
  kind: "release";
  value: IrOperand;
}

interface IrDetachInstruction {
  kind: "detach";
  target: IrTempId;
  value: IrOperand;
  type: IrType;
}
```

Rules:

- `assign` writes a value to a local slot.
- Local reads are represented directly as local operands.
- Reassignment of an owned heap value must release the old value before the new
  value is assigned.
- `detach` materializes a uniquely owned copy for copy-on-write mutation.

## Unary, Binary, Cast, and Calls

```ts
interface IrUnaryInstruction {
  kind: "unary";
  target: IrTempId;
  operator: Operator;
  argument: IrOperand;
  type: IrType;
}

interface IrBinaryInstruction {
  kind: "binary";
  target: IrTempId;
  operator: Operator;
  left: IrOperand;
  right: IrOperand;
  type: IrType;
}

interface IrCastInstruction {
  kind: "cast";
  target: IrTempId;
  value: IrOperand;
  type: IrType;
}

interface IrCallInstruction {
  kind: "call";
  target?: IrTempId;
  callee: IrOperand;
  args: IrOperand[];
  type: IrType;
}
```

Rules:

- `operator` is the resolved shared operator enum used by the checker.
- Source-level short-circuiting lowers to blocks and terminators, not eager
  binary evaluation.
- Method calls lower to concrete function calls with receiver as an ordinary
  argument.
- Runtime helpers are emitted either through dedicated instructions or through
  reserved function operands recognized by the C emitter.

## Structs

```ts
interface IrConstructStructInstruction {
  kind: "construct_struct";
  target: IrTempId;
  declId: IrTypeDeclId;
  fields: { name: string; value: IrOperand }[];
  type: IrType;
}

interface IrGetFieldInstruction {
  kind: "get_field";
  target: IrTempId;
  object: IrOperand;
  field: string;
  type: IrType;
}

interface IrSetFieldInstruction {
  kind: "set_field";
  target: IrLocalId;
  field: string;
  value: IrOperand;
}
```

Rules:

- `declId` identifies the emitted struct declaration.
- Field names are retained for emission and diagnostics.
- `set_field` mutates a field on a local aggregate slot.

## Tuples

```ts
interface IrConstructTupleInstruction {
  kind: "construct_tuple";
  target: IrTempId;
  elements: IrOperand[];
  type: IrTupleType;
}

interface IrGetTupleFieldInstruction {
  kind: "get_tuple_field";
  target: IrTempId;
  object: IrOperand;
  index: number;
  type: IrType;
}
```

Tuple mutation is not valid IR.

## Enums

```ts
interface IrConstructEnumInstruction {
  kind: "construct_enum";
  target: IrTempId;
  declId: IrTypeDeclId;
  variant: string;
  tag: number;
  payload: IrOperand[];
  type: IrType;
}

interface IrGetTagInstruction {
  kind: "get_tag";
  target: IrTempId;
  object: IrOperand;
  type: IrType;
}

interface IrGetEnumPayloadInstruction {
  kind: "get_enum_payload";
  target: IrTempId;
  object: IrOperand;
  variant: string;
  index: number;
  type: IrType;
}
```

Payload extraction is valid only on a path where the tag is known to match. The
checker and lowerer are responsible for source-level pattern checking and match
coverage before IR emission.

## Nullable Values

```ts
interface IrMakeNullableInstruction {
  kind: "make_nullable";
  target: IrTempId;
  value: IrOperand;
  type: IrNullableType;
}

interface IrMakeNullInstruction {
  kind: "make_null";
  target: IrTempId;
  type: IrNullableType;
}

interface IrIsNullInstruction {
  kind: "is_null";
  target: IrTempId;
  value: IrOperand;
  type: IrPrimitiveType;
}

interface IrUnwrapNullableInstruction {
  kind: "unwrap_nullable";
  target: IrTempId;
  value: IrOperand;
  type: IrType;
}
```

Source-level narrowing is not represented as a type environment in IR. The
lowerer emits branch-local values or unwrap operations where the value is known
non-null.

## Arrays and Strings

```ts
interface IrArrayNewInstruction {
  kind: "array_new";
  target: IrTempId;
  elementType: IrType;
  elements: IrOperand[];
  type: IrType;
}

interface IrArrayLenInstruction {
  kind: "array_len";
  target: IrTempId;
  array: IrOperand;
  type: IrType;
}

interface IrArrayGetInstruction {
  kind: "array_get";
  target: IrTempId;
  array: IrOperand;
  index: IrOperand;
  elementType: IrType;
  type: IrType;
}

interface IrArraySetInstruction {
  kind: "array_set";
  array: IrOperand;
  index: IrOperand;
  value: IrOperand;
  elementType: IrType;
}

interface IrStringLenInstruction {
  kind: "string_len";
  target: IrTempId;
  string: IrOperand;
  type: IrType;
}

interface IrStringAtInstruction {
  kind: "string_at";
  target: IrTempId;
  string: IrOperand;
  index: IrOperand;
  type: IrType;
}

interface IrStringConcatInstruction {
  kind: "string_concat";
  target: IrTempId;
  left: IrOperand;
  right: IrOperand;
  type: IrType;
}

interface IrStringEqInstruction {
  kind: "string_eq";
  target: IrTempId;
  left: IrOperand;
  right: IrOperand;
  type: IrType;
}
```

Rules:

- Bounds checks are required for `array_get`, `array_set`, and `string_at`.
- `array_set` must be preceded by detach when the array may be shared.
- `array_new` for an element type that owns storage must pass element
  retain/release callbacks to the runtime; trivial element types pass `NULL`
  callbacks.
- Strings are immutable; there is no `string_set`.

## Top-Level Initializers

```ts
interface IrEnsureGlobalInitializedInstruction {
  kind: "ensure_global_initialized";
  globalId: IrGlobalId;
}

interface IrStoreGlobalInstruction {
  kind: "store_global";
  globalId: IrGlobalId;
  value: IrOperand;
}
```

Any read of a lazily initialized global must be preceded by
`ensure_global_initialized`. The hidden initializer function writes the computed
value with `store_global`.
