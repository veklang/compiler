# IR Type Declarations

Type declarations are emitted for concrete aggregate layouts.

```ts
type IrTypeDeclaration =
  | IrStructDeclaration
  | IrEnumDeclaration
  | IrTupleDeclaration
  | IrArrayDeclaration;
```

## Struct Declarations

```ts
interface IrStructDeclaration {
  kind: "struct_decl";
  id: IrTypeDeclId;
  sourceName: string;
  linkName: string;
  fields: IrField[];
}

interface IrField {
  name: string;
  type: IrType;
  index: number;
}
```

Field order in IR is layout order. The lowerer must choose a deterministic order
from the checked declaration, normally source declaration order.

## Enum Declarations

```ts
interface IrEnumDeclaration {
  kind: "enum_decl";
  id: IrTypeDeclId;
  sourceName: string;
  linkName: string;
  variants: IrVariant[];
}

interface IrVariant {
  name: string;
  tag: number;
  payload: IrType[];
}
```

Rules:

- Tags are zero-based integers assigned in source variant order unless an ABI
  rule later requires otherwise.
- Unit variants have an empty payload list.
- Payload arity has already been checked.

## Tuple Declarations

```ts
interface IrTupleDeclaration {
  kind: "tuple_decl";
  id: IrTypeDeclId;
  linkName: string;
  elements: IrType[];
}
```

Tuple declarations are canonicalized by element type sequence.

## Array Declarations

```ts
interface IrArrayDeclaration {
  kind: "array_decl";
  id: IrTypeDeclId;
  element: IrType;
  linkName: string;
}
```

Array declarations describe generated C wrapper types when the emitter uses
specialized array structs. If the runtime uses a single erased array
representation, this declaration may lower to aliases or helper metadata.
