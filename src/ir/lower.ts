import type {
  IrBlock,
  IrConst,
  IrDeclaration,
  IrFunction,
  IrLocal,
  IrLocalId,
  IrOperand,
  IrPrimitiveType,
  IrProgram,
  IrRuntimeRequirements,
  IrTempId,
  IrType,
} from "@/ir/types";
import { irPrimitive } from "@/ir/types";
import type {
  AssignmentStatement,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  CastExpression,
  Expression,
  FunctionDeclaration,
  GroupingExpression,
  IdentifierExpression,
  LiteralExpression,
  NamedParameter,
  Node,
  Program,
  ReturnStatement,
  Statement,
  TypeNode,
  UnaryExpression,
  VariableDeclaration,
} from "@/types/ast";

interface LowerOptions {
  sourcePath?: string;
}

interface IrTypeSource {
  types: WeakMap<Node, unknown>;
}

interface LowerContext {
  checkResult: IrTypeSource;
  runtime: IrRuntimeRequirements;
  locals: Map<string, IrLocalId>;
  localDecls: IrLocal[];
  block: IrBlock;
  nextLocal: number;
  nextTemp: number;
}

export function lowerProgramToIr(
  program: Program,
  checkResult: IrTypeSource,
  options: LowerOptions = {},
): IrProgram {
  const runtime = emptyRuntimeRequirements();
  const declarations: IrDeclaration[] = [];
  let entry: string | undefined;

  for (const statement of program.body) {
    if (statement.kind !== "FunctionDeclaration") continue;
    const lowered = lowerFunction(statement, checkResult, runtime);
    declarations.push(lowered);
    if (statement.name.name === "main") entry = lowered.id;
  }

  return {
    version: 1,
    sourceFiles: [{ id: "source.0", path: options.sourcePath }],
    declarations,
    entry,
    runtime,
  };
}

function lowerFunction(
  node: FunctionDeclaration,
  checkResult: IrTypeSource,
  runtime: IrRuntimeRequirements,
): IrFunction {
  const block: IrBlock = { id: "bb.0", instructions: [] };
  const context: LowerContext = {
    checkResult,
    runtime,
    locals: new Map(),
    localDecls: [],
    block,
    nextLocal: 0,
    nextTemp: 0,
  };

  const params = node.params
    .filter((param): param is NamedParameter => param.kind === "NamedParameter")
    .map((param) => {
      const local = declareLocal(
        context,
        param.name.name,
        typeFromTypeNode(param.type),
        param.isMutable,
        param.span,
      );
      return {
        local: local.id,
        sourceName: param.name.name,
        type: local.type,
        mutable: param.isMutable,
        span: param.span,
      };
    });

  if (node.body) lowerBlock(node.body, context);
  if (node.body && !block.terminator) {
    block.terminator = {
      kind: "return",
      value: voidOperand(),
      span: node.body.span,
    };
  }

  const returnType = node.returnType
    ? typeFromTypeNode(node.returnType)
    : irPrimitive("void");

  return {
    kind: "function",
    id: `fn.${node.name.name}`,
    sourceName: node.name.name,
    linkName: node.name.name,
    signature: {
      params: params.map((param) => ({
        type: param.type,
        mutable: param.mutable,
      })),
      returnType,
    },
    params,
    locals: context.localDecls,
    blocks: node.isExtern ? [] : [block],
    body: node.isExtern ? "extern" : "defined",
    span: node.span,
  };
}

function lowerBlock(block: BlockStatement, context: LowerContext) {
  for (const statement of block.body) {
    if (context.block.terminator) return;
    lowerStatement(statement, context);
  }
}

function lowerStatement(statement: Statement, context: LowerContext) {
  switch (statement.kind) {
    case "VariableDeclaration":
      lowerVariableDeclaration(statement, context);
      return;
    case "ReturnStatement":
      lowerReturn(statement, context);
      return;
    case "ExpressionStatement":
      lowerExpression(statement.expression, context);
      return;
    case "AssignmentStatement":
      lowerAssignment(statement, context);
      return;
    case "BlockStatement":
      lowerBlock(statement, context);
      return;
    default:
      throw new Error(`IR lowering does not support ${statement.kind} yet.`);
  }
}

function lowerVariableDeclaration(
  statement: VariableDeclaration,
  context: LowerContext,
) {
  const type = statement.typeAnnotation
    ? typeFromTypeNode(statement.typeAnnotation)
    : typeFromNode(context.checkResult, statement.initializer);
  const local = declareLocal(
    context,
    statement.name.name,
    type,
    statement.declarationKind === "let",
    statement.span,
  );

  if (statement.initializer) {
    context.block.instructions.push({
      kind: "assign",
      target: local.id,
      value: lowerExpression(statement.initializer, context),
      span: statement.span,
    });
  }
}

function lowerReturn(statement: ReturnStatement, context: LowerContext) {
  context.block.terminator = {
    kind: "return",
    value: statement.value
      ? lowerExpression(statement.value, context)
      : voidOperand(),
    span: statement.span,
  };
}

function lowerAssignment(
  statement: AssignmentStatement,
  context: LowerContext,
) {
  if (statement.target.kind !== "IdentifierExpression") {
    throw new Error("IR lowering only supports identifier assignment so far.");
  }
  const target = context.locals.get(statement.target.name);
  if (!target) {
    throw new Error(
      `Unknown local '${statement.target.name}' during IR lowering.`,
    );
  }
  context.block.instructions.push({
    kind: "assign",
    target,
    value: lowerExpression(statement.value, context),
    span: statement.span,
  });
}

function lowerExpression(
  expression: Expression,
  context: LowerContext,
): IrOperand {
  switch (expression.kind) {
    case "LiteralExpression":
      if (expression.literalType === "String") context.runtime.strings = true;
      return lowerLiteral(expression);
    case "IdentifierExpression":
      return lowerIdentifier(expression, context);
    case "GroupingExpression":
      return lowerGrouping(expression, context);
    case "BinaryExpression":
      return lowerBinary(expression, context);
    case "UnaryExpression":
      return lowerUnary(expression, context);
    case "CallExpression":
      return lowerCall(expression, context);
    case "CastExpression":
      return lowerCast(expression, context);
    default:
      throw new Error(`IR lowering does not support ${expression.kind} yet.`);
  }
}

function lowerLiteral(expression: LiteralExpression): IrOperand {
  const value = constFromLiteral(expression);
  return { kind: "const", value, type: typeFromConst(value) };
}

function lowerIdentifier(
  expression: IdentifierExpression,
  context: LowerContext,
): IrOperand {
  const local = context.locals.get(expression.name);
  if (local) {
    return {
      kind: "local",
      id: local,
      type: typeFromNode(context.checkResult, expression),
    };
  }
  return {
    kind: "function",
    name: expression.name,
    type: typeFromNode(context.checkResult, expression),
  };
}

function lowerGrouping(
  expression: GroupingExpression,
  context: LowerContext,
): IrOperand {
  return lowerExpression(expression.expression, context);
}

function lowerBinary(
  expression: BinaryExpression,
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  const type = typeFromNode(context.checkResult, expression);
  context.block.instructions.push({
    kind: "binary",
    target,
    operator: expression.operator,
    left: lowerExpression(expression.left, context),
    right: lowerExpression(expression.right, context),
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function lowerUnary(
  expression: UnaryExpression,
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  const type = typeFromNode(context.checkResult, expression);
  context.block.instructions.push({
    kind: "unary",
    target,
    operator: expression.operator,
    argument: lowerExpression(expression.argument, context),
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function lowerCall(
  expression: CallExpression,
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  const type = typeFromNode(context.checkResult, expression);
  const callee = lowerExpression(expression.callee, context);
  const returnsVoid = type.kind === "primitive" && type.name === "void";

  if (callee.kind === "function" && callee.name === "panic") {
    context.runtime.panic = true;
  }

  context.block.instructions.push({
    kind: "call",
    target: returnsVoid ? undefined : target,
    callee,
    args: expression.args.map((arg) => lowerExpression(arg, context)),
    type,
    span: expression.span,
  });

  if (returnsVoid) return voidOperand();
  return { kind: "temp", id: target, type };
}

function lowerCast(
  expression: CastExpression,
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  const type = typeFromTypeNode(expression.type);
  context.block.instructions.push({
    kind: "cast",
    target,
    value: lowerExpression(expression.expression, context),
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function declareLocal(
  context: LowerContext,
  sourceName: string,
  type: IrType,
  mutable: boolean,
  span: IrLocal["span"],
): IrLocal {
  const local: IrLocal = {
    id: `local.${context.nextLocal++}`,
    sourceName,
    type,
    mutable,
    span,
  };
  context.locals.set(sourceName, local.id);
  context.localDecls.push(local);
  return local;
}

function nextTemp(context: LowerContext): IrTempId {
  return `tmp.${context.nextTemp++}`;
}

function emptyRuntimeRequirements(): IrRuntimeRequirements {
  return {
    panic: false,
    strings: false,
    arrays: [],
    refCounting: false,
    copyOnWrite: false,
  };
}

function constFromLiteral(expression: LiteralExpression): IrConst {
  if (expression.literalType === "Integer") {
    return { kind: "int", value: expression.value };
  }
  if (expression.literalType === "Float") {
    return { kind: "float", value: expression.value };
  }
  if (expression.literalType === "String") {
    return { kind: "string", value: expression.value };
  }
  if (expression.literalType === "Boolean") {
    return { kind: "bool", value: expression.value === "true" };
  }
  return { kind: "null" };
}

function typeFromConst(value: IrConst): IrType {
  if (value.kind === "int") return irPrimitive("i32");
  if (value.kind === "float") return irPrimitive("f32");
  if (value.kind === "string") return irPrimitive("string");
  if (value.kind === "bool") return irPrimitive("bool");
  if (value.kind === "null") return irPrimitive("null");
  return irPrimitive("void");
}

function voidOperand(): IrOperand {
  return {
    kind: "const",
    value: { kind: "void" },
    type: irPrimitive("void"),
  };
}

function typeFromNode(
  checkResult: IrTypeSource,
  node: Expression | VariableDeclaration["initializer"] | undefined,
): IrType {
  if (!node) return irPrimitive("void");
  return typeFromCheckerType(checkResult.types.get(node) as unknown);
}

function typeFromTypeNode(node: TypeNode): IrType {
  if (node.kind === "NamedType") {
    const name = node.name.name;
    if (isPrimitiveName(name)) return irPrimitive(name);
    return {
      kind: "named",
      name,
      args: (node.typeArgs ?? []).map(typeFromTypeNode),
    };
  }
  if (node.kind === "ArrayType") {
    return {
      kind: "named",
      name: "Array",
      args: [typeFromTypeNode(node.element)],
    };
  }
  if (node.kind === "NullableType") {
    return { kind: "nullable", base: typeFromTypeNode(node.base) };
  }
  if (node.kind === "TupleType") {
    return { kind: "tuple", elements: node.elements.map(typeFromTypeNode) };
  }
  if (node.kind === "FunctionType") {
    return {
      kind: "function",
      params: node.params.map((param) => ({
        type: typeFromTypeNode(param.type),
        mutable: param.isMutable,
      })),
      returnType: typeFromTypeNode(node.returnType),
    };
  }
  return { kind: "named", name: "Self", args: [] };
}

function typeFromCheckerType(type: unknown): IrType {
  if (!isRecord(type) || typeof type.kind !== "string")
    return { kind: "unknown" };

  if (type.kind === "Primitive" && typeof type.name === "string") {
    return isPrimitiveName(type.name)
      ? irPrimitive(type.name)
      : { kind: "unknown" };
  }

  if (type.kind === "Named" && typeof type.name === "string") {
    return {
      kind: "named",
      name: type.name,
      args: Array.isArray(type.typeArgs)
        ? type.typeArgs.map(typeFromCheckerType)
        : [],
    };
  }

  if (type.kind === "Nullable") {
    return { kind: "nullable", base: typeFromCheckerType(type.base) };
  }

  if (type.kind === "Tuple" && Array.isArray(type.elements)) {
    return { kind: "tuple", elements: type.elements.map(typeFromCheckerType) };
  }

  if (type.kind === "Function" && Array.isArray(type.params)) {
    return {
      kind: "function",
      params: type.params.map((param) => ({
        type: typeFromCheckerType(isRecord(param) ? param.type : undefined),
        mutable: isRecord(param) && param.isMutable === true,
      })),
      returnType: typeFromCheckerType(type.returnType),
    };
  }

  if (type.kind === "Error") return { kind: "error" };
  return { kind: "unknown" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPrimitiveName(name: string): name is IrPrimitiveType["name"] {
  return [
    "i8",
    "i16",
    "i32",
    "i64",
    "u8",
    "u16",
    "u32",
    "u64",
    "f16",
    "f32",
    "f64",
    "bool",
    "string",
    "void",
    "null",
  ].includes(name);
}
