# IR Values, Places, and Locals

The IR distinguishes values from places.

A **value** is something computed and consumed.

A **place** is something that can be loaded from or stored to.

## Values

```ts
type IrValue =
  | IrTempValue
  | IrConstValue
  | IrFunctionValue
  | IrGlobalValue;
```

```ts
interface IrTempValue {
  kind: "temp";
  id: IrTempId;
  type: IrType;
}

interface IrConstValue {
  kind: "const";
  type: IrType;
  value: IrConst;
}

interface IrFunctionValue {
  kind: "function";
  id: IrFunctionId;
  type: IrFunctionType;
}

interface IrGlobalValue {
  kind: "global";
  id: IrGlobalId;
  type: IrType;
}
```

## Constants

```ts
type IrConst =
  | { kind: "int"; value: string; bits: 8 | 16 | 32 | 64; signed: boolean }
  | { kind: "float"; value: string; bits: 16 | 32 | 64 }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "string"; value: string };
```

Integer constants use decimal strings to avoid JavaScript precision loss for
64-bit values.

## Places

```ts
type IrPlace =
  | IrLocalPlace
  | IrGlobalPlace
  | IrFieldPlace
  | IrTupleFieldPlace
  | IrIndexPlace;
```

```ts
interface IrLocalPlace {
  kind: "local";
  id: IrLocalId;
  type: IrType;
}

interface IrGlobalPlace {
  kind: "global";
  id: IrGlobalId;
  type: IrType;
}

interface IrFieldPlace {
  kind: "field";
  base: IrPlace | IrValue;
  field: string;
  index: number;
  type: IrType;
}

interface IrTupleFieldPlace {
  kind: "tuple_field";
  base: IrPlace | IrValue;
  index: number;
  type: IrType;
}

interface IrIndexPlace {
  kind: "index";
  base: IrPlace | IrValue;
  index: IrValue;
  type: IrType;
}
```

Rules:

- The checker decides whether a source expression is assignable.
- The IR represents only assignments the checker accepted.
- String indexed assignment must never appear.
- Tuple field stores must never appear.
- `IrIndexPlace` stores are valid only for mutable arrays.

## Locals

```ts
interface IrLocal {
  id: IrLocalId;
  sourceName?: string;
  type: IrType;
  mutable: boolean;
  storage: "param" | "local" | "temp";
}
```

`mutable` records whether the slot can be assigned after initialization. It is
not a substitute for checker mutability rules; the checker has already enforced
those. IR `mutable` is informational for optimization and ownership lowering.
