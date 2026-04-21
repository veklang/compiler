import type {
  IrBlock,
  IrBlockId,
  IrConst,
  IrDeclaration,
  IrEnumDeclaration,
  IrEnumVariant,
  IrFunction,
  IrGlobal,
  IrGlobalId,
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
  ArrayLiteralExpression,
  AssignmentStatement,
  BinaryExpression,
  BlockStatement,
  BreakStatement,
  CallExpression,
  CastExpression,
  ContinueStatement,
  EnumDeclaration,
  EnumVariant,
  Expression,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  GroupingExpression,
  IdentifierExpression,
  IfStatement,
  IndexExpression,
  LiteralExpression,
  MatchStatement,
  MatchStatementArm,
  MemberExpression,
  MethodDeclaration,
  NamedParameter,
  Node,
  Parameter,
  Program,
  ReturnStatement,
  Statement,
  StructDeclaration,
  StructField,
  StructLiteralExpression,
  TupleLiteralExpression,
  TupleMemberExpression,
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

interface VariantInfo {
  enumName: string;
  declId: IrTypeDeclId;
  variantName: string;
  tag: number;
  payloadTypes: IrType[];
}

interface LowerContext {
  checkResult: IrTypeSource;
  runtime: IrRuntimeRequirements;
  locals: Map<string, IrLocalId>;
  localTypes: Map<IrLocalId, IrType>;
  localDecls: IrLocal[];
  blocks: IrBlock[];
  currentBlock: IrBlock;
  nextLocal: number;
  nextTemp: number;
  loopExit?: IrBlockId;
  loopContinue?: IrBlockId;
  structFields: Map<string, IrStructField[]>;
  variantInfos: Map<string, VariantInfo>;
  methodLinks: Map<string, string>;
  globals: Map<string, IrGlobalId>;
  globalTypes: Map<IrGlobalId, IrType>;
  lazyGlobals: Set<IrGlobalId>;
  returnType: IrType;
  selfTypeName?: string;
  session: LowerSession;
}

interface LowerSession {
  generatedFunctions: IrFunction[];
  nextAnonymousFunction: number;
}

export function lowerProgramToIr(
  program: Program,
  checkResult: IrTypeSource,
  options: LowerOptions = {},
): IrProgram {
  const runtime = emptyRuntimeRequirements();
  const declarations: IrDeclaration[] = [];
  const structFields = new Map<string, IrStructField[]>();
  const variantInfos = new Map<string, VariantInfo>();
  const methodLinks = new Map<string, string>();
  const session: LowerSession = {
    generatedFunctions: [],
    nextAnonymousFunction: 0,
  };
  let entry: string | undefined;

  for (const statement of program.body) {
    if (statement.kind === "StructDeclaration") {
      declarations.push(
        lowerStructDeclaration(statement, structFields, methodLinks),
      );
    } else if (statement.kind === "EnumDeclaration") {
      declarations.push(
        lowerEnumDeclaration(statement, variantInfos, methodLinks),
      );
    }
  }

  const globals = new Map<string, IrGlobalId>();
  const globalTypes = new Map<IrGlobalId, IrType>();
  const lazyGlobals = new Set<IrGlobalId>();
  const globalStatements: VariableDeclaration[] = [];
  for (const statement of program.body) {
    if (statement.kind === "VariableDeclaration") {
      const global = lowerGlobalDeclaration(statement, checkResult, runtime);
      declarations.push(global);
      globals.set(statement.name.name, global.id);
      globalTypes.set(global.id, global.type);
      if (global.initializerFunction) lazyGlobals.add(global.id);
      globalStatements.push(statement);
    }
  }

  for (const statement of program.body) {
    if (
      statement.kind !== "StructDeclaration" &&
      statement.kind !== "EnumDeclaration"
    )
      continue;
    for (const member of statement.members) {
      if (member.kind !== "MethodDeclaration") continue;
      declarations.push(
        lowerMethod(
          member,
          statement.name.name,
          checkResult,
          runtime,
          structFields,
          variantInfos,
          methodLinks,
          globals,
          globalTypes,
          lazyGlobals,
          session,
        ),
      );
    }
  }

  for (const statement of globalStatements) {
    if (
      !statement.initializer ||
      statement.initializer.kind === "LiteralExpression"
    )
      continue;
    declarations.push(
      lowerGlobalInitializerFunction(
        statement,
        checkResult,
        runtime,
        structFields,
        variantInfos,
        methodLinks,
        globals,
        globalTypes,
        lazyGlobals,
        session,
      ),
    );
  }

  for (const statement of program.body) {
    if (statement.kind !== "FunctionDeclaration") continue;
    const lowered = lowerFunction(
      statement,
      checkResult,
      runtime,
      structFields,
      variantInfos,
      methodLinks,
      globals,
      globalTypes,
      lazyGlobals,
      session,
    );
    declarations.push(lowered);
    if (statement.name.name === "main") entry = lowered.id;
  }

  declarations.push(...session.generatedFunctions);

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
  methodLinks: Map<string, string>,
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
  recordMethodLinks(node.name.name, node.members, methodLinks);
  return {
    kind: "struct_decl",
    id,
    sourceName: node.name.name,
    linkName: node.name.name,
    fields,
    span: node.span,
  };
}

function lowerEnumDeclaration(
  node: EnumDeclaration,
  variantInfos: Map<string, VariantInfo>,
  methodLinks: Map<string, string>,
): IrEnumDeclaration {
  const id: IrTypeDeclId = `enum.${node.name.name}`;
  const declId = id;
  recordMethodLinks(node.name.name, node.members, methodLinks);
  const variants: IrEnumVariant[] = node.members
    .filter((m): m is EnumVariant => m.kind === "EnumVariant")
    .map((variant, tag) => {
      const payloadTypes = (variant.payload ?? []).map(typeFromTypeNode);
      const info: VariantInfo = {
        enumName: node.name.name,
        declId,
        variantName: variant.name.name,
        tag,
        payloadTypes,
      };
      variantInfos.set(variant.name.name, info);
      return { name: variant.name.name, tag, payloadTypes };
    });
  return {
    kind: "enum_decl",
    id,
    sourceName: node.name.name,
    linkName: node.name.name,
    variants,
    span: node.span,
  };
}

function recordMethodLinks(
  ownerName: string,
  members: Array<{ kind: string; name?: { name: string } }>,
  methodLinks: Map<string, string>,
) {
  for (const member of members) {
    if (member.kind !== "MethodDeclaration" || !member.name) continue;
    methodLinks.set(
      methodKey(ownerName, member.name.name),
      methodLinkName(ownerName, member.name.name),
    );
  }
}

function lowerGlobalDeclaration(
  node: VariableDeclaration,
  checkResult: IrTypeSource,
  runtime: IrRuntimeRequirements,
): IrGlobal {
  const type = node.typeAnnotation
    ? typeFromTypeNode(node.typeAnnotation)
    : typeFromNode(checkResult, node.initializer);
  const initializer =
    node.initializer?.kind === "LiteralExpression"
      ? constFromLiteral(node.initializer)
      : undefined;
  if (initializer?.kind === "string") runtime.strings = true;
  const id: IrGlobalId = `global.${node.name.name}`;
  const initializerFunction =
    node.initializer && !initializer
      ? `fn.__vek_init_global_${node.name.name}`
      : undefined;
  return {
    kind: "global",
    id,
    sourceName: node.name.name,
    linkName: node.name.name,
    type,
    mutable: node.declarationKind === "let",
    initializer,
    initializerFunction,
    span: node.span,
  };
}

function lowerGlobalInitializerFunction(
  node: VariableDeclaration,
  checkResult: IrTypeSource,
  runtime: IrRuntimeRequirements,
  structFields: Map<string, IrStructField[]>,
  variantInfos: Map<string, VariantInfo>,
  methodLinks: Map<string, string>,
  globals: Map<string, IrGlobalId>,
  globalTypes: Map<IrGlobalId, IrType>,
  lazyGlobals: Set<IrGlobalId>,
  session: LowerSession,
): IrFunction {
  if (!node.initializer) {
    throw new Error("IR lowering: missing global initializer.");
  }

  const entryBlock: IrBlock = { id: "bb.0", instructions: [] };
  const globalId: IrGlobalId = `global.${node.name.name}`;
  const context: LowerContext = {
    checkResult,
    runtime,
    locals: new Map(),
    localTypes: new Map(),
    localDecls: [],
    blocks: [entryBlock],
    currentBlock: entryBlock,
    nextLocal: 0,
    nextTemp: 0,
    structFields,
    variantInfos,
    methodLinks,
    globals,
    globalTypes,
    lazyGlobals,
    returnType: irPrimitive("void"),
    session,
  };

  context.currentBlock.instructions.push({
    kind: "store_global",
    globalId,
    value: coerceOperand(
      lowerExpression(node.initializer, context),
      globalTypes.get(globalId) ?? typeFromNode(checkResult, node.initializer),
      context,
      node.span,
    ),
    span: node.span,
  });
  context.currentBlock.terminator = {
    kind: "return",
    value: voidOperand(),
    span: node.span,
  };

  return {
    kind: "function",
    id: `fn.__vek_init_global_${node.name.name}`,
    sourceName: `__vek_init_global_${node.name.name}`,
    linkName: `__vek_init_global_${node.name.name}`,
    signature: { params: [], returnType: irPrimitive("void") },
    params: [],
    locals: context.localDecls,
    blocks: context.blocks,
    body: "defined",
    span: node.span,
  };
}

function lowerMethod(
  node: MethodDeclaration,
  ownerName: string,
  checkResult: IrTypeSource,
  runtime: IrRuntimeRequirements,
  structFields: Map<string, IrStructField[]>,
  variantInfos: Map<string, VariantInfo>,
  methodLinks: Map<string, string>,
  globals: Map<string, IrGlobalId>,
  globalTypes: Map<IrGlobalId, IrType>,
  lazyGlobals: Set<IrGlobalId>,
  session: LowerSession,
): IrFunction {
  const ownerType: IrType = { kind: "named", name: ownerName, args: [] };
  const returnType = node.returnType
    ? typeFromTypeNodeWithSelf(node.returnType, ownerName)
    : irPrimitive("void");
  const entryBlock: IrBlock = { id: "bb.0", instructions: [] };
  const context: LowerContext = {
    checkResult,
    runtime,
    locals: new Map(),
    localTypes: new Map(),
    localDecls: [],
    blocks: [entryBlock],
    currentBlock: entryBlock,
    nextLocal: 0,
    nextTemp: 0,
    structFields,
    variantInfos,
    methodLinks,
    globals,
    globalTypes,
    lazyGlobals,
    returnType,
    selfTypeName: ownerName,
    session,
  };

  const params = node.params.map((param) =>
    lowerMethodParameter(param, ownerType, ownerName, context),
  );

  lowerBlock(node.body, context);
  if (!isTerminated(context)) {
    context.currentBlock.terminator = {
      kind: "return",
      value: voidOperand(),
      span: node.body.span,
    };
  }

  const linkName = methodLinkName(ownerName, node.name.name);
  return {
    kind: "function",
    id: `fn.${linkName}`,
    sourceName: `${ownerName}.${node.name.name}`,
    linkName,
    signature: {
      params: params.map((param) => ({
        type: param.type,
        mutable: param.mutable,
      })),
      returnType,
    },
    params,
    locals: context.localDecls,
    blocks: context.blocks,
    body: "defined",
    span: node.span,
  };
}

function lowerMethodParameter(
  param: Parameter,
  ownerType: IrType,
  ownerName: string,
  context: LowerContext,
) {
  if (param.kind === "SelfParameter") {
    const local = declareLocal(
      context,
      "self",
      ownerType,
      param.isMutable,
      param.span,
    );
    return {
      local: local.id,
      sourceName: "self",
      type: local.type,
      mutable: param.isMutable,
      span: param.span,
    };
  }

  const local = declareLocal(
    context,
    param.name.name,
    typeFromTypeNodeWithSelf(param.type, ownerName),
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
}

function lowerFunction(
  node: FunctionDeclaration,
  checkResult: IrTypeSource,
  runtime: IrRuntimeRequirements,
  structFields: Map<string, IrStructField[]>,
  variantInfos: Map<string, VariantInfo>,
  methodLinks: Map<string, string>,
  globals: Map<string, IrGlobalId>,
  globalTypes: Map<IrGlobalId, IrType>,
  lazyGlobals: Set<IrGlobalId>,
  session: LowerSession,
): IrFunction {
  const returnType = node.returnType
    ? typeFromTypeNode(node.returnType)
    : irPrimitive("void");
  const entryBlock: IrBlock = { id: "bb.0", instructions: [] };
  const context: LowerContext = {
    checkResult,
    runtime,
    locals: new Map(),
    localTypes: new Map(),
    localDecls: [],
    blocks: [entryBlock],
    currentBlock: entryBlock,
    nextLocal: 0,
    nextTemp: 0,
    structFields,
    variantInfos,
    methodLinks,
    globals,
    globalTypes,
    lazyGlobals,
    returnType,
    session,
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
      value: coerceOperand(
        lowerExpression(statement.initializer, context),
        local.type,
        context,
        statement.span,
      ),
      span: statement.span,
    });
  }
}

function lowerReturn(statement: ReturnStatement, context: LowerContext) {
  context.currentBlock.terminator = {
    kind: "return",
    value: statement.value
      ? coerceOperand(
          lowerExpression(statement.value, context),
          context.returnType,
          context,
          statement.span,
        )
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
  if (statement.target.kind === "IndexExpression") {
    const arrayOperand = lowerExpression(statement.target.object, context);
    const indexOperand = lowerExpression(statement.target.index, context);
    const valueOperand = lowerExpression(statement.value, context);
    context.currentBlock.instructions.push({
      kind: "array_set",
      array: arrayOperand,
      index: indexOperand,
      value: valueOperand,
      elementType: valueOperand.type,
      span: statement.span,
    });
    return;
  }
  if (statement.target.kind !== "IdentifierExpression") {
    throw new Error("IR lowering only supports identifier assignment so far.");
  }
  const globalId = context.globals.get(statement.target.name);
  if (globalId) {
    context.currentBlock.instructions.push({
      kind: "store_global",
      globalId,
      value: coerceOperand(
        lowerExpression(statement.value, context),
        context.globalTypes.get(globalId) ??
          typeFromNode(context.checkResult, statement.value),
        context,
        statement.span,
      ),
      span: statement.span,
    });
    return;
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
    value: coerceOperand(
      lowerExpression(statement.value, context),
      context.localTypes.get(target) ??
        typeFromNode(context.checkResult, statement.value),
      context,
      statement.span,
    ),
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

function lowerForStatement(statement: ForStatement, context: LowerContext) {
  const arrayOperand = lowerExpression(statement.iterable, context);
  const arrayType = arrayOperand.type;
  const elementType: IrType =
    arrayType.kind === "named" && arrayType.args.length > 0
      ? arrayType.args[0]
      : { kind: "unknown" };

  const lenTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "array_len",
    target: lenTarget,
    array: arrayOperand,
    type: irPrimitive("i32"),
    span: statement.span,
  });

  const idxLocal = declareLocal(
    context,
    "__vek_for_idx",
    irPrimitive("i32"),
    true,
    statement.span,
  );
  context.currentBlock.instructions.push({
    kind: "assign",
    target: idxLocal.id,
    value: {
      kind: "const",
      value: { kind: "int", value: "0" },
      type: irPrimitive("i32"),
    },
    span: statement.span,
  });

  const condBlock = newBlock(context);
  const bodyBlock = newBlock(context);
  const incBlock = newBlock(context);
  const exitBlock = newBlock(context);

  context.currentBlock.terminator = {
    kind: "branch",
    target: condBlock.id,
    span: statement.span,
  };

  switchBlock(context, condBlock);
  const condTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "binary",
    target: condTarget,
    operator: "<",
    left: { kind: "local", id: idxLocal.id, type: irPrimitive("i32") },
    right: { kind: "temp", id: lenTarget, type: irPrimitive("i32") },
    type: irPrimitive("bool"),
    span: statement.span,
  });
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition: { kind: "temp", id: condTarget, type: irPrimitive("bool") },
    thenTarget: bodyBlock.id,
    elseTarget: exitBlock.id,
    span: statement.span,
  };

  switchBlock(context, bodyBlock);
  const elemTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "array_get",
    target: elemTarget,
    array: arrayOperand,
    index: { kind: "local", id: idxLocal.id, type: irPrimitive("i32") },
    elementType,
    type: elementType,
    span: statement.span,
  });
  const iterLocal = declareLocal(
    context,
    statement.iterator.name,
    elementType,
    false,
    statement.span,
  );
  context.currentBlock.instructions.push({
    kind: "assign",
    target: iterLocal.id,
    value: { kind: "temp", id: elemTarget, type: elementType },
    span: statement.span,
  });

  const savedExit = context.loopExit;
  const savedContinue = context.loopContinue;
  context.loopExit = exitBlock.id;
  context.loopContinue = incBlock.id;

  const savedLocals = saveLocals(context);
  lowerBlock(statement.body, context);
  restoreLocals(context, savedLocals);

  context.loopExit = savedExit;
  context.loopContinue = savedContinue;

  if (!isTerminated(context)) {
    context.currentBlock.terminator = {
      kind: "branch",
      target: incBlock.id,
    };
  }

  switchBlock(context, incBlock);
  const incTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "binary",
    target: incTarget,
    operator: "+",
    left: { kind: "local", id: idxLocal.id, type: irPrimitive("i32") },
    right: {
      kind: "const",
      value: { kind: "int", value: "1" },
      type: irPrimitive("i32"),
    },
    type: irPrimitive("i32"),
    span: statement.span,
  });
  context.currentBlock.instructions.push({
    kind: "assign",
    target: idxLocal.id,
    value: { kind: "temp", id: incTarget, type: irPrimitive("i32") },
    span: statement.span,
  });
  context.currentBlock.terminator = {
    kind: "branch",
    target: condBlock.id,
  };

  switchBlock(context, exitBlock);
}

function lowerMatchStatement(statement: MatchStatement, context: LowerContext) {
  const matchOperand = lowerExpression(statement.expression, context);
  const joinBlock = newBlock(context);

  const armBlocks = statement.arms.map(() => newBlock(context));
  const defaultBlock = newBlock(context);

  const matchType = matchOperand.type;
  const isEnum =
    matchType.kind === "named" &&
    [...context.variantInfos.values()].some(
      (v) => v.enumName === (matchType as { name: string }).name,
    );

  if (isEnum) {
    const tagTarget = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "get_tag",
      target: tagTarget,
      object: matchOperand,
      type: irPrimitive("i32"),
    });
    const tagOperand: IrOperand = {
      kind: "temp",
      id: tagTarget,
      type: irPrimitive("i32"),
    };

    const switchCases: { value: IrConst; target: IrBlockId }[] = [];
    let defaultTarget = defaultBlock.id;

    for (let i = 0; i < statement.arms.length; i++) {
      const arm = statement.arms[i];
      const armBlock = armBlocks[i];
      const pattern = arm.pattern;

      if (pattern.kind === "WildcardPattern") {
        defaultTarget = armBlock.id;
      } else if (pattern.kind === "IdentifierPattern") {
        const variantInfo = context.variantInfos.get(pattern.name.name);
        if (variantInfo) {
          switchCases.push({
            value: { kind: "int", value: String(variantInfo.tag) },
            target: armBlock.id,
          });
        } else {
          defaultTarget = armBlock.id;
        }
      } else if (pattern.kind === "EnumPattern") {
        const variantInfo = context.variantInfos.get(pattern.name.name);
        if (variantInfo) {
          switchCases.push({
            value: { kind: "int", value: String(variantInfo.tag) },
            target: armBlock.id,
          });
        }
      }
    }

    context.currentBlock.terminator = {
      kind: "switch",
      value: tagOperand,
      cases: switchCases,
      defaultTarget,
      span: statement.span,
    };
  } else {
    lowerNonEnumMatch(
      statement,
      matchOperand,
      armBlocks,
      defaultBlock,
      context,
    );
  }

  for (let i = 0; i < statement.arms.length; i++) {
    const arm = statement.arms[i];
    const armBlock = armBlocks[i];
    switchBlock(context, armBlock);
    lowerMatchArmBindings(arm, matchOperand, context);
    const savedLocals = saveLocals(context);
    lowerBlock(arm.body, context);
    restoreLocals(context, savedLocals);
    if (!isTerminated(context)) {
      context.currentBlock.terminator = {
        kind: "branch",
        target: joinBlock.id,
      };
    }
  }

  switchBlock(context, defaultBlock);
  if (!isTerminated(context)) {
    context.currentBlock.terminator = { kind: "branch", target: joinBlock.id };
  }

  switchBlock(context, joinBlock);
}

function lowerNonEnumMatch(
  statement: MatchStatement,
  matchOperand: IrOperand,
  armBlocks: IrBlock[],
  defaultBlock: IrBlock,
  context: LowerContext,
) {
  let defaultTarget = defaultBlock.id;
  const switchCases: { value: IrConst; target: IrBlockId }[] = [];

  for (let i = 0; i < statement.arms.length; i++) {
    const arm = statement.arms[i];
    const armBlock = armBlocks[i];
    const pattern = arm.pattern;

    if (pattern.kind === "WildcardPattern") {
      defaultTarget = armBlock.id;
    } else if (pattern.kind === "IdentifierPattern") {
      defaultTarget = armBlock.id;
    } else if (pattern.kind === "LiteralPattern") {
      const c = constFromLiteral(pattern.literal);
      switchCases.push({ value: c, target: armBlock.id });
    }
  }

  context.currentBlock.terminator = {
    kind: "switch",
    value: matchOperand,
    cases: switchCases,
    defaultTarget,
    span: statement.span,
  };
}

function lowerMatchArmBindings(
  arm: MatchStatementArm,
  matchOperand: IrOperand,
  context: LowerContext,
) {
  const pattern = arm.pattern;

  if (
    pattern.kind === "IdentifierPattern" &&
    !context.variantInfos.has(pattern.name.name)
  ) {
    const local = declareLocal(
      context,
      pattern.name.name,
      matchOperand.type,
      true,
      pattern.span,
    );
    context.currentBlock.instructions.push({
      kind: "assign",
      target: local.id,
      value: matchOperand,
      span: pattern.span,
    });
  } else if (pattern.kind === "EnumPattern") {
    const variantInfo = context.variantInfos.get(pattern.name.name);
    if (variantInfo) {
      for (let i = 0; i < pattern.args.length; i++) {
        const arg = pattern.args[i];
        if (arg.kind !== "IdentifierPattern") continue;
        const payloadType = variantInfo.payloadTypes[i] ?? {
          kind: "unknown" as const,
        };
        const tempId = nextTemp(context);
        context.currentBlock.instructions.push({
          kind: "get_enum_payload",
          target: tempId,
          object: matchOperand,
          variant: variantInfo.variantName,
          index: i,
          type: payloadType,
          span: arg.span,
        });
        const local = declareLocal(
          context,
          arg.name.name,
          payloadType,
          true,
          arg.span,
        );
        context.currentBlock.instructions.push({
          kind: "assign",
          target: local.id,
          value: { kind: "temp", id: tempId, type: payloadType },
          span: arg.span,
        });
      }
    }
  }
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
    case "TupleLiteralExpression":
      return lowerTupleLiteral(expression, context);
    case "TupleMemberExpression":
      return lowerTupleMemberExpression(expression, context);
    case "FunctionExpression":
      return lowerFunctionExpression(expression, context);
    case "ArrayLiteralExpression":
      return lowerArrayLiteral(expression, context);
    case "IndexExpression":
      return lowerIndexExpression(expression, context);
    default:
      throw new Error(`IR lowering does not support ${expression.kind} yet.`);
  }
}

function lowerFunctionExpression(
  expression: FunctionExpression,
  outerContext: LowerContext,
): IrOperand {
  const functionType = typeFromNode(outerContext.checkResult, expression);
  if (functionType.kind !== "function") {
    throw new Error(
      "IR lowering: function expression did not have function type.",
    );
  }

  const index = outerContext.session.nextAnonymousFunction++;
  const sourceName = `__vek_anon_${index}`;
  const entryBlock: IrBlock = { id: "bb.0", instructions: [] };
  const context: LowerContext = {
    checkResult: outerContext.checkResult,
    runtime: outerContext.runtime,
    locals: new Map(),
    localTypes: new Map(),
    localDecls: [],
    blocks: [entryBlock],
    currentBlock: entryBlock,
    nextLocal: 0,
    nextTemp: 0,
    structFields: outerContext.structFields,
    variantInfos: outerContext.variantInfos,
    methodLinks: outerContext.methodLinks,
    globals: outerContext.globals,
    globalTypes: outerContext.globalTypes,
    lazyGlobals: outerContext.lazyGlobals,
    returnType: functionType.returnType,
    session: outerContext.session,
  };

  const params = expression.params
    .filter((param): param is NamedParameter => param.kind === "NamedParameter")
    .map((param, paramIndex) => {
      const paramType = functionType.params[paramIndex]?.type ?? {
        kind: "unknown" as const,
      };
      const local = declareLocal(
        context,
        param.name.name,
        paramType,
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

  lowerBlock(expression.body, context);
  if (!isTerminated(context)) {
    context.currentBlock.terminator = {
      kind: "return",
      value: voidOperand(),
      span: expression.body.span,
    };
  }

  outerContext.session.generatedFunctions.push({
    kind: "function",
    id: `fn.${sourceName}`,
    sourceName,
    linkName: sourceName,
    signature: {
      params: params.map((param) => ({
        type: param.type,
        mutable: param.mutable,
      })),
      returnType: functionType.returnType,
    },
    params,
    locals: context.localDecls,
    blocks: context.blocks,
    body: "defined",
    span: expression.span,
  });

  return { kind: "function", name: sourceName, type: functionType };
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
    return maybeUnwrapNullable(
      {
        kind: "local",
        id: local,
        type:
          context.localTypes.get(local) ??
          typeFromNode(context.checkResult, expression),
      },
      typeFromNode(context.checkResult, expression),
      context,
      expression.span,
    );
  }
  const globalId = context.globals.get(expression.name);
  if (globalId) {
    if (context.lazyGlobals.has(globalId)) {
      context.currentBlock.instructions.push({
        kind: "ensure_global_initialized",
        globalId,
        span: expression.span,
      });
    }
    return maybeUnwrapNullable(
      {
        kind: "global",
        id: globalId,
        type:
          context.globalTypes.get(globalId) ??
          typeFromNode(context.checkResult, expression),
      },
      typeFromNode(context.checkResult, expression),
      context,
      expression.span,
    );
  }
  const variant = context.variantInfos.get(expression.name);
  if (variant && variant.payloadTypes.length === 0) {
    const target = nextTemp(context);
    const type: IrType = {
      kind: "named",
      name: variant.enumName,
      args: [],
      decl: "enum",
    };
    context.currentBlock.instructions.push({
      kind: "construct_enum",
      target,
      declId: variant.declId,
      variant: variant.variantName,
      tag: variant.tag,
      payload: [],
      type,
      span: expression.span,
    });
    return { kind: "temp", id: target, type };
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
  const nullComparison = lowerNullComparison(expression, context);
  if (nullComparison) return nullComparison;

  const leftType = typeFromNode(context.checkResult, expression.left);
  const isString = leftType.kind === "primitive" && leftType.name === "string";

  if (isString && expression.operator === "+") {
    const target = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "string_concat",
      target,
      left: lowerExpression(expression.left, context),
      right: lowerExpression(expression.right, context),
      type: irPrimitive("string"),
      span: expression.span,
    });
    context.runtime.strings = true;
    return { kind: "temp", id: target, type: irPrimitive("string") };
  }

  if (
    isString &&
    (expression.operator === "==" || expression.operator === "!=")
  ) {
    const eqTarget = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "string_eq",
      target: eqTarget,
      left: lowerExpression(expression.left, context),
      right: lowerExpression(expression.right, context),
      type: irPrimitive("bool"),
      span: expression.span,
    });
    context.runtime.strings = true;
    if (expression.operator === "==") {
      return { kind: "temp", id: eqTarget, type: irPrimitive("bool") };
    }
    const notTarget = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "unary",
      target: notTarget,
      operator: "!",
      argument: { kind: "temp", id: eqTarget, type: irPrimitive("bool") },
      type: irPrimitive("bool"),
      span: expression.span,
    });
    return { kind: "temp", id: notTarget, type: irPrimitive("bool") };
  }

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

function lowerNullComparison(
  expression: BinaryExpression,
  context: LowerContext,
): IrOperand | undefined {
  if (expression.operator !== "==" && expression.operator !== "!=")
    return undefined;

  const leftIsNull = isNullLiteral(expression.left);
  const rightIsNull = isNullLiteral(expression.right);
  if (!leftIsNull && !rightIsNull) return undefined;

  const nullable = lowerExpression(
    leftIsNull ? expression.right : expression.left,
    context,
  );
  if (nullable.type.kind !== "nullable") return undefined;

  const isNullTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "is_null",
    target: isNullTarget,
    value: nullable,
    type: irPrimitive("bool"),
    span: expression.span,
  });

  if (expression.operator === "==") {
    return { kind: "temp", id: isNullTarget, type: irPrimitive("bool") };
  }

  const notTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "unary",
    target: notTarget,
    operator: "!",
    argument: { kind: "temp", id: isNullTarget, type: irPrimitive("bool") },
    type: irPrimitive("bool"),
    span: expression.span,
  });
  return { kind: "temp", id: notTarget, type: irPrimitive("bool") };
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
  const methodCall = lowerInstanceMethodCall(expression, context);
  if (methodCall) return methodCall;

  const target = nextTemp(context);
  const type = typeFromNode(context.checkResult, expression);
  const callee = lowerExpression(expression.callee, context);
  const returnsVoid = type.kind === "primitive" && type.name === "void";

  if (callee.kind === "function") {
    const variant = context.variantInfos.get(callee.name);
    if (variant && variant.payloadTypes.length > 0) {
      const target = nextTemp(context);
      const enumType: IrType = {
        kind: "named",
        name: variant.enumName,
        args: [],
        decl: "enum",
      };
      const payload = expression.args.map((arg) =>
        lowerExpression(arg, context),
      );
      context.currentBlock.instructions.push({
        kind: "construct_enum",
        target,
        declId: variant.declId,
        variant: variant.variantName,
        tag: variant.tag,
        payload,
        type: enumType,
        span: expression.span,
      });
      return { kind: "temp", id: target, type: enumType };
    }
  }

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

function lowerInstanceMethodCall(
  expression: CallExpression,
  context: LowerContext,
): IrOperand | undefined {
  if (expression.callee.kind !== "MemberExpression") return undefined;
  if (
    expression.callee.object.kind === "IdentifierExpression" &&
    context.methodLinks.has(
      methodKey(expression.callee.object.name, expression.callee.property.name),
    )
  ) {
    return undefined;
  }

  const calleeType = typeFromNode(context.checkResult, expression.callee);
  if (calleeType.kind !== "function") return undefined;

  const objectType = typeFromNode(
    context.checkResult,
    expression.callee.object,
  );
  if (objectType.kind !== "named") return undefined;

  const linkName = context.methodLinks.get(
    methodKey(objectType.name, expression.callee.property.name),
  );
  if (!linkName) return undefined;

  const type = typeFromNode(context.checkResult, expression);
  const returnsVoid = type.kind === "primitive" && type.name === "void";
  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "call",
    target: returnsVoid ? undefined : target,
    callee: { kind: "function", name: linkName, type: calleeType },
    args: [
      lowerExpression(expression.callee.object, context),
      ...expression.args.map((arg) => lowerExpression(arg, context)),
    ],
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

function maybeUnwrapNullable(
  operand: IrOperand,
  expressionType: IrType,
  context: LowerContext,
  span: IrLocal["span"],
): IrOperand {
  if (
    operand.type.kind === "nullable" &&
    irTypeEquals(operand.type.base, expressionType)
  ) {
    const target = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "unwrap_nullable",
      target,
      value: operand,
      type: expressionType,
      span,
    });
    return { kind: "temp", id: target, type: expressionType };
  }
  return {
    ...operand,
    type: expressionType.kind === "unknown" ? operand.type : expressionType,
  };
}

function coerceOperand(
  operand: IrOperand,
  targetType: IrType,
  context: LowerContext,
  span: IrLocal["span"],
): IrOperand {
  if (targetType.kind !== "nullable") return operand;
  if (operand.type.kind === "primitive" && operand.type.name === "null") {
    const target = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "make_null",
      target,
      type: targetType,
      span,
    });
    return { kind: "temp", id: target, type: targetType };
  }
  if (irTypeEquals(operand.type, targetType.base)) {
    const target = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "make_nullable",
      target,
      value: operand,
      type: targetType,
      span,
    });
    return { kind: "temp", id: target, type: targetType };
  }
  return operand;
}

function isNullLiteral(expression: Expression): boolean {
  return (
    expression.kind === "LiteralExpression" && expression.literalType === "Null"
  );
}

function lowerArrayLiteral(
  expression: ArrayLiteralExpression,
  context: LowerContext,
): IrOperand {
  const type = typeFromNode(context.checkResult, expression);
  const elementType: IrType =
    type.kind === "named" && type.args.length > 0
      ? type.args[0]
      : { kind: "unknown" };
  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "array_new",
    target,
    elementType,
    elements: expression.elements.map((el) => lowerExpression(el, context)),
    type,
    span: expression.span,
  });
  if (!context.runtime.arrays.some((t) => irTypeEquals(t, elementType))) {
    context.runtime.arrays.push(elementType);
  }
  return { kind: "temp", id: target, type };
}

function lowerIndexExpression(
  expression: IndexExpression,
  context: LowerContext,
): IrOperand {
  const type = typeFromNode(context.checkResult, expression);
  const target = nextTemp(context);
  const object = lowerExpression(expression.object, context);
  const index = lowerExpression(expression.index, context);
  if (object.type.kind === "primitive" && object.type.name === "string") {
    context.currentBlock.instructions.push({
      kind: "string_at",
      target,
      string: object,
      index,
      type,
      span: expression.span,
    });
    context.runtime.strings = true;
    return { kind: "temp", id: target, type };
  }
  context.currentBlock.instructions.push({
    kind: "array_get",
    target,
    array: object,
    index,
    elementType: type,
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function lowerTupleLiteral(
  expression: TupleLiteralExpression,
  context: LowerContext,
): IrOperand {
  const type = typeFromNode(context.checkResult, expression);
  if (type.kind !== "tuple") {
    throw new Error("IR lowering: tuple literal did not have tuple type.");
  }
  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "construct_tuple",
    target,
    elements: expression.elements.map((element) =>
      lowerExpression(element, context),
    ),
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function lowerTupleMemberExpression(
  expression: TupleMemberExpression,
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  const type = typeFromNode(context.checkResult, expression);
  context.currentBlock.instructions.push({
    kind: "get_tuple_field",
    target,
    object: lowerExpression(expression.object, context),
    index: expression.index,
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function lowerStructLiteral(
  expression: StructLiteralExpression,
  context: LowerContext,
): IrOperand {
  const structName =
    expression.name.name === "Self" && context.selfTypeName
      ? context.selfTypeName
      : expression.name.name;
  const declId: IrTypeDeclId = `struct.${structName}`;
  const type = typeFromNode(context.checkResult, expression);
  const structType: IrType =
    type.kind === "named"
      ? { ...type, name: structName }
      : { kind: "named", name: structName, args: [] };
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
    type: structType,
    span: expression.span,
  });
  return { kind: "temp", id: target, type: structType };
}

function lowerMemberExpression(
  expression: MemberExpression,
  context: LowerContext,
): IrOperand {
  const type = typeFromNode(context.checkResult, expression);
  if (
    expression.object.kind === "IdentifierExpression" &&
    type.kind === "function"
  ) {
    const linkName = context.methodLinks.get(
      methodKey(expression.object.name, expression.property.name),
    );
    if (linkName) return { kind: "function", name: linkName, type };
  }

  const target = nextTemp(context);
  const object = lowerExpression(expression.object, context);

  if (expression.property.name === "len") {
    if (object.type.kind === "named" && object.type.name === "Array") {
      context.currentBlock.instructions.push({
        kind: "array_len",
        target,
        array: object,
        type: irPrimitive("i32"),
        span: expression.span,
      });
      return { kind: "temp", id: target, type: irPrimitive("i32") };
    }
    if (object.type.kind === "primitive" && object.type.name === "string") {
      context.currentBlock.instructions.push({
        kind: "string_len",
        target,
        string: object,
        type: irPrimitive("i32"),
        span: expression.span,
      });
      context.runtime.strings = true;
      return { kind: "temp", id: target, type: irPrimitive("i32") };
    }
  }

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
  context.localTypes.set(local.id, type);
  context.localDecls.push(local);
  return local;
}

function irTypeEquals(left: IrType, right: IrType): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "primitive" && right.kind === "primitive")
    return left.name === right.name;
  if (left.kind === "nullable" && right.kind === "nullable")
    return irTypeEquals(left.base, right.base);
  if (left.kind === "tuple" && right.kind === "tuple") {
    return (
      left.elements.length === right.elements.length &&
      left.elements.every((element, index) =>
        irTypeEquals(element, right.elements[index]),
      )
    );
  }
  if (left.kind === "named" && right.kind === "named") {
    return (
      left.name === right.name &&
      left.args.length === right.args.length &&
      left.args.every((arg, index) => irTypeEquals(arg, right.args[index]))
    );
  }
  if (left.kind === "function" && right.kind === "function") {
    return (
      left.params.length === right.params.length &&
      left.params.every(
        (param, index) =>
          param.mutable === right.params[index].mutable &&
          irTypeEquals(param.type, right.params[index].type),
      ) &&
      irTypeEquals(left.returnType, right.returnType)
    );
  }
  return left.kind === right.kind;
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

function typeFromTypeNodeWithSelf(
  node: TypeNode,
  selfTypeName: string,
): IrType {
  const type = typeFromTypeNode(node);
  return replaceSelfType(type, selfTypeName);
}

function replaceSelfType(type: IrType, selfTypeName: string): IrType {
  if (type.kind === "named" && type.name === "Self") {
    return { ...type, name: selfTypeName };
  }
  if (type.kind === "nullable") {
    return { ...type, base: replaceSelfType(type.base, selfTypeName) };
  }
  if (type.kind === "tuple") {
    return {
      ...type,
      elements: type.elements.map((element) =>
        replaceSelfType(element, selfTypeName),
      ),
    };
  }
  if (type.kind === "function") {
    return {
      ...type,
      params: type.params.map((param) => ({
        ...param,
        type: replaceSelfType(param.type, selfTypeName),
      })),
      returnType: replaceSelfType(type.returnType, selfTypeName),
    };
  }
  if (type.kind === "named" && type.args.length > 0) {
    return {
      ...type,
      args: type.args.map((arg) => replaceSelfType(arg, selfTypeName)),
    };
  }
  return type;
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

function methodKey(ownerName: string, methodName: string): string {
  return `${ownerName}.${methodName}`;
}

function methodLinkName(ownerName: string, methodName: string): string {
  return `${ownerName}_${methodName}`;
}
