import type {
  IrBlock,
  IrBlockId,
  IrConst,
  IrDeclaration,
  IrFunction,
  IrLocal,
  IrLocalId,
  IrOperand,
  IrPrimitiveType,
  IrProgram,
  IrRuntimeRequirements,
  IrStructDeclaration,
  IrStructField,
  IrTempId,
  IrType,
  IrTypeDeclId,
} from "@/ir/types";
import { irPrimitive } from "@/ir/types";
import type {
  AssignmentStatement,
  BinaryExpression,
  BlockStatement,
  BreakStatement,
  CallExpression,
  CastExpression,
  ContinueStatement,
  Expression,
  ForStatement,
  FunctionDeclaration,
  GroupingExpression,
  IdentifierExpression,
  IfStatement,
  LiteralExpression,
  MatchStatement,
  MemberExpression,
  NamedParameter,
  Node,
  Program,
  ReturnStatement,
  Statement,
  StructDeclaration,
  StructField,
  StructLiteralExpression,
  TypeNode,
  UnaryExpression,
  VariableDeclaration,
  WhileStatement,
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
  blocks: IrBlock[];
  currentBlock: IrBlock;
  nextLocal: number;
  nextTemp: number;
  loopExit?: IrBlockId;
  loopContinue?: IrBlockId;
  structFields: Map<string, IrStructField[]>;
}

export function lowerProgramToIr(
  program: Program,
  checkResult: IrTypeSource,
  options: LowerOptions = {},
): IrProgram {
  const runtime = emptyRuntimeRequirements();
  const declarations: IrDeclaration[] = [];
  const structFields = new Map<string, IrStructField[]>();
  let entry: string | undefined;

  for (const statement of program.body) {
    if (statement.kind !== "StructDeclaration") continue;
    const decl = lowerStructDeclaration(statement, structFields);
    declarations.push(decl);
  }

  for (const statement of program.body) {
    if (statement.kind !== "FunctionDeclaration") continue;
    const lowered = lowerFunction(
      statement,
      checkResult,
      runtime,
      structFields,
    );
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

function lowerStructDeclaration(
  node: StructDeclaration,
  structFields: Map<string, IrStructField[]>,
): IrStructDeclaration {
  const fields: IrStructField[] = node.members
    .filter((m): m is StructField => m.kind === "StructField")
    .map((field, index) => ({
      name: field.name.name,
      type: typeFromTypeNode(field.type),
      index,
    }));
  const id: IrTypeDeclId = `struct.${node.name.name}`;
  structFields.set(node.name.name, fields);
  return {
    kind: "struct_decl",
    id,
    sourceName: node.name.name,
    linkName: node.name.name,
    fields,
    span: node.span,
  };
}

function lowerFunction(
  node: FunctionDeclaration,
  checkResult: IrTypeSource,
  runtime: IrRuntimeRequirements,
  structFields: Map<string, IrStructField[]>,
): IrFunction {
  const entryBlock: IrBlock = { id: "bb.0", instructions: [] };
  const context: LowerContext = {
    checkResult,
    runtime,
    locals: new Map(),
    localDecls: [],
    blocks: [entryBlock],
    currentBlock: entryBlock,
    nextLocal: 0,
    nextTemp: 0,
    structFields,
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
  if (!isTerminated(context)) {
    context.currentBlock.terminator = {
      kind: "return",
      value: voidOperand(),
      span: node.body?.span,
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
    blocks: node.isExtern ? [] : context.blocks,
    body: node.isExtern ? "extern" : "defined",
    span: node.span,
  };
}

function lowerBlock(block: BlockStatement, context: LowerContext) {
  for (const statement of block.body) {
    if (isTerminated(context)) return;
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
    case "IfStatement":
      lowerIfStatement(statement, context);
      return;
    case "WhileStatement":
      lowerWhileStatement(statement, context);
      return;
    case "BreakStatement":
      lowerBreak(statement, context);
      return;
    case "ContinueStatement":
      lowerContinue(statement, context);
      return;
    case "ForStatement":
      lowerForStatement(statement, context);
      return;
    case "MatchStatement":
      lowerMatchStatement(statement, context);
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
    context.currentBlock.instructions.push({
      kind: "assign",
      target: local.id,
      value: lowerExpression(statement.initializer, context),
      span: statement.span,
    });
  }
}

function lowerReturn(statement: ReturnStatement, context: LowerContext) {
  context.currentBlock.terminator = {
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
  if (statement.target.kind === "MemberExpression") {
    const localId = resolveLocalFromMember(statement.target, context);
    context.currentBlock.instructions.push({
      kind: "set_field",
      target: localId,
      field: statement.target.property.name,
      value: lowerExpression(statement.value, context),
      span: statement.span,
    });
    return;
  }
  if (statement.target.kind !== "IdentifierExpression") {
    throw new Error("IR lowering only supports identifier assignment so far.");
  }
  const target = context.locals.get(statement.target.name);
  if (!target) {
    throw new Error(
      `Unknown local '${statement.target.name}' during IR lowering.`,
    );
  }
  context.currentBlock.instructions.push({
    kind: "assign",
    target,
    value: lowerExpression(statement.value, context),
    span: statement.span,
  });
}

function resolveLocalFromMember(
  expr: MemberExpression,
  context: LowerContext,
): IrLocalId {
  if (expr.object.kind !== "IdentifierExpression") {
    throw new Error(
      "IR lowering only supports single-level field assignment so far.",
    );
  }
  const localId = context.locals.get(expr.object.name);
  if (!localId) {
    throw new Error(`Unknown local '${expr.object.name}' during IR lowering.`);
  }
  return localId;
}

function lowerIfStatement(statement: IfStatement, context: LowerContext) {
  const condition = lowerExpression(statement.condition, context);

  const thenBlock = newBlock(context);
  const elseBlock = statement.elseBranch ? newBlock(context) : undefined;
  const joinBlock = newBlock(context);

  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition,
    thenTarget: thenBlock.id,
    elseTarget: elseBlock ? elseBlock.id : joinBlock.id,
    span: statement.span,
  };

  const savedLocals = saveLocals(context);

  switchBlock(context, thenBlock);
  lowerBlock(statement.thenBranch, context);
  restoreLocals(context, savedLocals);
  if (!isTerminated(context)) {
    context.currentBlock.terminator = { kind: "branch", target: joinBlock.id };
  }

  if (statement.elseBranch && elseBlock) {
    switchBlock(context, elseBlock);
    const savedLocals2 = saveLocals(context);
    if (statement.elseBranch.kind === "BlockStatement") {
      lowerBlock(statement.elseBranch, context);
    } else {
      lowerIfStatement(statement.elseBranch, context);
    }
    restoreLocals(context, savedLocals2);
    if (!isTerminated(context)) {
      context.currentBlock.terminator = {
        kind: "branch",
        target: joinBlock.id,
      };
    }
  }

  switchBlock(context, joinBlock);
}

function lowerWhileStatement(statement: WhileStatement, context: LowerContext) {
  const condBlock = newBlock(context);
  const bodyBlock = newBlock(context);
  const exitBlock = newBlock(context);

  context.currentBlock.terminator = {
    kind: "branch",
    target: condBlock.id,
    span: statement.span,
  };

  switchBlock(context, condBlock);
  const condition = lowerExpression(statement.condition, context);
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition,
    thenTarget: bodyBlock.id,
    elseTarget: exitBlock.id,
    span: statement.span,
  };

  switchBlock(context, bodyBlock);
  const savedExit = context.loopExit;
  const savedContinue = context.loopContinue;
  context.loopExit = exitBlock.id;
  context.loopContinue = condBlock.id;
  const savedLocals = saveLocals(context);
  lowerBlock(statement.body, context);
  restoreLocals(context, savedLocals);
  context.loopExit = savedExit;
  context.loopContinue = savedContinue;
  if (!isTerminated(context)) {
    context.currentBlock.terminator = { kind: "branch", target: condBlock.id };
  }

  switchBlock(context, exitBlock);
}

function lowerBreak(statement: BreakStatement, context: LowerContext) {
  if (!context.loopExit) {
    throw new Error("IR lowering: break outside of loop.");
  }
  context.currentBlock.terminator = {
    kind: "branch",
    target: context.loopExit,
    span: statement.span,
  };
}

function lowerContinue(statement: ContinueStatement, context: LowerContext) {
  if (!context.loopContinue) {
    throw new Error("IR lowering: continue outside of loop.");
  }
  context.currentBlock.terminator = {
    kind: "branch",
    target: context.loopContinue,
    span: statement.span,
  };
}

function lowerForStatement(_statement: ForStatement, _context: LowerContext) {
  throw new Error(
    "IR lowering does not support for loops yet (requires array runtime helpers).",
  );
}

function lowerMatchStatement(
  _statement: MatchStatement,
  _context: LowerContext,
) {
  throw new Error("IR lowering does not support match statements yet.");
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
    case "StructLiteralExpression":
      return lowerStructLiteral(expression, context);
    case "MemberExpression":
      return lowerMemberExpression(expression, context);
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
  context.currentBlock.instructions.push({
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
  context.currentBlock.instructions.push({
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
    const args = expression.args.map((arg) => lowerExpression(arg, context));
    context.currentBlock.instructions.push({
      kind: "call",
      target: undefined,
      callee,
      args,
      type,
      span: expression.span,
    });
    context.currentBlock.terminator = {
      kind: "unreachable",
      span: expression.span,
    };
    const afterBlock = newBlock(context);
    switchBlock(context, afterBlock);
    return voidOperand();
  }

  context.currentBlock.instructions.push({
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
  context.currentBlock.instructions.push({
    kind: "cast",
    target,
    value: lowerExpression(expression.expression, context),
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function lowerStructLiteral(
  expression: StructLiteralExpression,
  context: LowerContext,
): IrOperand {
  const structName = expression.name.name;
  const declId: IrTypeDeclId = `struct.${structName}`;
  const type: IrType = { kind: "named", name: structName, args: [] };
  const target = nextTemp(context);
  const fields = expression.fields.map((f) => ({
    name: f.name.name,
    value: lowerExpression(f.value, context),
  }));
  context.currentBlock.instructions.push({
    kind: "construct_struct",
    target,
    declId,
    fields,
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function lowerMemberExpression(
  expression: MemberExpression,
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  const type = typeFromNode(context.checkResult, expression);
  const object = lowerExpression(expression.object, context);
  context.currentBlock.instructions.push({
    kind: "get_field",
    target,
    object,
    field: expression.property.name,
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function newBlock(context: LowerContext): IrBlock {
  const block: IrBlock = {
    id: `bb.${context.blocks.length}`,
    instructions: [],
  };
  context.blocks.push(block);
  return block;
}

function switchBlock(context: LowerContext, block: IrBlock): void {
  context.currentBlock = block;
}

function isTerminated(context: LowerContext): boolean {
  return context.currentBlock.terminator !== undefined;
}

function saveLocals(context: LowerContext): Map<string, IrLocalId> {
  return new Map(context.locals);
}

function restoreLocals(
  context: LowerContext,
  saved: Map<string, IrLocalId>,
): void {
  context.locals = saved;
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
