# IR Types

All IR values and places have an `IrType`.

```ts
type IrType =
  | IrVoidType
  | IrNeverType
  | IrBoolType
  | IrIntegerType
  | IrFloatType
  | IrNullType
  | IrStringType
  | IrArrayType
  | IrNullableType
  | IrTupleType
  | IrStructType
  | IrEnumType
  | IrFunctionType
  | IrOpaqueRuntimeType;
```

## Primitive Types

```ts
interface IrVoidType {
  kind: "void";
}

interface IrNeverType {
  kind: "never";
}

interface IrBoolType {
  kind: "bool";
}

interface IrIntegerType {
  kind: "int";
  signed: boolean;
  bits: 8 | 16 | 32 | 64;
}

interface IrFloatType {
  kind: "float";
  bits: 16 | 32 | 64;
}

interface IrNullType {
  kind: "null";
}
```

`never` is the type of instructions or terminators that do not return normally,
such as unconditional panic paths. It is valid only inside IR and is not a Vek
source type.

## Runtime-Backed Types

```ts
interface IrStringType {
  kind: "string";
}

interface IrArrayType {
  kind: "array";
  element: IrType;
}
```

`string` and `array` are heap-backed runtime types. Their physical layout belongs
to the runtime and C emitter, not to the checker.

## Composite Types

```ts
interface IrNullableType {
  kind: "nullable";
  base: IrType;
}

interface IrTupleType {
  kind: "tuple";
  elements: IrType[];
}

interface IrStructType {
  kind: "struct";
  decl: IrTypeDeclId;
  name: string;
  typeArgs: IrType[];
}

interface IrEnumType {
  kind: "enum";
  decl: IrTypeDeclId;
  name: string;
  typeArgs: IrType[];
}
```

Rules:

- `nullable<T>` has a representation chosen by the C emitter.
- Tuples are structural and canonicalized by element types.
- Structs and enums refer to concrete type declarations.
- Generic structs and enums must be specialized before they appear in IR.

## Function Types

```ts
interface IrFunctionType {
  kind: "function";
  params: IrParamType[];
  returnType: IrType;
}

interface IrParamType {
  type: IrType;
  passing: "readonly" | "mut";
}
```

Rules:

- Function types in IR are concrete.
- Generic function values are represented only after specialization.
- Parameter names are not part of the function type.
- `passing` records source-level mutability only when it still affects runtime
  lowering. The checker has already validated mutability legality.

## Opaque Runtime Types

```ts
interface IrOpaqueRuntimeType {
  kind: "opaque_runtime";
  name: string;
}
```

Opaque runtime types are reserved for runtime handles that the compiler must pass
around but not inspect. They must not be used for ordinary Vek structs or enums.

Examples:

- file handles in future `std:fs`
- process handles in future `std:process`

## Implementation Note

The current implementation uses a simplified flat representation for primitive
types rather than the distinct typed interfaces above:

```ts
// current implementation (simplified)
interface IrPrimitiveType {
  kind: "primitive";
  name: "i8" | "i16" | "i32" | "i64" | "u8" | "u16" | "u32" | "u64"
      | "f16" | "f32" | "f64" | "bool" | "string" | "void" | "null";
}
```

This encoding is adequate for the current straight-line subset and will be
aligned to the typed interfaces above when struct/enum lowering is implemented.
