import type { Span } from "@/types/position";
import type { Operator } from "@/types/shared";

export type IrProgramVersion = 1;

export interface IrProgram {
  version: IrProgramVersion;
  sourceFiles: IrSourceFile[];
  declarations: IrDeclaration[];
  entry?: IrFunctionId;
  runtime: IrRuntimeRequirements;
}

export interface IrSourceFile {
  id: IrSourceFileId;
  path?: string;
}

export interface IrRuntimeRequirements {
  panic: boolean;
  strings: boolean;
  arrays: IrType[];
  refCounting: boolean;
  copyOnWrite: boolean;
}

export type IrDeclaration =
  | IrFunction
  | IrGlobal
  | IrStructDeclaration
  | IrEnumDeclaration;

export type IrSourceFileId = string;
export type IrFunctionId = string;
export type IrGlobalId = string;
export type IrTypeDeclId = string;
export type IrBlockId = string;
export type IrLocalId = string;
export type IrTempId = string;

export interface IrFunction {
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

export interface IrGlobal {
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

export interface IrStructDeclaration {
  kind: "struct_decl";
  id: IrTypeDeclId;
  sourceName?: string;
  linkName: string;
  fields: IrStructField[];
  span?: Span;
}

export interface IrStructField {
  name: string;
  type: IrType;
  index: number;
}

export interface IrEnumDeclaration {
  kind: "enum_decl";
  id: IrTypeDeclId;
  sourceName?: string;
  linkName: string;
  variants: IrEnumVariant[];
  span?: Span;
}

export interface IrEnumVariant {
  name: string;
  tag: number;
  payloadTypes: IrType[];
}

export interface IrFunctionType {
  params: IrParamType[];
  returnType: IrType;
}

export interface IrParamType {
  type: IrType;
  mutable: boolean;
}

export interface IrParam {
  local: IrLocalId;
  sourceName?: string;
  type: IrType;
  mutable: boolean;
  span?: Span;
}

export interface IrLocal {
  id: IrLocalId;
  sourceName?: string;
  type: IrType;
  mutable: boolean;
  span?: Span;
}

export type IrType =
  | IrPrimitiveType
  | IrNamedType
  | IrNullableType
  | IrTupleType
  | IrFunctionValueType
  | IrUnknownType
  | IrErrorType;

export interface IrPrimitiveType {
  kind: "primitive";
  name:
    | "i8"
    | "i16"
    | "i32"
    | "i64"
    | "u8"
    | "u16"
    | "u32"
    | "u64"
    | "f16"
    | "f32"
    | "f64"
    | "bool"
    | "string"
    | "void"
    | "null";
}

export interface IrNamedType {
  kind: "named";
  name: string;
  args: IrType[];
  decl?: "struct" | "enum";
}

export interface IrNullableType {
  kind: "nullable";
  base: IrType;
}

export interface IrTupleType {
  kind: "tuple";
  elements: IrType[];
}

export interface IrFunctionValueType {
  kind: "function";
  params: IrParamType[];
  returnType: IrType;
}

export interface IrUnknownType {
  kind: "unknown";
}

export interface IrErrorType {
  kind: "error";
}

export interface IrBlock {
  id: IrBlockId;
  instructions: IrInstruction[];
  terminator?: IrTerminator;
}

export type IrOperand =
  | IrConstOperand
  | IrLocalOperand
  | IrTempOperand
  | IrFunctionOperand
  | IrGlobalOperand;

export interface IrConstOperand {
  kind: "const";
  value: IrConst;
  type: IrType;
}

export interface IrLocalOperand {
  kind: "local";
  id: IrLocalId;
  type: IrType;
}

export interface IrTempOperand {
  kind: "temp";
  id: IrTempId;
  type: IrType;
}

export interface IrFunctionOperand {
  kind: "function";
  name: string;
  type: IrType;
}

export interface IrGlobalOperand {
  kind: "global";
  id: IrGlobalId;
  type: IrType;
}

export type IrConst =
  | { kind: "int"; value: string }
  | { kind: "float"; value: string }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "void" };

export type IrInstruction =
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

export interface IrAssignInstruction {
  kind: "assign";
  target: IrLocalId;
  value: IrOperand;
  span?: Span;
}

export interface IrRetainInstruction {
  kind: "retain";
  value: IrOperand;
  span?: Span;
}

export interface IrReleaseInstruction {
  kind: "release";
  value: IrOperand;
  span?: Span;
}

export interface IrDetachInstruction {
  kind: "detach";
  target: IrTempId;
  value: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrBinaryInstruction {
  kind: "binary";
  target: IrTempId;
  operator: Operator;
  left: IrOperand;
  right: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrUnaryInstruction {
  kind: "unary";
  target: IrTempId;
  operator: Operator;
  argument: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrCallInstruction {
  kind: "call";
  target?: IrTempId;
  callee: IrOperand;
  args: IrOperand[];
  type: IrType;
  span?: Span;
}

export interface IrCastInstruction {
  kind: "cast";
  target: IrTempId;
  value: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrMakeNullInstruction {
  kind: "make_null";
  target: IrTempId;
  type: IrNullableType;
  span?: Span;
}

export interface IrMakeNullableInstruction {
  kind: "make_nullable";
  target: IrTempId;
  value: IrOperand;
  type: IrNullableType;
  span?: Span;
}

export interface IrIsNullInstruction {
  kind: "is_null";
  target: IrTempId;
  value: IrOperand;
  type: IrPrimitiveType;
  span?: Span;
}

export interface IrUnwrapNullableInstruction {
  kind: "unwrap_nullable";
  target: IrTempId;
  value: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrConstructTupleInstruction {
  kind: "construct_tuple";
  target: IrTempId;
  elements: IrOperand[];
  type: IrTupleType;
  span?: Span;
}

export interface IrGetTupleFieldInstruction {
  kind: "get_tuple_field";
  target: IrTempId;
  object: IrOperand;
  index: number;
  type: IrType;
  span?: Span;
}

export interface IrConstructStructInstruction {
  kind: "construct_struct";
  target: IrTempId;
  declId: IrTypeDeclId;
  fields: { name: string; value: IrOperand }[];
  type: IrType;
  span?: Span;
}

export interface IrGetFieldInstruction {
  kind: "get_field";
  target: IrTempId;
  object: IrOperand;
  field: string;
  type: IrType;
  span?: Span;
}

export interface IrSetFieldInstruction {
  kind: "set_field";
  target: IrLocalId;
  field: string;
  value: IrOperand;
  span?: Span;
}

export interface IrConstructEnumInstruction {
  kind: "construct_enum";
  target: IrTempId;
  declId: IrTypeDeclId;
  variant: string;
  tag: number;
  payload: IrOperand[];
  type: IrType;
  span?: Span;
}

export interface IrGetTagInstruction {
  kind: "get_tag";
  target: IrTempId;
  object: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrGetEnumPayloadInstruction {
  kind: "get_enum_payload";
  target: IrTempId;
  object: IrOperand;
  variant: string;
  index: number;
  type: IrType;
  span?: Span;
}

export interface IrArrayNewInstruction {
  kind: "array_new";
  target: IrTempId;
  elementType: IrType;
  elements: IrOperand[];
  type: IrType;
  span?: Span;
}

export interface IrArrayLenInstruction {
  kind: "array_len";
  target: IrTempId;
  array: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrArrayGetInstruction {
  kind: "array_get";
  target: IrTempId;
  array: IrOperand;
  index: IrOperand;
  elementType: IrType;
  type: IrType;
  span?: Span;
}

export interface IrArraySetInstruction {
  kind: "array_set";
  array: IrOperand;
  index: IrOperand;
  value: IrOperand;
  elementType: IrType;
  span?: Span;
}

export interface IrStoreGlobalInstruction {
  kind: "store_global";
  globalId: IrGlobalId;
  value: IrOperand;
  span?: Span;
}

export interface IrEnsureGlobalInitializedInstruction {
  kind: "ensure_global_initialized";
  globalId: IrGlobalId;
  span?: Span;
}

export interface IrStringLenInstruction {
  kind: "string_len";
  target: IrTempId;
  string: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrStringAtInstruction {
  kind: "string_at";
  target: IrTempId;
  string: IrOperand;
  index: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrStringConcatInstruction {
  kind: "string_concat";
  target: IrTempId;
  left: IrOperand;
  right: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrStringEqInstruction {
  kind: "string_eq";
  target: IrTempId;
  left: IrOperand;
  right: IrOperand;
  type: IrType;
  span?: Span;
}

export interface IrSwitchCase {
  value: IrConst;
  target: IrBlockId;
}

export type IrTerminator =
  | { kind: "return"; value?: IrOperand; span?: Span }
  | { kind: "branch"; target: IrBlockId; span?: Span }
  | {
      kind: "cond_branch";
      condition: IrOperand;
      thenTarget: IrBlockId;
      elseTarget: IrBlockId;
      span?: Span;
    }
  | {
      kind: "switch";
      value: IrOperand;
      cases: IrSwitchCase[];
      defaultTarget: IrBlockId;
      span?: Span;
    }
  | { kind: "unreachable"; span?: Span };

export const irPrimitive = (
  name: IrPrimitiveType["name"],
): IrPrimitiveType => ({
  kind: "primitive",
  name,
});
