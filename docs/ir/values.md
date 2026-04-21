# IR Operands, Constants, and Locals

The current IR uses operands directly rather than a separate place/value model.
Assignable source forms have already been checked before IR lowering.

## Operands

```ts
type IrOperand =
  | IrConstOperand
  | IrLocalOperand
  | IrTempOperand
  | IrFunctionOperand
  | IrGlobalOperand;
```

```ts
interface IrConstOperand {
  kind: "const";
  value: IrConst;
  type: IrType;
}

interface IrLocalOperand {
  kind: "local";
  id: IrLocalId;
  type: IrType;
}

interface IrTempOperand {
  kind: "temp";
  id: IrTempId;
  type: IrType;
}

interface IrFunctionOperand {
  kind: "function";
  name: string;
  type: IrType;
}

interface IrGlobalOperand {
  kind: "global";
  id: IrGlobalId;
  type: IrType;
}
```

Rules:

- Locals and globals are read by using local/global operands.
- Instruction results are addressed by temp ids.
- Function operands name concrete functions or function values known after
  checking and specialization.
- Store-like effects are represented by dedicated instructions such as
  `assign`, `set_field`, `array_set`, and `store_global`.

## Constants

```ts
type IrConst =
  | { kind: "int"; value: string }
  | { kind: "float"; value: string }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "void" };
```

Integer and float constants use strings so the compiler does not lose source
precision through JavaScript number conversion.

## Locals and Params

```ts
interface IrLocal {
  id: IrLocalId;
  sourceName?: string;
  type: IrType;
  mutable: boolean;
  span?: Span;
}

interface IrParam {
  local: IrLocalId;
  sourceName?: string;
  type: IrType;
  mutable: boolean;
  span?: Span;
}
```

`mutable` records whether the slot can be assigned after initialization. It is
not a substitute for checker mutability rules; those rules have already been
enforced.
