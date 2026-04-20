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

export type IrDeclaration = IrFunction | IrGlobal | IrStructDeclaration;

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
  | IrFunctionOperand;

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

export type IrConst =
  | { kind: "int"; value: string }
  | { kind: "float"; value: string }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "void" };

export type IrInstruction =
  | IrAssignInstruction
  | IrBinaryInstruction
  | IrUnaryInstruction
  | IrCallInstruction
  | IrCastInstruction
  | IrConstructStructInstruction
  | IrGetFieldInstruction
  | IrSetFieldInstruction;

export interface IrAssignInstruction {
  kind: "assign";
  target: IrLocalId;
  value: IrOperand;
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
