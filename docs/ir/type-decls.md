# IR Type Declarations

IR type declarations are emitted only for concrete aggregate layouts that need
named C declarations.

```ts
type IrDeclaration =
  | IrFunction
  | IrGlobal
  | IrStructDeclaration
  | IrEnumDeclaration;
```

Tuple and nullable layouts are discovered from type use and emitted as
canonical helper structs by the C backend. Runtime arrays use an erased runtime
representation and do not have `array_decl` IR declarations.

## Struct Declarations

```ts
interface IrStructDeclaration {
  kind: "struct_decl";
  id: IrTypeDeclId;
  sourceName?: string;
  linkName: string;
  fields: IrStructField[];
  span?: Span;
}

interface IrStructField {
  name: string;
  type: IrType;
  index: number;
}
```

Rules:

- Field order in IR is layout order.
- Field indexes are assigned deterministically from the checked declaration,
  normally source declaration order.
- `linkName` is the C-safe emitted type name.

## Enum Declarations

```ts
interface IrEnumDeclaration {
  kind: "enum_decl";
  id: IrTypeDeclId;
  sourceName?: string;
  linkName: string;
  variants: IrEnumVariant[];
  span?: Span;
}

interface IrEnumVariant {
  name: string;
  tag: number;
  payloadTypes: IrType[];
}
```

Rules:

- Tags are zero-based integers assigned in source variant order.
- Unit variants have an empty `payloadTypes` list.
- Payload arity and payload types have already been checked.
- `linkName` is the C-safe emitted enum storage type name.
