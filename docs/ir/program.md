# IR Program Structure

## IrProgram

```ts
interface IrProgram {
  version: 1;
  sourceFiles: IrSourceFile[];
  declarations: IrDeclaration[];
  entry?: IrFunctionId;
  runtime: IrRuntimeRequirements;
}

type IrDeclaration =
  | IrFunction
  | IrGlobal
  | IrStructDeclaration
  | IrEnumDeclaration;
```

`IrProgram.declarations` contains only IR-level declarations:

- functions
- globals
- struct declarations needed by C emission
- enum declarations needed by C emission

Declaration order is not semantically significant. The C emitter may reorder
declarations as needed for prototypes and definitions.

String literals and generated helper declarations are emitted by the C backend
from instruction and type use; they are not represented as standalone constant
data declarations in the current IR.

## Source Files

```ts
type IrSourceFileId = string;

interface IrSourceFile {
  id: IrSourceFileId;
  path?: string;
}
```

Source file ids are used only for debug spans and diagnostics. They do not affect
runtime behavior.

## Runtime Requirements

```ts
interface IrRuntimeRequirements {
  panic: boolean;
  strings: boolean;
  arrays: IrType[];
  refCounting: boolean;
  copyOnWrite: boolean;
}
```

The runtime requirements describe which runtime headers and objects the emitted
C needs. They are derived from IR instructions and types.

The C emitter must not silently emit calls to runtime helpers not declared by
`runtime`.

## Identifiers and Names

IR ids are stable within one `IrProgram` and are not user-facing.

```ts
type IrFunctionId = string;
type IrGlobalId = string;
type IrTypeDeclId = string;
type IrBlockId = string;
type IrLocalId = string;
type IrTempId = string;
```

Recommended generated forms:

- functions: `fn.N`
- globals: `global.N`
- type declarations: `type.N`
- blocks: `bb.N`
- locals: `local.N`
- temporaries: `tmp.N`

The emitter is responsible for turning ids and symbolic names into C-safe names.

### Symbol Names

Every emitted function has both:

- an internal `IrFunctionId`
- a C-safe `linkName`

```ts
interface IrFunction {
  kind: "function";
  id: IrFunctionId;
  sourceName?: string;
  linkName: string;
  signature: IrFunctionType;
  params: IrParam[];
  locals: IrLocal[];
  blocks: IrBlock[];
  body: "defined" | "extern";
  span?: Span;
}
```

Rules:

- Non-generic functions use their declared name unless collision avoidance is
  required.
- Generic specializations use monomorphized mangled names.
- Methods include their owner type in the mangled name.
- Runtime helpers use reserved `__vek_*` names.
- User-visible names must never be trusted as already C-safe.

## Globals

```ts
interface IrGlobal {
  kind: "global";
  id: IrGlobalId;
  sourceName?: string;
  linkName: string;
  type: IrType;
  mutable: boolean;
  initializer?: IrConst;
  initializerFunction?: IrFunctionId;
  span?: Span;
}
```

Rules:

- `initializer` is used only for values that can be emitted as static C
  initializers.
- Non-literal/runtime initializers lower to a hidden zero-argument
  `initializerFunction` that stores the computed value into the global.
- Reads of globals with `initializerFunction` must be preceded by
  `ensure_global_initialized`.
- Lazy initializer state is emitted by the C backend as uninitialized,
  initializing, or initialized. Re-entry while initializing panics.

## Source Spans

```ts
type Span = import("@/types/position").Span;
```

Spans are optional but should be preserved where practical for:

- generated C comments in debug mode
- backend diagnostics
- IR validation errors
- source maps or future tooling

Spans must not affect emitted program behavior.
