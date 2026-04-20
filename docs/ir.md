# Vek Compiler IR Specification

Status: internal compiler contract.

This document specifies the intermediate representation used by this compiler
between the checked Vek AST and C emission. It is not part of the public Vek
language specification. User code must not depend on it.

## 1. Purpose

The IR exists to make Vek runtime semantics explicit before C emission.

The parser and checker work with source-shaped syntax. The C emitter should not
need to know high-level language rules such as nullable narrowing, match
coverage, method lookup, trait satisfaction, copy-on-write insertion, or generic
specialization. Those rules are resolved before or during IR lowering.

The C emitter consumes concrete IR and prints C.

Pipeline:

```text
Vek source
  -> lexer
  -> parser AST
  -> checker typed AST + symbols/types
  -> reachability
  -> monomorphization
  -> Vek IR lowering
  -> IR validation
  -> C emission
  -> C compiler + runtime
```

## 2. Design Goals

The IR must be:

- typed
- concrete after monomorphization
- simple to validate
- simple to emit as C
- explicit about control flow
- explicit about runtime operations
- explicit about ownership operations once ownership lowering is enabled
- independent of source syntax trivia
- stable enough for tests and backend evolution

The IR must not be:

- a public ABI
- a bytecode format
- a VM instruction set
- a fully optimized SSA IR
- a second type checker
- a textual format required for compilation

The implementation may provide a textual dump for tests and debugging, but the
authoritative IR is TypeScript data structures.

## 3. IR Levels

There is one IR model, but there are two validity levels.

### 3.1 Lowered IR

Lowered IR is produced directly from the checked AST.

It may still contain:

- abstract aggregate operations such as `array_new`
- abstract runtime operations such as `panic`
- ownership-neutral value movement

It must not contain:

- parser AST nodes
- unresolved identifiers
- generic type parameters
- overloaded operators
- high-level `match`, `for`, `while`, or short-circuit expression syntax

### 3.2 Emittable IR

Emittable IR is the input accepted by the C emitter.

It must satisfy every lowered IR invariant, plus:

- all functions have concrete names
- all types have concrete runtime representations or a specified C-lowering rule
- all calls have concrete targets or concrete function-value operands
- all required runtime helper calls are explicit
- all blocks are terminated
- all temporaries are defined before use
- no instruction relies on source-level control-flow semantics

Ownership operations may initially be absent for unsupported heap-backed
features. Once a feature is emitted, its required ownership operations must be
present in emittable IR rather than inferred by the C emitter.

## 4. Program Structure

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
  | IrTypeDeclaration
  | IrConstantData;
```

`IrProgram.declarations` contains only IR-level declarations:

- functions
- globals
- type declarations needed by C emission
- constant data

Declaration order is not semantically significant. The C emitter may reorder
declarations as needed for prototypes and definitions.

Constant data is static immutable data emitted outside function bodies.

```ts
interface IrConstantData {
  kind: "constant_data";
  id: string;
  linkName: string;
  type: IrType;
  value: IrConst;
}
```

### 4.1 Source Files

```ts
type IrSourceFileId = string;

interface IrSourceFile {
  id: IrSourceFileId;
  path?: string;
}
```

Source file ids are used only for debug spans and diagnostics. They do not affect
runtime behavior.

### 4.2 Runtime Requirements

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

## 5. Identifiers and Names

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

### 5.1 Symbol Names

Every emitted function has both:

- an internal `IrFunctionId`
- a C-safe `linkName`

```ts
interface IrFunction {
  id: IrFunctionId;
  sourceName?: string;
  linkName: string;
  signature: IrFunctionType;
  params: IrParam[];
  locals: IrLocal[];
  blocks: IrBlock[];
  body: "defined" | "extern";
  span?: IrSpan;
}

interface IrParam {
  local: IrLocalId;
  sourceName?: string;
  type: IrType;
  passing: "readonly" | "mut";
}
```

Rules:

- Non-generic functions use their declared name unless collision avoidance is
  required.
- Generic specializations use monomorphized mangled names.
- Methods include their owner type in the mangled name.
- Runtime helpers use reserved `__vek_*` names.
- User-visible names must never be trusted as already C-safe.

## 6. Types

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

### 6.1 Primitive Types

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

### 6.2 Runtime-Backed Types

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

### 6.3 Composite Types

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

### 6.4 Function Types

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

### 6.5 Opaque Runtime Types

```ts
interface IrOpaqueRuntimeType {
  kind: "opaque_runtime";
  name: string;
}
```

Opaque runtime types are reserved for runtime handles that the compiler must pass
around but not inspect.

Examples:

- file handles in future `std:fs`
- process handles in future `std:process`

They must not be used for ordinary Vek structs or enums.

## 7. Type Declarations

Type declarations are emitted for concrete aggregate layouts.

```ts
type IrTypeDeclaration =
  | IrStructDeclaration
  | IrEnumDeclaration
  | IrTupleDeclaration
  | IrArrayDeclaration;
```

### 7.1 Struct Declarations

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

### 7.2 Enum Declarations

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

### 7.3 Tuple Declarations

```ts
interface IrTupleDeclaration {
  kind: "tuple_decl";
  id: IrTypeDeclId;
  linkName: string;
  elements: IrType[];
}
```

Tuple declarations are canonicalized by element type sequence.

### 7.4 Array Declarations

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

## 8. Values, Places, and Locals

The IR distinguishes values from places.

A value is something computed and consumed.

A place is something that can be loaded from or stored to.

### 8.1 Values

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

Constants:

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

### 8.2 Places

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

### 8.3 Locals

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
not a substitute for checker mutability rules.

## 9. Blocks and Control Flow

Functions contain basic blocks.

```ts
interface IrBlock {
  id: IrBlockId;
  label?: string;
  instructions: IrInstruction[];
  terminator: IrTerminator;
  span?: IrSpan;
}
```

Rules:

- Every block has exactly one terminator.
- Blocks do not fall through.
- Instructions inside one block execute in order.
- Terminators transfer control or leave the function.
- A block may be unreachable, but unreachable blocks should be removed before C
  emission when practical.

## 10. Instructions

Every instruction has a stable operation kind and optional source span.

```ts
interface IrInstructionBase {
  kind: string;
  result?: IrTempValue;
  span?: IrSpan;
}

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

### 10.1 Local and Memory Instructions

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

### 10.2 Constants

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

### 10.3 Unary, Binary, and Cast

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
  already been lowered, or when both operands are known already evaluated.
- Source-level `&&` and `||` must normally lower to blocks with `cond_branch` to
  preserve short-circuit evaluation.
- User-defined equality must lower to a static call to the resolved `equals`
  method, not to `binary eq`.
- `binary eq` and `binary ne` are for built-in equality only.

### 10.4 Calls

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

### 10.5 Structs

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

### 10.6 Tuples

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

### 10.7 Enums

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

### 10.8 Nullable Values

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

### 10.9 Arrays and Strings

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

### 10.10 Ownership and Runtime Lifetime

Ownership instructions make reference-counting and copy-on-write explicit.

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

Rules:

- `retain` increments the runtime reference count for heap-backed values.
- `release` decrements it and may free.
- `detach` returns a uniquely owned value suitable for mutation.
- Non-heap-backed values must not receive retain/release/detach.
- Ownership lowering is responsible for inserting these instructions.
- The C emitter must not infer missing ownership operations.

Heap-backed IR types:

- `string`
- `array<T>`
- future opaque runtime handles when declared ref-counted

Composite types containing heap-backed fields may require recursive retain and
release helpers. The lowerer may emit calls to generated helper functions rather
than inline every retain/release operation.

### 10.11 Top-Level Initializers

Top-level values with initializers are represented explicitly.

```ts
interface IrGlobal {
  kind: "global";
  id: IrGlobalId;
  sourceName: string;
  linkName: string;
  type: IrType;
  initializer?: IrGlobalInitializer;
  mutable: boolean;
}

interface IrGlobalInitializer {
  function: IrFunctionId;
  lazy: boolean;
}

interface IrEnsureGlobalInitialized {
  kind: "ensure_global_initialized";
  global: IrGlobalId;
}
```

Rules:

- Cycles are rejected before IR lowering.
- Lazy top-level initializer execution lowers to an initializer function plus
  guard state.
- Any read of a lazily initialized global must be preceded by
  `ensure_global_initialized`.
- Eager compile-time constants may be emitted as static C initializers when they
  require no runtime work.

## 11. Terminators

```ts
type IrTerminator =
  | IrReturn
  | IrBranch
  | IrCondBranch
  | IrSwitch
  | IrUnreachable;
```

### 11.1 Return

```ts
interface IrReturn {
  kind: "return";
  value?: IrValue;
}
```

Rules:

- `value` is absent only for `void` functions.
- Return type compatibility has already been checked.
- Ownership lowering must release owned locals before `return` if required.

### 11.2 Branch

```ts
interface IrBranch {
  kind: "branch";
  target: IrBlockId;
}
```

### 11.3 Conditional Branch

```ts
interface IrCondBranch {
  kind: "cond_branch";
  condition: IrValue;
  thenTarget: IrBlockId;
  elseTarget: IrBlockId;
}
```

`condition` must have type `bool`.

### 11.4 Switch

```ts
interface IrSwitch {
  kind: "switch";
  value: IrValue;
  cases: IrSwitchCase[];
  defaultTarget: IrBlockId;
}

interface IrSwitchCase {
  value: IrConst;
  target: IrBlockId;
}
```

`switch` may be used for:

- enum tags
- integer constants
- boolean constants

The lowerer may use chains of `cond_branch` instead of `switch`.

### 11.5 Unreachable

```ts
interface IrUnreachable {
  kind: "unreachable";
}
```

Used after calls that cannot return, such as panic.

## 12. Source Spans

```ts
interface IrSpan {
  file: IrSourceFileId;
  start: { index: number; line: number; column: number };
  end: { index: number; line: number; column: number };
}
```

Spans are optional but should be preserved where practical for:

- generated C comments in debug mode
- backend diagnostics
- IR validation errors
- source maps or future tooling

Spans must not affect emitted program behavior.

## 13. Lowering Rules

This section defines how checked AST constructs lower to IR.

### 13.1 Functions

Each reachable concrete function lowers to one `IrFunction`.

Rules:

- Generic functions lower only for used specializations.
- Extern functions lower to declarations without blocks.
- Anonymous functions lower to generated top-level functions because v1
  anonymous functions are non-capturing.
- Methods lower to functions. Instance methods receive `self` as the first
  ordinary parameter.
- The user-level `main` function lowers to the program entry function.

### 13.2 Variables

Local declarations lower to:

- local slot declaration in `IrFunction.locals`
- initializer expression instructions
- `store` into the local place

`const` and readonly restrictions are checker-only. IR does not need separate
readonly places except where runtime ownership depends on parameter passing.

### 13.3 Assignment

Assignments lower to stores or aggregate set instructions.

Examples:

```text
x = value
  -> store local.x, value

user.name = value
  -> set_field user, "name", value

arr[i] = value
  -> detach arr
  -> array_set arr, i, value
```

Invalid assignment targets must never reach IR.

### 13.4 If

Source:

```vek
if condition {
  then_body
} else {
  else_body
}
```

IR shape:

```text
entry:
  %cond = ...
  cond_branch %cond, then, else

then:
  ...
  branch join

else:
  ...
  branch join

join:
  ...
```

If one branch returns or is unreachable, it does not branch to the join block.

### 13.5 While

Source:

```vek
while condition {
  body
}
```

IR shape:

```text
preheader:
  branch condition

condition:
  %cond = ...
  cond_branch %cond, body, exit

body:
  ...
  branch condition

exit:
  ...
```

`break` branches to `exit`. `continue` branches to `condition`.

### 13.6 For

Array iteration may lower to index-based loops.

```vek
for item in array {
  body
}
```

Recommended IR shape:

```text
%len = array_len array
store index, 0
branch condition

condition:
  %i = load index
  %more = binary lt %i, %len
  cond_branch %more, body, exit

body:
  %item = array_get array, %i
  store item_local, %item
  ...
  %next = binary add %i, 1
  store index, %next
  branch condition
```

Custom `Iterable<T>` lowers to repeated static calls to the resolved `next`
method:

```text
%next = call Iterable_next_specialized(iterable)
%done = is_null %next
cond_branch %done, exit, body
```

The non-null item is extracted with `unwrap_nullable` in the body path.

### 13.7 Match Statements

Match statements lower to branches.

Enum matches:

- evaluate scrutinee once
- compute tag once
- dispatch by tag
- extract payloads only in matching blocks

Nullable matches:

- test null first when a `null` pattern exists
- non-null branches may use `unwrap_nullable`

Wildcard arms become default branches.

Shadowed arms and exhaustiveness warnings are checker concerns. IR lowering
should still produce correct reachable code for accepted programs.

### 13.8 Match Expressions

Match expressions lower like match statements, but each arm stores its result
into a compiler-generated local or temp before branching to the join block.

Shape:

```text
arm_a:
  %a = ...
  store match_result, %a
  branch join

arm_b:
  %b = ...
  store match_result, %b
  branch join

join:
  %result = load match_result
```

The checker has already validated arm result types.

### 13.9 Short-Circuit Operators

`&&` and `||` must preserve short-circuit evaluation.

`a && b` shape:

```text
entry:
  %a = ...
  cond_branch %a, eval_b, false_block

eval_b:
  %b = ...
  store result, %b
  branch join

false_block:
  store result, false
  branch join

join:
  %result = load result
```

`a || b` is analogous with the early branch storing `true`.

### 13.10 Nullable Narrowing

The checker proves narrowing. IR represents it operationally.

Source:

```vek
if value != null {
  use(value)
}
```

IR:

```text
%is_null = is_null value
cond_branch %is_null, else, then

then:
  %unwrapped = unwrap_nullable value
  call use(%unwrapped)
```

The lowerer must use the narrowed value in the narrowed block rather than
requiring the C emitter to understand narrowing.

### 13.11 Equality

Built-in equality lowers to `binary eq` or runtime helper calls.

User-defined equality through `Equal<T>` lowers to a static call to the resolved
`equals` method.

`!=` lowers to equality followed by boolean negation unless a better direct
operation exists for the type.

### 13.12 Casts

Only checked valid casts reach IR.

Numeric casts lower to `cast`.

Invalid casts are checker diagnostics and must not reach emittable IR.

### 13.13 Panic

`panic("literal")` may lower to:

```text
call runtime "__vek_panic_cstr"("literal")
unreachable
```

`panic(value)` where `value: string` lowers to:

```text
call runtime "__vek_panic"(value)
unreachable
```

The runtime call is non-returning.

### 13.14 Struct Literals

Struct literals lower to `construct_struct` with fields sorted by IR field
index.

Field shorthand has already been resolved by the parser/checker and does not
exist in IR.

### 13.15 Enum Variants

Enum variant construction lowers to `construct_enum`.

Unit variants are `construct_enum` with an empty payload list.

Bare variant identifiers in expression position must have been resolved before
IR lowering.

### 13.16 Function Values

Named functions and type-qualified method references lower to `IrFunctionValue`.

Anonymous functions lower to generated `IrFunction` declarations and then to
`IrFunctionValue` when used as values.

Captured closures are not supported in v1 and must never reach IR.

### 13.17 Generics

IR is post-monomorphization.

Rules:

- No `TypeParam` types may appear.
- No generic function declarations may appear unless represented only as source
  metadata.
- Each used type argument set gets a concrete `IrFunction`.
- Each used generic struct/enum instantiation gets concrete type declarations as
  needed.
- Mangled names must be deterministic.

### 13.18 Traits

Traits do not exist as runtime values in IR.

Rules:

- Trait bounds are checker constraints only.
- Trait method calls lower to concrete static calls.
- `satisfies` blocks contribute concrete methods.
- Trait objects and dynamic dispatch are not supported.

## 14. Ownership Lowering

Ownership lowering is the pass that inserts `retain`, `release`, and `detach`.

The pass may be implemented after the first primitive-only C emitter, but once a
heap-backed feature is emitted, ownership lowering for that feature is required.

### 14.1 Ownership Categories

Types fall into ownership categories:

- `trivial`: no retain/release needed
- `heap_ref`: retain/release needed
- `aggregate`: retain/release needed if any field/element needs it
- `opaque`: determined by runtime declaration

Trivial:

- `void`
- `never`
- `bool`
- integer types
- float types
- enum tags without heap payload by representation

Heap refs:

- `string`
- `array<T>`

Aggregates:

- tuples
- structs
- enums with payloads
- nullable heap-backed values

### 14.2 Function Calls

The IR calling convention defines ownership transfer as follows:

- parameters are borrowed for the duration of the call
- return values are owned by the caller when heap-backed
- storing a heap-backed value into a longer-lived place retains it
- overwriting a heap-backed place releases the previous value

Changing this convention requires updating this specification and the IR
validator. The C emitter must treat this convention as fixed input behavior, not
as something to infer or reinterpret.

### 14.3 Locals

For heap-backed locals:

- initialization stores an owned or retained value
- reassignment releases the previous value
- function exit releases live owned locals

### 14.4 Branches

Ownership lowering must handle all exits from a block:

- normal branches
- returns
- panic/unreachable
- loop break/continue

The pass may insert cleanup blocks if needed.

## 15. C Emitter Contract

The C emitter consumes emittable IR.

It is responsible for:

- choosing C declarations for IR types
- emitting prototypes
- emitting function definitions
- emitting runtime includes
- emitting runtime calls
- emitting block labels and gotos
- emitting C-safe names
- preserving evaluation order represented by IR

It is not responsible for:

- name resolution
- type checking
- overload resolution
- trait satisfaction
- match exhaustiveness
- nullable narrowing
- generic specialization selection
- deciding whether a mutation is legal
- inserting copy-on-write detach operations
- inserting missing retain/release operations for supported heap-backed features

### 15.1 C Type Mapping

Recommended mapping:

| IR type | C type |
| --- | --- |
| `void` | `void` |
| `never` | no value |
| `bool` | `bool` from `stdbool.h` |
| `i8` | `int8_t` |
| `i16` | `int16_t` |
| `i32` | `int32_t` |
| `i64` | `int64_t` |
| `u8` | `uint8_t` |
| `u16` | `uint16_t` |
| `u32` | `uint32_t` |
| `u64` | `uint64_t` |
| `f16` | runtime/compiler-defined representation until C support is chosen |
| `f32` | `float` |
| `f64` | `double` |
| `string` | `struct __vek_string *` |
| `array<T>` | specialized or erased runtime array pointer |
| tuple | generated `struct` |
| struct | generated `struct` |
| enum | generated tagged `struct` |
| function | function pointer |

The emitter must include the runtime headers required by used runtime-backed
types and calls.

### 15.2 Control Flow Emission

Blocks lower naturally to C labels:

```c
bb_0:
  ...
  if (cond) goto bb_1;
  goto bb_2;
```

The emitter may use structured C for simple cases, but must preserve IR
semantics exactly. Label/goto emission is the baseline.

### 15.3 Runtime Boundary

All runtime symbols emitted by the C emitter must use the reserved `__vek_*`
prefix.

The runtime repo owns:

- the canonical runtime source
- the generated single-header artifact
- smoke tests for runtime helpers

The compiler repo owns:

- generated C
- calls to runtime symbols
- declarations of what runtime symbols are required
- packaging or writing the runtime header next to generated C

The local development default may assume sibling repos:

```text
../runtime/dist/vek_runtime.h
```

But the compiler should eventually accept an explicit runtime header path.

Generated C must include the runtime as a single-header library. Exactly one
generated translation unit must define `VEK_RUNTIME_IMPLEMENTATION` before
including `vek_runtime.h`.

Example:

```c
#define VEK_RUNTIME_IMPLEMENTATION
#include "vek_runtime.h"
```

No prebuilt runtime library is required. The runtime implementation is compiled
by the user's chosen C toolchain together with the generated program.

## 16. Validation

An IR validation pass must run before C emission.

Validation errors are compiler bugs unless they arise from unsupported backend
features, in which case the compiler may report an explicit backend diagnostic.

Required checks:

- every function has at least one block unless extern
- every non-extern block has one terminator
- every terminator target exists
- every temp is defined exactly once
- every temp is defined before use in block order, accounting for predecessor
  dominance when needed
- every instruction result type matches the operation
- every `store` value type matches the place type
- every `cond_branch` condition is `bool`
- every `return` matches the function return type
- every direct call target exists
- every call argument matches the target signature
- no generic type parameters appear
- no parser AST nodes appear
- runtime calls are listed in `IrRuntimeRequirements`
- enum payload extraction is dominated by matching tag control flow
- no invalid assignment forms appear
- no string mutation appears
- no tuple mutation appears

For the first implementation, validation may start with structural checks and
grow as features are added. Each newly supported instruction must add validation
coverage.

## 17. Debug Dump Format

The compiler should provide a deterministic textual dump for tests.

This is not the canonical representation, but it should be stable enough for
snapshot-style assertions.

Example:

```text
func main() -> void {
bb.0:
  return
}
```

Example with control flow:

```text
func main() -> void {
bb.0:
  %0:i32 = const 1
  %1:i32 = const 2
  %2:i32 = add %0, %1
  %3:bool = eq %2, 3
  cond_branch %3, bb.1, bb.2

bb.1:
  call_runtime __vek_panic_cstr "ok"
  unreachable

bb.2:
  return
}
```

Dump requirements:

- deterministic declaration order
- deterministic block order
- deterministic temp/local ids
- explicit types on temps
- explicit terminators

## 18. Initial Implementation Slice

The first IR implementation should support:

- `fn main() -> void`
- `return;`
- integer constants
- boolean constants
- string constants only as panic literals
- local declarations
- local loads/stores
- integer arithmetic
- integer comparisons
- `if`
- direct call to `panic("literal")`

Required files:

```text
compiler/src/ir/types.ts
compiler/src/ir/lower.ts
compiler/src/ir/validate.ts
compiler/src/ir/dump.ts
compiler/src/emit/c.ts
```

Initial tests:

- lower empty `main`
- lower integer local and arithmetic
- lower `if`
- lower `panic("literal")`
- emit C for empty `main`
- emit C for panic literal

Unsupported constructs should fail with a clear backend unsupported diagnostic or
test-only thrown error until backend diagnostics are formalized.

## 19. Feature Expansion Order

Recommended order after the initial slice:

1. Primitive function calls and non-void returns.
2. Struct declarations, struct literals, field get.
3. Field set for non-heap-backed structs.
4. Enum declarations and unit variants.
5. Enum payload variants and match lowering.
6. Nullable values and null checks.
7. Runtime strings beyond panic literals.
8. Arrays and array indexing.
9. Copy-on-write detach for array mutation.
10. Retain/release for strings and arrays.
11. Aggregate retain/release helpers.
12. Top-level lazy initializers.
13. Function values.
14. Specialized generic functions and methods beyond direct primitive cases.

Each step must include:

- IR lowering tests
- IR validation coverage
- C emission tests
- runtime linkage tests when runtime helpers are involved

## 20. Non-Negotiable Invariants

Before a program reaches C emission:

- all names are resolved
- all types are concrete
- all generics are specialized
- all trait calls are statically resolved
- all high-level control flow is lowered to blocks
- all source-level mutability rules are already enforced
- all runtime helper requirements are known
- all emitted heap-backed operations have explicit ownership behavior
- every block ends in a terminator

If an invariant cannot be satisfied for a construct, that construct is not
backend-supported yet.
